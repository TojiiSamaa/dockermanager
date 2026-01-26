import streamDeck, { Action, action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent, SingletonAction } from "@elgato/streamdeck";
import { dockerService, ContainerInfo } from "../services/docker-service";
import { globalSettings } from "../services/settings-manager";

interface PIMessage {
  action?: string;
}

interface StatusSettings {
  containerId: string;
  containerName: string;
  displayName?: string;
  refreshInterval?: number;
}

@action({ UUID: "io.deckops.containers.status" })
export class DockerStatusAction extends SingletonAction<StatusSettings> {
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();

  override async onWillAppear(ev: WillAppearEvent<StatusSettings>): Promise<void> {
    const { containerId, containerName, displayName, refreshInterval = 10 } = ev.payload.settings;

    if (!containerId && !containerName) {
      await ev.action.setTitle("Config\nrequired");
      return;
    }

    // Initial state check
    await this.updateContainerStatus(ev.action, containerId || containerName, displayName);

    // Set up refresh interval
    const intervalId = setInterval(async () => {
      await this.updateContainerStatus(ev.action, containerId || containerName, displayName);
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onWillDisappear(ev: WillDisappearEvent<StatusSettings>): Promise<void> {
    const intervalId = this.refreshIntervals.get(ev.action.id);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshIntervals.delete(ev.action.id);
    }
  }

  override async onKeyDown(ev: KeyDownEvent<StatusSettings>): Promise<void> {
    const { containerId, containerName, displayName } = ev.payload.settings;
    const identifier = containerId || containerName;

    if (!identifier) {
      await ev.action.showAlert();
      return;
    }

    // Refresh status on key press
    await this.updateContainerStatus(ev.action, identifier, displayName);
    await ev.action.showOk();
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<StatusSettings>): Promise<void> {
    const { containerId, containerName, displayName, refreshInterval = 10 } = ev.payload.settings;
    const identifier = containerId || containerName;

    if (!identifier) {
      await ev.action.setTitle("Config\nrequired");
      return;
    }

    // Clear existing interval
    const existingInterval = this.refreshIntervals.get(ev.action.id);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Update immediately
    await this.updateContainerStatus(ev.action, identifier, displayName);

    // Set new interval
    const intervalId = setInterval(async () => {
      await this.updateContainerStatus(ev.action, identifier, displayName);
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, StatusSettings>): Promise<void> {
    const actionType = ev.payload.action;

    if (actionType === "listContainers") {
      try {
        // Ensure connected
        if (!dockerService.isConnected()) {
          const config = globalSettings.getServerConfig();
          if (config) {
            await dockerService.configure(config);
            await dockerService.connect();
          } else {
            await ev.action.sendToPropertyInspector({
              error: "No server configured. Click 'Configure Server Connection' first."
            });
            return;
          }
        }

        const containers = await dockerService.listContainers();
        await ev.action.sendToPropertyInspector({ containers });
      } catch (error) {
        console.error("Failed to list containers:", error);
        await ev.action.sendToPropertyInspector({
          error: `Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`
        });
      }
    }
  }

  private async updateContainerStatus(action: Action<StatusSettings>, identifier: string, displayName?: string): Promise<void> {
    try {
      // Ensure connected
      if (!dockerService.isConnected()) {
        const settings = globalSettings.getServerConfig();
        if (settings) {
          await dockerService.configure(settings);
          await dockerService.connect();
        } else {
          await action.setTitle("No\nserver");
          await action.setState(0);
          return;
        }
      }

      const state = await dockerService.getContainerState(identifier);
      const isRunning = state === "running";

      // Update state (0 = stopped, 1 = running)
      await action.setState(isRunning ? 1 : 0);

      // Update title with container name
      const title = displayName || identifier;
      const shortTitle = title.length > 10 ? title.substring(0, 9) + "…" : title;
      await action.setTitle(shortTitle);

    } catch (error) {
      console.error("Failed to update container status:", error);
      await action.setTitle("Error");
      await action.setState(0);
    }
  }
}
