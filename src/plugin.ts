import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { DockerToggleAction } from "./actions/docker-toggle";
import { DockerLogsAction } from "./actions/docker-logs";
import { DebugLogsAction, pluginLogger } from "./actions/debug-logs";
import { globalSettings } from "./services/settings-manager";
import { dockerService, ServerConfig } from "./services/docker-service";

// Configure logging
streamDeck.logger.setLevel(LogLevel.DEBUG);

// Log plugin startup
pluginLogger.info("Docker Manager plugin starting...", "plugin");

// Register actions
streamDeck.actions.registerAction(new DockerToggleAction());
streamDeck.actions.registerAction(new DockerLogsAction());
streamDeck.actions.registerAction(new DebugLogsAction());

// Initialize settings and auto-connect
async function initialize() {
  pluginLogger.info("Docker Manager plugin initializing...", "plugin");

  // Load global settings
  await globalSettings.load();
  pluginLogger.info("Global settings loaded", "plugin");

  // Auto-connect if settings exist
  const serverConfig = globalSettings.getServerConfig();
  if (serverConfig) {
    pluginLogger.info(`Server config found: ${serverConfig.connectionType} - ${serverConfig.sshHost || serverConfig.dockerHost}`, "plugin");
    try {
      await dockerService.configure(serverConfig);
      const connected = await dockerService.connect();
      pluginLogger.info(`Auto-connect to Docker server: ${connected ? "success" : "failed"}`, "plugin");
    } catch (error) {
      pluginLogger.error(`Auto-connect failed: ${error instanceof Error ? error.message : "Unknown error"}`, "plugin");
    }
  } else {
    pluginLogger.warn("No server configuration found", "plugin");
  }
}

// Listen for global settings changes
streamDeck.settings.onDidReceiveGlobalSettings<{ serverConfig?: ServerConfig }>(async (ev) => {
  pluginLogger.info("Global settings received", "plugin");
  pluginLogger.debug(`Settings: ${JSON.stringify(ev.settings)}`, "plugin");

  // Update the globalSettings manager cache (don't save back to avoid loop)
  if (ev.settings?.serverConfig) {
    globalSettings.updateServerConfigCache(ev.settings.serverConfig);
  }

  const serverConfig = ev.settings?.serverConfig;
  if (serverConfig) {
    pluginLogger.info(`New server config: ${serverConfig.connectionType} - ${serverConfig.sshHost || serverConfig.dockerHost}`, "plugin");
    try {
      // Disconnect if already connected
      if (dockerService.isConnected()) {
        pluginLogger.info("Disconnecting from current server...", "plugin");
        await dockerService.disconnect();
      }

      // Configure and reconnect with new settings
      await dockerService.configure(serverConfig);
      const connected = await dockerService.connect();
      pluginLogger.info(`Reconnected with new settings: ${connected ? "success" : "failed"}`, "plugin");
    } catch (error) {
      pluginLogger.error(`Failed to reconnect with new settings: ${error instanceof Error ? error.message : "Unknown error"}`, "plugin");
    }
  }
});

// Start the plugin and initialize
streamDeck.connect().then(() => {
  initialize();
});
