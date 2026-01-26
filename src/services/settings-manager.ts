import streamDeck from "@elgato/streamdeck";
import { ServerConfig, ContainerConfig } from "./docker-service";

export interface GlobalSettings {
  serverConfig?: ServerConfig;
  containers?: ContainerConfig[];
}

class SettingsManager {
  private settings: GlobalSettings = {};

  async load(): Promise<void> {
    try {
      const stored = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
      this.settings = stored || {};
    } catch (error) {
      console.error("Failed to load global settings:", error);
      this.settings = {};
    }
  }

  async save(): Promise<void> {
    try {
      await streamDeck.settings.setGlobalSettings(this.settings);
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
