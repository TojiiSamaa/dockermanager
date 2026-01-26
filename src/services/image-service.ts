import https from "https";
import { dockerService } from "./docker-service";
import { pluginLogger } from "../actions/debug-logs";

export interface DockerHubImage {
  name: string;
  namespace: string;
  fullName: string;
  description: string;
  starCount: number;
  pullCount: number;
  isOfficial: boolean;
  isAutomated: boolean;
}

export interface DockerHubTag {
  name: string;
  fullSize: number;
  lastUpdated: Date;
  digest: string;
}

export interface LocalImage {
  id: string;
  repository: string;
  tag: string;
  fullName: string;
  size: number;
  created: Date;
  inUse: boolean;
}

export interface PullProgress {
  status: string;
  progress?: string;
  id?: string;
}

class ImageService {
  private localImagesCache: LocalImage[] = [];
  private lastLocalScan: number = 0;
  private readonly LOCAL_CACHE_TTL = 30000; // 30 seconds

  /**
   * Search Docker Hub for images
   */
  async searchDockerHub(query: string, limit: number = 25): Promise<DockerHubImage[]> {
    if (!query || query.length < 2) {
      return [];
    }

    try {
      const url = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=${limit}`;
      const response = await this.httpGet(url);
      const data = JSON.parse(response);

      return (data.results || []).map((item: any) => ({
        name: item.repo_name || item.name,
        namespace: item.repo_name?.split("/")[0] || "library",
        fullName: item.repo_name || item.name,
        description: item.short_description || item.description || "",
        starCount: item.star_count || 0,
        pullCount: item.pull_count || 0,
        isOfficial: item.is_official || false,
        isAutomated: item.is_automated || false
      }));
    } catch (error) {
      pluginLogger.error(`Docker Hub search failed: ${error}`, "image");
      return [];
    }
  }

  /**
   * Get available tags for a Docker Hub image
   */
  async getImageTags(imageName: string, limit: number = 50): Promise<DockerHubTag[]> {
    try {
      // Handle official images (no namespace)
      let namespace = "library";
      let repo = imageName;

      if (imageName.includes("/")) {
        [namespace, repo] = imageName.split("/");
      }

      const url = `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags/?page_size=${limit}&ordering=-last_updated`;
      const response = await this.httpGet(url);
      const data = JSON.parse(response);

      return (data.results || []).map((tag: any) => ({
        name: tag.name,
        fullSize: tag.full_size || 0,
        lastUpdated: new Date(tag.last_updated || tag.tag_last_pushed),
        digest: tag.digest || tag.images?.[0]?.digest || ""
      }));
    } catch (error) {
      pluginLogger.error(`Failed to get tags for ${imageName}: ${error}`, "image");
      return [];
    }
  }

  /**
   * List local Docker images
   */
  async listLocalImages(forceRefresh: boolean = false): Promise<LocalImage[]> {
    const now = Date.now();

    if (!forceRefresh && this.localImagesCache.length > 0 && (now - this.lastLocalScan) < this.LOCAL_CACHE_TTL) {
      return this.localImagesCache;
    }

    try {
      // Get images with their info
      const output = await this.execCommand(
        `docker images --format '{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}' && echo "---CONTAINERS---" && docker ps -a --format '{{.Image}}'`
      );

      const lines = output.trim().split("\n");
      const containerIndex = lines.findIndex(l => l.includes("---CONTAINERS---"));

      const imageLines = containerIndex > 0 ? lines.slice(0, containerIndex) : lines;
      const containerImages = containerIndex > 0 ? lines.slice(containerIndex + 1) : [];

      // Create a set of images in use
      const inUseImages = new Set(containerImages.map(i => i.trim()).filter(i => i));

      const images: LocalImage[] = [];

      for (const line of imageLines) {
        if (!line.trim() || line.includes("---")) continue;

        const [id, repository, tag, size, created] = line.split("|");
        if (!id || !repository) continue;

        const fullName = tag && tag !== "<none>" ? `${repository}:${tag}` : repository;

        images.push({
          id: id.substring(0, 12),
          repository: repository || "<none>",
          tag: tag || "<none>",
          fullName,
          size: this.parseSize(size || "0"),
          created: new Date(created || Date.now()),
          inUse: inUseImages.has(fullName) || inUseImages.has(repository) || inUseImages.has(id)
        });
      }

      this.localImagesCache = images;
      this.lastLocalScan = now;

      return images;
    } catch (error) {
      pluginLogger.error(`Failed to list local images: ${error}`, "image");
      return this.localImagesCache;
    }
  }

  /**
   * Pull an image from Docker Hub
   */
  async pullImage(imageName: string, tag: string = "latest", onProgress?: (progress: PullProgress) => void): Promise<boolean> {
    try {
      const fullName = `${imageName}:${tag}`;
      pluginLogger.info(`Pulling image: ${fullName}`, "image");

      // Execute pull command
      const output = await this.execCommand(`docker pull ${fullName} 2>&1`);

      // Check if pull was successful
      if (output.includes("Downloaded") || output.includes("Pull complete") || output.includes("Image is up to date")) {
        pluginLogger.info(`Successfully pulled ${fullName}`, "image");
        this.clearLocalCache();
        return true;
      }

      pluginLogger.error(`Pull may have failed: ${output}`, "image");
      return false;
    } catch (error) {
      pluginLogger.error(`Failed to pull image: ${error}`, "image");
      return false;
    }
  }

  /**
   * Remove a local image
   */
  async removeImage(imageId: string, force: boolean = false): Promise<boolean> {
    try {
      const forceFlag = force ? " -f" : "";
      await this.execCommand(`docker rmi${forceFlag} ${imageId}`);
      this.clearLocalCache();
      return true;
    } catch (error) {
      pluginLogger.error(`Failed to remove image ${imageId}: ${error}`, "image");
      return false;
    }
  }

  /**
   * Remove all dangling (unused) images
   */
  async pruneImages(): Promise<{ success: boolean; spaceSaved: string }> {
    try {
      const output = await this.execCommand("docker image prune -f 2>&1");

      // Extract space saved from output
      const match = output.match(/Total reclaimed space:\s*(.+)/i);
      const spaceSaved = match ? match[1].trim() : "0B";

      this.clearLocalCache();

      return { success: true, spaceSaved };
    } catch (error) {
      pluginLogger.error(`Failed to prune images: ${error}`, "image");
      return { success: false, spaceSaved: "0B" };
    }
  }

  /**
   * Remove all unused images (not just dangling)
   */
  async pruneAllUnused(): Promise<{ success: boolean; spaceSaved: string }> {
    try {
      const output = await this.execCommand("docker image prune -a -f 2>&1");

      const match = output.match(/Total reclaimed space:\s*(.+)/i);
      const spaceSaved = match ? match[1].trim() : "0B";

      this.clearLocalCache();

      return { success: true, spaceSaved };
    } catch (error) {
      pluginLogger.error(`Failed to prune all unused images: ${error}`, "image");
      return { success: false, spaceSaved: "0B" };
    }
  }

  /**
   * Full system prune (containers, images, volumes, networks)
   */
  async systemPrune(includeVolumes: boolean = false): Promise<{ success: boolean; spaceSaved: string }> {
    try {
      const volumeFlag = includeVolumes ? " --volumes" : "";
      const output = await this.execCommand(`docker system prune -f${volumeFlag} 2>&1`);

      const match = output.match(/Total reclaimed space:\s*(.+)/i);
      const spaceSaved = match ? match[1].trim() : "0B";

      this.clearLocalCache();

      return { success: true, spaceSaved };
    } catch (error) {
      pluginLogger.error(`Failed to system prune: ${error}`, "image");
      return { success: false, spaceSaved: "0B" };
    }
  }

  /**
   * Get disk usage information
   */
  async getDiskUsage(): Promise<{
    images: { count: number; size: string };
    containers: { count: number; size: string };
    volumes: { count: number; size: string };
    buildCache: { size: string };
    total: string;
  }> {
    try {
      const output = await this.execCommand("docker system df 2>&1");
      const lines = output.trim().split("\n");

      const result = {
        images: { count: 0, size: "0B" },
        containers: { count: 0, size: "0B" },
        volumes: { count: 0, size: "0B" },
        buildCache: { size: "0B" },
        total: "0B"
      };

      for (const line of lines) {
        const parts = line.split(/\s{2,}/).filter(p => p.trim());
        if (parts.length < 4) continue;

        const type = parts[0].toLowerCase();
        if (type.includes("images")) {
          result.images = { count: parseInt(parts[1]) || 0, size: parts[3] || "0B" };
        } else if (type.includes("containers")) {
          result.containers = { count: parseInt(parts[1]) || 0, size: parts[3] || "0B" };
        } else if (type.includes("volumes")) {
          result.volumes = { count: parseInt(parts[1]) || 0, size: parts[3] || "0B" };
        } else if (type.includes("build")) {
          result.buildCache = { size: parts[3] || parts[2] || "0B" };
        }
      }

      // Calculate total
      const totalBytes =
        this.parseSize(result.images.size) +
        this.parseSize(result.containers.size) +
        this.parseSize(result.volumes.size) +
        this.parseSize(result.buildCache.size);

      result.total = this.formatSize(totalBytes);

      return result;
    } catch (error) {
      pluginLogger.error(`Failed to get disk usage: ${error}`, "image");
      return {
        images: { count: 0, size: "0B" },
        containers: { count: 0, size: "0B" },
        volumes: { count: 0, size: "0B" },
        buildCache: { size: "0B" },
        total: "0B"
      };
    }
  }

  /**
   * Search local images
   */
  searchLocalImages(query: string): LocalImage[] {
    const lowerQuery = query.toLowerCase();
    return this.localImagesCache.filter(img =>
      img.repository.toLowerCase().includes(lowerQuery) ||
      img.tag.toLowerCase().includes(lowerQuery) ||
      img.id.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Clear local images cache
   */
  clearLocalCache(): void {
    this.localImagesCache = [];
    this.lastLocalScan = 0;
  }

  private parseSize(sizeStr: string): number {
    const match = sizeStr.match(/^([\d.]+)\s*([KMGT]?B?)$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers: Record<string, number> = {
      "B": 1,
      "KB": 1024,
      "MB": 1024 * 1024,
      "GB": 1024 * 1024 * 1024,
      "TB": 1024 * 1024 * 1024 * 1024
    };

    return value * (multipliers[unit] || 1);
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          "User-Agent": "StreamDeck-DockerManager/1.0"
        }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }).on("error", reject);
    });
  }

  private async execCommand(command: string): Promise<string> {
    return (dockerService as any).execSSHCommand(command);
  }
}

export const imageService = new ImageService();
