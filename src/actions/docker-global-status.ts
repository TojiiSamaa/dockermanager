import { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, SingletonAction } from "@elgato/streamdeck";
import { pluginLogger } from "./debug-logs";
import { globalStatusServer } from "../services/global-status-server";
import { exec } from "child_process";

interface GlobalStatusSettings {
  // No settings needed for this action
}

@action({ UUID: "io.deckops.containers.globalstatus" })
export class DockerGlobalStatusAction extends SingletonAction<GlobalStatusSettings> {

  override async onWillAppear(ev: WillAppearEvent<GlobalStatusSettings>): Promise<void> {
    // Set a default title
    await ev.action.setTitle("Global\nStatus");
  }

  override async onWillDisappear(ev: WillDisappearEvent<GlobalStatusSettings>): Promise<void> {
    // Nothing to clean up
  }

  override async onKeyDown(ev: KeyDownEvent<GlobalStatusSettings>): Promise<void> {
    try {
      pluginLogger.info("Opening global status dashboard", "global-status");

      // Start the status server if not already running
      const serverResult = await globalStatusServer.start();

      if (!serverResult) {
        pluginLogger.error("Failed to start global status server", "global-status");
        await ev.action.showAlert();
        return;
      }

      pluginLogger.info(`Opening global status at ${serverResult.url}`, "global-status");

      // Open the browser to the status server URL
      this.openBrowser(serverResult.url);
      await ev.action.showOk();

    } catch (error) {
      pluginLogger.error(`Failed to open global status: ${error instanceof Error ? error.message : "Unknown error"}`, "global-status");
      await ev.action.showAlert();
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
        pluginLogger.error(`Failed to open browser: ${error.message}`, "global-status");
      }
    });
  }
}
