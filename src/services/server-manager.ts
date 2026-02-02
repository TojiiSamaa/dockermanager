import streamDeck from "@elgato/streamdeck";
import { Client as SSHClient } from "ssh2";
import { pluginLogger } from "../actions/debug-logs";

export interface ServerAddress {
  host: string;
  port: number;
  label?: string; // e.g., "Local", "VPN", "Pangolin"
}

export interface ServerConfig {
  id: string;
  name: string; // Display name (e.g., "NAS", "PC Gaming", "Serveur Dev")
  connectionType: "ssh" | "docker-api";

  // Primary address
  primaryAddress: ServerAddress;

  // Backup addresses (will try in order if primary fails)
  backupAddresses?: ServerAddress[];

  // SSH credentials
  sshUsername?: string;
  sshPrivateKey?: string;
  sshPassword?: string;

  // Docker API config (if using docker-api connection type)
  dockerCertPath?: string;

  // Connection options
  connectionTimeout?: number; // in seconds, default 30
  keepAlive?: boolean;

  // Last successful address (for faster reconnection)
  lastSuccessfulAddress?: string;
}

export interface MultiServerSettings {
  servers: ServerConfig[];
  defaultServerId?: string;
}

interface ServerConnection {
  serverId: string;
  client: SSHClient | null;
  connected: boolean;
  currentAddress?: string;
  lastConnectAttempt: number;
}

class ServerManager {
  private settings: MultiServerSettings = { servers: [] };
  private connections: Map<string, ServerConnection> = new Map();
  private healthCache: Map<string, Map<string, { health: any; timestamp: number }>> = new Map();

  async load(): Promise<void> {
    try {
      const stored = await streamDeck.settings.getGlobalSettings<{ multiServer?: MultiServerSettings }>();
      if (stored?.multiServer) {
        this.settings = stored.multiServer;
      } else {
        // Migration: check for old single-server config
        const oldSettings = await streamDeck.settings.getGlobalSettings<{ serverConfig?: any }>();
        if (oldSettings?.serverConfig) {
          await this.migrateFromSingleServer(oldSettings.serverConfig);
        }
      }
    } catch (error) {
      pluginLogger.error(`Failed to load server settings: ${error}`, "server-manager");
      this.settings = { servers: [] };
    }
  }

  private async migrateFromSingleServer(oldConfig: any): Promise<void> {
    pluginLogger.info("Migrating from single-server to multi-server config", "server-manager");

    const newServer: ServerConfig = {
      id: this.generateId(),
      name: "Serveur Principal",
      connectionType: oldConfig.connectionType || "ssh",
      primaryAddress: {
        host: oldConfig.sshHost || oldConfig.dockerHost || "localhost",
        port: oldConfig.sshPort || oldConfig.dockerPort || 22,
        label: "Principal"
      },
      sshUsername: oldConfig.sshUsername,
      sshPrivateKey: oldConfig.sshPrivateKey,
      sshPassword: oldConfig.sshPassword,
      dockerCertPath: oldConfig.dockerCertPath,
      connectionTimeout: oldConfig.connectionTimeout,
      keepAlive: oldConfig.keepAlive
    };

    this.settings = {
      servers: [newServer],
      defaultServerId: newServer.id
    };

    await this.save();
  }

  async save(): Promise<void> {
    try {
      const current = await streamDeck.settings.getGlobalSettings<any>();
      await streamDeck.settings.setGlobalSettings({
        ...current,
        multiServer: this.settings
      });
    } catch (error) {
      pluginLogger.error(`Failed to save server settings: ${error}`, "server-manager");
    }
  }

