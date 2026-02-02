import { action, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService } from "../services/docker-service";
import { composeService, ComposeFile, ComposeStack } from "../services/compose-service";
import { globalSettings } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";
import { logServerManager } from "../services/log-server";
import { exec } from "child_process";

interface PIMessage {
  action?: string;
  searchPaths?: string[];
  query?: string;
  serverId?: string;
}

interface ComposeSettings {
  // Compose file selection
  composePath: string;
  projectName: string;
  displayName?: string;
  serverId?: string; // Server ID to use for this action

  // Action configuration
  actionType: "toggle" | "up" | "down" | "restart" | "build" | "pull";
  longPressAction?: "none" | "down" | "restart" | "build" | "logs";

  // Build options
  buildOnUp?: boolean;
  forceRecreate?: boolean;

  // Service targeting (empty = all services)
  targetService?: string;

  // Logs behavior
  openLogsOnBuild?: boolean;
  openLogsOnUp?: boolean;

  // Display
  refreshInterval?: number;
  iconSource?: "default" | "file" | "url";
  iconUrl?: string;
  customIconBase64?: string;
  showTitle?: boolean;
  backgroundColor?: string;

  // Search paths for discovery
  searchPaths?: string[];
}

@action({ UUID: "io.deckops.containers.compose" })
export class DockerComposeAction extends SingletonAction<ComposeSettings> {
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  private settingsVersion: Map<string, number> = new Map();
  private keyDownTime: Map<string, number> = new Map();
  private actionSettings: Map<string, ComposeSettings> = new Map();
  private readonly LONG_PRESS_THRESHOLD = 500; // ms

