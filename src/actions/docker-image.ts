import { action, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService } from "../services/docker-service";
import { imageService, LocalImage, DockerHubImage, DockerHubTag } from "../services/image-service";
import { globalSettings } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";

interface PIMessage {
  action?: string;
  query?: string;
  imageName?: string;
  imageId?: string;
  tag?: string;
  force?: boolean;
  includeVolumes?: boolean;
}

interface ImageSettings {
  // Action type
  actionType: "pull" | "remove" | "prune" | "prune-all" | "system-prune" | "status";

  // For pull action
  imageName?: string;
  imageTag?: string;
  autoUpdate?: boolean; // Auto-pull on button press

  // For remove action
  targetImageId?: string;
  targetImageName?: string;
  forceRemove?: boolean;

  // For prune actions
  includeVolumes?: boolean;

  // Long press
  longPressAction?: "none" | "prune" | "remove" | "pull-latest";

  // Display
  displayName?: string;
  refreshInterval?: number;
  iconSource?: "default" | "file" | "url";
  iconUrl?: string;
  customIconBase64?: string;
  showTitle?: boolean;
  backgroundColor?: string;
}

@action({ UUID: "io.deckops.containers.image" })
export class DockerImageAction extends SingletonAction<ImageSettings> {
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  private settingsVersion: Map<string, number> = new Map();
  private keyDownTime: Map<string, number> = new Map();
  private readonly LONG_PRESS_THRESHOLD = 500;

