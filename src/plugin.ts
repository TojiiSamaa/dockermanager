import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { DockerToggleAction } from "./actions/docker-toggle";
import { DockerLogsAction } from "./actions/docker-logs";
import { DebugLogsAction, pluginLogger } from "./actions/debug-logs";
import { DockerComposeAction } from "./actions/docker-compose";
import { DockerImageAction } from "./actions/docker-image";
import { globalSettings } from "./services/settings-manager";
import { dockerService, ServerConfig } from "./services/docker-service";
import { logServerManager } from "./services/log-server";

// Configure logging
streamDeck.logger.setLevel(LogLevel.DEBUG);

// Log plugin startup
pluginLogger.info("Docker Manager plugin starting...", "plugin");

// Register actions
streamDeck.actions.registerAction(new DockerToggleAction());
streamDeck.actions.registerAction(new DockerLogsAction());
streamDeck.actions.registerAction(new DebugLogsAction());
streamDeck.actions.registerAction(new DockerComposeAction());
streamDeck.actions.registerAction(new DockerImageAction());

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
  // SECURITY: Never log full settings - they contain credentials

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

// Cleanup function for graceful shutdown
async function cleanup() {
  pluginLogger.info("Plugin shutting down, cleaning up resources...", "plugin");

  try {
    // Destroy all log servers
    await logServerManager.destroyAllServers();
    pluginLogger.info("Log servers cleaned up", "plugin");

    // Disconnect from Docker
    if (dockerService.isConnected()) {
      await dockerService.disconnect();
      pluginLogger.info("Disconnected from Docker server", "plugin");
    }
  } catch (error) {
    pluginLogger.error(`Cleanup error: ${error instanceof Error ? error.message : "Unknown error"}`, "plugin");
  }
}

// Handle process termination signals
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});

process.on("exit", () => {
  // Synchronous cleanup if needed (limited)
  pluginLogger.info("Plugin process exiting", "plugin");
});

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  pluginLogger.error(`Uncaught exception: ${error.message}`, "plugin");
  await cleanup();
  process.exit(1);
});

// Start the plugin and initialize
streamDeck.connect().then(() => {
  initialize();
});
