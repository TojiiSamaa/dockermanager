import streamDeck from "@elgato/streamdeck";
import { ServerConfig, ContainerConfig } from "./docker-service";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { encryptFields, decryptFields } from "./encryption";

// Extended server config with multi-server support
export interface MultiServerConfig extends ServerConfig {
  id?: string;
  name?: string;
  isDefault?: boolean;
}

export interface GlobalSettings {
  serverConfig?: ServerConfig;  // Legacy: single server config
  servers?: MultiServerConfig[];  // New: multi-server support
  containers?: ContainerConfig[];
}

// Backup file location - persists across plugin reinstalls
const BACKUP_DIR = path.join(os.homedir(), ".deckops-docker");
const BACKUP_FILE = path.join(BACKUP_DIR, "settings-backup.json");

class SettingsManager {
  private settings: GlobalSettings = {};

  async load(): Promise<void> {
    try {
      const stored = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
      this.settings = stored || {};

      // If no settings in Stream Deck, try to restore from backup
      const hasServers = this.settings.servers && this.settings.servers.length > 0;
      const hasServerConfig = this.settings.serverConfig && (this.settings.serverConfig.sshHost || this.settings.serverConfig.dockerHost);

      if (!hasServers && !hasServerConfig) {
        const restored = await this.restoreFromBackup();
        if (restored) {
          console.log("[settings] Restored settings from backup file");
          // Save restored settings back to Stream Deck
          await this.save();
        }
      } else {
        // Settings exist, update the backup
        await this.saveBackup();
      }

      // Migrate: if we have servers array but no serverConfig, use default server
      this.syncServerConfig();
    } catch (error) {
      console.error("Failed to load global settings:", error);
      this.settings = {};
    }
  }

