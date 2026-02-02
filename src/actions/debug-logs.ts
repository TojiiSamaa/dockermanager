import streamDeck, { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent, SendToPluginEvent, SingletonAction } from "@elgato/streamdeck";
import * as http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { exec } from "child_process";

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

// Debug Log Server for viewing logs in browser
class DebugLogServer {
  private static instance: DebugLogServer;
  private server: http.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private port = 9550;
  private refreshInterval: NodeJS.Timeout | null = null;

  static getInstance(): DebugLogServer {
    if (!DebugLogServer.instance) {
      DebugLogServer.instance = new DebugLogServer();
    }
    return DebugLogServer.instance;
  }

  async start(): Promise<string> {
    if (this.server) {
      return `http://localhost:${this.port}`;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.generateHtml());
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      this.wsServer = new WebSocketServer({ server: this.server });

      this.wsServer.on("connection", (ws: WebSocket) => {
        this.clients.add(ws);
        // Send current logs immediately
        const logs = pluginLogger.getLogsAsText();
        ws.send(JSON.stringify({ type: "logs", data: logs }));

        ws.on("close", () => {
          this.clients.delete(ws);
        });

        ws.on("message", (msg) => {
          try {
            const data = JSON.parse(msg.toString());
            if (data.action === "clear") {
              pluginLogger.clear();
              this.broadcast({ type: "logs", data: "" });
            }
          } catch (e) {
            // Ignore
          }
        });
      });

      this.server.listen(this.port, "127.0.0.1", () => {
        // Start refresh interval
        this.refreshInterval = setInterval(() => {
          if (this.clients.size > 0) {
            const logs = pluginLogger.getLogsAsText();
            this.broadcast({ type: "logs", data: logs });
          }
        }, 1000);

        resolve(`http://localhost:${this.port}`);
      });

      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          this.port++;
          this.server = null;
          this.start().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  private broadcast(message: any): void {
    const str = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(str);
      }
    });
  }

  private generateHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Docker Manager - Debug Logs</title>
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
      background: rgba(142,68,173,0.2);
      border-bottom: 1px solid rgba(142,68,173,0.4);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header h1 {
      font-size: 14px;
      font-weight: 600;
      color: #8E44AD;
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
      transition: background 0.2s;
    }
    .btn:hover { background: rgba(255,255,255,0.15); }
    .btn.active { background: rgba(76,175,80,0.3); border-color: rgba(76,175,80,0.5); }
    .btn.danger { background: rgba(244,67,54,0.2); border-color: rgba(244,67,54,0.4); }
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
    .log-line { padding: 2px 0; border-left: 3px solid transparent; padding-left: 8px; margin-left: -8px; }
    .log-line:hover { background: rgba(255,255,255,0.05); }
    .log-error { color: #F44336; border-left-color: #F44336; }
    .log-warn { color: #FF9800; border-left-color: #FF9800; }
    .log-info { color: #2196F3; border-left-color: #2196F3; }
    .log-debug { color: #9E9E9E; border-left-color: #9E9E9E; }
    .status-bar {
      background: rgba(0,0,0,0.5);
      border-top: 1px solid rgba(255,255,255,0.1);
      padding: 6px 16px;
      font-size: 11px;
      color: #666;
      display: flex;
      justify-content: space-between;
    }
    .connection-status { display: inline-flex; align-items: center; gap: 4px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4CAF50; }
    .status-dot.disconnected { background: #F44336; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .live-indicator { animation: pulse 1.5s infinite; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Docker Manager - Debug Logs</h1>
    <div class="header-actions">
      <button class="btn active" onclick="toggleAutoScroll()" id="autoScrollBtn">Auto-scroll</button>
      <button class="btn" onclick="scrollToBottom()">Bottom</button>
      <button class="btn" onclick="copyAllLogs()">Copy All</button>
      <button class="btn danger" onclick="clearLogs()">Clear</button>
    </div>
  </div>
  <div class="logs-container" id="logsContainer">
    <div class="logs-content" id="logsContent">Connecting...</div>
  </div>
  <div class="status-bar">
    <span id="lineCount">0 lines</span>
    <span class="connection-status">
      <span class="status-dot" id="statusDot"></span>
      <span id="connectionStatus" class="live-indicator" style="color:#4CAF50;">LIVE</span>
    </span>
    <span id="lastUpdate">--</span>
  </div>
  <script>
    let ws;
    let autoScroll = true;
    let allLogs = '';

    function connect() {
      ws = new WebSocket('ws://localhost:${this.port}');
      ws.onopen = () => {
        document.getElementById('statusDot').style.background = '#4CAF50';
        document.getElementById('connectionStatus').textContent = 'LIVE';
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'logs') {
          allLogs = msg.data;
          displayLogs();
        }
      };
      ws.onclose = () => {
        document.getElementById('statusDot').style.background = '#F44336';
        document.getElementById('connectionStatus').textContent = 'Disconnected';
        setTimeout(connect, 2000);
      };
    }

    function displayLogs() {
      const container = document.getElementById('logsContent');
      const wasAtBottom = isScrolledToBottom();
      const lines = allLogs.split('\\n').filter(l => l);

      let html = '';
      lines.forEach(line => {
        let className = 'log-line';
        if (line.includes('[ERROR]')) className += ' log-error';
        else if (line.includes('[WARN]')) className += ' log-warn';
        else if (line.includes('[INFO]')) className += ' log-info';
        else if (line.includes('[DEBUG]')) className += ' log-debug';

        const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += '<div class="' + className + '">' + escaped + '</div>';
      });

      container.innerHTML = html || '<div style="color:#666">No logs yet...</div>';
      document.getElementById('lineCount').textContent = lines.length + ' lines';
      document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();

      if (autoScroll && wasAtBottom) scrollToBottom();
    }

    function isScrolledToBottom() {
      const container = document.getElementById('logsContainer');
      return container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    }

    function scrollToBottom() {
      document.getElementById('logsContainer').scrollTop = document.getElementById('logsContainer').scrollHeight;
    }

    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      const btn = document.getElementById('autoScrollBtn');
      btn.classList.toggle('active', autoScroll);
      btn.textContent = autoScroll ? 'Auto-scroll' : 'Manual';
      if (autoScroll) scrollToBottom();
    }

    function copyAllLogs() {
      navigator.clipboard.writeText(allLogs).then(() => {
        const btn = event.target;
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = 'rgba(76,175,80,0.3)';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
      });
    }

    function clearLogs() {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ action: 'clear' }));
      }
    }

    connect();
  </script>