  override async onWillAppear(ev: WillAppearEvent<ImageSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { refreshInterval = 30 } = settings;

    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    await this.updateDisplay(ev.action, settings, version);

    const intervalId = setInterval(async () => {
      const currentVersion = this.settingsVersion.get(ev.action.id);
      if (currentVersion === version) {
        await this.updateDisplay(ev.action, settings, version);
      }
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onWillDisappear(ev: WillDisappearEvent<ImageSettings>): Promise<void> {
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

  override async onKeyDown(ev: KeyDownEvent<ImageSettings>): Promise<void> {
    this.keyDownTime.set(ev.action.id, Date.now());
  }

  override async onKeyUp(ev: KeyUpEvent<ImageSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { actionType, longPressAction = "none" } = settings;

    const keyDownAt = this.keyDownTime.get(ev.action.id) || Date.now();
    const pressDuration = Date.now() - keyDownAt;
    const isLongPress = pressDuration >= this.LONG_PRESS_THRESHOLD;

    // Handle pull-latest separately (only on long press)
    if (isLongPress && longPressAction === "pull-latest") {
      try {
        await this.ensureConnected();
        await this.handlePullLatest(ev.action, settings);
        const version = this.settingsVersion.get(ev.action.id);
        if (version !== undefined) {
          await this.updateDisplay(ev.action, settings, version);
        }
      } catch (error) {
        pluginLogger.error(`Image action failed: ${error instanceof Error ? error.message : "Unknown error"}`, "image");
        await ev.action.showAlert();
      }
      return;
    }

    let effectiveAction: "pull" | "remove" | "prune" | "prune-all" | "system-prune" | "status" = actionType;
    if (isLongPress && longPressAction !== "none" && longPressAction !== "pull-latest") {
      effectiveAction = longPressAction;
    }

    try {
      await this.ensureConnected();

      switch (effectiveAction) {
        case "pull":
          await this.handlePull(ev.action, settings);
          break;

        case "remove":
          await this.handleRemove(ev.action, settings);
          break;

        case "prune":
          await this.handlePrune(ev.action, false);
          break;

        case "prune-all":
          await this.handlePrune(ev.action, true);
          break;

        case "system-prune":
          await this.handleSystemPrune(ev.action, settings.includeVolumes || false);
          break;

        case "status":
          // Just refresh display
          break;
      }

      // Refresh display
      const version = this.settingsVersion.get(ev.action.id);
      if (version !== undefined) {
        await this.updateDisplay(ev.action, settings, version);
      }

    } catch (error) {
      pluginLogger.error(`Image action failed: ${error instanceof Error ? error.message : "Unknown error"}`, "image");
      await ev.action.showAlert();
    }
  }

  private async handlePull(action: Action<ImageSettings>, settings: ImageSettings): Promise<void> {
    const { imageName, imageTag = "latest" } = settings;

    if (!imageName) {
      pluginLogger.warn("No image name configured for pull", "image");
      return;
    }

    pluginLogger.info(`Pulling ${imageName}:${imageTag}`, "image");
    await action.showOk(); // Show pulling indicator

    const success = await imageService.pullImage(imageName, imageTag);

    if (success) {
      pluginLogger.info(`Successfully pulled ${imageName}:${imageTag}`, "image");
      await action.showOk();
    } else {
      pluginLogger.error(`Failed to pull ${imageName}:${imageTag}`, "image");
      await action.showAlert();
    }
  }

  private async handlePullLatest(action: Action<ImageSettings>, settings: ImageSettings): Promise<void> {
    const { imageName } = settings;

    if (!imageName) {
      return;
    }

    pluginLogger.info(`Pulling latest ${imageName}`, "image");
    const success = await imageService.pullImage(imageName, "latest");

    if (success) {
      await action.showOk();
    } else {
      await action.showAlert();
    }
  }

  private async handleRemove(action: Action<ImageSettings>, settings: ImageSettings): Promise<void> {
    const { targetImageId, targetImageName, forceRemove = false } = settings;
    const imageIdentifier = targetImageId || targetImageName;

    if (!imageIdentifier) {
      pluginLogger.warn("No image configured for removal", "image");
      return;
    }

    pluginLogger.info(`Removing image ${imageIdentifier}`, "image");
    const success = await imageService.removeImage(imageIdentifier, forceRemove);

    if (success) {
      pluginLogger.info(`Successfully removed ${imageIdentifier}`, "image");
      await action.showOk();
    } else {
      pluginLogger.error(`Failed to remove ${imageIdentifier}`, "image");
      await action.showAlert();
    }
  }

  private async handlePrune(action: Action<ImageSettings>, all: boolean): Promise<void> {
    pluginLogger.info(`Pruning ${all ? "all unused" : "dangling"} images`, "image");

    const result = all
      ? await imageService.pruneAllUnused()
      : await imageService.pruneImages();

    if (result.success) {
      pluginLogger.info(`Pruned images, saved ${result.spaceSaved}`, "image");
      await action.showOk();
    } else {
      await action.showAlert();
    }
  }

  private async handleSystemPrune(action: Action<ImageSettings>, includeVolumes: boolean): Promise<void> {
    pluginLogger.info(`System prune (volumes: ${includeVolumes})`, "image");

    const result = await imageService.systemPrune(includeVolumes);

    if (result.success) {
      pluginLogger.info(`System prune complete, saved ${result.spaceSaved}`, "image");
      await action.showOk();
    } else {
      await action.showAlert();
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ImageSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { refreshInterval = 30 } = settings;

    const currentVersion = (this.settingsVersion.get(ev.action.id) || 0) + 1;
    this.settingsVersion.set(ev.action.id, currentVersion);

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

  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, ImageSettings>): Promise<void> {
    const { action: actionType, query, imageName, imageId, tag, force, includeVolumes } = ev.payload;

    switch (actionType) {
      case "searchDockerHub":
        await this.handleSearchDockerHub(ev, query);
        break;

      case "getImageTags":
        await this.handleGetImageTags(ev, imageName);
        break;

      case "listLocalImages":
        await this.handleListLocalImages(ev);
        break;

      case "pullImage":
        await this.handlePullFromPI(ev, imageName, tag);
        break;

      case "removeImage":
        await this.handleRemoveFromPI(ev, imageId, force);
        break;

      case "getDiskUsage":
        await this.handleGetDiskUsage(ev);
        break;

      case "systemPrune":
        await this.handleSystemPruneFromPI(ev, includeVolumes);
        break;

      case "testConnection":
        await this.handleTestConnection(ev);
        break;
    }
  }

  private async handleSearchDockerHub(
    ev: SendToPluginEvent<PIMessage, ImageSettings>,
    query?: string
  ): Promise<void> {
    if (!query || query.length < 2) {
      await ev.action.sendToPropertyInspector({ hubImages: [] });
      return;
    }

    try {
      const images = await imageService.searchDockerHub(query);
      await ev.action.sendToPropertyInspector({
        hubImages: images.map(img => ({
          name: img.name,
          fullName: img.fullName,
          description: img.description.substring(0, 100),
          stars: img.starCount,
          pulls: this.formatPullCount(img.pullCount),
          isOfficial: img.isOfficial
        }))
      });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  }

  private async handleGetImageTags(
    ev: SendToPluginEvent<PIMessage, ImageSettings>,
    imageName?: string
  ): Promise<void> {
    if (!imageName) {
      await ev.action.sendToPropertyInspector({ tags: [] });
      return;
    }

    try {
      const tags = await imageService.getImageTags(imageName);
      await ev.action.sendToPropertyInspector({
        tags: tags.map(t => ({
          name: t.name,
          size: this.formatSize(t.fullSize),
          lastUpdated: t.lastUpdated.toISOString()
        }))
      });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        error: `Failed to get tags: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  }

  private async handleListLocalImages(ev: SendToPluginEvent<PIMessage, ImageSettings>): Promise<void> {
    try {
      await this.ensureConnected();
      const images = await imageService.listLocalImages(true);
      await ev.action.sendToPropertyInspector({
        localImages: images.map(img => ({
          id: img.id,
          repository: img.repository,
          tag: img.tag,
          fullName: img.fullName,
          size: this.formatSize(img.size),
          inUse: img.inUse
        }))
      });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        error: `Failed to list images: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  }

  private async handlePullFromPI(
    ev: SendToPluginEvent<PIMessage, ImageSettings>,
    imageName?: string,
    tag?: string
  ): Promise<void> {
    if (!imageName) {
      await ev.action.sendToPropertyInspector({ pullResult: { success: false, error: "No image specified" } });
      return;
    }

    try {
      await this.ensureConnected();
      const success = await imageService.pullImage(imageName, tag || "latest");
      await ev.action.sendToPropertyInspector({
        pullResult: { success, imageName, tag: tag || "latest" }
      });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        pullResult: { success: false, error: error instanceof Error ? error.message : "Unknown error" }
      });
    }
  }

  private async handleRemoveFromPI(
    ev: SendToPluginEvent<PIMessage, ImageSettings>,
    imageId?: string,
    force?: boolean
  ): Promise<void> {
    if (!imageId) {
      await ev.action.sendToPropertyInspector({ removeResult: { success: false, error: "No image specified" } });
      return;
    }

    try {
      await this.ensureConnected();
      const success = await imageService.removeImage(imageId, force || false);
      await ev.action.sendToPropertyInspector({
        removeResult: { success, imageId }
      });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        removeResult: { success: false, error: error instanceof Error ? error.message : "Unknown error" }
      });
    }
  }

  private async handleGetDiskUsage(ev: SendToPluginEvent<PIMessage, ImageSettings>): Promise<void> {
    try {
      await this.ensureConnected();
      const usage = await imageService.getDiskUsage();
      await ev.action.sendToPropertyInspector({ diskUsage: usage });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        error: `Failed to get disk usage: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  }

  private async handleSystemPruneFromPI(
    ev: SendToPluginEvent<PIMessage, ImageSettings>,
    includeVolumes?: boolean
  ): Promise<void> {
    try {
      await this.ensureConnected();
      const result = await imageService.systemPrune(includeVolumes || false);
      await ev.action.sendToPropertyInspector({
        pruneResult: result
      });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        pruneResult: { success: false, spaceSaved: "0B" }
      });
    }
  }

  private async handleTestConnection(ev: SendToPluginEvent<PIMessage, ImageSettings>): Promise<void> {
    try {
      await this.ensureConnected();
      await ev.action.sendToPropertyInspector({ connected: true });
    } catch (error) {
      await ev.action.sendToPropertyInspector({
        connected: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  private async updateDisplay(action: Action<ImageSettings>, settings: ImageSettings, version?: number): Promise<void> {
    try {
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const { actionType, displayName, imageName, customIconBase64, backgroundColor, showTitle = true } = settings;

      let title = displayName || "";
      let healthState: HealthState = "stable";

      switch (actionType) {
        case "pull":
          title = title || imageName || "Pull";
          break;

        case "remove":
          title = title || "Remove";
          healthState = "stopped";
          break;

        case "prune":
          title = title || "Prune";
          healthState = "starting";
          break;

        case "prune-all":
          title = title || "Prune\nAll";
          healthState = "starting";
          break;

        case "system-prune":
          title = title || "System\nPrune";
          healthState = "crashloop";
          break;

        case "status":
          title = title || "Docker";
          try {
            await this.ensureConnected();
            const usage = await imageService.getDiskUsage();
            title = `${usage.images.count} img\n${usage.total}`;
          } catch {
            title = "Offline";
            healthState = "stopped";
          }
          break;
      }

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const iconBase64 = await iconGenerator.generateHealthIcon(
        title,
        healthState,
        customIconBase64,
        { backgroundColor }
      );

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

      if (showTitle) {
        const shortTitle = title.length > 12 ? title.substring(0, 11) + "..." : title;
        await action.setTitle(shortTitle);
      } else {
        await action.setTitle("");
      }

    } catch (error) {
      pluginLogger.error(`Failed to update image display: ${error instanceof Error ? error.message : "Unknown error"}`, "image");
      if (version === undefined || this.settingsVersion.get(action.id) === version) {
        await action.setTitle("Error");
      }
    }
  }

  private formatPullCount(count: number): string {
    if (count >= 1000000000) return `${(count / 1000000000).toFixed(1)}B`;
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }

  private async ensureConnected(): Promise<void> {
    if (!dockerService.isConnected()) {
      const config = globalSettings.getServerConfig();
      if (config) {
        await dockerService.configure(config);
        await dockerService.connect();
      } else {
        throw new Error("No server configuration");
      }
    }
  }
}
