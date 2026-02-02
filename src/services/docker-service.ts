import { Client as SSHClient } from "ssh2";
import Dockerode from "dockerode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { pluginLogger } from "../actions/debug-logs";
import { buildDockerCommand, escapePath } from "./shell-escape";

export interface ServerConfig {
  connectionType: "ssh" | "docker-api";
  // SSH config
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPrivateKey?: string;
  sshKeyPath?: string;  // Path to SSH private key file
  sshPassword?: string;
  backupAddresses?: string[];  // Backup hosts to try if primary fails
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

// Connection pool entry for a single server
interface ServerConnection {
  sshClient: SSHClient | null;
  dockerClient: Dockerode | null;
  config: ServerConfig;
  connected: boolean;
  activeHost: string | null;
  lastUsed: number;
  healthCache: Map<string, { health: ContainerHealth; timestamp: number }>;
  bulkRefreshInProgress: boolean;
  lastBulkRefresh: number;
}

class DockerService {
  // Connection pool - one connection per server (keyed by primary host)
  private connections: Map<string, ServerConnection> = new Map();
  // Current active connection (for backwards compatibility)
  private currentServerId: string | null = null;

  // Cache TTL in milliseconds (5 minutes)
  private readonly HEALTH_CACHE_TTL = 5 * 60 * 1000;
  private readonly BULK_REFRESH_INTERVAL = 3000; // Minimum 3 seconds between bulk refreshes
  // Connection cleanup interval (close unused connections after 5 minutes)
  private readonly CONNECTION_IDLE_TIMEOUT = 5 * 60 * 1000;

  // Get server ID from config (primary host)
  private getServerId(config: ServerConfig): string {
    return config.sshHost || config.dockerHost || "default";
  }

  // Get or create a connection for a server
  private getConnection(config: ServerConfig): ServerConnection {
    const serverId = this.getServerId(config);
    let conn = this.connections.get(serverId);

    if (!conn) {
      conn = {
        sshClient: null,
        dockerClient: null,
        config: config,
        connected: false,
        activeHost: null,
        lastUsed: Date.now(),
        healthCache: new Map(),
        bulkRefreshInProgress: false,
        lastBulkRefresh: 0
      };
      this.connections.set(serverId, conn);
    } else {
      // Update config in case it changed
      conn.config = config;
      conn.lastUsed = Date.now();
    }

    return conn;
  }

  // Get current connection (for backwards compatibility)
  private get currentConnection(): ServerConnection | null {
    if (!this.currentServerId) return null;
    return this.connections.get(this.currentServerId) || null;
  }

  // Legacy getters for backwards compatibility
  private get sshClient(): SSHClient | null {
    return this.currentConnection?.sshClient || null;
  }
  private get dockerClient(): Dockerode | null {
    return this.currentConnection?.dockerClient || null;
  }
  private get config(): ServerConfig | null {
    return this.currentConnection?.config || null;
  }
  private get connected(): boolean {
    return this.currentConnection?.connected || false;
  }
  private get activeHost(): string | null {
    return this.currentConnection?.activeHost || null;
  }
  private get healthCache(): Map<string, { health: ContainerHealth; timestamp: number }> {
    return this.currentConnection?.healthCache || new Map();
  }
  private get bulkRefreshInProgress(): boolean {
    return this.currentConnection?.bulkRefreshInProgress || false;
  }
  private set bulkRefreshInProgress(value: boolean) {
    if (this.currentConnection) this.currentConnection.bulkRefreshInProgress = value;
  }
  private get lastBulkRefresh(): number {
    return this.currentConnection?.lastBulkRefresh || 0;
  }
  private set lastBulkRefresh(value: number) {
    if (this.currentConnection) this.currentConnection.lastBulkRefresh = value;
  }

  async configure(config: ServerConfig): Promise<void> {
    const serverId = this.getServerId(config);
    const conn = this.getConnection(config);

    // If switching to a different server, just update the current pointer
    // Don't disconnect the old one - keep it in the pool
    this.currentServerId = serverId;

    // Only disconnect if config changed for this specific server
    if (conn.connected && this.configChanged(conn.config, config)) {
      pluginLogger.info(`Config changed for ${serverId}, reconnecting...`, "docker");
      await this.disconnectServer(serverId);
    }

    conn.config = config;
  }

