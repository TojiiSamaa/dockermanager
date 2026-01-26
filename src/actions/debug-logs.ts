import streamDeck, { action, KeyDownEvent, WillAppearEvent, SendToPluginEvent, SingletonAction } from "@elgato/streamdeck";

interface PIMessage {
  action?: string;
}

interface DebugSettings {
  // No settings needed for this action
}

// Global log store that can be used by other actions
export class PluginLogger {
  private static instance: PluginLogger;
  private logs: Array<{ timestamp: Date; level: string; message: string; source: string }> = [];
  private maxLogs = 500;
  private listeners: Set<(logs: string) => void> = new Set();

  static getInstance(): PluginLogger {
    if (!PluginLogger.instance) {
      PluginLogger.instance = new PluginLogger();
    }
    return PluginLogger.instance;
  }

  log(level: string, message: string, source: string = "plugin"): void {
    const entry = {
      timestamp: new Date(),
      level,
      message,
      source
    };

    this.logs.push(entry);

    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Use Stream Deck's official logger for proper log file output
    const logLine = `[${source}] ${message}`;
    if (level === "error") {
      streamDeck.logger.error(logLine);
    } else if (level === "warn") {
      streamDeck.logger.warn(logLine);
    } else if (level === "debug") {
      streamDeck.logger.debug(logLine);
    } else {
      streamDeck.logger.info(logLine);
    }

    // Notify listeners
    this.notifyListeners();
  }

  info(message: string, source?: string): void {
    this.log("info", message, source);
  }

  warn(message: string, source?: string): void {
    this.log("warn", message, source);
  }

  error(message: string, source?: string): void {
    this.log("error", message, source);
  }

  debug(message: string, source?: string): void {
    this.log("debug", message, source);
  }

  private formatLogEntry(entry: { timestamp: Date; level: string; message: string; source: string }): string {
    const ts = entry.timestamp.toISOString();
    return `[${ts}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`;
  }

  getLogsAsText(): string {
    return this.logs.map(entry => this.formatLogEntry(entry)).join("\n");
  }

  getLogs(): Array<{ timestamp: Date; level: string; message: string; source: string }> {
    return [...this.logs];
  }

  getLogsForPI(): Array<{ timestamp: string; level: string; message: string; source: string }> {
    return this.logs.map(entry => ({
      timestamp: entry.timestamp.toISOString(),
      level: entry.level,
      message: entry.message,
      source: entry.source
    }));
  }

  clear(): void {
    this.logs = [];
    this.notifyListeners();
  }

  addListener(callback: (logs: string) => void): void {
    this.listeners.add(callback);
  }

  removeListener(callback: (logs: string) => void): void {
    this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    const logsText = this.getLogsAsText();
    this.listeners.forEach(listener => {
      try {
        listener(logsText);
      } catch (e) {
        // Ignore listener errors
      }
    });
  }
}

// Export singleton instance
export const pluginLogger = PluginLogger.getInstance();

@action({ UUID: "io.deckops.containers.debug" })
export class DebugLogsAction extends SingletonAction<DebugSettings> {

  override async onWillAppear(ev: WillAppearEvent<DebugSettings>): Promise<void> {
    // Set the button title
    await ev.action.setTitle("Debug\nLogs");
    pluginLogger.info("Debug Logs action appeared", "debug-action");
  }

  override async onKeyDown(ev: KeyDownEvent<DebugSettings>): Promise<void> {
    // Just log a message - the actual logs are viewed in the Property Inspector
    pluginLogger.info("Debug Logs button pressed - view logs in Stream Deck settings panel", "debug-action");
    pluginLogger.info(`Current log count: ${pluginLogger.getLogs().length}`, "debug-action");
    await ev.action.showOk();
  }

  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, DebugSettings>): Promise<void> {
    const actionType = ev.payload.action;

    if (actionType === "getLogs") {
      pluginLogger.info("PI requested logs", "debug-action");
      const logs = pluginLogger.getLogsForPI();
      await ev.action.sendToPropertyInspector({ logs });
    } else if (actionType === "clearLogs") {
      pluginLogger.clear();
      pluginLogger.info("Logs cleared by user", "debug-action");
      await ev.action.sendToPropertyInspector({ logs: [], cleared: true });
    } else if (actionType === "refreshLogs") {
      const logs = pluginLogger.getLogsForPI();
      await ev.action.sendToPropertyInspector({ logs });
    }
  }

}
