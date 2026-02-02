import { action, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService, BatchResult, ServerConfig } from "../services/docker-service";
import { imageService } from "../services/image-service";
import { globalSettings, MultiServerConfig } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";

interface PruneSettings {
  // Server targeting
  serverId?: string;
  targetServers?: "default" | "all" | string[];  // Multi-server support

  // Prune type
  pruneType: "dangling" | "unused" | "all";

  // Display
  displayName?: string;
  showTitle?: boolean;
  customIconBase64?: string;
  backgroundColor?: string;

  // Confirmation (future: could add confirmation dialog)
  confirmBeforePrune?: boolean;
}

@action({ UUID: "io.deckops.containers.prune" })
export class DockerPruneAction extends SingletonAction<PruneSettings> {
  private settingsVersion: Map<string, number> = new Map();

  override async onWillAppear(ev: WillAppearEvent<PruneSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    await this.updateDisplay(ev.action, settings, version);
  }

  override async onWillDisappear(ev: WillDisappearEvent<PruneSettings>): Promise<void> {
    const currentVersion = this.settingsVersion.get(ev.action.id) || 0;
    this.settingsVersion.set(ev.action.id, currentVersion + 1);
    this.settingsVersion.delete(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<PruneSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { pruneType = "dangling", serverId, targetServers = "default" } = settings;

    try {
      // Determine which servers to target
      const serversToExecute = this.getTargetServers(serverId, targetServers);

      if (serversToExecute.length === 0) {
        pluginLogger.error("Aucun serveur configuré", "prune");
        await ev.action.showAlert();
        return;
      }

      pluginLogger.info(`Exécution prune (${pruneType}) sur ${serversToExecute.length} serveur(s)`, "prune");

      // Define the prune operation
      const pruneOperation = async (config: ServerConfig) => {
        // Ensure this server is configured as current for imageService
        await dockerService.configure(config);

        let result: { success: boolean; spaceSaved: string };
        switch (pruneType) {
          case "dangling":
            result = await imageService.pruneImages();
            break;
          case "unused":
          case "all":
            result = await imageService.pruneAllUnused();
            break;
          default:
            result = await imageService.pruneImages();
        }
        return result;
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
        pluginLogger.info(`Prune terminé sur ${successCount} serveur(s). Espace libéré: ${totalSpace || "inconnu"}`, "prune");
        await ev.action.showOk();
      } else if (successCount > 0) {
        pluginLogger.warn(`Prune partiel: ${successCount}/${serversToExecute.length} serveurs`, "prune");
        await ev.action.showOk();
      } else {
        pluginLogger.error("Prune échoué sur tous les serveurs", "prune");
        await ev.action.showAlert();
      }

      // Log individual results
      for (const result of results) {
        if (result.success) {
          pluginLogger.info(`  ${result.serverName}: ${result.result?.spaceSaved || "OK"}`, "prune");
        } else {
          pluginLogger.error(`  ${result.serverName}: ${result.error}`, "prune");
        }
      }

      // Refresh display
      const version = this.settingsVersion.get(ev.action.id);
      if (version !== undefined) {
        await this.updateDisplay(ev.action, settings, version);
      }

    } catch (error) {
      pluginLogger.error(`Prune échoué: ${error instanceof Error ? error.message : "Erreur inconnue"}`, "prune");
      await ev.action.showAlert();
    }
  }

  private getTargetServers(serverId?: string, targetServers?: "default" | "all" | string[]): ServerConfig[] {
    const allServers = globalSettings.getServers();

    // If "all" is selected, return all servers
    if (targetServers === "all") {
      return allServers.length > 0 ? allServers : this.getDefaultServerAsArray();
    }

    // If specific servers are selected (array)
    if (Array.isArray(targetServers) && targetServers.length > 0) {
      return targetServers
        .map(id => globalSettings.getServerById(id))
        .filter((s): s is MultiServerConfig => s !== undefined);
    }

    // Default behavior: use serverId or default server
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

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PruneSettings>): Promise<void> {
    const settings = ev.payload.settings;

    const currentVersion = (this.settingsVersion.get(ev.action.id) || 0) + 1;
    this.settingsVersion.set(ev.action.id, currentVersion);

    await this.updateDisplay(ev.action, settings, currentVersion);
  }

  private async updateDisplay(action: Action<PruneSettings>, settings: PruneSettings, version?: number): Promise<void> {
    try {
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const { pruneType = "dangling", displayName, showTitle = true, customIconBase64, backgroundColor } = settings;

      // Default titles based on prune type
      let title = displayName;
      if (!title) {
        switch (pruneType) {
          case "dangling":
            title = "Orphelines";
            break;
          case "unused":
            title = "Inutilisées";
            break;
          case "all":
            title = "Tout";
            break;
          default:
            title = "Nettoyer";
        }
      }

      // Use a cleaning/trash icon state
      const healthState: HealthState = "stopped"; // Orange/red color for cleanup actions

      const iconBase64 = await iconGenerator.generateHealthIcon(
        title,
        healthState,
        customIconBase64,
        { backgroundColor: backgroundColor || "#E67E22" } // Orange for cleanup
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
      pluginLogger.error(`Failed to update prune display: ${error instanceof Error ? error.message : "Unknown error"}`, "prune");
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
      pluginLogger.error("No server config found", "prune");
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