</body>
</html>`;
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.clients.forEach(c => c.close());
    this.clients.clear();
    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

const debugLogServer = DebugLogServer.getInstance();

@action({ UUID: "io.deckops.containers.debug" })
export class DebugLogsAction extends SingletonAction<DebugSettings> {

  override async onWillAppear(ev: WillAppearEvent<DebugSettings>): Promise<void> {
    await ev.action.setTitle("Debug\nLogs");
    pluginLogger.info("Debug Logs action appeared", "debug-action");
  }

  override async onWillDisappear(ev: WillDisappearEvent<DebugSettings>): Promise<void> {
    // Keep server running for now
  }

  override async onKeyDown(ev: KeyDownEvent<DebugSettings>): Promise<void> {
    pluginLogger.info("Opening debug logs in browser", "debug-action");

    try {
      const url = await debugLogServer.start();

      // Open in default browser
      exec(`start "" "${url}"`, (error) => {
        if (error) {
          pluginLogger.error(`Failed to open browser: ${error}`, "debug-action");
        }
      });

      await ev.action.showOk();
    } catch (error) {
      pluginLogger.error(`Failed to start debug log server: ${error}`, "debug-action");
      await ev.action.showAlert();
    }
  }

  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, DebugSettings>): Promise<void> {
    const actionType = ev.payload.action;

    if (actionType === "getLogs") {
      const logs = pluginLogger.getLogsForPI();
      await ev.action.sendToPropertyInspector({ logs });
    } else if (actionType === "clearLogs") {
      pluginLogger.clear();
      await ev.action.sendToPropertyInspector({ logs: [], cleared: true });
    } else if (actionType === "refreshLogs") {
      const logs = pluginLogger.getLogsForPI();
      await ev.action.sendToPropertyInspector({ logs });
    }
  }
}
