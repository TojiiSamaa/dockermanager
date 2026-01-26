import { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, SendToPluginEvent, SingletonAction, Action } from "@elgato/streamdeck";
import { dockerService, ContainerHealth } from "../services/docker-service";
import { globalSettings } from "../services/settings-manager";
import { iconGenerator, HealthState } from "../services/icon-generator";
import { pluginLogger } from "./debug-logs";
import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";

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
      logLines = 100,
      streamingMode = true,
      streamingRefreshRate = 2
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

      // Get logs
      const logs = await dockerService.getContainerLogs(identifier, logLines);

      // Get server config for streaming
      const serverConfig = globalSettings.getServerConfig();

      // Open logs in a new window with streaming support
      this.openLogsWindow(
        displayName || identifier,
        logs,
        identifier,
        streamingMode,
        streamingRefreshRate,
        serverConfig
      );

    } catch (error) {
      pluginLogger.error(`Failed to get logs: ${error instanceof Error ? error.message : "Unknown error"}`, "logs");
    }
  }

  private openLogsWindow(
    containerName: string,
    logs: string,
    containerId: string,
    streamingMode: boolean,
    refreshRate: number,
    serverConfig: any
  ): void {
    // Create a temp HTML file with the logs
    const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
    const sessionId = Date.now().toString();
    const tempFile = path.join(tempDir, `docker-logs-${sessionId}.html`);

    // Create a data file for streaming updates
    const dataFile = path.join(tempDir, `docker-logs-data-${sessionId}.json`);

    const htmlContent = this.generateLogsHtml(
      containerName,
      logs,
      containerId,
      streamingMode,
      refreshRate,
      sessionId
    );

    // Write initial data file
    fs.writeFileSync(dataFile, JSON.stringify({ logs, timestamp: Date.now() }));

    fs.writeFile(tempFile, htmlContent, (err) => {
      if (err) {
        console.error("Failed to write temp logs file:", err);
        return;
      }

      // Start background log fetching if streaming mode
      if (streamingMode) {
        this.startLogStreaming(containerId, dataFile, refreshRate, sessionId);
      }

      // Open in default browser
      const command = process.platform === "win32"
        ? `start "" "${tempFile}"`
        : process.platform === "darwin"
          ? `open "${tempFile}"`
          : `xdg-open "${tempFile}"`;

      exec(command, (error) => {
        if (error) {
          console.error("Failed to open logs window:", error);
        }

        // Clean up temp files after a longer delay (streaming needs them)
        setTimeout(() => {
          this.stopLogStreaming(sessionId);
          fs.unlink(tempFile, () => {});
          fs.unlink(dataFile, () => {});
        }, streamingMode ? 3600000 : 60000); // 1 hour for streaming, 1 minute otherwise
      });
    });
  }

  private streamingIntervals: Map<string, NodeJS.Timeout> = new Map();

  private startLogStreaming(containerId: string, dataFile: string, refreshRate: number, sessionId: string): void {
    const intervalId = setInterval(async () => {
      try {
        if (!dockerService.isConnected()) {
          return;
        }
        const logs = await dockerService.getContainerLogs(containerId, 200);
        fs.writeFileSync(dataFile, JSON.stringify({ logs, timestamp: Date.now() }));
      } catch (error) {
        console.error("Streaming log fetch error:", error);
      }
    }, refreshRate * 1000);

    this.streamingIntervals.set(sessionId, intervalId);
  }

  private stopLogStreaming(sessionId: string): void {
    const intervalId = this.streamingIntervals.get(sessionId);
    if (intervalId) {
      clearInterval(intervalId);
      this.streamingIntervals.delete(sessionId);
    }
  }

  private generateLogsHtml(
    containerName: string,
    logs: string,
    containerId: string,
    streamingMode: boolean,
    refreshRate: number,
    sessionId: string
  ): string {
    const escapedName = containerName
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const tempDir = (process.env.TEMP || process.env.TMP || "/tmp").replace(/\\/g, "/");
    const dataFileUrl = `file:///${tempDir}/docker-logs-data-${sessionId}.json`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Logs: ${escapedName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
      background: #1a1a2e;
      color: #E8E8E8;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      background: rgba(13,183,237,0.1);
      border-bottom: 1px solid rgba(13,183,237,0.3);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header h1 {
      font-size: 14px;
      font-weight: 600;
      color: #0db7ed;
    }
    .container-name {
      font-size: 14px;
      color: #E8E8E8;
      background: rgba(255,255,255,0.1);
      padding: 4px 10px;
      border-radius: 4px;
      margin-left: 10px;
    }
    .header-actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      background: rgba(255,255,255,0.1);
      color: #E8E8E8;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .btn:hover { background: rgba(255,255,255,0.15); }
    .logs-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      background: #0d0d1a;
    }
    .logs-content {
      white-space: pre-wrap;
      word-break: break-all;
      font-size: 11px;
      line-height: 1.5;
      color: #ccc;
    }
    .log-line { padding: 2px 0; }
    .log-line:hover { background: rgba(255,255,255,0.05); }
    .log-error { color: #F44336; }
    .log-warn { color: #FF9800; }
    .log-info { color: #2196F3; }
    .status-bar {
      background: rgba(0,0,0,0.5);
      border-top: 1px solid rgba(255,255,255,0.1);
      padding: 6px 16px;
      font-size: 11px;
      color: #666;
      display: flex;
      justify-content: space-between;
    }
    .search-container {
      padding: 8px 16px;
      background: rgba(0,0,0,0.3);
      border-bottom: 1px solid rgba(255,255,255,0.1);
      display: none;
    }
    .search-container.show { display: block; }
    .search-input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 4px;
      background: rgba(0,0,0,0.3);
      color: #E8E8E8;
      font-size: 12px;
    }
    .search-input:focus { outline: none; border-color: #0db7ed; }
    .btn.active { background: rgba(76,175,80,0.3); }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .live-indicator { animation: pulse 1.5s infinite; }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; align-items: center;">
      <h1>Container Logs</h1>
      <span class="container-name">${escapedName}</span>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="toggleSearch()">Search</button>
      <button class="btn" onclick="toggleAutoScroll()" id="autoScrollBtn">${streamingMode ? "Auto-scroll: ON" : "Auto-scroll"}</button>
      <button class="btn" onclick="scrollToBottom()">↓ Bottom</button>
    </div>
  </div>
  <div class="search-container" id="searchContainer">
    <input type="text" class="search-input" id="searchInput" placeholder="Search logs..." onkeyup="searchLogs(event)">
  </div>
  <div class="logs-container" id="logsContainer">
    <div class="logs-content" id="logsContent"></div>
  </div>
  <div class="status-bar">
    <span id="lineCount">0 lines</span>
    <span id="streamStatus">${streamingMode ? `<span class="live-indicator" style="color:#4CAF50;">● LIVE</span> - Auto-refresh: ${refreshRate}s` : ""}</span>
    <span id="lastUpdate">Updated: ${new Date().toLocaleTimeString()}</span>
  </div>
  <script>
    const rawLogs = ${JSON.stringify(logs)};
    const streamingMode = ${streamingMode};
    const refreshRate = ${refreshRate * 1000};
    const dataFileUrl = "${dataFileUrl}";
    let currentLogs = rawLogs;
    let autoScroll = true;

    function init() {
      displayLogs(rawLogs);
      scrollToBottom();

      if (streamingMode) {
        startStreaming();
      }
    }

    async function startStreaming() {
      setInterval(async () => {
        try {
          const response = await fetch(dataFileUrl + '?t=' + Date.now());
          if (response.ok) {
            const data = await response.json();
            if (data.logs !== currentLogs) {
              currentLogs = data.logs;
              const wasAtBottom = isScrolledToBottom();
              displayLogs(currentLogs);
              document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();
              if (autoScroll && wasAtBottom) {
                scrollToBottom();
              }
            }
          }
        } catch (e) {
          console.log('Refresh failed, retrying...', e);
        }
      }, refreshRate);
    }

    function isScrolledToBottom() {
      const container = document.getElementById('logsContainer');
      return container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    }

    function displayLogs(logs) {
      const container = document.getElementById('logsContent');
      const lines = logs.split('\\n');
      let html = '';

      lines.forEach(line => {
        if (!line.trim()) return;
        let className = 'log-line';
        if (/error|fatal|exception|fail/i.test(line)) className += ' log-error';
        else if (/warn|warning/i.test(line)) className += ' log-warn';
        else if (/info/i.test(line)) className += ' log-info';

        const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += '<div class="' + className + '">' + escaped + '</div>';
      });

      container.innerHTML = html;
      document.getElementById('lineCount').textContent = lines.filter(l => l.trim()).length + ' lines';
    }

    function scrollToBottom() {
      const container = document.getElementById('logsContainer');
      container.scrollTop = container.scrollHeight;
    }

    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      const btn = document.getElementById('autoScrollBtn');
      btn.textContent = autoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF';
      btn.style.background = autoScroll ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.1)';
    }

    function toggleSearch() {
      const container = document.getElementById('searchContainer');
      container.classList.toggle('show');
      if (container.classList.contains('show')) {
        document.getElementById('searchInput').focus();
      }
    }

    function searchLogs(event) {
      if (event.key === 'Escape') {
        toggleSearch();
        return;
      }

      const query = document.getElementById('searchInput').value;
      if (!query) {
        displayLogs(rawLogs);
        return;
      }

      const container = document.getElementById('logsContent');
      const lines = rawLogs.split('\\n');
      let html = '';
      const lowerQuery = query.toLowerCase();

      lines.forEach(line => {
        if (!line.trim()) return;
        let className = 'log-line';
        if (/error|fatal|exception|fail/i.test(line)) className += ' log-error';
        else if (/warn|warning/i.test(line)) className += ' log-warn';
        else if (/info/i.test(line)) className += ' log-info';

        let escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Highlight matches
        const lowerLine = escaped.toLowerCase();
        const idx = lowerLine.indexOf(lowerQuery);
        if (idx !== -1) {
          const before = escaped.substring(0, idx);
          const match = escaped.substring(idx, idx + query.length);
          const after = escaped.substring(idx + query.length);
          escaped = before + '<mark style="background:#FFD700;color:#000;">' + match + '</mark>' + after;
        }

        html += '<div class="' + className + '">' + escaped + '</div>';
      });

      container.innerHTML = html;
      const firstMatch = container.querySelector('mark');
      if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        toggleSearch();
      }
    });

    init();
  </script>
</body>
</html>`;
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
        const shortTitle = containerName.length > 10 ? containerName.substring(0, 9) + "…" : containerName;
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