  override async onWillAppear(ev: WillAppearEvent<ComposeSettings>): Promise<void> {
    const settings = ev.payload.settings;
    this.actionSettings.set(ev.action.id, settings);
    const { composePath, displayName, refreshInterval = 10, customIconBase64, showTitle = true } = settings;

    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    if (!composePath) {
      await ev.action.setTitle("Select\nCompose");
      return;
    }

    await this.updateDisplay(ev.action, settings, version);

    const intervalId = setInterval(async () => {
      const currentVersion = this.settingsVersion.get(ev.action.id);
      if (currentVersion === version) {
        await this.updateDisplay(ev.action, settings, version);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onWillDisappear(ev: WillDisappearEvent<ComposeSettings>): Promise<void> {
    const currentVersion = this.settingsVersion.get(ev.action.id) || 0;
    this.settingsVersion.set(ev.action.id, currentVersion + 1);

    const intervalId = this.refreshIntervals.get(ev.action.id);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshIntervals.delete(ev.action.id);
    }

    this.settingsVersion.delete(ev.action.id);
    this.keyDownTime.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<ComposeSettings>): Promise<void> {
    this.keyDownTime.set(ev.action.id, Date.now());
  }

  override async onKeyUp(ev: KeyUpEvent<ComposeSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { composePath, projectName, actionType, longPressAction = "none", targetService } = settings;

    if (!composePath) {
      return;
    }

    const keyDownAt = this.keyDownTime.get(ev.action.id) || Date.now();
    const pressDuration = Date.now() - keyDownAt;
    const isLongPress = pressDuration >= this.LONG_PRESS_THRESHOLD;

    // Handle logs action separately (only on long press)
    if (isLongPress && longPressAction === "logs") {
      await this.openLogs(settings);
      return;
    }

    // Determine which action to execute
    let effectiveAction: "toggle" | "up" | "down" | "restart" | "build" | "pull" = actionType;
    if (isLongPress && longPressAction !== "none" && longPressAction !== "logs") {
      effectiveAction = longPressAction;
    }

    try {
      await this.ensureConnected(settings.serverId);

      const composeFile = await this.getComposeFile(settings);
      if (!composeFile) {
        pluginLogger.error(`Compose file not found: ${composePath}`, "compose");
        return;
      }

      pluginLogger.info(`Executing ${effectiveAction} on ${projectName || composePath}`, "compose");

      let success = false;
      let shouldOpenLogs = false;

      switch (effectiveAction) {
        case "toggle": {
          const stack = await composeService.getStackStatus(composeFile);
          if (stack.status === "running" || stack.status === "partial") {
            success = await composeService.down(composeFile, targetService);
          } else {
            success = await composeService.up(composeFile, {
              build: settings.buildOnUp,
              service: targetService
            });
            shouldOpenLogs = settings.openLogsOnUp || false;
          }
          break;
        }

        case "up":
          success = await composeService.up(composeFile, {
            build: settings.buildOnUp,
            service: targetService
          });
          shouldOpenLogs = settings.openLogsOnUp || false;
          break;

        case "down":
          success = await composeService.down(composeFile, targetService);
          break;

        case "restart":
          success = await composeService.restart(composeFile, targetService);
          break;

        case "build": {
          const result = await composeService.build(composeFile, targetService);
          success = result.success;
          shouldOpenLogs = settings.openLogsOnBuild || false;
          break;
        }

        case "pull":
          success = await composeService.pull(composeFile, targetService);
          break;
      }

      if (success && shouldOpenLogs) {
        await this.openLogs(settings);
      }

      // Refresh display
      const version = this.settingsVersion.get(ev.action.id);
      if (version !== undefined) {
        await this.updateDisplay(ev.action, settings, version);
      }

    } catch (error) {
      pluginLogger.error(`Compose action failed: ${error instanceof Error ? error.message : "Unknown error"}`, "compose");
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ComposeSettings>): Promise<void> {
    const settings = ev.payload.settings;
    this.actionSettings.set(ev.action.id, settings);
    const { composePath, refreshInterval = 10 } = settings;

    const currentVersion = (this.settingsVersion.get(ev.action.id) || 0) + 1;
    this.settingsVersion.set(ev.action.id, currentVersion);

    if (!composePath) {
      await ev.action.setTitle("Select\nCompose");
      return;
    }

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

  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, ComposeSettings>): Promise<void> {
    const { action: actionType, searchPaths, query } = ev.payload;

    switch (actionType) {
      case "discoverComposeFiles":
        await this.handleDiscoverComposeFiles(ev, searchPaths);
        break;

      case "searchComposeFiles":
        await this.handleSearchComposeFiles(ev, query);
        break;

      case "getStackStatus":
        await this.handleGetStackStatus(ev);
        break;

      case "refreshContainers":
        await this.handleRefreshContainers(ev);
        break;

      case "testConnection":
        await this.handleTestConnection(ev);
        break;
    }
  }

  private async handleDiscoverComposeFiles(
    ev: SendToPluginEvent<PIMessage, ComposeSettings>,
    searchPaths?: string[]
  ): Promise<void> {
    try {
      await this.ensureConnected(ev.payload.serverId);

      const paths = searchPaths && searchPaths.length > 0
        ? searchPaths
        : ["/mnt/user", "/opt", "/home", "/root"];

      // Use progressive discovery - send files as they're found
      await composeService.discoverComposeFilesProgressive(
        paths,
        // onFileFound callback - send each file immediately
        async (file) => {
          await ev.action.sendToPropertyInspector({
            composeFileFound: {
              path: file.path,
              directory: file.directory,
              projectName: file.projectName,
              services: file.services,
              servicesCount: file.services.length
            }
          });
        },
        // onComplete callback - send final summary
        async (files) => {
          await ev.action.sendToPropertyInspector({
            discoveryComplete: true,
            totalFiles: files.length
          });
        }
      );

    } catch (error) {
      await ev.action.sendToPropertyInspector({
        error: `Failed to discover compose files: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  }

  private async handleSearchComposeFiles(
    ev: SendToPluginEvent<PIMessage, ComposeSettings>,
    query?: string
  ): Promise<void> {
    if (!query) {
      await ev.action.sendToPropertyInspector({ composeFiles: [] });
      return;
    }

    const files = composeService.searchComposeFiles(query);
    await ev.action.sendToPropertyInspector({
      composeFiles: files.map(f => ({
        path: f.path,
        directory: f.directory,
        projectName: f.projectName,
        services: f.services,
        servicesCount: f.services.length
      }))
    });
  }

  private async handleGetStackStatus(ev: SendToPluginEvent<PIMessage, ComposeSettings>): Promise<void> {
    const settings = this.actionSettings.get(ev.action.id);
    const composePath = settings?.composePath;

    if (!composePath || !settings) {
      await ev.action.sendToPropertyInspector({ stackStatus: null });
      return;
    }

    try {
      await this.ensureConnected(settings.serverId);

      const composeFile = await this.getComposeFile(settings);
      if (!composeFile) {
        await ev.action.sendToPropertyInspector({ stackStatus: null });
        return;
      }

      const status = await composeService.getStackStatus(composeFile);
      await ev.action.sendToPropertyInspector({ stackStatus: status });

    } catch (error) {
      await ev.action.sendToPropertyInspector({
        error: `Failed to get stack status: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  }

  private async handleRefreshContainers(ev: SendToPluginEvent<PIMessage, ComposeSettings>): Promise<void> {
    try {
      const requestedServerId = ev.payload.serverId;
      await this.ensureConnected(requestedServerId);
      const containers = await dockerService.listContainers();
      await ev.action.sendToPropertyInspector({ containers });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        error: `Failed to refresh containers: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  }

  private async handleTestConnection(ev: SendToPluginEvent<PIMessage, ComposeSettings>): Promise<void> {
    try {
      await this.ensureConnected(ev.payload.serverId);
      await ev.action.sendToPropertyInspector({ connected: true });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        connected: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  private async openLogs(settings: ComposeSettings): Promise<void> {
    const { composePath, projectName, targetService, serverId } = settings;

    try {
      await this.ensureConnected(serverId);

      const identifier = targetService || projectName || composePath;
      const displayName = settings.displayName || projectName || "Compose Stack";

      const serverResult = await logServerManager.createServer(
        identifier,
        displayName,
        200,
        2,
        "full"
      );

      if (serverResult) {
        this.openBrowser(serverResult.url);
      }
    } catch (error) {
      pluginLogger.error(`Failed to open logs: ${error instanceof Error ? error.message : "Unknown error"}`, "compose");
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
        pluginLogger.error(`Failed to open browser: ${error.message}`, "compose");
      }
    });
  }

  private async updateDisplay(action: Action<ComposeSettings>, settings: ComposeSettings, version?: number): Promise<void> {
    try {
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      await this.ensureConnected(settings.serverId);

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const composeFile = await this.getComposeFile(settings);
      if (!composeFile) {
        await action.setTitle("Not\nfound");
        return;
      }

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const stack = await composeService.getStackStatus(composeFile);

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      // Determine health state
      let healthState: HealthState;
      switch (stack.status) {
        case "running":
          healthState = "stable";
          break;
        case "partial":
          healthState = "starting";
          break;
        case "stopped":
          healthState = "stopped";
          break;
        default:
          healthState = "stopped";
      }

      const displayName = settings.displayName || settings.projectName || composeFile.projectName;

      // Generate icon
      const iconBase64 = await iconGenerator.generateHealthIcon(
        displayName,
        healthState,
        settings.customIconBase64,
        { backgroundColor: settings.backgroundColor }
      );

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

      // Update title
      if (settings.showTitle !== false) {
        const shortTitle = displayName.length > 10 ? displayName.substring(0, 9) + "..." : displayName;
        await action.setTitle(shortTitle);
      } else {
        await action.setTitle("");
      }

      // Update state
      await action.setState(stack.status === "running" ? 1 : 0);

    } catch (error) {
      pluginLogger.error(`Failed to update compose display: ${error instanceof Error ? error.message : "Unknown error"}`, "compose");
      if (version === undefined || this.settingsVersion.get(action.id) === version) {
        await action.setTitle("Error");
      }
    }
  }

  private async getComposeFile(settings: ComposeSettings): Promise<ComposeFile | null> {
    const { composePath, projectName } = settings;

    // Try to find in cache first
    const cachedFiles = composeService.searchComposeFiles(composePath);
    if (cachedFiles.length > 0) {
      return cachedFiles[0];
    }

    // Build a minimal ComposeFile object
    const parts = composePath.split("/");
    const filename = parts.pop() || "";
    const directory = parts.join("/");

    return {
      path: composePath,
      directory,
      filename,
      projectName: projectName || parts[parts.length - 1] || "unknown",
      services: []
    };
  }

  private async ensureConnected(serverId?: string): Promise<void> {
    // Get server config - use specific server if provided, otherwise default
    let config;
    if (serverId) {
      config = globalSettings.getServerById(serverId);
    } else {
      config = globalSettings.getServerConfig();
    }

    if (!config) {
      throw new Error("No server configuration");
    }

    // Use the new connection pool method - does NOT disconnect other servers
    const connected = await dockerService.ensureServerConnection(config);
    if (!connected) {
      throw new Error("Failed to connect to server");
    }
    // Also set as current for backwards compatibility
    await dockerService.configure(config);
  }
}
