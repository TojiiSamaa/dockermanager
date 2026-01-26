import { dockerService } from "./docker-service";
import { pluginLogger } from "../actions/debug-logs";

export interface ComposeFile {
  path: string;
  directory: string;
  filename: string;
  projectName: string;
  services: string[];
  lastModified?: Date;
}

export interface ComposeStack {
  name: string;
  status: "running" | "partial" | "stopped" | "unknown";
  services: ComposeServiceInfo[];
  configPath: string;
}

export interface ComposeServiceInfo {
  name: string;
  status: "running" | "exited" | "restarting" | "paused" | "dead" | "unknown";
  image: string;
  ports: string[];
}

export type ComposeCommand = "up" | "down" | "restart" | "build" | "pull" | "logs" | "ps";

class ComposeService {
  private composeFilesCache: ComposeFile[] = [];
  private lastScan: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute cache

  /**
   * Discover all docker-compose files on the server
   * Searches common locations and allows custom paths
   */
  async discoverComposeFiles(searchPaths: string[] = ["/"]): Promise<ComposeFile[]> {
    const now = Date.now();

    // Return cache if fresh
    if (this.composeFilesCache.length > 0 && (now - this.lastScan) < this.CACHE_TTL) {
      return this.composeFilesCache;
    }

    try {
      const files: ComposeFile[] = [];

      // Build find command for compose files
      const searchPathsStr = searchPaths.join(" ");
      const command = `find ${searchPathsStr} \\( -name "docker-compose.yml" -o -name "docker-compose.yaml" -o -name "compose.yml" -o -name "compose.yaml" \\) -type f 2>/dev/null | head -100`;

      const output = await this.execCommand(command);
      const paths = output.trim().split("\n").filter(p => p.trim());

      for (const filePath of paths) {
        try {
          const file = await this.parseComposeFile(filePath);
          if (file) {
            files.push(file);
          }
        } catch (err) {
          pluginLogger.warn(`Failed to parse compose file ${filePath}: ${err}`, "compose");
        }
      }

      this.composeFilesCache = files;
      this.lastScan = now;

      pluginLogger.info(`Discovered ${files.length} compose files`, "compose");
      return files;
    } catch (error) {
      pluginLogger.error(`Failed to discover compose files: ${error}`, "compose");
      return this.composeFilesCache; // Return stale cache on error
    }
  }

  /**
   * Parse a compose file to extract service information
   */
  private async parseComposeFile(filePath: string): Promise<ComposeFile | null> {
    try {
      // Get directory and filename
      const parts = filePath.split("/");
      const filename = parts.pop() || "";
      const directory = parts.join("/");

      // Extract project name from directory (last folder name)
      const projectName = parts[parts.length - 1] || "unknown";

      // Get services from compose file using docker compose config
      const servicesOutput = await this.execCommand(
        `cd "${directory}" && docker compose -f "${filename}" config --services 2>/dev/null || docker-compose -f "${filename}" config --services 2>/dev/null || echo ""`
      );

      const services = servicesOutput.trim().split("\n").filter(s => s.trim());

      // Get last modified time
      const statOutput = await this.execCommand(`stat -c %Y "${filePath}" 2>/dev/null || echo "0"`);
      const timestamp = parseInt(statOutput.trim()) || 0;
      const lastModified = timestamp > 0 ? new Date(timestamp * 1000) : undefined;

      return {
        path: filePath,
        directory,
        filename,
        projectName,
        services,
        lastModified
      };
    } catch (error) {
      pluginLogger.error(`Failed to parse ${filePath}: ${error}`, "compose");
      return null;
    }
  }

  /**
   * Get status of a compose stack
   */
  async getStackStatus(composeFile: ComposeFile): Promise<ComposeStack> {
    try {
      const { directory, filename, projectName } = composeFile;

      // Get running containers for this stack
      const output = await this.execCommand(
        `cd "${directory}" && docker compose -f "${filename}" ps --format json 2>/dev/null || docker-compose -f "${filename}" ps --format json 2>/dev/null || echo "[]"`
      );

      let services: ComposeServiceInfo[] = [];

      try {
        // Try to parse JSON output (newer docker compose)
        const lines = output.trim().split("\n").filter(l => l.trim());
        for (const line of lines) {
          if (line.startsWith("{")) {
            const data = JSON.parse(line);
            services.push({
              name: data.Service || data.Name || "unknown",
              status: this.mapServiceStatus(data.State || data.Status || "unknown"),
              image: data.Image || "",
              ports: data.Ports ? [data.Ports] : []
            });
          }
        }
      } catch {
        // Fallback: parse text output
        const psOutput = await this.execCommand(
          `cd "${directory}" && docker compose -f "${filename}" ps 2>/dev/null || docker-compose -f "${filename}" ps 2>/dev/null`
        );
        services = this.parseTextPsOutput(psOutput, composeFile.services);
      }

      // Determine overall status
      let status: ComposeStack["status"] = "unknown";
      if (services.length === 0) {
        status = "stopped";
      } else {
        const runningCount = services.filter(s => s.status === "running").length;
        if (runningCount === services.length) {
          status = "running";
        } else if (runningCount > 0) {
          status = "partial";
        } else {
          status = "stopped";
        }
      }

      return {
        name: projectName,
        status,
        services,
        configPath: composeFile.path
      };
    } catch (error) {
      pluginLogger.error(`Failed to get stack status: ${error}`, "compose");
      return {
        name: composeFile.projectName,
        status: "unknown",
        services: [],
        configPath: composeFile.path
      };
    }
  }

