import { action, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService } from "../services/docker-service";
import { networkService, DockerNetwork } from "../services/network-service";
import { globalSettings } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";

interface NetworkPIMessage {
  action?: string;
}

interface NetworkSettings {
  // Action type
  actionType: "status" | "prune" | "list";

  // Selected network (for future: inspect specific network)
  networkName?: string;

  // Display
  displayName?: string;
  showTitle?: boolean;
  customIconBase64?: string;
  backgroundColor?: string;

  // Refresh
  refreshInterval?: number;
}

@action({ UUID: "io.deckops.containers.network" })
export class DockerNetworkAction extends SingletonAction<NetworkSettings> {
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  private settingsVersion: Map<string, number> = new Map();

  override async onWillAppear(ev: WillAppearEvent<NetworkSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { refreshInterval = 30 } = settings;

    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    await this.updateDisplay(ev.action, settings, version);

    // Refresh periodically
    const intervalId = setInterval(async () => {
      const currentVersion = this.settingsVersion.get(ev.action.id);
      if (currentVersion === version) {
        await this.updateDisplay(ev.action, settings, version);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onWillDisappear(ev: WillDisappearEvent<NetworkSettings>): Promise<void> {
    const currentVersion = this.settingsVersion.get(ev.action.id) || 0;
    this.settingsVersion.set(ev.action.id, currentVersion + 1);

    const intervalId = this.refreshIntervals.get(ev.action.id);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshIntervals.delete(ev.action.id);
    }

    this.settingsVersion.delete(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<NetworkSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { actionType = "status" } = settings;

    try {
      await this.ensureConnected();

      switch (actionType) {
        case "prune":
          pluginLogger.info("Pruning unused networks", "network");
          const result = await networkService.pruneNetworks();
          if (result.success) {
            const count = result.networksRemoved?.length || 0;
            pluginLogger.info(`Pruned ${count} networks`, "network");
            await ev.action.showOk();
          } else {
            await ev.action.showAlert();
          }
          break;

        case "status":
        case "list":
        default:
          // Just refresh the display
          await ev.action.showOk();
          break;
      }

      // Refresh display
      const version = this.settingsVersion.get(ev.action.id);
      if (version !== undefined) {
        await this.updateDisplay(ev.action, settings, version);
      }

    } catch (error) {
      pluginLogger.error(`Network action failed: ${error instanceof Error ? error.message : "Unknown error"}`, "network");
      await ev.action.showAlert();
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<NetworkSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { refreshInterval = 30 } = settings;

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

  override async onSendToPlugin(ev: SendToPluginEvent<NetworkPIMessage, NetworkSettings>): Promise<void> {
    const { action: actionType } = ev.payload;

    switch (actionType) {
      case "listNetworks":
        await this.handleListNetworks(ev);
        break;

      case "testConnection":
        await this.handleTestConnection(ev);
        break;
    }
  }

  private async handleListNetworks(ev: SendToPluginEvent<NetworkPIMessage, NetworkSettings>): Promise<void> {
    try {
      await this.ensureConnected();
      const networks = await networkService.listNetworks();
      await ev.action.sendToPropertyInspector({ networks });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        error: `Erreur: ${error instanceof Error ? error.message : "Erreur inconnue"}`
      });
    }
  }

  private async handleTestConnection(ev: SendToPluginEvent<NetworkPIMessage, NetworkSettings>): Promise<void> {
    try {
      await this.ensureConnected();
      await ev.action.sendToPropertyInspector({ connected: true });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        connected: false,
        error: error instanceof Error ? error.message : "Erreur inconnue"
      });
    }
  }

  private async updateDisplay(action: Action<NetworkSettings>, settings: NetworkSettings, version?: number): Promise<void> {
    try {
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const { actionType = "status", displayName, showTitle = true, customIconBase64, backgroundColor } = settings;

      await this.ensureConnected();

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      // Get network summary
      const summary = await networkService.getNetworkSummary();

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      let title = displayName || "Réseaux";
      let subtitle = `${summary.total}`;

      // Determine health state
      let healthState: HealthState = "stable"; // Green for normal

      if (actionType === "prune") {
        title = displayName || "Prune\nRéseaux";
        healthState = "stopped"; // Orange for prune action
      }

      const iconBase64 = await iconGenerator.generateHealthIcon(
        subtitle,
        healthState,
        customIconBase64,
        { backgroundColor: backgroundColor || "#9B59B6" } // Purple for networks
      );

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

      if (showTitle !== false) {
        const displayTitle = actionType === "prune" ? title : `${title}\n${subtitle}`;
        await action.setTitle(displayTitle);
      } else {
        await action.setTitle("");
      }

    } catch (error) {
      pluginLogger.error(`Failed to update network display: ${error instanceof Error ? error.message : "Unknown error"}`, "network");
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
