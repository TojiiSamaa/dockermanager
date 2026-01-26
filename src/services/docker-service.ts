import { Client as SSHClient } from "ssh2";
import Dockerode from "dockerode";

export interface ServerConfig {
  connectionType: "ssh" | "docker-api";
  // SSH config
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPrivateKey?: string;
  sshPassword?: string;
  // Docker API config
  dockerHost?: string;
  dockerPort?: number;
  dockerCertPath?: string;
  // Connection options (for internet/VPN)
  connectionTimeout?: number;  // in seconds, default 30
  keepAlive?: boolean;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: "running" | "stopped" | "paused" | "restarting" | "exited";
  status: string;
  iconUrl?: string;  // URL to container icon (from Unraid labels or other sources)
}

export interface ContainerHealth {
  state: "running" | "stopped" | "paused" | "restarting" | "exited";
  startedAt: Date | null;
  restartCount: number;
  exitCode: number | null;
  uptime: number; // seconds since started
  isStable: boolean; // running for more than stability threshold
  isCrashLooping: boolean; // high restart count in short time
}

export interface ContainerConfig {
  containerId: string;
  containerName: string;
  displayName?: string;
  category?: string;
}

class DockerService {
  private sshClient: SSHClient | null = null;
  private dockerClient: Dockerode | null = null;
  private config: ServerConfig | null = null;
  private connected: boolean = false;
  // Cache for last known health state to avoid showing "stopped" on temporary failures
  private healthCache: Map<string, { health: ContainerHealth; timestamp: number }> = new Map();
  // Cache TTL in milliseconds (5 minutes)
  private readonly HEALTH_CACHE_TTL = 5 * 60 * 1000;
  // Bulk refresh state
  private bulkRefreshInProgress: boolean = false;
  private lastBulkRefresh: number = 0;
  private readonly BULK_REFRESH_INTERVAL = 3000; // Minimum 3 seconds between bulk refreshes

  async configure(config: ServerConfig): Promise<void> {
    this.config = config;
    await this.disconnect();
  }

  async connect(): Promise<boolean> {
    if (!this.config) {
      throw new Error("Server not configured");
    }

    if (this.config.connectionType === "docker-api") {
      return this.connectDockerAPI();
    } else {
      return this.connectSSH();
    }
  }

  private async connectDockerAPI(): Promise<boolean> {
    try {
      const options: Dockerode.DockerOptions = {};

      if (this.config!.dockerHost) {
        options.host = this.config!.dockerHost;
        options.port = this.config!.dockerPort || 2375;
        options.protocol = this.config!.dockerCertPath ? "https" : "http";

        if (this.config!.dockerCertPath) {
          options.ca = this.config!.dockerCertPath + "/ca.pem";
          options.cert = this.config!.dockerCertPath + "/cert.pem";
          options.key = this.config!.dockerCertPath + "/key.pem";
        }
      }

      this.dockerClient = new Dockerode(options);
      await this.dockerClient.ping();
      this.connected = true;
      return true;
    } catch (error) {
      console.error("Docker API connection failed:", error);
      this.connected = false;
      return false;
    }
  }

  private connectSSH(): Promise<boolean> {
    return new Promise((resolve) => {
      this.sshClient = new SSHClient();

      const timeout = (this.config!.connectionTimeout || 30) * 1000;
      let timeoutId: NodeJS.Timeout;

      this.sshClient.on("ready", () => {
        clearTimeout(timeoutId);
        this.connected = true;
        console.log("SSH connected successfully");
        resolve(true);
      });

      this.sshClient.on("error", (err) => {
        clearTimeout(timeoutId);
        console.error("SSH connection error:", err);
        this.connected = false;
        resolve(false);
      });

      this.sshClient.on("close", () => {
        this.connected = false;
      });

      const connectConfig: any = {
        host: this.config!.sshHost,
        port: this.config!.sshPort || 22,
        username: this.config!.sshUsername,
        readyTimeout: timeout,
        keepaliveInterval: this.config!.keepAlive ? 10000 : 0,
        keepaliveCountMax: 3,
      };

      if (this.config!.sshPrivateKey) {
        connectConfig.privateKey = this.config!.sshPrivateKey;
      } else if (this.config!.sshPassword) {
        connectConfig.password = this.config!.sshPassword;
      }

      // Timeout fallback
      timeoutId = setTimeout(() => {
        console.error("SSH connection timeout");
        this.sshClient?.end();
        this.connected = false;
        resolve(false);
      }, timeout + 5000);

      console.log(`Connecting to SSH: ${this.config!.sshHost}:${this.config!.sshPort || 22}`);
      this.sshClient.connect(connectConfig);
    });
  }