  private parseTextPsOutput(output: string, expectedServices: string[]): ComposeServiceInfo[] {
    const services: ComposeServiceInfo[] = [];
    const lines = output.trim().split("\n");

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Try to extract service name and status
      const parts = line.split(/\s{2,}/);
      if (parts.length >= 2) {
        const name = parts[0].split("-").slice(-1)[0] || parts[0];
        const statusStr = parts.find(p =>
          p.toLowerCase().includes("up") ||
          p.toLowerCase().includes("exit") ||
          p.toLowerCase().includes("running")
        ) || "unknown";

        services.push({
          name,
          status: this.mapServiceStatus(statusStr),
          image: "",
          ports: []
        });
      }
    }

    return services;
  }

  private mapServiceStatus(status: string): ComposeServiceInfo["status"] {
    const lower = status.toLowerCase();
    if (lower.includes("running") || lower.includes("up")) return "running";
    if (lower.includes("exit")) return "exited";
    if (lower.includes("restart")) return "restarting";
    if (lower.includes("pause")) return "paused";
    if (lower.includes("dead")) return "dead";
    return "unknown";
  }

  /**
   * Execute a compose command
   */
  async executeCommand(
    composeFile: ComposeFile,
    command: ComposeCommand,
    options: {
      detached?: boolean;
      build?: boolean;
      forceRecreate?: boolean;
      service?: string;
      tail?: number;
    } = {}
  ): Promise<{ success: boolean; output: string }> {
    const { directory, filename } = composeFile;
    const { detached = true, build = false, forceRecreate = false, service, tail } = options;

    let cmd = `cd "${directory}" && docker compose -f "${filename}"`;

    // Fallback to docker-compose if docker compose fails
    const fallbackCmd = `cd "${directory}" && docker-compose -f "${filename}"`;

    switch (command) {
      case "up":
        cmd += " up";
        if (detached) cmd += " -d";
        if (build) cmd += " --build";
        if (forceRecreate) cmd += " --force-recreate";
        if (service) cmd += ` ${service}`;
        break;

      case "down":
        cmd += " down";
        if (service) {
          // For single service, use stop and rm instead
          cmd = `cd "${directory}" && docker compose -f "${filename}" stop ${service} && docker compose -f "${filename}" rm -f ${service}`;
        }
        break;

      case "restart":
        cmd += " restart";
        if (service) cmd += ` ${service}`;
        break;

      case "build":
        cmd += " build";
        if (service) cmd += ` ${service}`;
        break;

      case "pull":
        cmd += " pull";
        if (service) cmd += ` ${service}`;
        break;

      case "logs":
        cmd += " logs";
        if (tail) cmd += ` --tail ${tail}`;
        if (service) cmd += ` ${service}`;
        break;

      case "ps":
        cmd += " ps";
        break;
    }

    try {
      pluginLogger.info(`Executing compose command: ${command} in ${directory}`, "compose");
      const output = await this.execCommand(`${cmd} 2>&1 || ${fallbackCmd.replace("docker compose", "docker-compose")} ${command} 2>&1`);
      return { success: true, output };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      pluginLogger.error(`Compose command failed: ${errorMsg}`, "compose");
      return { success: false, output: errorMsg };
    }
  }

  /**
   * Start a compose stack with optional build
   */
  async up(composeFile: ComposeFile, options: { build?: boolean; service?: string } = {}): Promise<boolean> {
    const result = await this.executeCommand(composeFile, "up", {
      detached: true,
      build: options.build,
      service: options.service
    });
    return result.success;
  }

  /**
   * Stop a compose stack
   */
  async down(composeFile: ComposeFile, service?: string): Promise<boolean> {
    const result = await this.executeCommand(composeFile, "down", { service });
    return result.success;
  }

  /**
   * Restart a compose stack or service
   */
  async restart(composeFile: ComposeFile, service?: string): Promise<boolean> {
    const result = await this.executeCommand(composeFile, "restart", { service });
    return result.success;
  }

  /**
   * Build images for a compose stack
   */
  async build(composeFile: ComposeFile, service?: string): Promise<{ success: boolean; output: string }> {
    return this.executeCommand(composeFile, "build", { service });
  }

  /**
   * Pull images for a compose stack
   */
  async pull(composeFile: ComposeFile, service?: string): Promise<boolean> {
    const result = await this.executeCommand(composeFile, "pull", { service });
    return result.success;
  }

  /**
   * Get logs for a compose stack
   */
  async getLogs(composeFile: ComposeFile, options: { service?: string; tail?: number } = {}): Promise<string> {
    const result = await this.executeCommand(composeFile, "logs", {
      tail: options.tail || 100,
      service: options.service
    });
    return result.output;
  }

  /**
   * Clear the compose files cache
   */
  clearCache(): void {
    this.composeFilesCache = [];
    this.lastScan = 0;
  }

  /**
   * Search compose files by name or path
   */
  searchComposeFiles(query: string): ComposeFile[] {
    const lowerQuery = query.toLowerCase();
    return this.composeFilesCache.filter(f =>
      f.projectName.toLowerCase().includes(lowerQuery) ||
      f.path.toLowerCase().includes(lowerQuery) ||
      f.services.some(s => s.toLowerCase().includes(lowerQuery))
    );
  }

  private async execCommand(command: string): Promise<string> {
    // Use dockerService's SSH connection
    return (dockerService as any).execSSHCommand(command);
  }
}

export const composeService = new ComposeService();
