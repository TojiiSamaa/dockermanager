import { action, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService } from "../services/docker-service";
import { imageService } from "../services/image-service";
import { globalSettings } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";

interface DiskSettings {
  // Display options
  displayName?: string;
  showTitle?: boolean;
  customIconBase64?: string;
  backgroundColor?: string;

  // Refresh
  refreshInterval?: number;
}

@action({ UUID: "io.deckops.containers.disk" })
export class DockerDiskAction extends SingletonAction<DiskSettings> {
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  private settingsVersion: Map<string, number> = new Map();
  private lastDiskUsage: Map<string, string> = new Map();

  override async onWillAppear(ev: WillAppearEvent<DiskSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { refreshInterval = 60 } = settings;

    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    await this.updateDisplay(ev.action, settings, version);

    // Refresh periodically (default: every 60 seconds)
    const intervalId = setInterval(async () => {
      const currentVersion = this.settingsVersion.get(ev.action.id);
      if (currentVersion === version) {
        await this.updateDisplay(ev.action, settings, version);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onWillDisappear(ev: WillDisappearEvent<DiskSettings>): Promise<void> {
    const currentVersion = this.settingsVersion.get(ev.action.id) || 0;
    this.settingsVersion.set(ev.action.id, currentVersion + 1);

    const intervalId = this.refreshIntervals.get(ev.action.id);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshIntervals.delete(ev.action.id);
    }

    this.settingsVersion.delete(ev.action.id);
    this.lastDiskUsage.delete(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<DiskSettings>): Promise<void> {
    const settings = ev.payload.settings;

    try {
      await this.ensureConnected();

      pluginLogger.info("Refreshing disk usage", "disk");

      // Force refresh
      const version = this.settingsVersion.get(ev.action.id);
      if (version !== undefined) {
        await this.updateDisplay(ev.action, settings, version, true);
      }

      await ev.action.showOk();

    } catch (error) {
      pluginLogger.error(`Disk usage refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`, "disk");
      await ev.action.showAlert();
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<DiskSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { refreshInterval = 60 } = settings;

    const currentVersion = (this.settingsVersion.get(ev.action.id) || 0) + 1;
    this.settingsVersion.set(ev.action.id, currentVersion);

    // Update refresh interval
    const existingInterval = this.refreshIntervals.get(ev.action.id);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    await this.updateDisplay(ev.action, settings, currentVersion);

    const intervalId = setInterval(async () => {
      const checkVersion = this.settingsVersion.get(ev.action.id);
      if (checkVersion === currentVersion) {
        await this.updateDisplay(ev.action, settings, currentVersion);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  private async updateDisplay(action: Action<DiskSettings>, settings: DiskSettings, version?: number, forceRefresh = false): Promise<void> {
    try {
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const { displayName, showTitle = true, customIconBase64, backgroundColor } = settings;

      await this.ensureConnected();

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      // Get disk usage
      const diskUsage = await imageService.getDiskUsage();

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      // Format the display
      let title = displayName || "Disque";
      let subtitle = "";

      if (diskUsage) {
        // Use the total from the disk usage object
        subtitle = diskUsage.total;

        // Store a summary string for caching
        this.lastDiskUsage.set(action.id, `Images: ${diskUsage.images.size}, Containers: ${diskUsage.containers.size}, Volumes: ${diskUsage.volumes.size}, Total: ${diskUsage.total}`);
      }

      // Determine health state based on usage
      let healthState: HealthState = "stable"; // Green - normal

      // Could add thresholds here based on disk usage percentage

      const iconBase64 = await iconGenerator.generateHealthIcon(
        subtitle || title,
        healthState,
        customIconBase64,
        { backgroundColor: backgroundColor || "#3498DB" } // Blue for info
      );

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

      if (showTitle !== false) {
        const displayTitle = subtitle ? `${title}\n${subtitle}` : title;
        await action.setTitle(displayTitle);
      } else {
        await action.setTitle("");
      }

    } catch (error) {
      pluginLogger.error(`Failed to update disk display: ${error instanceof Error ? error.message : "Unknown error"}`, "disk");
      if (version === undefined || this.settingsVersion.get(action.id) === version) {
        await action.setTitle("Erreur");
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    const config = globalSettings.getServerConfig();
    if (!config) {
      throw new Error("Aucune configuration serveur");
    }
    // Use the new connection pool method - does NOT disconnect other servers
    const connected = await dockerService.ensureServerConnection(config);
    if (!connected) {
      throw new Error("Connexion au serveur échouée");
    }
    await dockerService.configure(config);
  }
}
