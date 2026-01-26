import { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService, ContainerHealth } from "../services/docker-service";
import { globalSettings } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";
import { logServerManager } from "../services/log-server";
import { exec } from "child_process";

interface PIMessage {
  action?: string;
}

interface LogsSettings {
  containerId: string;
  containerName: string;
  displayName?: string;
  logLines?: number;
  refreshInterval?: number;
  streamingMode?: boolean;
  streamingRefreshRate?: number; // in seconds
  windowFormat?: "small" | "full"; // Window format option
  // Icon settings (same as toggle)
  iconSource?: "default" | "file" | "url";
  iconUrl?: string;
  customIconBase64?: string;
  // Display settings
  showTitle?: boolean; // Default true
}

@action({ UUID: "io.deckops.containers.logs" })
export class DockerLogsAction extends SingletonAction<LogsSettings> {
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  // Version counter to prevent race conditions when settings change
  private settingsVersion: Map<string, number> = new Map();

  override async onWillAppear(ev: WillAppearEvent<LogsSettings>): Promise<void> {
    const { containerId, containerName, displayName, refreshInterval = 10, customIconBase64, showTitle = true } = ev.payload.settings;

    // Initialize version counter
    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    if (!containerId && !containerName) {
      await ev.action.setTitle("Config\nrequired");
      return;
    }

    const identifier = containerId || containerName;
    await this.updateDisplay(ev.action, identifier, displayName, customIconBase64, showTitle, version);

    // Set up refresh interval
    const intervalId = setInterval(async () => {
      const currentVersion = this.settingsVersion.get(ev.action.id);
      if (currentVersion === version) {
        await this.updateDisplay(ev.action, identifier, displayName, customIconBase64, showTitle, version);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onWillDisappear(ev: WillDisappearEvent<LogsSettings>): Promise<void> {
    // Increment version to cancel any pending operations
    const currentVersion = this.settingsVersion.get(ev.action.id) || 0;
    this.settingsVersion.set(ev.action.id, currentVersion + 1);

    const intervalId = this.refreshIntervals.get(ev.action.id);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshIntervals.delete(ev.action.id);
    }

    // Clean up
    this.settingsVersion.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<LogsSettings>): Promise<void> {
    const {
      containerId,
      containerName,
      displayName,
      logLines = 200,
      streamingMode = true,
      streamingRefreshRate = 2,
      windowFormat = "full"
    } = ev.payload.settings;
    const identifier = containerId || containerName;

    if (!identifier) {
      return;
    }

    try {
      // Ensure connected
      if (!dockerService.isConnected()) {
        const config = globalSettings.getServerConfig();
        if (config) {
          await dockerService.configure(config);
          await dockerService.connect();
        } else {
          return;
        }
      }

      // Create or get log server
      const serverResult = await logServerManager.createServer(
        identifier,
        displayName || identifier,
        logLines,
        streamingRefreshRate,
        windowFormat
      );

      if (!serverResult) {
        pluginLogger.error("Failed to create log server", "logs");
        return;
      }

      pluginLogger.info(`Opening logs for ${displayName || identifier} at ${serverResult.url}`, "logs");

      // Open the browser to the log server URL
      this.openBrowser(serverResult.url);

    } catch (error) {
      pluginLogger.error(`Failed to open logs: ${error instanceof Error ? error.message : "Unknown error"}`, "logs");
    }
  }

  private openBrowser(url: string): void {
    const command = process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

    exec(command, (error) => {
      if (error) {
        pluginLogger.error(`Failed to open browser: ${error.message}`, "logs");
      }
    });
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<LogsSettings>): Promise<void> {
    const { containerId, containerName, displayName, refreshInterval = 10, customIconBase64, showTitle = true } = ev.payload.settings;
    const identifier = containerId || containerName;

    // Increment version to cancel any pending operations from previous settings
    const currentVersion = (this.settingsVersion.get(ev.action.id) || 0) + 1;
    this.settingsVersion.set(ev.action.id, currentVersion);

    if (!identifier) {
      await ev.action.setTitle("Config\nrequired");
      return;
    }

    // Clear existing interval
    const existingInterval = this.refreshIntervals.get(ev.action.id);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    await this.updateDisplay(ev.action, identifier, displayName, customIconBase64, showTitle, currentVersion);

    // Set new interval
    const intervalId = setInterval(async () => {
      const checkVersion = this.settingsVersion.get(ev.action.id);
      if (checkVersion === currentVersion) {
        await this.updateDisplay(ev.action, identifier, displayName, customIconBase64, showTitle, currentVersion);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, LogsSettings>): Promise<void> {
    const actionType = ev.payload.action;

    if (actionType === "listContainers") {
      try {
        // Ensure connected
        if (!dockerService.isConnected()) {
          const config = globalSettings.getServerConfig();
          console.log("Server config:", JSON.stringify(config));

          if (!config) {
            await ev.action.sendToPropertyInspector({
              error: "No server configured. Click 'Configure Server Connection' first."
            });
            return;
          }

          await dockerService.configure(config);
          const connected = await dockerService.connect();

          if (!connected) {
            await ev.action.sendToPropertyInspector({
              error: `SSH connection failed. Check host (${config.sshHost}), credentials, and network.`
            });
            return;
          }
        }

        const containers = await dockerService.listContainers();
        await ev.action.sendToPropertyInspector({ containers });
      } catch (error) {
        console.error("Failed to list containers:", error);
        await ev.action.sendToPropertyInspector({
          error: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
        });
      }
    }
  }

  private async updateDisplay(action: Action<LogsSettings>, identifier: string, displayName?: string, customIconBase64?: string, showTitle: boolean = true, version?: number): Promise<void> {
    try {
      // Check version before doing anything
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      if (!dockerService.isConnected()) {
        const config = globalSettings.getServerConfig();
        if (config) {
          await dockerService.configure(config);
          await dockerService.connect();
        } else {
          await action.setTitle("No\nserver");
          return;
        }
      }

      // Check version again after async operation
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      const containerName = displayName || identifier;

      // Get container health for status
      const health = await dockerService.getContainerHealth(identifier);

      // Check version again after async operation
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      // Determine health state for status dot color
      let healthState: HealthState;
      if (health.state !== "running") {
        healthState = "stopped";
      } else if (health.isCrashLooping) {
        healthState = "crashloop";
      } else if (health.isStable) {
        healthState = "stable";
      } else {
        healthState = "starting";
      }

      // Generate icon with logs badge
      const iconBase64 = await iconGenerator.generateLogsIcon(containerName, customIconBase64);

      // Final version check before setting image
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

      // Update title (only if showTitle is true)
      if (showTitle) {
        const shortTitle = containerName.length > 10 ? containerName.substring(0, 9) + "..." : containerName;
        await action.setTitle(shortTitle);
      } else {
        await action.setTitle("");
      }

      // Update state
      await action.setState(health.state === "running" ? 1 : 0);

    } catch (error) {
      pluginLogger.error(`Failed to update logs display: ${error instanceof Error ? error.message : "Unknown error"}`, "logs");
      // Only show error if version still matches
      if (version === undefined || this.settingsVersion.get(action.id) === version) {
        await action.setTitle("Error");
      }
    }
  }
}