  private generateId(): string {
    return `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get all servers
  getServers(): ServerConfig[] {
    return this.settings.servers;
  }

  // Get server by ID
  getServer(serverId: string): ServerConfig | undefined {
    return this.settings.servers.find(s => s.id === serverId);
  }

  // Get default server
  getDefaultServer(): ServerConfig | undefined {
    if (this.settings.defaultServerId) {
      return this.getServer(this.settings.defaultServerId);
    }
    return this.settings.servers[0];
  }

  // Add a new server
  async addServer(server: Omit<ServerConfig, "id">): Promise<ServerConfig> {
    const newServer: ServerConfig = {
      ...server,
      id: this.generateId()
    };

    this.settings.servers.push(newServer);

    // Set as default if it's the first server
    if (this.settings.servers.length === 1) {
      this.settings.defaultServerId = newServer.id;
    }

    await this.save();
    return newServer;
  }

  // Update a server
  async updateServer(serverId: string, updates: Partial<ServerConfig>): Promise<boolean> {
    const index = this.settings.servers.findIndex(s => s.id === serverId);
    if (index === -1) return false;

    this.settings.servers[index] = {
      ...this.settings.servers[index],
      ...updates,
      id: serverId // Ensure ID doesn't change
    };

    await this.save();

    // Disconnect if config changed
    await this.disconnect(serverId);

    return true;
  }

  // Remove a server
  async removeServer(serverId: string): Promise<boolean> {
    const index = this.settings.servers.findIndex(s => s.id === serverId);
    if (index === -1) return false;

    // Disconnect first
    await this.disconnect(serverId);

    this.settings.servers.splice(index, 1);

    // Update default if removed
    if (this.settings.defaultServerId === serverId) {
      this.settings.defaultServerId = this.settings.servers[0]?.id;
    }

    await this.save();
    return true;
  }

  // Set default server
  async setDefaultServer(serverId: string): Promise<void> {
    if (this.getServer(serverId)) {
      this.settings.defaultServerId = serverId;
      await this.save();
    }
  }

  // Connect to a server (tries primary, then backups)
  async connect(serverId: string): Promise<boolean> {
    const server = this.getServer(serverId);
    if (!server) {
      pluginLogger.error(`Server not found: ${serverId}`, "server-manager");
      return false;
    }

    // Check if already connected
    const existing = this.connections.get(serverId);
    if (existing?.connected) {
      return true;
    }

    // Build list of addresses to try
    const addresses: ServerAddress[] = [server.primaryAddress];
    if (server.backupAddresses) {
      addresses.push(...server.backupAddresses);
    }

    // If we had a successful address before, try it first
    if (server.lastSuccessfulAddress) {
      const lastIndex = addresses.findIndex(a => `${a.host}:${a.port}` === server.lastSuccessfulAddress);
      if (lastIndex > 0) {
        const [last] = addresses.splice(lastIndex, 1);
        addresses.unshift(last);
      }
    }

    // Try each address
    for (const address of addresses) {
      pluginLogger.info(`Trying to connect to ${server.name} at ${address.host}:${address.port} (${address.label || "default"})`, "server-manager");

      try {
        const connected = await this.connectToAddress(server, address);
        if (connected) {
          pluginLogger.info(`Connected to ${server.name} via ${address.host}:${address.port}`, "server-manager");

          // Remember successful address
          server.lastSuccessfulAddress = `${address.host}:${address.port}`;
          await this.save();

          return true;
        }
      } catch (error) {
        pluginLogger.warn(`Failed to connect to ${address.host}:${address.port}: ${error}`, "server-manager");
      }
    }

    pluginLogger.error(`Failed to connect to ${server.name} - all addresses failed`, "server-manager");
    return false;
  }

  private connectToAddress(server: ServerConfig, address: ServerAddress): Promise<boolean> {
    return new Promise((resolve) => {
      if (server.connectionType === "docker-api") {
        // Docker API connection (not implemented yet, placeholder)
        resolve(false);
        return;
      }

      // SSH connection
      const client = new SSHClient();
      const timeout = (server.connectionTimeout || 30) * 1000;
      let timeoutId: NodeJS.Timeout;

      client.on("ready", () => {
        clearTimeout(timeoutId);

        this.connections.set(server.id, {
          serverId: server.id,
          client,
          connected: true,
          currentAddress: `${address.host}:${address.port}`,
          lastConnectAttempt: Date.now()
        });

        resolve(true);
      });

      client.on("error", (err) => {
        clearTimeout(timeoutId);
        pluginLogger.warn(`SSH error for ${server.name}: ${err.message}`, "server-manager");
        resolve(false);
      });

      client.on("close", () => {
        const conn = this.connections.get(server.id);
        if (conn) {
          conn.connected = false;
        }
      });

      const connectConfig: any = {
        host: address.host,
        port: address.port,
        username: server.sshUsername,
        readyTimeout: timeout,
        keepaliveInterval: server.keepAlive ? 10000 : 0,
        keepaliveCountMax: 3,
      };

      if (server.sshPrivateKey) {
        connectConfig.privateKey = server.sshPrivateKey;
      } else if (server.sshPassword) {
        connectConfig.password = server.sshPassword;
      }

      timeoutId = setTimeout(() => {
        client.end();
        resolve(false);
      }, timeout + 5000);

      client.connect(connectConfig);
    });
  }

  // Disconnect from a server
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (conn?.client) {
      conn.client.end();
    }
    this.connections.delete(serverId);
    this.healthCache.delete(serverId);
  }

  // Disconnect from all servers
  async disconnectAll(): Promise<void> {
    for (const serverId of this.connections.keys()) {
      await this.disconnect(serverId);
    }
  }

  // Check if connected to a server
  isConnected(serverId: string): boolean {
    return this.connections.get(serverId)?.connected || false;
  }

  // Execute SSH command on a server
  async execCommand(serverId: string, command: string): Promise<string> {
    // Ensure connected
    if (!this.isConnected(serverId)) {
      const connected = await this.connect(serverId);
      if (!connected) {
        throw new Error(`Cannot connect to server ${serverId}`);
      }
    }

    const conn = this.connections.get(serverId);
    if (!conn?.client) {
      throw new Error(`No connection for server ${serverId}`);
    }

    return new Promise((resolve, reject) => {
      const commandTimeout = setTimeout(() => {
        reject(new Error("SSH command timeout"));
      }, 30000);

      conn.client!.exec(command, (err, stream) => {
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

  // Get current address for a server
  getCurrentAddress(serverId: string): string | undefined {
    return this.connections.get(serverId)?.currentAddress;
  }

  // Update settings cache (for PI updates)
  updateSettingsCache(settings: MultiServerSettings): void {
    this.settings = settings;
  }
}

export const serverManager = new ServerManager();
