import { action, KeyUpEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService } from "../services/docker-service";
import { globalSettings } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";

interface RunSettings {
  // Server
  serverId?: string;

  // Raw command (for paste & parse feature)
  rawCommand?: string;

  // Docker run configuration
  imageName: string;
  containerName?: string;
  workingDirectory?: string;

  // Port mappings (format: "hostPort:containerPort")
  ports?: string;

  // Volume mappings (format: "hostPath:containerPath")
  volumes?: string;

  // Environment variables (format: "KEY=value" per line)
  envVars?: string;

  // Additional docker run options
  network?: string;
  restartPolicy?: "no" | "always" | "unless-stopped" | "on-failure";
  detached?: boolean;
  removeOnExit?: boolean;

  // Custom command (overrides image default)
  command?: string;

  // Display
  displayName?: string;
  showTitle?: boolean;
  customIconBase64?: string;
  backgroundColor?: string;
}

@action({ UUID: "io.deckops.containers.run" })
export class DockerRunAction extends SingletonAction<RunSettings> {
  private settingsVersion: Map<string, number> = new Map();

  override async onWillAppear(ev: WillAppearEvent<RunSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const version = 1;
    this.settingsVersion.set(ev.action.id, version);

    await this.updateDisplay(ev.action, settings, version);
  }

  override async onWillDisappear(ev: WillDisappearEvent<RunSettings>): Promise<void> {
    const currentVersion = this.settingsVersion.get(ev.action.id) || 0;
    this.settingsVersion.set(ev.action.id, currentVersion + 1);
    this.settingsVersion.delete(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<RunSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const { serverId, imageName } = settings;

    if (!imageName) {
      pluginLogger.error("No image name configured for docker run", "run");
      await ev.action.showAlert();
      return;
    }

    try {
      const connected = await this.ensureConnected(serverId);
      if (!connected) {
        await ev.action.showAlert();
        return;
      }

      pluginLogger.info(`Executing docker run for image: ${imageName}`, "run");

      const result = await this.executeDockerRun(settings);

      if (result.success) {
        pluginLogger.info(`Docker run completed: ${result.containerId || "success"}`, "run");
        await ev.action.showOk();
      } else {
        pluginLogger.error(`Docker run failed: ${result.error}`, "run");
        await ev.action.showAlert();
      }

      // Refresh display
      const version = this.settingsVersion.get(ev.action.id);
      if (version !== undefined) {
        await this.updateDisplay(ev.action, settings, version);
      }

    } catch (error) {
      pluginLogger.error(`Docker run failed: ${error instanceof Error ? error.message : "Unknown error"}`, "run");
      await ev.action.showAlert();
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<RunSettings>): Promise<void> {
    const settings = ev.payload.settings;

    const currentVersion = (this.settingsVersion.get(ev.action.id) || 0) + 1;
    this.settingsVersion.set(ev.action.id, currentVersion);

    await this.updateDisplay(ev.action, settings, currentVersion);
  }

  private async executeDockerRun(settings: RunSettings): Promise<{ success: boolean; containerId?: string; error?: string }> {
    const {
      imageName,
      containerName,
      workingDirectory,
      ports,
      volumes,
      envVars,
      network,
      restartPolicy,
      detached = true,
      removeOnExit = false,
      command
    } = settings;

    // Build docker run command
    let cmd = "docker run";

    // Detached mode
    if (detached) {
      cmd += " -d";
    }

    // Remove on exit
    if (removeOnExit) {
      cmd += " --rm";
    }

    // Container name
    if (containerName) {
      cmd += ` --name "${containerName}"`;
    }

    // Working directory
    if (workingDirectory) {
      cmd += ` -w "${workingDirectory}"`;
    }

    // Network
    if (network) {
      cmd += ` --network "${network}"`;
    }

    // Restart policy
    if (restartPolicy && restartPolicy !== "no") {
      cmd += ` --restart ${restartPolicy}`;
    }

    // Port mappings
    if (ports) {
      const portMappings = ports.split(/[\n,]/).map(p => p.trim()).filter(p => p);
      for (const port of portMappings) {
        cmd += ` -p ${port}`;
      }
    }

    // Volume mappings
    if (volumes) {
      const volumeMappings = volumes.split(/[\n,]/).map(v => v.trim()).filter(v => v);
      for (const volume of volumeMappings) {
        cmd += ` -v "${volume}"`;
      }
    }

    // Environment variables
    if (envVars) {
      const envLines = envVars.split(/[\n]/).map(e => e.trim()).filter(e => e);
      for (const env of envLines) {
        // Escape special characters in values
        cmd += ` -e "${env}"`;
      }
    }

    // Image name
    cmd += ` ${imageName}`;

    // Custom command
    if (command) {
      cmd += ` ${command}`;
    }

    try {
      pluginLogger.info(`Executing command: ${cmd}`, "run");
      const output = await this.execCommand(cmd);

      // If detached, the output is the container ID
      const containerId = detached ? output.trim().substring(0, 12) : undefined;

      return { success: true, containerId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  private async updateDisplay(action: Action<RunSettings>, settings: RunSettings, version?: number): Promise<void> {
    try {
      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      const { imageName, displayName, showTitle = true, customIconBase64, backgroundColor } = settings;

      // Extract short image name for display
      let shortName = displayName || imageName || "Docker Run";
      if (!displayName && imageName) {
        // Extract image name without registry and tag
        const parts = imageName.split("/");
        shortName = parts[parts.length - 1].split(":")[0];
      }

      // Use a "run" style icon - blue/green for action
      const healthState: HealthState = "stable"; // Green for run action

      const iconBase64 = await iconGenerator.generateHealthIcon(
        shortName,
        healthState,
        customIconBase64,
        { backgroundColor: backgroundColor || "#27AE60" } // Green for run
      );

      if (version !== undefined && this.settingsVersion.get(action.id) !== version) {
        return;
      }

      await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

      if (showTitle !== false) {
        await action.setTitle(shortName);
      } else {
        await action.setTitle("");
      }

    } catch (error) {
      pluginLogger.error(`Failed to update docker run display: ${error instanceof Error ? error.message : "Unknown error"}`, "run");
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
      pluginLogger.error("No server config found", "run");
      return false;
    }

    // Use the new connection pool method - does NOT disconnect other servers
    const connected = await dockerService.ensureServerConnection(config);
    if (connected) {
      await dockerService.configure(config);
    }
    return connected;
  }

  private async execCommand(command: string): Promise<string> {
    return (dockerService as any).execSSHCommand(command);
  }
}
