import streamDeck, { action, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService, ContainerHealth } from "../services/docker-service";
import { globalSettings } from "../services/settings-manager";
import { iconGenerator, ContainerState, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";
import { exec } from "child_process";
import { escapeURL, sanitizeClipboardText } from "../services/shell-escape";

interface PIMessage {
  action?: string;
  serverId?: string;  // Server ID to use for listContainers
}

type ActionType = "toggle" | "start" | "stop" | "restart" | "status" | "openUrl" | "copyToClipboard";

interface ToggleSettings {
  containerId: string;
  containerName: string;
  displayName?: string;
  serverId?: string; // Server ID to use for this action
  action?: ActionType;
  refreshInterval?: number;
  // URL settings
  primaryUrl?: string;
  longPressAction?: ActionType;
  longPressUrl?: string;
  // Clipboard settings
  clipboardText?: string;
  longPressClipboardText?: string;
  // Long press duration
  longPressDuration?: number; // Default 500ms
  // Icon settings
  iconSource?: "default" | "file" | "url";
  iconUrl?: string;
  customIconBase64?: string;
  backgroundColor?: string; // Custom background color (hex)
  // Display settings
  showTitle?: boolean; // Default true
}

// Default long press threshold in ms
const DEFAULT_LONG_PRESS_THRESHOLD = 500;

@action({ UUID: "io.deckops.containers.toggle" })
export class DockerToggleAction extends SingletonAction<ToggleSettings> {
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  private keyDownTimes: Map<string, number> = new Map();
  private animationIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastKnownStates: Map<string, ContainerState> = new Map();
  private healthAnimations: Map<string, NodeJS.Timeout> = new Map();
  private lastHealthStates: Map<string, HealthState> = new Map();
  private initialLoadDone: Map<string, boolean> = new Map();
  // Version counter to prevent race conditions when settings change
  private settingsVersion: Map<string, number> = new Map();

  override async onWillAppear(ev: WillAppearEvent<ToggleSettings>): Promise<void> {
    const { containerId, containerName, displayName, serverId, refreshInterval = 5, customIconBase64, backgroundColor, showTitle = true } = ev.payload.settings;

    // Initialize version counter
    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    if (!containerId && !containerName) {
      await ev.action.setTitle("Config\nrequired");
      return;
    }

    const identifier = containerId || containerName;
    const name = displayName || identifier;

    // Show loading state immediately (gray dot) while fetching actual state
    const loadingIcon = await iconGenerator.generateHealthIcon(name, "loading", customIconBase64, { backgroundColor });
    await ev.action.setImage(`data:image/svg+xml;base64,${loadingIcon}`);
    if (showTitle) {
      const shortTitle = name.length > 10 ? name.substring(0, 9) + "…" : name;
      await ev.action.setTitle(shortTitle);
    } else {
      await ev.action.setTitle("");
    }

    // Phase 1: Quick initial load - just get basic state and show icon immediately
    await this.quickUpdateStatus(ev.action, identifier, displayName, serverId, customIconBase64, backgroundColor, showTitle, version);

    // Phase 2: Full health check in background (async, don't await)
    this.updateContainerStatus(ev.action, identifier, displayName, serverId, customIconBase64, backgroundColor, showTitle, version).then(() => {
      // Only mark as done if version still matches
      if (this.settingsVersion.get(ev.action.id) === version) {
        this.initialLoadDone.set(ev.action.id, true);
      }
    });

    // Set up refresh interval - use full health check for subsequent updates
    const intervalId = setInterval(async () => {
      const currentVersion = this.settingsVersion.get(ev.action.id);
      if (currentVersion === version) {
        await this.updateContainerStatus(ev.action, identifier, displayName, serverId, customIconBase64, backgroundColor, showTitle, version);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onWillDisappear(ev: WillDisappearEvent<ToggleSettings>): Promise<void> {
    // Increment version to cancel any pending operations
    const currentVersion = this.settingsVersion.get(ev.action.id) || 0;
    this.settingsVersion.set(ev.action.id, currentVersion + 1);

    // Clear refresh interval
    const intervalId = this.refreshIntervals.get(ev.action.id);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshIntervals.delete(ev.action.id);
    }
    // Stop any running animations
    this.stopAnimation(ev.action.id);
    this.stopHealthAnimation(ev.action.id);
    // Clear state tracking
    this.lastKnownStates.delete(ev.action.id);
    this.lastHealthStates.delete(ev.action.id);
    this.initialLoadDone.delete(ev.action.id);
    this.settingsVersion.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<ToggleSettings>): Promise<void> {
    // Record the key down time for long press detection
    this.keyDownTimes.set(ev.action.id, Date.now());
  }

  override async onKeyUp(ev: KeyUpEvent<ToggleSettings>): Promise<void> {
    const keyDownTime = this.keyDownTimes.get(ev.action.id) || Date.now();
    const pressDuration = Date.now() - keyDownTime;
    const longPressThreshold = ev.payload.settings.longPressDuration || DEFAULT_LONG_PRESS_THRESHOLD;
    const isLongPress = pressDuration >= longPressThreshold;

    const {
      containerId,
      containerName,
      displayName,
      serverId,
      action: actionType = "toggle",
      primaryUrl,
      longPressAction,
      longPressUrl,
      clipboardText,
      longPressClipboardText
    } = ev.payload.settings;

    const identifier = containerId || containerName;

    // Debug logging
    pluginLogger.debug(`Key press duration: ${pressDuration}ms, threshold: ${longPressThreshold}ms, isLongPress: ${isLongPress}`, "toggle");
    pluginLogger.debug(`Settings: actionType=${actionType}, longPressAction=${longPressAction}`, "toggle");

    // Determine which action to execute
    const effectiveAction = isLongPress && longPressAction ? longPressAction : actionType;
    pluginLogger.debug(`Effective action: ${effectiveAction}`, "toggle");
    const effectiveUrl = isLongPress && longPressUrl ? longPressUrl : primaryUrl;
    const effectiveClipboardText = isLongPress && longPressClipboardText ? longPressClipboardText : clipboardText;

    // Handle copyToClipboard action
    if (effectiveAction === "copyToClipboard") {
      if (effectiveClipboardText) {
        this.copyToClipboard(effectiveClipboardText);
        pluginLogger.info(`Copied text to clipboard`, "toggle");
        // Show validation feedback
        const { customIconBase64 } = ev.payload.settings;
        await this.showValidationFeedback(ev.action, displayName || identifier || "Copy", customIconBase64);
      }
      return;
    }

    // Handle openUrl action
    if (effectiveAction === "openUrl") {
      if (effectiveUrl) {
        this.openUrl(effectiveUrl);
        // Show validation feedback
        const { customIconBase64 } = ev.payload.settings;
        await this.showValidationFeedback(ev.action, displayName || identifier || "URL", customIconBase64);
      }
      return;
    }

    // Handle status action (just refresh, no container action)
    if (effectiveAction === "status") {
      if (identifier) {
        const { customIconBase64, backgroundColor, showTitle = true } = ev.payload.settings;
        const currentVersion = this.settingsVersion.get(ev.action.id);
        // Show validation feedback first
        await this.showValidationFeedback(ev.action, displayName || identifier, customIconBase64);
        // Then update status after a brief delay
        setTimeout(async () => {
          // Check version before updating
          if (this.settingsVersion.get(ev.action.id) === currentVersion) {
            await this.updateContainerStatus(ev.action, identifier, displayName, serverId, customIconBase64, backgroundColor, showTitle, currentVersion);
          }
        }, 600);
      }
      return;
    }

    // Docker container actions
    if (!identifier) {
      return;
    }

    // Get current version for this action
    const currentVersion = this.settingsVersion.get(ev.action.id);

    try {
      // Ensure connected to the correct server
      const connected = await this.ensureConnected(serverId);
      if (!connected) {
        return;
      }

      const currentState = await dockerService.getContainerState(identifier);
      const isRunning = currentState === "running";

      const containerName = displayName || identifier;
      const { customIconBase64 } = ev.payload.settings;

      // Determine transition direction based on action
      let transitionDirection: "starting" | "stopping" | null = null;

      switch (effectiveAction) {
        case "start":
          if (!isRunning) {
            transitionDirection = "starting";
            await dockerService.startContainer(identifier);
          } else {
            // Already running - show validation feedback
            await this.showValidationFeedback(ev.action, containerName, customIconBase64);
          }
          break;

        case "stop":
          if (isRunning) {
            transitionDirection = "stopping";
            await dockerService.stopContainer(identifier);
          } else {
            // Already stopped - show validation feedback
            await this.showValidationFeedback(ev.action, containerName, customIconBase64);
          }
          break;

        case "restart":
          // For restart: stop then start
          transitionDirection = isRunning ? "stopping" : "starting";
          await dockerService.restartContainer(identifier);
          break;

        case "toggle":
        default:
          if (isRunning) {
            transitionDirection = "stopping";
            await dockerService.stopContainer(identifier);
          } else {
            transitionDirection = "starting";
            await dockerService.startContainer(identifier);
          }
          break;
      }

      // Play transition animation if state is changing
      if (transitionDirection) {
        // Show brief validation feedback (independent, non-blocking)
        this.flashValidation(ev.action, containerName, customIconBase64);

        // Start transition animation immediately
        await this.playTransitionAnimation(ev.action, containerName, transitionDirection, customIconBase64, currentVersion);
      }

      const { customIconBase64: customIcon, backgroundColor: bgColor, showTitle = true } = ev.payload.settings;
      // After transition animation, continue monitoring until stable
      setTimeout(async () => {
        // Check version before updating
        if (this.settingsVersion.get(ev.action.id) === currentVersion) {
          this.stopAnimation(ev.action.id);
          await this.updateContainerStatus(ev.action, identifier, displayName, serverId, customIcon, bgColor, showTitle, currentVersion);
        }
      }, 2500);
    } catch (error) {
      pluginLogger.error(`Failed to toggle container: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
      // Only update if version still matches
      if (this.settingsVersion.get(ev.action.id) === currentVersion) {
        this.stopAnimation(ev.action.id);
        // Restore previous state icon
        const { customIconBase64, backgroundColor, showTitle = true } = ev.payload.settings;
        await this.updateContainerStatus(ev.action, identifier, displayName, serverId, customIconBase64, backgroundColor, showTitle, currentVersion);
      }
    }
  }

  private openUrl(url: string): void {
    try {
      // Validate and escape URL to prevent command injection
      const safeUrl = escapeURL(url);

      // Open URL in default browser with escaped URL
      const command = process.platform === "win32"
        ? `start "" ${safeUrl}`
        : process.platform === "darwin"
          ? `open ${safeUrl}`
          : `xdg-open ${safeUrl}`;

      exec(command, (error) => {
        if (error) {
          pluginLogger.error(`Failed to open URL: ${error.message}`, "toggle");
        }
      });
    } catch (error) {
      pluginLogger.error(`Invalid URL: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
    }
  }

  private copyToClipboard(text: string): void {
    try {
      // Sanitize text to prevent command injection
      const safeText = sanitizeClipboardText(text);

      // Use Node.js child_process with stdin to avoid shell escaping issues
      const { spawn } = require("child_process");

      let proc;
      if (process.platform === "win32") {
        // Windows: use clip command via stdin
        proc = spawn("clip", [], { shell: false });
      } else if (process.platform === "darwin") {
        // macOS: use pbcopy via stdin
        proc = spawn("pbcopy", [], { shell: false });
      } else {
        // Linux: use xclip via stdin
        proc = spawn("xclip", ["-selection", "clipboard"], { shell: false });
      }

      proc.on("error", (error: Error) => {
        pluginLogger.error(`Failed to copy to clipboard: ${error.message}`, "toggle");
      });

      // Write text to stdin (safest way - no shell escaping needed)
      proc.stdin.write(safeText);
      proc.stdin.end();

      pluginLogger.debug("Text copied to clipboard successfully", "toggle");
    } catch (error) {
      pluginLogger.error(`Failed to copy to clipboard: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ToggleSettings>): Promise<void> {
    const { containerId, containerName, displayName, serverId, refreshInterval = 5, customIconBase64, backgroundColor, showTitle = true } = ev.payload.settings;
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
      this.refreshIntervals.delete(ev.action.id);
    }

    // Stop ALL running animations (settings changed, so restart fresh)
    this.stopAnimation(ev.action.id);
    this.stopHealthAnimation(ev.action.id);

    // Clear previous state tracking
    this.lastKnownStates.delete(ev.action.id);
    this.lastHealthStates.delete(ev.action.id);

    // Reset initial load flag
    this.initialLoadDone.set(ev.action.id, false);

    // Show loading state immediately (gray dot) while fetching actual state
    const name = displayName || identifier;
    const loadingIcon = await iconGenerator.generateHealthIcon(name, "loading", customIconBase64, { backgroundColor });
    await ev.action.setImage(`data:image/svg+xml;base64,${loadingIcon}`);
    if (showTitle) {
      const shortTitle = name.length > 10 ? name.substring(0, 9) + "…" : name;
      await ev.action.setTitle(shortTitle);
    } else {
      await ev.action.setTitle("");
    }

    // Phase 1: Quick update first
    await this.quickUpdateStatus(ev.action, identifier, displayName, serverId, customIconBase64, backgroundColor, showTitle, currentVersion);

    // Phase 2: Full health check in background
    this.updateContainerStatus(ev.action, identifier, displayName, serverId, customIconBase64, backgroundColor, showTitle, currentVersion).then(() => {
      // Only mark as done if version still matches
      if (this.settingsVersion.get(ev.action.id) === currentVersion) {
        this.initialLoadDone.set(ev.action.id, true);
      }
    });

    // Set new interval
    const intervalId = setInterval(async () => {
      const checkVersion = this.settingsVersion.get(ev.action.id);
      if (checkVersion === currentVersion) {
        await this.updateContainerStatus(ev.action, identifier, displayName, serverId, customIconBase64, backgroundColor, showTitle, currentVersion);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, ToggleSettings>): Promise<void> {
    const actionType = ev.payload.action;

    if (actionType === "listContainers") {
      try {
        const requestedServerId = ev.payload.serverId;
        pluginLogger.info(`listContainers request received from PI for server: ${requestedServerId || 'default'}`, "toggle");
        await ev.action.sendToPropertyInspector({ log: "Starting listContainers..." });

        // Get server config - use specific server if provided, otherwise default
        let config;
        if (requestedServerId) {
          config = globalSettings.getServerById(requestedServerId);
          pluginLogger.info(`Using specific server: ${requestedServerId}`, "toggle");
        } else {
          config = globalSettings.getServerConfig();
        }

        if (!config) {
          pluginLogger.error("No server config found", "toggle");
          await ev.action.sendToPropertyInspector({
            log: "No server config found",
            logType: "error"
          });
          await ev.action.sendToPropertyInspector({
            error: "No server configured. Click 'Manage Servers' first."
          });
          return;
        }

        // Check if we need to reconnect (different server or not connected)
        const targetHost = config.sshHost || config.dockerHost;
        const currentHost = dockerService.getActiveHost();
        const needsReconnect = !dockerService.isConnected() || currentHost !== targetHost;

        if (needsReconnect) {
          pluginLogger.info(`Connecting to server: ${targetHost}`, "toggle");
          await ev.action.sendToPropertyInspector({ log: `Connecting to ${targetHost}...` });

          // Disconnect first if switching servers
          if (dockerService.isConnected() && currentHost !== targetHost) {
            pluginLogger.info(`Switching from ${currentHost} to ${targetHost}`, "toggle");
            await dockerService.disconnect();
          }

          await dockerService.configure(config);
          const connected = await dockerService.connect();

          if (!connected) {
            pluginLogger.error(`Connection failed to ${targetHost}`, "toggle");
            await ev.action.sendToPropertyInspector({
              log: "Connection failed!",
              logType: "error"
            });
            await ev.action.sendToPropertyInspector({
              error: `Connection failed to ${targetHost}. Check settings.`
            });
            return;
          }

          pluginLogger.info("Connected successfully!", "toggle");
          await ev.action.sendToPropertyInspector({ log: "Connected successfully!" });
        } else {
          pluginLogger.info(`Already connected to ${currentHost}`, "toggle");
          await ev.action.sendToPropertyInspector({ log: `Already connected to ${currentHost}` });
        }

        pluginLogger.info("Fetching containers list...", "toggle");
        await ev.action.sendToPropertyInspector({ log: "Fetching containers..." });
        const containers = await dockerService.listContainers();
        pluginLogger.info(`Got ${containers.length} containers`, "toggle");
        await ev.action.sendToPropertyInspector({ log: `Got ${containers.length} containers` });
        await ev.action.sendToPropertyInspector({ containers });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        pluginLogger.error(`Failed to list containers: ${errorMsg}`, "toggle");
        await ev.action.sendToPropertyInspector({
          log: `Exception: ${errorMsg}`,
          logType: "error"
        });
        await ev.action.sendToPropertyInspector({
          error: `Error: ${errorMsg}`
        });
      }
    }

    // Test connection handler
    if (actionType === "testConnection") {
      try {
        pluginLogger.info("testConnection request received from PI", "toggle");
        await ev.action.sendToPropertyInspector({ testStatus: "testing", message: "Testing connection..." });

        const config = globalSettings.getServerConfig();

        if (!config) {
          pluginLogger.error("No server config found for test", "toggle");
          await ev.action.sendToPropertyInspector({
            testStatus: "error",
            message: "No server configured. Click 'Configure Server Connection' first."
          });
          return;
        }

        pluginLogger.info(`Testing connection to: ${config.connectionType} - ${config.sshHost || config.dockerHost}`, "toggle");

        // Disconnect if already connected to force a fresh test
        if (dockerService.isConnected()) {
          pluginLogger.info("Disconnecting for fresh test...", "toggle");
          await dockerService.disconnect();
        }

        // Configure and try to connect
        await dockerService.configure(config);
        const connected = await dockerService.connect();

        if (connected) {
          // Try to list containers as an additional test
          const containers = await dockerService.listContainers();
          pluginLogger.info(`Connection test successful! Found ${containers.length} containers.`, "toggle");
          await ev.action.sendToPropertyInspector({
            testStatus: "success",
            message: `Connected! Found ${containers.length} container(s).`
          });
        } else {
          pluginLogger.error("Connection test failed", "toggle");
          await ev.action.sendToPropertyInspector({
            testStatus: "error",
            message: `Connection failed to ${config.sshHost || config.dockerHost}. Check your settings.`
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        pluginLogger.error(`Connection test exception: ${errorMsg}`, "toggle");
        await ev.action.sendToPropertyInspector({
          testStatus: "error",
          message: `Error: ${errorMsg}`
        });
      }
    }
  }

  /**
   * Ensure connection to the correct server
   * @param serverId - Optional server ID to connect to (uses default if not provided)
   * @returns true if connected successfully
   */
  private async ensureConnected(serverId?: string): Promise<boolean> {
    // Get server config - use specific server if provided, otherwise default
    let config;
    if (serverId) {
      config = globalSettings.getServerById(serverId);
      pluginLogger.debug(`Using specific server: ${serverId}`, "toggle");
    } else {
      config = globalSettings.getServerConfig();
    }

    if (!config) {
      pluginLogger.error("No server config found", "toggle");
      return false;
    }

    // Use the new connection pool method - does NOT disconnect other servers
    const connected = await dockerService.ensureServerConnection(config);
    if (!connected) {
      const targetHost = config.sshHost || config.dockerHost;
      pluginLogger.error(`Connection failed to ${targetHost}`, "toggle");
      return false;
    }

    // Also set as current for backwards compatibility with other methods
    await dockerService.configure(config);
    return true;
  }

  /**
   * Quick status update - just gets basic state, no full health check
   * Used for initial fast loading before detailed health info is available
   */
  private async quickUpdateStatus(action: Action<ToggleSettings>, identifier: string, displayName?: string, serverId?: string, customIconBase64?: string, backgroundColor?: string, showTitle: boolean = true, version?: number): Promise<void> {
    try {
      // Check version before doing anything
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      // Ensure connected to the correct server
      const connected = await this.ensureConnected(serverId);
      if (!connected) {
        await action.setTitle("No\nserver");
        await action.setState(0);
        return;
      }

      // Quick state check only
      const state = await dockerService.getContainerState(identifier);

      // Check version again after async operation
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      const containerName = displayName || identifier;

      // Update title (only if showTitle is true)
      if (showTitle) {
        const shortTitle = containerName.length > 10 ? containerName.substring(0, 9) + "…" : containerName;
        await action.setTitle(shortTitle);
      } else {
        await action.setTitle("");
      }

      // Update state (0 = stopped, 1 = running)
      await action.setState(state === "running" ? 1 : 0);

      // Show basic icon based on running/stopped state
      const healthState: HealthState = state === "running" ? "starting" : "stopped";
      const iconBase64 = await iconGenerator.generateHealthIcon(containerName, healthState, customIconBase64, { backgroundColor });

      // Final version check before setting image
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

      // Store basic state
      this.lastKnownStates.set(action.id, state as ContainerState);

    } catch (error) {
      pluginLogger.error(`Failed to quick update container status: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
      // Only show error if version still matches
      if (version === undefined || this.settingsVersion.get(action.id) === version) {
        await action.setTitle("Error");
        await action.setState(0);
      }
    }
  }

  private async updateContainerStatus(action: Action<ToggleSettings>, identifier: string, displayName?: string, serverId?: string, customIconBase64?: string, backgroundColor?: string, showTitle: boolean = true, version?: number): Promise<void> {
    try {
      // Check version before doing anything
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      // Ensure connected to the correct server
      const connected = await this.ensureConnected(serverId);
      if (!connected) {
        await action.setTitle("No\nserver");
        await action.setState(0);
        return;
      }

      // Get detailed health information
      const health = await dockerService.getContainerHealth(identifier);

      // Check version again after async operation
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      const containerName = displayName || identifier;

      // Determine health state
      let healthState: HealthState;
      if (health.state !== "running") {
        healthState = "stopped";
      } else if (health.isCrashLooping) {
        healthState = "crashloop";
      } else if (health.isStable) {
        healthState = "stable";
      } else {
        healthState = "starting"; // Running but not yet stable
      }

      const previousHealthState = this.lastHealthStates.get(action.id);

      // Stop existing health animation if state changed
      if (previousHealthState !== healthState) {
        this.stopHealthAnimation(action.id);
      }

      // Update title with container name (only if showTitle is true)
      if (showTitle) {
        const shortTitle = containerName.length > 10 ? containerName.substring(0, 9) + "…" : containerName;
        await action.setTitle(shortTitle);
      } else {
        await action.setTitle("");
      }

      // Update state (0 = stopped, 1 = running) - for fallback
      await action.setState(health.state === "running" ? 1 : 0);

      // Final version check before setting image/starting animations
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return; // Settings changed, abort
      }

      // Handle different health states - only update if state changed or no animation running
      if (healthState === "stable" || healthState === "stopped") {
        // Solid icon for stable states
        const iconBase64 = await iconGenerator.generateHealthIcon(containerName, healthState, customIconBase64, { backgroundColor });
        await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);
      } else if (healthState === "crashloop") {
        // Blinking animation for crash loop - only start if not already running
        if (!this.healthAnimations.has(action.id)) {
          this.playBlinkingAnimation(action, containerName, customIconBase64, backgroundColor, version);
        }
      } else if (healthState === "starting") {
        // Pulsing animation for starting/unstable - only start if not already running
        if (!this.healthAnimations.has(action.id)) {
          this.playPulsingAnimation(action, containerName, healthState, customIconBase64, backgroundColor, version);
        }
      }

      // Store states
      this.lastKnownStates.set(action.id, health.state as ContainerState);
      this.lastHealthStates.set(action.id, healthState);

    } catch (error) {
      pluginLogger.error(`Failed to update container status: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
      // Only show error if version still matches
      if (version === undefined || this.settingsVersion.get(action.id) === version) {
        await action.setTitle("Error");
        await action.setState(0);
      }
    }
  }

  /**
   * Play blinking animation for starting containers
   * Simple on/off blink to show container is starting up
   */
  private playPulsingAnimation(action: Action<ToggleSettings>, containerName: string, healthState: HealthState, customIconBase64?: string, backgroundColor?: string, version?: number): void {
    // Don't start if already running
    if (this.healthAnimations.has(action.id)) {
      return;
    }

    let frameIndex = 0;
    const totalFrames = 6;

    const animationId = setInterval(async () => {
      // Check version - if changed, stop animation
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        this.stopHealthAnimation(action.id);
        return;
      }

      try {
        const iconBase64 = await iconGenerator.generatePulsingFrame(containerName, healthState, frameIndex, totalFrames, customIconBase64, { backgroundColor });

        // Check version again before setting image
        if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
          this.stopHealthAnimation(action.id);
          return;
        }

        await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);
        frameIndex = (frameIndex + 1) % totalFrames;
      } catch (error) {
        pluginLogger.error(`Blinking animation error: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
      }
    }, 400); // Slower blink rate for starting state

    this.healthAnimations.set(action.id, animationId);
  }

  /**
   * Play blinking animation for crash loop containers
   */
  private playBlinkingAnimation(action: Action<ToggleSettings>, containerName: string, customIconBase64?: string, backgroundColor?: string, version?: number): void {
    // Don't start if already running
    if (this.healthAnimations.has(action.id)) {
      return;
    }

    let frameIndex = 0;
    const totalFrames = 6;

    const animationId = setInterval(async () => {
      // Check version - if changed, stop animation
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        this.stopHealthAnimation(action.id);
        return;
      }

      try {
        const iconBase64 = await iconGenerator.generateBlinkingFrame(containerName, frameIndex, totalFrames, customIconBase64, { backgroundColor });

        // Check version again before setting image
        if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
          this.stopHealthAnimation(action.id);
          return;
        }

        await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);
        frameIndex = (frameIndex + 1) % totalFrames;
      } catch (error) {
        pluginLogger.error(`Blinking animation error: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
      }
    }, 300);

    this.healthAnimations.set(action.id, animationId);
  }

  /**
   * Stop health animation for an action
   */
  private stopHealthAnimation(actionId: string): void {
    const animationId = this.healthAnimations.get(actionId);
    if (animationId) {
      clearInterval(animationId);
      this.healthAnimations.delete(actionId);
    }
  }

  /**
   * Flash validation icon briefly (non-blocking, fire-and-forget)
   * Used for container actions where a transition animation follows immediately
   * Does NOT restore the icon - the animation will take over
   */
  private flashValidation(
    action: Action<ToggleSettings>,
    containerName: string,
    customIconBase64?: string
  ): void {
    // Fire and forget - don't await, don't block
    iconGenerator.generateValidationIcon(containerName, customIconBase64)
      .then(validationIcon => {
        action.setImage(`data:image/svg+xml;base64,${validationIcon}`);
      })
      .catch(error => {
        pluginLogger.error(`Failed to flash validation: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
      });
  }

  /**
   * Show brief validation feedback (checkmark icon) after an action
   * Displays for ~500ms then restores the previous icon
   */
  private async showValidationFeedback(
    action: Action<ToggleSettings>,
    containerName: string,
    customIconBase64?: string
  ): Promise<void> {
    try {
      // Generate and show validation icon
      const validationIcon = await iconGenerator.generateValidationIcon(containerName, customIconBase64);
      await action.setImage(`data:image/svg+xml;base64,${validationIcon}`);

      // Restore normal icon after brief delay
      setTimeout(async () => {
        try {
          // Generate normal health icon (use stable state for now)
          const normalIcon = await iconGenerator.generateHealthIcon(containerName, "stable", customIconBase64);
          await action.setImage(`data:image/svg+xml;base64,${normalIcon}`);
        } catch (error) {
          pluginLogger.error(`Failed to restore icon: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
        }
      }, 500);
    } catch (error) {
      pluginLogger.error(`Failed to show validation feedback: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
    }
  }

  /**
   * Play color transition animation (red↔green with blinking)
   * @param direction - "starting" (red→green) or "stopping" (green→red)
   */
  private async playTransitionAnimation(
    action: Action<ToggleSettings>,
    containerName: string,
    direction: "starting" | "stopping",
    customIconBase64?: string,
    version?: number
  ): Promise<void> {
    // Stop any existing animation
    this.stopAnimation(action.id);
    this.stopHealthAnimation(action.id);

    let frameIndex = 0;
    let progress = 0;
    // Slower transition with consistent blink rate (same as health animations)
    const blinkInterval = 400; // Same as pulsing animation
    const transitionDuration = 2500; // Total transition time in ms
    const framesForTransition = transitionDuration / blinkInterval;
    const progressIncrement = 1 / framesForTransition;

    const animationId = setInterval(async () => {
      // Check version - if changed, stop animation
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        this.stopAnimation(action.id);
        return;
      }

      try {
        const iconBase64 = await iconGenerator.generateTransitionFrame(
          containerName,
          direction,
          progress,
          frameIndex,
          customIconBase64
        );

        // Check version again before setting image
        if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
          this.stopAnimation(action.id);
          return;
        }

        await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

        frameIndex++;
        // Progress increases over time (color transition)
        if (progress < 1) {
          progress = Math.min(1, progress + progressIncrement);
        }
      } catch (error) {
        pluginLogger.error(`Transition animation error: ${error instanceof Error ? error.message : "Unknown error"}`, "toggle");
      }
    }, blinkInterval); // Same blink rate as health animations

    this.animationIntervals.set(action.id, animationId);
  }

  /**
   * Stop animation for an action
   */
  private stopAnimation(actionId: string): void {
    const animationId = this.animationIntervals.get(actionId);
    if (animationId) {
      clearInterval(animationId);
      this.animationIntervals.delete(actionId);
    }
  }
}