  /**
   * Ensure a connection to a specific server is established.
   * This method maintains multiple connections simultaneously - it does NOT
   * disconnect other servers when connecting to a new one.
   * @param config The server configuration
   * @returns true if connected, false otherwise
   */
  async ensureServerConnection(config: ServerConfig): Promise<boolean> {
    const serverId = this.getServerId(config);
    const conn = this.getConnection(config);

    // Update last used time
    conn.lastUsed = Date.now();

    // Already connected?
    if (conn.connected && conn.sshClient) {
      return true;
    }

    // Need to connect
    pluginLogger.info(`[${serverId}] Establishing connection...`, "ssh");

    if (config.connectionType === "docker-api") {
      return this.connectDockerAPIForServer(conn);
    } else {
      return this.connectSSHForServer(conn);
    }
  }

  private async connectDockerAPIForServer(conn: ServerConnection): Promise<boolean> {
    try {
      const options: Dockerode.DockerOptions = {};

      if (conn.config.dockerHost) {
        options.host = conn.config.dockerHost;
        options.port = conn.config.dockerPort || 2375;
        options.protocol = conn.config.dockerCertPath ? "https" : "http";

        if (conn.config.dockerCertPath) {
          options.ca = conn.config.dockerCertPath + "/ca.pem";
          options.cert = conn.config.dockerCertPath + "/cert.pem";
          options.key = conn.config.dockerCertPath + "/key.pem";
        }
      }

      conn.dockerClient = new Dockerode(options);
      await conn.dockerClient.ping();
      conn.connected = true;
      conn.activeHost = conn.config.dockerHost || "local";
      return true;
    } catch (error) {
      pluginLogger.error(`Docker API connection failed: ${error}`, "docker-api");
      conn.connected = false;
      return false;
    }
  }

  private async connectSSHForServer(conn: ServerConnection): Promise<boolean> {
    const config = conn.config;
    const serverId = this.getServerId(config);

    // Build list of hosts to try: primary first, then backups
    const hostsToTry: string[] = [];
    if (config.sshHost) {
      hostsToTry.push(config.sshHost);
    }
    if (config.backupAddresses && config.backupAddresses.length > 0) {
      hostsToTry.push(...config.backupAddresses.filter(a => a && a.trim()));
    }

    if (hostsToTry.length === 0) {
      pluginLogger.error(`[${serverId}] No SSH hosts configured`, "ssh");
      return false;
    }

    // Get private key (from path or directly)
    let privateKey: string | undefined = config.sshPrivateKey;

    // Normalize line endings for pasted keys (Windows CRLF -> Unix LF)
    if (privateKey) {
      privateKey = privateKey.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!privateKey.endsWith("\n")) {
        privateKey += "\n";
      }
    }

    // Try loading from path if no inline key provided
    if (!privateKey && config.sshKeyPath) {
      try {
        let keyPath = config.sshKeyPath.trim();
        if (keyPath.startsWith("~/") || keyPath.startsWith("~\\")) {
          keyPath = path.join(os.homedir(), keyPath.slice(2));
        } else if (keyPath === "~") {
          keyPath = os.homedir();
        }
        keyPath = path.normalize(keyPath);

        if (fs.existsSync(keyPath)) {
          privateKey = fs.readFileSync(keyPath, "utf8");
          privateKey = privateKey.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          if (!privateKey.endsWith("\n")) {
            privateKey += "\n";
          }
        }
      } catch (err) {
        pluginLogger.error(`[${serverId}] Failed to read SSH key: ${err}`, "ssh");
      }
    }

    // Build connection sequence: primary -> backup -> primary (retry)
    const connectionSequence: { host: string; label: string }[] = [];
    const primary = hostsToTry[0];
    const backups = hostsToTry.slice(1);

