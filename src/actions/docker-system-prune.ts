import { action, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService, BatchResult, ServerConfig } from "../services/docker-service";
import { imageService } from "../services/image-service";
import { globalSettings, MultiServerConfig } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";

interface SystemPruneSettings {
  // Server targeting
  serverId?: string;
  targetServers?: "default" | "all" | string[];  // Multi-server support

  // Options
  includeVolumes?: boolean;

  // Display
  displayName?: string;
  showTitle?: boolean;
  customIconBase64?: string;
  backgroundColor?: string;
}

@action({ UUID: "io.deckops.containers.systemprune" })
export class DockerSystemPruneAction extends SingletonAction<SystemPruneSettings> {
  private settingsVersion: Map<string, number> = new Map();

  override async onWillAppear(ev: WillAppearEvent<SystemPruneSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    await this.updateDisplay(ev.action, settings, version);
  }

  override async onWillDisappear(ev: WillDisappearEvent<SystemPruneSettings>): Promise<void> {
    const currentVersion = this.settingsVersion.get(ev.action.id) || 0;
    this.settingsVersion.set(ev.action.id, currentVersion + 1);
    this.settingsVersion.delete(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<SystemPruneSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { includeVolumes = false, serverId, targetServers = "default" } = settings;

    try {
      // Determine which servers to target
      const serversToExecute = this.getTargetServers(serverId, targetServers);

      if (serversToExecute.length === 0) {
        pluginLogger.error("Aucun serveur configuré", "systemprune");
        await ev.action.showAlert();
        return;
      }

      pluginLogger.info(`Exécution system prune (volumes: ${includeVolumes}) sur ${serversToExecute.length} serveur(s)`, "systemprune");

      // Define the system prune operation
      const pruneOperation = async (config: ServerConfig) => {
        await dockerService.configure(config);
        return await imageService.systemPrune(includeVolumes);
      };

      // Execute on all target servers
      const results = await dockerService.executeBatch(serversToExecute, pruneOperation);

      // Check results
      const successCount = results.filter(r => r.success).length;
      const totalSpace = results
        .filter(r => r.success && r.result?.spaceSaved)
        .map(r => r.result!.spaceSaved)
        .join(", ");

      if (successCount === serversToExecute.length) {
        pluginLogger.info(`System prune terminé sur ${successCount} serveur(s). Espace libéré: ${totalSpace || "inconnu"}`, "systemprune");
        await ev.action.showOk();
      } else if (successCount > 0) {
        pluginLogger.warn(`System prune partiel: ${successCount}/${serversToExecute.length} serveurs`, "systemprune");
        await ev.action.showOk();
      } else {
        pluginLogger.error("System prune échoué sur tous les serveurs", "systemprune");
        await ev.action.showAlert();
      }

      // Log individual results
      for (const result of results) {
        if (result.success) {
          pluginLogger.info(`  ${result.serverName}: ${result.result?.spaceSaved || "OK"}`, "systemprune");
        } else {
          pluginLogger.error(`  ${result.serverName}: ${result.error}`, "systemprune");
        }
      }

      // Refresh display
      const version = this.settingsVersion.get(ev.action.id);
      if (version !== undefined) {
        await this.updateDisplay(ev.action, settings, version);
      }

    } catch (error) {
      pluginLogger.error(`System prune échoué: ${error instanceof Error ? error.message : "Erreur inconnue"}`, "systemprune");
      await ev.action.showAlert();
    }
  }

  private getTargetServers(serverId?: string, targetServers?: "default" | "all" | string[]): ServerConfig[] {
    const allServers = globalSettings.getServers();

    if (targetServers === "all") {
      return allServers.length > 0 ? allServers : this.getDefaultServerAsArray();
    }

    if (Array.isArray(targetServers) && targetServers.length > 0) {
      return targetServers
        .map(id => globalSettings.getServerById(id))
        .filter((s): s is MultiServerConfig => s !== undefined);
    }

    if (serverId) {
      const server = globalSettings.getServerById(serverId);
      return server ? [server] : [];
    }

    return this.getDefaultServerAsArray();
  }

  private getDefaultServerAsArray(): ServerConfig[] {
    const defaultServer = globalSettings.getDefaultServer();
    if (defaultServer) return [defaultServer];

    const serverConfig = globalSettings.getServerConfig();
    if (serverConfig) return [serverConfig];

    return [];
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SystemPruneSettings>): Promise<void> {
    const settings = ev.payload.settings;

    const currentVersion = (this.settingsVersion.get(ev.action.id) || 0) + 1;
    this.settingsVersion.set(ev.action.id, currentVersion);

    await this.updateDisplay(ev.action, settings, currentVersion);
  }

  private async updateDisplay(action: Action<SystemPruneSettings>, settings: SystemPruneSettings, version?: number): Promise<void> {
    try {
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const { includeVolumes = false, displayName, showTitle = true, customIconBase64, backgroundColor } = settings;

      let title = displayName || (includeVolumes ? "Prune\nTotal" : "Prune\nSystème");

      // Use warning color for system prune (it's destructive)
      const healthState: HealthState = "crashloop"; // Red for destructive action

      const iconBase64 = await iconGenerator.generateHealthIcon(
        title,
        healthState,
        customIconBase64,
        { backgroundColor: backgroundColor || "#C0392B" } // Red for dangerous operation
      );

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

      if (showTitle !== false) {
        await action.setTitle(title);
      } else {
        await action.setTitle("");
      }

    } catch (error) {
      pluginLogger.error(`Failed to update system prune display: ${error instanceof Error ? error.message : "Unknown error"}`, "systemprune");
      if (version === undefined || this.settingsVersion.get(action.id) === version) {
        await action.setTitle("Erreur");
      }
    }
  }

  private async ensureConnected(serverId?: string): Promise<boolean> {
    let config;
    if (serverId) {
      config = globalSettings.getServerById(serverId);
    } else {
      config = globalSettings.getServerConfig();
    }

    if (!config) {
      pluginLogger.error("No server config found", "systemprune");
      return false;
    }

    // Use the new connection pool method - does NOT disconnect other servers
    const connected = await dockerService.ensureServerConnection(config);
    if (connected) {
      await dockerService.configure(config);
    }
    return connected;
  }
}