  /**
   * Save settings to backup file for persistence across updates
   */
  private async saveBackup(): Promise<void> {
    try {
      // Create backup directory if it doesn't exist
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      // Don't backup if settings are empty
      const hasSettings = (this.settings.servers && this.settings.servers.length > 0) ||
                         (this.settings.serverConfig && (this.settings.serverConfig.sshHost || this.settings.serverConfig.dockerHost));

      if (!hasSettings) {
        return;
      }

      // Create a copy and encrypt sensitive fields
      const backupData = JSON.parse(JSON.stringify(this.settings)); // Deep copy

      // Encrypt sensitive fields in legacy serverConfig
      if (backupData.serverConfig) {
        encryptFields(backupData.serverConfig, ["sshPrivateKey", "sshPassword"]);
      }

      // Encrypt sensitive fields in servers array
      if (backupData.servers) {
        for (const server of backupData.servers) {
          encryptFields(server, ["sshPrivateKey", "sshPassword"]);
        }
      }

      // Add metadata
      backupData._backupTimestamp = new Date().toISOString();
      backupData._version = "2.3.0";
      backupData._encrypted = true; // Mark as encrypted

      fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupData, null, 2), "utf8");
      console.log("[settings] Settings backup saved (encrypted) to:", BACKUP_FILE);
    } catch (error) {
      console.error("[settings] Failed to save backup:", error);
    }
  }

  /**
   * Restore settings from backup file
   */
  private async restoreFromBackup(): Promise<boolean> {
    try {
      if (!fs.existsSync(BACKUP_FILE)) {
        console.log("[settings] No backup file found");
        return false;
      }

      const data = fs.readFileSync(BACKUP_FILE, "utf8");
      const backup = JSON.parse(data);

      // Decrypt sensitive fields if backup is encrypted
      if (backup._encrypted) {
        // Decrypt legacy serverConfig
        if (backup.serverConfig) {
          decryptFields(backup.serverConfig, ["sshPrivateKey", "sshPassword"]);
        }

        // Decrypt servers array
        if (backup.servers) {
          for (const server of backup.servers) {
            decryptFields(server, ["sshPrivateKey", "sshPassword"]);
          }
        }
      }

      // Remove metadata fields
      delete backup._backupTimestamp;
      delete backup._version;
      delete backup._encrypted;

      // Validate backup has actual settings
      const hasServers = backup.servers && backup.servers.length > 0;
      const hasServerConfig = backup.serverConfig && (backup.serverConfig.sshHost || backup.serverConfig.dockerHost);

      if (!hasServers && !hasServerConfig) {
        console.log("[settings] Backup file is empty or invalid");
        return false;
      }

      this.settings = backup;
      console.log("[settings] Restored", backup.servers?.length || 0, "servers from backup");
      return true;
    } catch (error) {
      console.error("[settings] Failed to restore from backup:", error);
      return false;
    }
  }

  // Sync serverConfig with the default server from servers array
  private syncServerConfig(): void {
    if (this.settings.servers && this.settings.servers.length > 0) {
      // Find default server, or use first one
      const defaultServer = this.settings.servers.find(s => s.isDefault) || this.settings.servers[0];
      if (defaultServer) {
        // Convert MultiServerConfig to ServerConfig
        this.settings.serverConfig = {
          connectionType: defaultServer.connectionType,
          sshHost: defaultServer.sshHost,
          sshPort: defaultServer.sshPort,
          sshUsername: defaultServer.sshUsername,
          sshPrivateKey: defaultServer.sshPrivateKey,
          sshKeyPath: defaultServer.sshKeyPath,
          sshPassword: defaultServer.sshPassword,
          backupAddresses: defaultServer.backupAddresses,
          dockerHost: defaultServer.dockerHost,
          dockerPort: defaultServer.dockerPort,
          dockerCertPath: defaultServer.dockerCertPath,
          connectionTimeout: defaultServer.connectionTimeout,
          keepAlive: defaultServer.keepAlive,
        };
      }
    }
  }

  async save(): Promise<void> {
    try {
      await streamDeck.settings.setGlobalSettings(this.settings);
      // Also save to backup file for persistence across updates
      await this.saveBackup();
    } catch (error) {
      console.error("Failed to save global settings:", error);
    }
  }

  getServerConfig(): ServerConfig | undefined {
    return this.settings.serverConfig;
  }

  async setServerConfig(config: ServerConfig): Promise<void> {
    this.settings.serverConfig = config;
    await this.save();
  }

  // Update cache without saving back (to avoid loops when receiving from PI)
  updateServerConfigCache(config: ServerConfig): void {
    this.settings.serverConfig = config;
    // Save backup asynchronously (don't await to avoid blocking)
    this.saveBackup().catch(e => console.error("[settings] Backup failed:", e));
  }

  // Update servers array from PI and sync serverConfig
  updateServersCache(servers: MultiServerConfig[]): void {
    this.settings.servers = servers;
    this.syncServerConfig();
    // Save backup asynchronously (don't await to avoid blocking)
    this.saveBackup().catch(e => console.error("[settings] Backup failed:", e));
  }

  // Get all configured servers
  getServers(): MultiServerConfig[] {
    return this.settings.servers || [];
  }

  // Get server by ID
  getServerById(id: string): MultiServerConfig | undefined {
    return this.settings.servers?.find(s => s.id === id);
  }

  // Get default server
  getDefaultServer(): MultiServerConfig | undefined {
    if (!this.settings.servers || this.settings.servers.length === 0) {
      return undefined;
    }
    return this.settings.servers.find(s => s.isDefault) || this.settings.servers[0];
  }

  getContainers(): ContainerConfig[] {
    return this.settings.containers || [];
  }

  async setContainers(containers: ContainerConfig[]): Promise<void> {
    this.settings.containers = containers;
    await this.save();
  }

  async addContainer(container: ContainerConfig): Promise<void> {
    if (!this.settings.containers) {
      this.settings.containers = [];
    }

    // Check if container already exists
    const existingIndex = this.settings.containers.findIndex(
      c => c.containerId === container.containerId || c.containerName === container.containerName
    );

    if (existingIndex >= 0) {
      this.settings.containers[existingIndex] = container;
    } else {
      this.settings.containers.push(container);
    }

    await this.save();
  }

  async removeContainer(containerIdOrName: string): Promise<void> {
    if (!this.settings.containers) return;

    this.settings.containers = this.settings.containers.filter(
      c => c.containerId !== containerIdOrName && c.containerName !== containerIdOrName
    );

    await this.save();
  }

  getContainerByIdOrName(idOrName: string): ContainerConfig | undefined {
    return this.settings.containers?.find(
      c => c.containerId === idOrName || c.containerName === idOrName
    );
  }
}

export const globalSettings = new SettingsManager();
