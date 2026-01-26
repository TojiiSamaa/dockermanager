import streamDeck, { action, KeyDownEvent, WillAppearEvent, DidReceiveSettingsEvent, SingletonAction, SendToPluginEvent } from "@elgato/streamdeck";
import { dockerService, ServerConfig } from "../services/docker-service";
import { globalSettings } from "../services/settings-manager";

interface SettingsActionSettings {
  serverConfig?: ServerConfig;
}

interface PIMessage {
  action: string;
}

@action({ UUID: "io.deckops.containers.settings" })
export class ServerSettingsAction extends SingletonAction<SettingsActionSettings> {
  override async onWillAppear(ev: WillAppearEvent<SettingsActionSettings>): Promise<void> {
    await this.updateDisplay(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<SettingsActionSettings>): Promise<void> {
    // Test connection on key press
    await this.testConnection(ev.action);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SettingsActionSettings>): Promise<void> {
    const { serverConfig } = ev.payload.settings;

    if (serverConfig) {
      await globalSettings.setServerConfig(serverConfig);
      await dockerService.configure(serverConfig);
    }

    await this.updateDisplay(ev.action);
  }

  // Handle messages from Property Inspector
  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, SettingsActionSettings>): Promise<void> {
    const { action: actionType } = ev.payload;

    console.log("Received from PI:", actionType);

    if (actionType === "testConnection") {
      const result = await this.testConnection(ev.action);
      // Send result back to PI
      await ev.action.sendToPropertyInspector({
        connectionResult: result
      });
    }

    if (actionType === "listContainers") {
      try {
        const config = globalSettings.getServerConfig();
        if (config) {
          if (!dockerService.isConnected()) {
            await dockerService.configure(config);
            await dockerService.connect();
          }
          const containers = await dockerService.listContainers();
          await ev.action.sendToPropertyInspector({
            containers: containers
          });
        } else {
          await ev.action.sendToPropertyInspector({
            containers: [],
            error: "Not configured"
          });
        }
      } catch (error) {
        console.error("Failed to list containers:", error);
        await ev.action.sendToPropertyInspector({
          containers: [],
          error: String(error)
        });
      }
    }
  }

  private async testConnection(action: any): Promise<boolean> {
    const config = globalSettings.getServerConfig();

    if (!config) {
      await action.showAlert();
      await action.setTitle("Not\nconfigured");
      return false;
    }

    try {
      await dockerService.configure(config);
      const connected = await dockerService.connect();

      if (connected) {
        await action.showOk();
        await action.setTitle("Connected");

        // List containers to verify
        const containers = await dockerService.listContainers();
        console.log(`Found ${containers.length} containers`);
        return true;
      } else {
        await action.showAlert();
        await action.setTitle("Failed");
        return false;
      }
    } catch (error) {
      console.error("Connection test failed:", error);
      await action.showAlert();
      await action.setTitle("Error");
      return false;
    }
  }

  private async updateDisplay(action: any): Promise<void> {
    const config = globalSettings.getServerConfig();

    if (!config) {
      await action.setTitle("Setup\nServer");
      return;
    }

    const host = config.connectionType === "ssh"
      ? config.sshHost
      : config.dockerHost;

    const shortHost = host && host.length > 8
      ? host.substring(0, 7) + "…"
      : host || "Server";

    await action.setTitle(shortHost);
  }
}
