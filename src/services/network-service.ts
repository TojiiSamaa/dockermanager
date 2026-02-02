import { dockerService } from "./docker-service";
import { pluginLogger } from "../actions/debug-logs";

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  containers: number;
  createdAt?: string;
}

class NetworkService {
  /**
   * List all Docker networks
   */
  async listNetworks(): Promise<DockerNetwork[]> {
    try {
      const output = await this.execCommand(
        `docker network ls --format '{{.ID}}|{{.Name}}|{{.Driver}}|{{.Scope}}'`
      );

      const lines = output.trim().split("\n").filter(l => l.trim());
      const networks: DockerNetwork[] = [];

      for (const line of lines) {
        const [id, name, driver, scope] = line.split("|");
        if (id && name) {
          // Get container count for this network
          const containerCount = await this.getNetworkContainerCount(name);

          networks.push({
            id: id.trim(),
            name: name.trim(),
            driver: driver?.trim() || "unknown",
            scope: scope?.trim() || "local",
            internal: false,
            containers: containerCount
          });
        }
      }

      return networks;
    } catch (error) {
      pluginLogger.error(`Failed to list networks: ${error}`, "network");
      return [];
    }
  }

  /**
   * Get detailed information about a network
   */
  async inspectNetwork(networkName: string): Promise<any> {
    try {
      const output = await this.execCommand(
        `docker network inspect ${networkName} --format '{{json .}}'`
      );
      return JSON.parse(output.trim());
    } catch (error) {
      pluginLogger.error(`Failed to inspect network ${networkName}: ${error}`, "network");
      return null;
    }
  }

  /**
   * Get count of containers connected to a network
   */
  private async getNetworkContainerCount(networkName: string): Promise<number> {
    try {
      const output = await this.execCommand(
        `docker network inspect ${networkName} --format '{{len .Containers}}' 2>/dev/null || echo "0"`
      );
      return parseInt(output.trim()) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Create a new network
   */
  async createNetwork(name: string, driver: string = "bridge"): Promise<boolean> {
    try {
      await this.execCommand(`docker network create --driver ${driver} ${name}`);
      pluginLogger.info(`Created network: ${name}`, "network");
      return true;
    } catch (error) {
      pluginLogger.error(`Failed to create network ${name}: ${error}`, "network");
      return false;
    }
  }

  /**
   * Remove a network
   */
  async removeNetwork(networkName: string): Promise<boolean> {
    try {
      await this.execCommand(`docker network rm ${networkName}`);
      pluginLogger.info(`Removed network: ${networkName}`, "network");
      return true;
    } catch (error) {
      pluginLogger.error(`Failed to remove network ${networkName}: ${error}`, "network");
      return false;
    }
  }

  /**
   * Prune unused networks
   */
  async pruneNetworks(): Promise<{ success: boolean; networksRemoved?: string[] }> {
    try {
      const output = await this.execCommand(`docker network prune -f`);
      pluginLogger.info(`Pruned networks: ${output}`, "network");

      // Parse removed networks
      const removedMatch = output.match(/Deleted Networks:\n([\s\S]*?)(?:\n\n|$)/);
      const networksRemoved = removedMatch
        ? removedMatch[1].trim().split("\n").filter(n => n.trim())
        : [];

      return { success: true, networksRemoved };
    } catch (error) {
      pluginLogger.error(`Failed to prune networks: ${error}`, "network");
      return { success: false };
    }
  }

  /**
   * Get network summary (count and types)
   */
  async getNetworkSummary(): Promise<{ total: number; bridge: number; host: number; overlay: number; custom: number }> {
    try {
      const networks = await this.listNetworks();

      return {
        total: networks.length,
        bridge: networks.filter(n => n.driver === "bridge").length,
        host: networks.filter(n => n.driver === "host").length,
        overlay: networks.filter(n => n.driver === "overlay").length,
        custom: networks.filter(n => !["bridge", "host", "overlay", "null", "none"].includes(n.driver)).length
      };
    } catch (error) {
      pluginLogger.error(`Failed to get network summary: ${error}`, "network");
      return { total: 0, bridge: 0, host: 0, overlay: 0, custom: 0 };
    }
  }

  private async execCommand(command: string): Promise<string> {
    return (dockerService as any).execSSHCommand(command);
  }
}

export const networkService = new NetworkService();