  async disconnect(): Promise<void> {
    if (this.sshClient) {
      this.sshClient.end();
      this.sshClient = null;
    }
    this.dockerClient = null;
    this.connected = false;
    // Clear health cache on disconnect
    this.healthCache.clear();
  }

  async listContainers(): Promise<ContainerInfo[]> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.config?.connectionType === "docker-api") {
      return this.listContainersDockerAPI();
    } else {
      return this.listContainersSSH();
    }
  }

  private async listContainersDockerAPI(): Promise<ContainerInfo[]> {
    if (!this.dockerClient) {
      throw new Error("Docker client not connected");
    }

    const containers = await this.dockerClient.listContainers({ all: true });

    return containers.map((container) => ({
      id: container.Id.substring(0, 12),
      name: container.Names[0]?.replace(/^\//, "") || container.Id.substring(0, 12),
      image: container.Image,
      state: this.mapDockerState(container.State),
      status: container.Status,
      // Get icon from Unraid label if available
      iconUrl: container.Labels?.["net.unraid.docker.icon"] || undefined,
    }));
  }

  private mapDockerState(state: string): ContainerInfo["state"] {
    switch (state.toLowerCase()) {
      case "running":
        return "running";
      case "paused":
        return "paused";
      case "restarting":
        return "restarting";
      case "exited":
      case "dead":
        return "exited";
      default:
        return "stopped";
    }
  }

  private listContainersSSH(): Promise<ContainerInfo[]> {
    // Use docker ps with label to get Unraid icon URL
    return this.execSSHCommand(
      'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Label \\"net.unraid.docker.icon\\"}}"'
    ).then((output) => {
      const lines = output.trim().split("\n").filter(Boolean);
      return lines.map((line) => {
        const parts = line.split("|");
        const [id, name, image, state, status] = parts;
        const iconUrl = parts[5] || undefined;
        return {
          id,
          name,
          image,
          state: this.mapDockerState(state),
          status,
          iconUrl: iconUrl && iconUrl.trim() ? iconUrl.trim() : undefined,
        };
      });
    });
  }

  async getContainerState(containerIdOrName: string): Promise<ContainerInfo["state"]> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.config?.connectionType === "docker-api") {
      return this.getContainerStateDockerAPI(containerIdOrName);
    } else {
      return this.getContainerStateSSH(containerIdOrName);
    }
  }

  private async getContainerStateDockerAPI(containerIdOrName: string): Promise<ContainerInfo["state"]> {
    if (!this.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = this.dockerClient.getContainer(containerIdOrName);
      const info = await container.inspect();
      return this.mapDockerState(info.State.Status);
    } catch {
      return "stopped";
    }
  }

  private async getContainerStateSSH(containerIdOrName: string): Promise<ContainerInfo["state"]> {
    const output = await this.execSSHCommand(
      `docker inspect --format '{{.State.Status}}' ${containerIdOrName} 2>/dev/null || echo "stopped"`
    );
    return this.mapDockerState(output.trim());
  }

  async startContainer(containerIdOrName: string): Promise<boolean> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.config?.connectionType === "docker-api") {
      return this.startContainerDockerAPI(containerIdOrName);
    } else {
      return this.startContainerSSH(containerIdOrName);
    }
  }

  private async startContainerDockerAPI(containerIdOrName: string): Promise<boolean> {
    if (!this.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = this.dockerClient.getContainer(containerIdOrName);
      await container.start();
      return true;
    } catch (error) {
      console.error("Failed to start container:", error);
      return false;
    }
  }

  private async startContainerSSH(containerIdOrName: string): Promise<boolean> {
    try {
      await this.execSSHCommand(`docker start ${containerIdOrName}`);
      return true;
    } catch {
      return false;
    }
  }

  async stopContainer(containerIdOrName: string): Promise<boolean> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.config?.connectionType === "docker-api") {
      return this.stopContainerDockerAPI(containerIdOrName);
    } else {
      return this.stopContainerSSH(containerIdOrName);
    }
  }

  private async stopContainerDockerAPI(containerIdOrName: string): Promise<boolean> {
    if (!this.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = this.dockerClient.getContainer(containerIdOrName);
      await container.stop();
      return true;
    } catch (error) {
      console.error("Failed to stop container:", error);
      return false;
    }
  }

  private async stopContainerSSH(containerIdOrName: string): Promise<boolean> {
    try {
      await this.execSSHCommand(`docker stop ${containerIdOrName}`);
      return true;
    } catch {
      return false;
    }
  }

  async restartContainer(containerIdOrName: string): Promise<boolean> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.config?.connectionType === "docker-api") {
      return this.restartContainerDockerAPI(containerIdOrName);
    } else {
      return this.restartContainerSSH(containerIdOrName);
    }
  }

  private async restartContainerDockerAPI(containerIdOrName: string): Promise<boolean> {
    if (!this.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = this.dockerClient.getContainer(containerIdOrName);
      await container.restart();
      return true;
    } catch (error) {
      console.error("Failed to restart container:", error);
      return false;
    }
  }

  private async restartContainerSSH(containerIdOrName: string): Promise<boolean> {
    try {
      await this.execSSHCommand(`docker restart ${containerIdOrName}`);
      return true;
    } catch {
      return false;
    }
  }

  private execSSHCommand(command: string, retryCount: number = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.sshClient || !this.connected) {
        // Try to reconnect once
        if (retryCount === 0) {
          this.connect().then((connected) => {
            if (connected) {
              this.execSSHCommand(command, 1).then(resolve).catch(reject);
            } else {
              reject(new Error("SSH client not connected and reconnection failed"));
            }
          }).catch(reject);
          return;
        }
        reject(new Error("SSH client not connected"));
        return;
      }

      // Set a timeout for the command
      const commandTimeout = setTimeout(() => {
        reject(new Error("SSH command timeout"));
      }, 30000);

      this.sshClient.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(commandTimeout);
          // Mark as disconnected on exec error
          this.connected = false;
          reject(err);
          return;
        }

        let output = "";
        let errorOutput = "";

        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });

        stream.on("close", (code: number) => {
          clearTimeout(commandTimeout);
          if (code === 0 || output) {
            resolve(output);
          } else {
            reject(new Error(errorOutput || `Command failed with code ${code}`));
          }
        });

        stream.on("error", (err: Error) => {
          clearTimeout(commandTimeout);
          this.connected = false;
          reject(err);
        });
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getContainerLogs(containerIdOrName: string, lines: number = 100): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.config?.connectionType === "docker-api") {
      return this.getContainerLogsDockerAPI(containerIdOrName, lines);
    } else {
      return this.getContainerLogsSSH(containerIdOrName, lines);
    }
  }

  private async getContainerLogsDockerAPI(containerIdOrName: string, lines: number): Promise<string> {
    if (!this.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = this.dockerClient.getContainer(containerIdOrName);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: lines,
        timestamps: true,
      });
      return logs.toString();
    } catch (error) {
      console.error("Failed to get container logs:", error);
      return "Error getting logs";
    }
  }

  private async getContainerLogsSSH(containerIdOrName: string, lines: number): Promise<string> {
    try {
      const output = await this.execSSHCommand(
        `docker logs --tail ${lines} --timestamps ${containerIdOrName} 2>&1`
      );
      return output;
    } catch (error) {
      console.error("Failed to get container logs:", error);
      return "Error getting logs";
    }
  }

  // Stability threshold in seconds (container must be running for this long to be considered stable)
  private readonly STABILITY_THRESHOLD = 30;
  // Crash loop detection: if restarted more than this many times, consider it crashing
  private readonly CRASH_LOOP_THRESHOLD = 3;

  async getContainerHealth(containerIdOrName: string): Promise<ContainerHealth> {
    if (!this.connected) {
      await this.connect();
    }

    // Check if we have a recent cached value
    const cached = this.healthCache.get(containerIdOrName);
    const now = Date.now();

    // If cache is fresh (less than 3 seconds old), return it immediately
    if (cached && (now - cached.timestamp) < this.BULK_REFRESH_INTERVAL) {
      return cached.health;
    }

    // Trigger bulk refresh if not already in progress and enough time has passed
    if (!this.bulkRefreshInProgress && (now - this.lastBulkRefresh) >= this.BULK_REFRESH_INTERVAL) {
      // Don't await - let it run in background
      this.refreshAllContainerHealth().catch(err => {
        console.error("Bulk refresh failed:", err);
      });
    }

    // Return cached value if available (even if slightly stale)
    if (cached && (now - cached.timestamp) < this.HEALTH_CACHE_TTL) {
      return cached.health;
    }

    // No cache available, try individual fetch as fallback
    try {
      let health: ContainerHealth;
      if (this.config?.connectionType === "docker-api") {
        health = await this.getContainerHealthDockerAPI(containerIdOrName);
      } else {
        health = await this.getContainerHealthSSH(containerIdOrName);
      }

      // Cache the successful result
      this.healthCache.set(containerIdOrName, { health, timestamp: now });
      return health;
    } catch (error) {
      console.error(`Failed to get health for ${containerIdOrName}:`, error);

      // Return stopped as last resort
      return {
        state: "stopped",
        startedAt: null,
        restartCount: 0,
        exitCode: null,
        uptime: 0,
        isStable: false,
        isCrashLooping: false,
      };
    }
  }

  /**
   * Refresh health status for ALL containers in a single SSH call
   * Much more efficient than individual calls
   */
  async refreshAllContainerHealth(): Promise<void> {
    if (this.bulkRefreshInProgress) {
      return; // Already refreshing
    }

    this.bulkRefreshInProgress = true;

    try {
      if (!this.connected) {
        await this.connect();
      }

      const now = Date.now();

      if (this.config?.connectionType === "docker-api") {
        await this.refreshAllContainerHealthDockerAPI(now);
      } else {
        await this.refreshAllContainerHealthSSH(now);
      }

      this.lastBulkRefresh = now;
    } catch (error) {
      console.error("Failed to refresh all container health:", error);
    } finally {
      this.bulkRefreshInProgress = false;
    }
  }

  private async refreshAllContainerHealthDockerAPI(timestamp: number): Promise<void> {
    if (!this.dockerClient) {
      throw new Error("Docker client not connected");
    }

    const containers = await this.dockerClient.listContainers({ all: true });

    for (const container of containers) {
      try {
        const info = await this.dockerClient.getContainer(container.Id).inspect();
        const name = container.Names[0]?.replace(/^\//, "") || container.Id.substring(0, 12);

        const state = this.mapDockerState(info.State.Status);
        const startedAt = info.State.StartedAt ? new Date(info.State.StartedAt) : null;
        const restartCount = info.RestartCount || 0;
        const exitCode = info.State.ExitCode;

        let uptime = 0;
        if (startedAt && state === "running") {
          uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
        }

        const isStable = state === "running" && uptime >= this.STABILITY_THRESHOLD;
        const isCrashLooping = restartCount >= this.CRASH_LOOP_THRESHOLD && uptime < this.STABILITY_THRESHOLD;

        const health: ContainerHealth = {
          state,
          startedAt,
          restartCount,
          exitCode,
          uptime,
          isStable,
          isCrashLooping,
        };

        // Cache by both name and ID
        this.healthCache.set(name, { health, timestamp });
        this.healthCache.set(container.Id.substring(0, 12), { health, timestamp });
      } catch (err) {
        console.error(`Failed to get health for container ${container.Id}:`, err);
      }
    }
  }

  private async refreshAllContainerHealthSSH(timestamp: number): Promise<void> {
    // Get all containers with their health info in ONE command
    const output = await this.execSSHCommand(
      `docker ps -a --format '{{.Names}}|{{.ID}}|{{.State}}' && echo "---INSPECT---" && docker inspect --format '{{.Name}}|{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.ExitCode}}' $(docker ps -aq) 2>/dev/null || true`
    );

    const lines = output.trim().split("\n");
    const inspectIndex = lines.findIndex(l => l.includes("---INSPECT---"));

    if (inspectIndex === -1) {
      // Fallback: parse basic ps output only
      for (const line of lines) {
        if (!line.trim()) continue;
        const [name, id, stateStr] = line.split("|");
        if (!name || !id) continue;

        const state = this.mapDockerState(stateStr || "stopped");
        const health: ContainerHealth = {
          state,
          startedAt: null,
          restartCount: 0,
          exitCode: null,
          uptime: state === "running" ? 60 : 0, // Assume stable if running
          isStable: state === "running",
          isCrashLooping: false,
        };

        this.healthCache.set(name, { health, timestamp });
        this.healthCache.set(id, { health, timestamp });
      }
      return;
    }

    // Parse detailed inspect output
    const inspectLines = lines.slice(inspectIndex + 1);
    for (const line of inspectLines) {
      if (!line.trim()) continue;

      const parts = line.split("|");
      if (parts.length < 5) continue;

      // Remove leading slash from name
      const name = (parts[0] || "").replace(/^\//, "");
      const stateStr = parts[1] || "stopped";
      const startedAtStr = parts[2];
      const restartCount = parseInt(parts[3]) || 0;
      const exitCode = parts[4] ? parseInt(parts[4]) : null;

      if (!name) continue;

      const state = this.mapDockerState(stateStr);

      let startedAt: Date | null = null;
      let uptime = 0;

      if (startedAtStr && startedAtStr !== "0001-01-01T00:00:00Z") {
        startedAt = new Date(startedAtStr);
        if (state === "running" && !isNaN(startedAt.getTime())) {
          uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
        }
      }

      const isStable = state === "running" && uptime >= this.STABILITY_THRESHOLD;
      const isCrashLooping = restartCount >= this.CRASH_LOOP_THRESHOLD && uptime < this.STABILITY_THRESHOLD;

      const health: ContainerHealth = {
        state,
        startedAt,
        restartCount,
        exitCode,
        uptime,
        isStable,
        isCrashLooping,
      };

      this.healthCache.set(name, { health, timestamp });
    }
  }

  private async getContainerHealthDockerAPI(containerIdOrName: string): Promise<ContainerHealth> {
    if (!this.dockerClient) {
      throw new Error("Docker client not connected");
    }

    const container = this.dockerClient.getContainer(containerIdOrName);
    const info = await container.inspect();

    const state = this.mapDockerState(info.State.Status);
    const startedAt = info.State.StartedAt ? new Date(info.State.StartedAt) : null;
    const restartCount = info.RestartCount || 0;
    const exitCode = info.State.ExitCode;

    // Calculate uptime
    let uptime = 0;
    if (startedAt && state === "running") {
      uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    }

    const isStable = state === "running" && uptime >= this.STABILITY_THRESHOLD;
    const isCrashLooping = restartCount >= this.CRASH_LOOP_THRESHOLD && uptime < this.STABILITY_THRESHOLD;

    return {
      state,
      startedAt,
      restartCount,
      exitCode,
      uptime,
      isStable,
      isCrashLooping,
    };
  }

  private async getContainerHealthSSH(containerIdOrName: string): Promise<ContainerHealth> {
    // Get detailed container info via SSH
    const output = await this.execSSHCommand(
      `docker inspect --format '{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.ExitCode}}' ${containerIdOrName} 2>/dev/null || echo "stopped|||0"`
    );

    const parts = output.trim().split("|");
    const state = this.mapDockerState(parts[0] || "stopped");
    const startedAtStr = parts[1];
    const restartCount = parseInt(parts[2]) || 0;
    const exitCode = parts[3] ? parseInt(parts[3]) : null;

    let startedAt: Date | null = null;
    let uptime = 0;

    if (startedAtStr && startedAtStr !== "0001-01-01T00:00:00Z") {
      startedAt = new Date(startedAtStr);
      if (state === "running") {
        uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      }
    }

    const isStable = state === "running" && uptime >= this.STABILITY_THRESHOLD;
    const isCrashLooping = restartCount >= this.CRASH_LOOP_THRESHOLD && uptime < this.STABILITY_THRESHOLD;

    return {
      state,
      startedAt,
      restartCount,
      exitCode,
      uptime,
      isStable,
      isCrashLooping,
    };
  }
}

export const dockerService = new DockerService();