    connectionSequence.push({ host: primary, label: "primary" });
    for (const backup of backups) {
      connectionSequence.push({ host: backup, label: "backup" });
    }
    if (backups.length > 0) {
      connectionSequence.push({ host: primary, label: "primary (retry)" });
    }

    // Try each host in sequence
    for (const { host, label } of connectionSequence) {
      pluginLogger.info(`[${serverId}] Trying ${label}: ${host}`, "ssh");

      try {
        const result = await this.tryConnectSSHForServer(host, privateKey, config);
        if (result.success && result.client) {
          conn.sshClient = result.client;
          conn.activeHost = host;
          conn.connected = true;

          // Setup close handler
          conn.sshClient.on("close", () => {
            pluginLogger.info(`[${serverId}] SSH connection closed`, "ssh");
            conn.connected = false;
          });

          pluginLogger.info(`[${serverId}] ✓ Connected to: ${host} (${label})`, "ssh");
          return true;
        }
      } catch (error) {
        pluginLogger.error(`[${serverId}] ${label} failed: ${error instanceof Error ? error.message : error}`, "ssh");
      }
    }

    pluginLogger.error(`[${serverId}] ✗ All connection attempts failed`, "ssh");
    return false;
  }

  /**
   * Execute an SSH command on a specific server (by config)
   * Does NOT switch the current server - maintains independent connections
   */
  async execSSHCommandForServer(config: ServerConfig, command: string): Promise<string> {
    const serverId = this.getServerId(config);
    const conn = this.getConnection(config);

    if (!conn.connected || !conn.sshClient) {
      // Try to connect
      const connected = await this.ensureServerConnection(config);
      if (!connected) {
        throw new Error(`Cannot connect to server ${serverId}`);
      }
    }

    return new Promise((resolve, reject) => {
      const commandTimeout = setTimeout(() => {
        reject(new Error("SSH command timeout"));
      }, 30000);

      conn.sshClient!.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(commandTimeout);
          conn.connected = false;
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
          conn.connected = false;
          reject(err);
        });
      });
    });
  }

  /**
   * Get the connection for a specific server (for advanced use cases like log streaming)
   */
  getServerConnection(config: ServerConfig): ServerConnection {
    return this.getConnection(config);
  }

  // Check if server config changed significantly
  private configChanged(oldConfig: ServerConfig, newConfig: ServerConfig): boolean {
    return oldConfig.sshHost !== newConfig.sshHost ||
           oldConfig.sshPort !== newConfig.sshPort ||
           oldConfig.sshUsername !== newConfig.sshUsername ||
           oldConfig.dockerHost !== newConfig.dockerHost ||
           oldConfig.connectionType !== newConfig.connectionType;
  }

  // Disconnect a specific server from the pool
  async disconnectServer(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    if (conn.sshClient) {
      conn.sshClient.end();
      conn.sshClient = null;
    }
    if (conn.dockerClient) {
      conn.dockerClient = null;
    }
    conn.connected = false;
    conn.activeHost = null;
  }

  async connect(): Promise<boolean> {
    const conn = this.currentConnection;
    if (!conn || !conn.config) {
      throw new Error("Server not configured");
    }

    // Already connected to this server? Just return true
    if (conn.connected && conn.sshClient) {
      conn.lastUsed = Date.now();
      return true;
    }

    if (conn.config.connectionType === "docker-api") {
      return this.connectDockerAPI();
    } else {
      return this.connectSSH();
    }
  }

  private async connectDockerAPI(): Promise<boolean> {
    const conn = this.currentConnection;
    if (!conn) return false;

    try {
      const options: Dockerode.DockerOptions = {};

      if (conn.config.dockerHost) {
        options.host = conn.config.dockerHost;
        options.port = conn.config.dockerPort || 2375;
        options.protocol = conn.config.dockerCertPath ? "https" : "http";

        if (conn.config.dockerCertPath) {
          options.ca = conn.config.dockerCertPath + "/ca.pem";
          options.cert = conn.config.dockerCertPath + "/cert.pem";
          options.key = conn.config.dockerCertPath + "/key.pem";
        }
      }

      conn.dockerClient = new Dockerode(options);
      await conn.dockerClient.ping();
      conn.connected = true;
      conn.activeHost = conn.config.dockerHost || "local";
      return true;
    } catch (error) {
      pluginLogger.error(`Docker API connection failed: ${error}`, "docker-api");
      conn.connected = false;
      return false;
    }
  }

  private async connectSSH(): Promise<boolean> {
    const conn = this.currentConnection;
    if (!conn) return false;

    const config = conn.config;

    // Build list of hosts to try: primary first, then backups
    const hostsToTry: string[] = [];
    if (config.sshHost) {
      hostsToTry.push(config.sshHost);
    }
    if (config.backupAddresses && config.backupAddresses.length > 0) {
      hostsToTry.push(...config.backupAddresses.filter(a => a && a.trim()));
    }

    if (hostsToTry.length === 0) {
      pluginLogger.error("No SSH hosts configured", "ssh");
      return false;
    }

    // Get private key (from path or directly)
    let privateKey: string | undefined = config.sshPrivateKey;

    // Normalize line endings for pasted keys (Windows CRLF -> Unix LF)
    if (privateKey) {
      privateKey = privateKey.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!privateKey.endsWith("\n")) {
        privateKey += "\n";
      }
    }

    // Try loading from path if no inline key provided
    if (!privateKey && config.sshKeyPath) {
      try {
        let keyPath = config.sshKeyPath.trim();
        if (keyPath.startsWith("~/") || keyPath.startsWith("~\\")) {
          keyPath = path.join(os.homedir(), keyPath.slice(2));
        } else if (keyPath === "~") {
          keyPath = os.homedir();
        }
        keyPath = path.normalize(keyPath);

        if (fs.existsSync(keyPath)) {
          privateKey = fs.readFileSync(keyPath, "utf8");
          privateKey = privateKey.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          if (!privateKey.endsWith("\n")) {
            privateKey += "\n";
          }
          pluginLogger.info(`Loaded SSH key from: ${keyPath}`, "ssh");
        } else {
          pluginLogger.error(`SSH key file not found: ${keyPath}`, "ssh");
        }
      } catch (err) {
        pluginLogger.error(`Failed to read SSH key: ${err}`, "ssh");
      }
    }

    // Build connection sequence: primary -> backup -> primary (retry)
    const connectionSequence: { host: string; label: string }[] = [];
    const primary = hostsToTry[0];
    const backups = hostsToTry.slice(1);

    connectionSequence.push({ host: primary, label: "primary" });
    for (const backup of backups) {
      connectionSequence.push({ host: backup, label: "backup" });
    }
    if (backups.length > 0) {
      connectionSequence.push({ host: primary, label: "primary (retry)" });
    }

    const serverId = this.getServerId(config);

    // Try each host in sequence
    for (const { host, label } of connectionSequence) {
      pluginLogger.info(`[${serverId}] Trying ${label}: ${host}`, "ssh");

      try {
        const result = await this.tryConnectSSHForServer(host, privateKey, config);
        if (result.success && result.client) {
          conn.sshClient = result.client;
          conn.activeHost = host;
          conn.connected = true;

          // Setup close handler
          conn.sshClient.on("close", () => {
            pluginLogger.info(`[${serverId}] SSH connection closed`, "ssh");
            conn.connected = false;
          });

          pluginLogger.info(`[${serverId}] ✓ Connected to: ${host} (${label})`, "ssh");
          return true;
        }
      } catch (error) {
        pluginLogger.error(`[${serverId}] ${label} failed: ${error instanceof Error ? error.message : error}`, "ssh");
      }
    }

    pluginLogger.error(`[${serverId}] ✗ All connection attempts failed`, "ssh");
    return false;
  }

  // Simple SSH connection attempt
  private tryConnectSSHForServer(
    host: string,
    privateKey: string | undefined,
    config: ServerConfig
  ): Promise<{ success: boolean; client?: SSHClient }> {
    return new Promise((resolve) => {
      const client = new SSHClient();
      const timeout = (config.connectionTimeout || 10) * 1000;
      let timeoutId: NodeJS.Timeout;
      let resolved = false;

      const cleanup = (success: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        if (!success) {
          client.end();
          resolve({ success: false });
        } else {
          resolve({ success: true, client });
        }
      };

      client.on("ready", () => {
        pluginLogger.info(`[${host}] SSH connection ready!`, "ssh");
        cleanup(true);
      });

      client.on("error", (err: Error & { code?: string; level?: string }) => {
        const errorDetails = [
          err.message,
          err.code ? `code=${err.code}` : null,
          err.level ? `level=${err.level}` : null
        ].filter(Boolean).join(', ');
        pluginLogger.error(`[${host}] SSH error: ${errorDetails}`, "ssh");
        cleanup(false);
      });

      client.on("close", () => {
        if (!resolved) {
          pluginLogger.info(`[${host}] Connection closed unexpectedly`, "ssh");
          cleanup(false);
        }
      });

      client.on("keyboard-interactive", (name, instructions, lang, prompts, finish) => {
        if (config.sshPassword && prompts.length > 0) {
          finish([config.sshPassword]);
        } else {
          finish([]);
        }
      });

      const connectConfig: any = {
        host: host,
        port: config.sshPort || 22,
        username: config.sshUsername,
        readyTimeout: timeout,
        keepaliveInterval: 10000, // Keep connection alive
        keepaliveCountMax: 3,
        tryKeyboard: true,
      };

      let authMethod = "none";
      if (privateKey) {
        connectConfig.privateKey = privateKey;
        authMethod = `privateKey`;
      } else if (config.sshPassword) {
        connectConfig.password = config.sshPassword;
        authMethod = "password";
      }

      pluginLogger.info(`[${host}] Connecting as '${connectConfig.username}' using ${authMethod}...`, "ssh");

      timeoutId = setTimeout(() => {
        pluginLogger.error(`[${host}] Connection timeout after ${timeout}ms`, "ssh");
        cleanup(false);
      }, timeout);

      client.connect(connectConfig);
    });
  }

  async disconnect(): Promise<void> {
    // Disconnect current server
    if (this.currentServerId) {
      await this.disconnectServer(this.currentServerId);
    }
  }

  // Disconnect all servers in the pool
  async disconnectAll(): Promise<void> {
    for (const serverId of this.connections.keys()) {
      await this.disconnectServer(serverId);
    }
    this.connections.clear();
    this.currentServerId = null;
  }

  getActiveHost(): string | null {
    return this.currentConnection?.activeHost || null;
  }

  isConnected(): boolean {
    return this.currentConnection?.connected || false;
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

  /**
   * Get container state for a specific server (multi-server safe)
   */
  async getContainerStateForServer(config: ServerConfig, containerIdOrName: string): Promise<ContainerInfo["state"]> {
    const connected = await this.ensureServerConnection(config);
    if (!connected) {
      return "stopped";
    }

    const conn = this.getConnection(config);

    if (config.connectionType === "docker-api") {
      return this.getContainerStateDockerAPIForServer(conn, containerIdOrName);
    } else {
      return this.getContainerStateSSHForServer(config, containerIdOrName);
    }
  }

  private async getContainerStateDockerAPIForServer(conn: ServerConnection, containerIdOrName: string): Promise<ContainerInfo["state"]> {
    if (!conn.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = conn.dockerClient.getContainer(containerIdOrName);
      const info = await container.inspect();
      return this.mapDockerState(info.State.Status);
    } catch {
      return "stopped";
    }
  }

  private async getContainerStateSSHForServer(config: ServerConfig, containerIdOrName: string): Promise<ContainerInfo["state"]> {
    const cmd = buildDockerCommand("inspect", containerIdOrName, "--format", "{{.State.Status}}");
    const output = await this.execSSHCommandForServer(
      config,
      `${cmd} 2>/dev/null || echo "stopped"`
    );
    return this.mapDockerState(output.trim());
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
    const cmd = buildDockerCommand("inspect", containerIdOrName, "--format", "{{.State.Status}}");
    const output = await this.execSSHCommand(
      `${cmd} 2>/dev/null || echo "stopped"`
    );
    return this.mapDockerState(output.trim());
  }

  /**
   * Start container on a specific server (multi-server safe)
   */
  async startContainerForServer(config: ServerConfig, containerIdOrName: string): Promise<boolean> {
    const connected = await this.ensureServerConnection(config);
    if (!connected) {
      return false;
    }

    const conn = this.getConnection(config);

    if (config.connectionType === "docker-api") {
      return this.startContainerDockerAPIForServer(conn, containerIdOrName);
    } else {
      return this.startContainerSSHForServer(config, containerIdOrName);
    }
  }

  private async startContainerDockerAPIForServer(conn: ServerConnection, containerIdOrName: string): Promise<boolean> {
    if (!conn.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = conn.dockerClient.getContainer(containerIdOrName);
      await container.start();
      return true;
    } catch (error) {
      pluginLogger.error(`Failed to start container: ${error}`, "docker");
      return false;
    }
  }

  private async startContainerSSHForServer(config: ServerConfig, containerIdOrName: string): Promise<boolean> {
    try {
      const cmd = buildDockerCommand("start", containerIdOrName);
      await this.execSSHCommandForServer(config, cmd);
      return true;
    } catch {
      return false;
    }
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
      pluginLogger.error(`Failed to start container: ${error}`, "docker");
      return false;
    }
  }

  private async startContainerSSH(containerIdOrName: string): Promise<boolean> {
    try {
      const cmd = buildDockerCommand("start", containerIdOrName);
      await this.execSSHCommand(cmd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stop container on a specific server (multi-server safe)
   */
  async stopContainerForServer(config: ServerConfig, containerIdOrName: string): Promise<boolean> {
    const connected = await this.ensureServerConnection(config);
    if (!connected) {
      return false;
    }

    const conn = this.getConnection(config);

    if (config.connectionType === "docker-api") {
      return this.stopContainerDockerAPIForServer(conn, containerIdOrName);
    } else {
      return this.stopContainerSSHForServer(config, containerIdOrName);
    }
  }

  private async stopContainerDockerAPIForServer(conn: ServerConnection, containerIdOrName: string): Promise<boolean> {
    if (!conn.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = conn.dockerClient.getContainer(containerIdOrName);
      await container.stop();
      return true;
    } catch (error) {
      pluginLogger.error(`Failed to stop container: ${error}`, "docker");
      return false;
    }
  }

  private async stopContainerSSHForServer(config: ServerConfig, containerIdOrName: string): Promise<boolean> {
    try {
      const cmd = buildDockerCommand("stop", containerIdOrName);
      await this.execSSHCommandForServer(config, cmd);
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
      pluginLogger.error(`Failed to stop container: ${error}`, "docker");
      return false;
    }
  }

  private async stopContainerSSH(containerIdOrName: string): Promise<boolean> {
    try {
      const cmd = buildDockerCommand("stop", containerIdOrName);
      await this.execSSHCommand(cmd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restart container on a specific server (multi-server safe)
   */
  async restartContainerForServer(config: ServerConfig, containerIdOrName: string): Promise<boolean> {
    const connected = await this.ensureServerConnection(config);
    if (!connected) {
      return false;
    }

    const conn = this.getConnection(config);

    if (config.connectionType === "docker-api") {
      return this.restartContainerDockerAPIForServer(conn, containerIdOrName);
    } else {
      return this.restartContainerSSHForServer(config, containerIdOrName);
    }
  }

  private async restartContainerDockerAPIForServer(conn: ServerConnection, containerIdOrName: string): Promise<boolean> {
    if (!conn.dockerClient) {
      throw new Error("Docker client not connected");
    }

    try {
      const container = conn.dockerClient.getContainer(containerIdOrName);
      await container.restart();
      return true;
    } catch (error) {
      pluginLogger.error(`Failed to restart container: ${error}`, "docker");
      return false;
    }
  }

  private async restartContainerSSHForServer(config: ServerConfig, containerIdOrName: string): Promise<boolean> {
    try {
      const cmd = buildDockerCommand("restart", containerIdOrName);
      await this.execSSHCommandForServer(config, cmd);
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
      pluginLogger.error(`Failed to restart container: ${error}`, "docker");
      return false;
    }
  }

  private async restartContainerSSH(containerIdOrName: string): Promise<boolean> {
    try {
      const cmd = buildDockerCommand("restart", containerIdOrName);
      await this.execSSHCommand(cmd);
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

      const conn = this.currentConnection;
      this.sshClient.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(commandTimeout);
          // Mark as disconnected on exec error
          if (conn) conn.connected = false;
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
          if (conn) conn.connected = false;
          reject(err);
        });
      });
    });
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
      pluginLogger.error(`Failed to get container logs: ${error}`, "docker");
      return "Error getting logs";
    }
  }

  private async getContainerLogsSSH(containerIdOrName: string, lines: number): Promise<string> {
    try {
      const cmd = buildDockerCommand("logs", containerIdOrName, "--tail", String(lines), "--timestamps");
      const output = await this.execSSHCommand(`${cmd} 2>&1`);
      return output;
    } catch (error) {
      pluginLogger.error(`Failed to get container logs: ${error}`, "docker");
      return "Error getting logs";
    }
  }

  // Stability threshold in seconds (container must be running for this long to be considered stable)
  private readonly STABILITY_THRESHOLD = 30;
  // Crash loop detection: if restarted more than this many times, consider it crashing
  private readonly CRASH_LOOP_THRESHOLD = 3;

  /**
   * Get container health for a specific server (multi-server safe)
   * @param config Server configuration
   * @param containerIdOrName Container ID or name
   * @returns Container health information
   */
  async getContainerHealth(config: ServerConfig, containerIdOrName: string): Promise<ContainerHealth> {
    // Ensure connection to this specific server
    const connected = await this.ensureServerConnection(config);
    if (!connected) {
      pluginLogger.error(`Cannot connect to server for container ${containerIdOrName}`, "docker");
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

    const conn = this.getConnection(config);
    const now = Date.now();

    // Check if we have a recent cached value
    const cached = conn.healthCache.get(containerIdOrName);

    // If cache is fresh (less than 3 seconds old), return it immediately
    if (cached && (now - cached.timestamp) < this.BULK_REFRESH_INTERVAL) {
      return cached.health;
    }

    // Trigger bulk refresh if not already in progress and enough time has passed
    if (!conn.bulkRefreshInProgress && (now - conn.lastBulkRefresh) >= this.BULK_REFRESH_INTERVAL) {
      // Don't await - let it run in background
      this.refreshAllContainerHealthForServer(config).catch(err => {
        pluginLogger.error(`Bulk refresh failed for server: ${err}`, "docker");
      });
    }

    // Return cached value if available (even if slightly stale)
    if (cached && (now - cached.timestamp) < this.HEALTH_CACHE_TTL) {
      return cached.health;
    }

    // No cache available, try individual fetch as fallback
    try {
      let health: ContainerHealth;
      if (config.connectionType === "docker-api") {
        health = await this.getContainerHealthDockerAPIForServer(conn, containerIdOrName);
      } else {
        health = await this.getContainerHealthSSHForServer(config, containerIdOrName);
      }

      // Cache the successful result
      conn.healthCache.set(containerIdOrName, { health, timestamp: now });
      return health;
    } catch (error) {
      pluginLogger.error(`Failed to get health for ${containerIdOrName}: ${error}`, "docker");

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
   * Refresh health status for ALL containers on a specific server
   * Much more efficient than individual calls
   */
  async refreshAllContainerHealthForServer(config: ServerConfig): Promise<void> {
    const conn = this.getConnection(config);

    if (conn.bulkRefreshInProgress) {
      return; // Already refreshing
    }

    conn.bulkRefreshInProgress = true;

    try {
      const connected = await this.ensureServerConnection(config);
      if (!connected) {
        return;
      }

      const now = Date.now();

      if (config.connectionType === "docker-api") {
        await this.refreshAllContainerHealthDockerAPIForServer(conn, now);
      } else {
        await this.refreshAllContainerHealthSSHForServer(config, conn, now);
      }

      conn.lastBulkRefresh = now;
    } catch (error) {
      pluginLogger.error(`Failed to refresh all container health: ${error}`, "docker");
    } finally {
      conn.bulkRefreshInProgress = false;
    }
  }

  /**
   * Refresh health status for ALL containers in a single SSH call (DEPRECATED - use refreshAllContainerHealthForServer)
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
      pluginLogger.error(`Failed to refresh all container health: ${error}`, "docker");
    } finally {
      this.bulkRefreshInProgress = false;
    }
  }

  /**
   * Refresh all container health via Docker API for a specific server
   */
  private async refreshAllContainerHealthDockerAPIForServer(conn: ServerConnection, timestamp: number): Promise<void> {
    if (!conn.dockerClient) {
      throw new Error("Docker client not connected");
    }

    const containers = await conn.dockerClient.listContainers({ all: true });

    for (const container of containers) {
      try {
        const info = await conn.dockerClient.getContainer(container.Id).inspect();
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

        conn.healthCache.set(name, { health, timestamp });
        conn.healthCache.set(container.Id, { health, timestamp });
      } catch (error) {
        pluginLogger.error(`Failed to refresh health for container: ${error}`, "docker");
      }
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
        pluginLogger.error(`Failed to get health for container ${container.Id}: ${err}`, "docker");
      }
    }
  }

  /**
   * Refresh all container health via SSH for a specific server
   */
  private async refreshAllContainerHealthSSHForServer(config: ServerConfig, conn: ServerConnection, timestamp: number): Promise<void> {
    // Get all containers with their health info in ONE command
    const output = await this.execSSHCommandForServer(
      config,
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

        conn.healthCache.set(name, { health, timestamp });
        conn.healthCache.set(id, { health, timestamp });
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

      conn.healthCache.set(name, { health, timestamp });
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

  /**
   * Get container health via Docker API for a specific server
   */
  private async getContainerHealthDockerAPIForServer(conn: ServerConnection, containerIdOrName: string): Promise<ContainerHealth> {
    if (!conn.dockerClient) {
      throw new Error("Docker client not connected");
    }

    const container = conn.dockerClient.getContainer(containerIdOrName);
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

  /**
   * Get container health via SSH for a specific server
   */
  private async getContainerHealthSSHForServer(config: ServerConfig, containerIdOrName: string): Promise<ContainerHealth> {
    // Get detailed container info via SSH
    const cmd = buildDockerCommand("inspect", containerIdOrName, "--format", "{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.ExitCode}}");
    const output = await this.execSSHCommandForServer(
      config,
      `${cmd} 2>/dev/null || echo "stopped|||0"`
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

  private async getContainerHealthSSH(containerIdOrName: string): Promise<ContainerHealth> {
    // Get detailed container info via SSH
    const cmd = buildDockerCommand("inspect", containerIdOrName, "--format", "{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.ExitCode}}");
    const output = await this.execSSHCommand(
      `${cmd} 2>/dev/null || echo "stopped|||0"`
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

  /**
   * Execute an operation on multiple servers simultaneously
   * Returns results for each server
   */
  async executeBatch<T>(
    serverConfigs: ServerConfig[],
    operation: (config: ServerConfig) => Promise<T>
  ): Promise<BatchResult<T>[]> {
    const results: BatchResult<T>[] = [];

    const promises = serverConfigs.map(async (config) => {
      const serverId = this.getServerId(config);
      try {
        // Ensure connection to this server
        const connected = await this.ensureServerConnection(config);
        if (!connected) {
          return {
            serverId,
            serverName: (config as any).name || serverId,
            success: false,
            error: "Connexion impossible"
          };
        }

        // Execute the operation
        const result = await operation(config);
        return {
          serverId,
          serverName: (config as any).name || serverId,
          success: true,
          result
        };
      } catch (error) {
        return {
          serverId,
          serverName: (config as any).name || serverId,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const promiseResults = await Promise.all(promises);
    results.push(...promiseResults);

    return results;
  }
}

// Batch result interface
export interface BatchResult<T = any> {
  serverId: string;
  serverName: string;
  success: boolean;
  result?: T;
  error?: string;
}

export const dockerService = new DockerService();
