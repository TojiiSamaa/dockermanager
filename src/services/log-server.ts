import * as http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { dockerService } from "./docker-service";
import { pluginLogger } from "../actions/debug-logs";

// WebSocket ready states
const WS_OPEN = 1;

interface LogServerInstance {
  httpServer: http.Server;
  wsServer: WebSocketServer;
  port: number;
  containerId: string;
  containerName: string;
  serverName?: string;
  clients: Set<WebSocket>;
  refreshInterval: NodeJS.Timeout | null;
  windowFormat: "small" | "full";
}

interface LogMessage {
  type: "logs" | "error" | "info";
  data?: string;
  message?: string;
  timestamp: number;
}

/**
 * LogServerManager - Singleton class that manages WebSocket-based log servers
 * for streaming Docker container logs to browser windows.
 */
class LogServerManager {
  private static instance: LogServerManager;
  private servers: Map<string, LogServerInstance> = new Map();
  private readonly PORT_RANGE_START = 9500;
  private readonly PORT_RANGE_END = 9599;
  private usedPorts: Set<number> = new Set();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): LogServerManager {
    if (!LogServerManager.instance) {
      LogServerManager.instance = new LogServerManager();
    }
    return LogServerManager.instance;
  }

  /**
   * Find an available port in the range 9500-9599
   */
  private findAvailablePort(): number | null {
    for (let port = this.PORT_RANGE_START; port <= this.PORT_RANGE_END; port++) {
      if (!this.usedPorts.has(port)) {
        return port;
      }
    }
    return null;
  }

  /**
   * Generate the HTML page content for the log viewer
   */
  private generateLogViewerHtml(
    containerName: string,
    containerId: string,
    port: number,
    windowFormat: "small" | "full",
    serverName?: string
  ): string {
    const escapedName = containerName
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const isSmallWindow = windowFormat === "small";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapedName} - Logs Docker</title>
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
      padding: ${isSmallWindow ? "8px 12px" : "12px 16px"};
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      flex-wrap: ${isSmallWindow ? "wrap" : "nowrap"};
      gap: 8px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      ${isSmallWindow ? "flex-basis: 100%; justify-content: space-between;" : "flex: 1;"}
    }
    .header h1 {
      font-size: ${isSmallWindow ? "13px" : "16px"};
      font-weight: 600;
      color: #0db7ed;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .container-name {
      font-size: ${isSmallWindow ? "13px" : "16px"};
      color: #FFFFFF;
      background: rgba(13,183,237,0.2);
      padding: 6px 14px;
      border-radius: 6px;
      font-weight: 600;
      border: 1px solid rgba(13,183,237,0.4);
      max-width: ${isSmallWindow ? "200px" : "400px"};
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .header-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      ${isSmallWindow ? "justify-content: flex-end; flex-basis: 100%;" : ""}
    }
    .btn {
      padding: ${isSmallWindow ? "4px 8px" : "6px 12px"};
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: ${isSmallWindow ? "10px" : "12px"};
      background: rgba(255,255,255,0.1);
      color: #E8E8E8;
      border: 1px solid rgba(255,255,255,0.2);
      transition: background 0.2s;
    }
    .btn:hover { background: rgba(255,255,255,0.15); }
    .btn.active { background: rgba(76,175,80,0.3); border-color: rgba(76,175,80,0.5); }
    .btn.danger { background: rgba(244,67,54,0.2); border-color: rgba(244,67,54,0.4); }
    .btn.danger:hover { background: rgba(244,67,54,0.3); }
    .logs-container {
      flex: 1;
      overflow-y: auto;
      padding: ${isSmallWindow ? "8px 12px" : "12px 16px"};
      background: #0d0d1a;
    }
    .logs-content {
      white-space: pre-wrap;
      word-break: break-all;
      font-size: ${isSmallWindow ? "10px" : "11px"};
      line-height: 1.5;
      color: #ccc;
    }
    .log-line {
      padding: 2px 0;
      border-left: 3px solid transparent;
      padding-left: 8px;
      margin-left: -8px;
    }
    .log-line:hover { background: rgba(255,255,255,0.05); }
    .log-error { color: #F44336; border-left-color: #F44336; background: rgba(244,67,54,0.05); }
    .log-warn { color: #FF9800; border-left-color: #FF9800; background: rgba(255,152,0,0.05); }
    .log-info { color: #2196F3; border-left-color: #2196F3; }
    .log-debug { color: #9E9E9E; border-left-color: #9E9E9E; }
    .connection-error { color: #F44336; font-weight: bold; font-size: 14px; padding: 20px; text-align: center; background: rgba(244,67,54,0.1); border-radius: 8px; margin: 20px; }
    .status-bar {
      background: rgba(0,0,0,0.5);
      border-top: 1px solid rgba(255,255,255,0.1);
      padding: ${isSmallWindow ? "4px 12px" : "6px 16px"};
      font-size: ${isSmallWindow ? "9px" : "11px"};
      color: #666;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    .search-container {
      padding: 8px ${isSmallWindow ? "12px" : "16px"};
      background: rgba(0,0,0,0.3);
      border-bottom: 1px solid rgba(255,255,255,0.1);
      display: none;
    }
    .search-container.show { display: flex; gap: 8px; align-items: center; }
    .search-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 4px;
      background: rgba(0,0,0,0.3);
      color: #E8E8E8;
      font-size: 12px;
    }
    .search-input:focus { outline: none; border-color: #0db7ed; }
    .search-stats { color: #888; font-size: 11px; white-space: nowrap; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .live-indicator { animation: pulse 1.5s infinite; }
    .connection-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4CAF50;
    }
    .status-dot.disconnected { background: #F44336; }
    .status-dot.connecting { background: #FF9800; animation: pulse 1s infinite; }
    mark {
      background: #FFD700;
      color: #000;
      padding: 1px 2px;
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>
        🐳 Container Logs:
        <span class="container-name" title="${escapedName}">${escapedName}</span>
        ${serverName ? `<span style="font-size: 12px; color: #888; font-weight: normal;">@ ${serverName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>` : ""}
      </h1>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="toggleSearch()" title="Ctrl+F">Search</button>
      <button class="btn active" onclick="toggleAutoScroll()" id="autoScrollBtn">Auto-scroll</button>
      <button class="btn" onclick="scrollToBottom()" title="Jump to bottom">Bottom</button>
      <button class="btn" onclick="copyAllLogs()" title="Copy all logs to clipboard">Copy</button>
      <button class="btn" onclick="clearDisplay()" title="Clear display only">Clear</button>
    </div>
  </div>
  <div class="search-container" id="searchContainer">
    <input type="text" class="search-input" id="searchInput" placeholder="Search logs (regex supported)..." oninput="searchLogs()">
    <span class="search-stats" id="searchStats"></span>
    <button class="btn" onclick="prevMatch()">Prev</button>
    <button class="btn" onclick="nextMatch()">Next</button>
    <button class="btn" onclick="toggleSearch()">Close</button>
  </div>
  <div class="logs-container" id="logsContainer">
    <div class="logs-content" id="logsContent">
      <div class="log-line log-info">Connecting to log stream...</div>
    </div>
  </div>
  <div class="status-bar">
    <span id="lineCount">0 lines</span>
    <span class="connection-status">
      <span class="status-dot connecting" id="statusDot"></span>
      <span id="connectionStatus">Connecting...</span>
    </span>
    <span id="lastUpdate">--</span>
  </div>
  <script>
    const wsPort = ${port};
    const containerId = "${containerId}";
    let ws = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let autoScroll = true;
    let allLogs = [];
    let searchMatches = [];
    let currentMatchIndex = -1;
    let isSearchActive = false;

    function connect() {
      updateConnectionStatus('connecting');

      try {
        ws = new WebSocket('ws://localhost:' + wsPort);

        ws.onopen = function() {
          console.log('WebSocket connected');
          reconnectAttempts = 0;
          updateConnectionStatus('connected');
        };

        ws.onmessage = function(event) {
          try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        };

        ws.onclose = function() {
          console.log('WebSocket disconnected');
          updateConnectionStatus('disconnected');
          scheduleReconnect();
        };

        ws.onerror = function(error) {
          console.error('WebSocket error:', error);
          updateConnectionStatus('disconnected');
        };
      } catch (e) {
        console.error('Failed to create WebSocket:', e);
        updateConnectionStatus('disconnected');
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
        console.log('Reconnecting in ' + delay + 'ms (attempt ' + reconnectAttempts + ')');
        setTimeout(connect, delay);
      } else {
        document.getElementById('connectionStatus').textContent = 'Connection failed - refresh to retry';
      }
    }

    function updateConnectionStatus(status) {
      const dot = document.getElementById('statusDot');
      const text = document.getElementById('connectionStatus');

      dot.className = 'status-dot';

      switch (status) {
        case 'connected':
          dot.classList.add('connected');
          text.innerHTML = '<span class="live-indicator" style="color:#4CAF50;">LIVE</span>';
          break;
        case 'connecting':
          dot.classList.add('connecting');
          text.textContent = 'Connecting...';
          break;
        case 'disconnected':
          dot.classList.add('disconnected');
          text.textContent = 'Disconnected';
          break;
      }
    }

    function handleMessage(msg) {
      if (msg.type === 'logs') {
        const newLogs = msg.data.split('\\n').filter(line => line.trim());
        allLogs = newLogs;
        displayLogs();
        document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();
      } else if (msg.type === 'error') {
        appendLogLine('[ERROR] ' + msg.message, 'error');
      } else if (msg.type === 'info') {
        appendLogLine('[INFO] ' + msg.message, 'info');
      }
    }

    function displayLogs() {
      const container = document.getElementById('logsContent');
      const wasAtBottom = isScrolledToBottom();
      const searchQuery = document.getElementById('searchInput').value;

      let html = '';
      let matchCount = 0;
      searchMatches = [];

      allLogs.forEach((line, index) => {
        let className = 'log-line';
        if (/error|fatal|exception|fail|panic/i.test(line)) className += ' log-error';
        else if (/warn|warning/i.test(line)) className += ' log-warn';
        else if (/\\binfo\\b/i.test(line)) className += ' log-info';
        else if (/debug|trace/i.test(line)) className += ' log-debug';

        let escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Apply search highlighting
        if (searchQuery && isSearchActive) {
          try {
            const regex = new RegExp('(' + escapeRegex(searchQuery) + ')', 'gi');
            if (regex.test(line)) {
              searchMatches.push(index);
              escaped = escaped.replace(regex, '<mark data-match="' + matchCount + '">$1</mark>');
              matchCount++;
            }
          } catch (e) {
            // Invalid regex, skip highlighting
          }
        }

        html += '<div class="' + className + '" data-line="' + index + '">' + escaped + '</div>';
      });

      container.innerHTML = html;
      document.getElementById('lineCount').textContent = allLogs.length + ' lines';

      if (isSearchActive) {
        updateSearchStats();
      }

      if (autoScroll && wasAtBottom) {
        scrollToBottom();
      }
    }

    function escapeRegex(str) {
      var pattern = /[.*+?^\${}()|[\\]\\\\]/g;
      return str.replace(pattern, '\\\\$&');
    }

    function appendLogLine(text, level) {
      const container = document.getElementById('logsContent');
      const wasAtBottom = isScrolledToBottom();

      const div = document.createElement('div');
      div.className = 'log-line log-' + level;
      div.textContent = text;
      container.appendChild(div);

      if (autoScroll && wasAtBottom) {
        scrollToBottom();
      }
    }

    function isScrolledToBottom() {
      const container = document.getElementById('logsContainer');
      return container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    }

    function scrollToBottom() {
      const container = document.getElementById('logsContainer');
      container.scrollTop = container.scrollHeight;
    }

    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      const btn = document.getElementById('autoScrollBtn');
      btn.classList.toggle('active', autoScroll);
      btn.textContent = autoScroll ? 'Auto-scroll' : 'Manual';
      if (autoScroll) {
        scrollToBottom();
      }
    }

    function toggleSearch() {
      const container = document.getElementById('searchContainer');
      container.classList.toggle('show');
      isSearchActive = container.classList.contains('show');

      if (isSearchActive) {
        document.getElementById('searchInput').focus();
      } else {
        document.getElementById('searchInput').value = '';
        searchMatches = [];
        currentMatchIndex = -1;
        displayLogs();
      }
    }

    function searchLogs() {
      currentMatchIndex = -1;
      displayLogs();
      if (searchMatches.length > 0) {
        nextMatch();
      }
    }

    function updateSearchStats() {
      const stats = document.getElementById('searchStats');
      if (searchMatches.length === 0) {
        stats.textContent = 'No matches';
      } else {
        stats.textContent = (currentMatchIndex + 1) + ' of ' + searchMatches.length;
      }
    }

    function nextMatch() {
      if (searchMatches.length === 0) return;
      currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
      scrollToMatch();
    }

    function prevMatch() {
      if (searchMatches.length === 0) return;
      currentMatchIndex = currentMatchIndex <= 0 ? searchMatches.length - 1 : currentMatchIndex - 1;
      scrollToMatch();
    }

    function scrollToMatch() {
      updateSearchStats();
      const lineIndex = searchMatches[currentMatchIndex];
      const lineElement = document.querySelector('[data-line="' + lineIndex + '"]');
      if (lineElement) {
        lineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Briefly highlight the line
        lineElement.style.background = 'rgba(255,215,0,0.2)';
        setTimeout(() => {
          lineElement.style.background = '';
        }, 1000);
      }
    }

    function clearDisplay() {
      allLogs = [];
      displayLogs();
    }

    function copyAllLogs() {
      const text = allLogs.join('\\n');
      navigator.clipboard.writeText(text).then(() => {
        // Show feedback
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = 'rgba(76,175,80,0.3)';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
        }, 1500);
      }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy logs to clipboard');
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        toggleSearch();
      } else if (e.key === 'Escape' && isSearchActive) {
        toggleSearch();
      } else if (e.key === 'Enter' && isSearchActive) {
        e.preventDefault();
        if (e.shiftKey) {
          prevMatch();
        } else {
          nextMatch();
        }
      }
    });

    // Start connection
    connect();
  </script>
</body>
</html>`;
  }

  /**
   * Create a new log server for a container
   */
  async createServer(
    containerId: string,
    containerName: string,
    logLines: number = 200,
    refreshRate: number = 2,
    windowFormat: "small" | "full" = "full",
    serverName?: string
  ): Promise<{ port: number; url: string } | null> {
    // Check if we already have a server for this container
    const existingServer = this.servers.get(containerId);
    if (existingServer) {
      pluginLogger.info(`Reusing existing log server for ${containerName} on port ${existingServer.port}`, "log-server");
      return { port: existingServer.port, url: `http://localhost:${existingServer.port}` };
    }

    const port = this.findAvailablePort();
    if (port === null) {
      pluginLogger.error("No available ports for log server", "log-server");
      return null;
    }

    try {
      const clients = new Set<WebSocket>();

      // Create HTTP server
      const httpServer = http.createServer((req, res) => {
        if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.generateLogViewerHtml(containerName, containerId, port, windowFormat, serverName));
        } else if (req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", clients: clients.size }));
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      // Create WebSocket server
      const wsServer = new WebSocketServer({ server: httpServer });

      wsServer.on("connection", async (ws: WebSocket) => {
        pluginLogger.info(`WebSocket client connected to ${containerName} log server`, "log-server");
        clients.add(ws);

        // Send initial logs
        try {
          const logs = await dockerService.getContainerLogs(containerId, logLines);
          const message: LogMessage = {
            type: "logs",
            data: logs,
            timestamp: Date.now()
          };
          ws.send(JSON.stringify(message));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          pluginLogger.error(`Failed to get initial logs for ${containerName}: ${errorMessage}`, "log-server");

          // Send a more user-friendly error message
          const errorMsg: LogMessage = {
            type: "error",
            message: `❌ Cannot connect to container "${containerName}".\n\n` +
                     `Error: ${errorMessage}\n\n` +
                     `Possible causes:\n` +
                     `• Container name may be incorrect (check spelling, case-sensitive)\n` +
                     `• Container might not exist on this server\n` +
                     `• Server connection may have failed\n\n` +
                     `Please verify the container name in the Stream Deck action settings.`,
            timestamp: Date.now()
          };
          ws.send(JSON.stringify(errorMsg));
        }

        ws.on("close", () => {
          pluginLogger.info(`WebSocket client disconnected from ${containerName} log server`, "log-server");
          clients.delete(ws);
        });

        ws.on("error", (error) => {
          pluginLogger.error(`WebSocket error: ${error.message}`, "log-server");
          clients.delete(ws);
        });
      });

      // Start the HTTP server
      await new Promise<void>((resolve, reject) => {
        httpServer.on("error", (err) => {
          reject(err);
        });
        httpServer.listen(port, "127.0.0.1", () => {
          resolve();
        });
      });

      this.usedPorts.add(port);

      // Set up log refresh interval
      const refreshInterval = setInterval(async () => {
        if (clients.size === 0) {
          return; // No clients, skip refresh
        }

        try {
          if (!dockerService.isConnected()) {
            return;
          }

          const logs = await dockerService.getContainerLogs(containerId, logLines);
          const message: LogMessage = {
            type: "logs",
            data: logs,
            timestamp: Date.now()
          };
          const messageStr = JSON.stringify(message);

          clients.forEach((client) => {
            if (client.readyState === WS_OPEN) {
              client.send(messageStr);
            }
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          pluginLogger.error(`Failed to refresh logs for ${containerName}: ${errorMessage}`, "log-server");

          // Send error to connected clients
          const errorMsg: LogMessage = {
            type: "error",
            message: `Failed to fetch logs: ${errorMessage}`,
            timestamp: Date.now()
          };
          const errorStr = JSON.stringify(errorMsg);

          clients.forEach((client) => {
            if (client.readyState === WS_OPEN) {
              client.send(errorStr);
            }
          });
        }
      }, refreshRate * 1000);

      // Store the server instance
      const serverInstance: LogServerInstance = {
        httpServer,
        wsServer,
        port,
        containerId,
        containerName,
        serverName,
        clients,
        refreshInterval,
        windowFormat
      };

      this.servers.set(containerId, serverInstance);
      pluginLogger.info(`Log server created for ${containerName} on port ${port}`, "log-server");

      return { port, url: `http://localhost:${port}` };
    } catch (error) {
      pluginLogger.error(`Failed to create log server: ${error instanceof Error ? error.message : "Unknown error"}`, "log-server");
      this.usedPorts.delete(port);
      return null;
    }
  }

  /**
   * Destroy a log server for a specific container
   */
  async destroyServer(containerId: string): Promise<void> {
    const server = this.servers.get(containerId);
    if (!server) {
      return;
    }

    pluginLogger.info(`Destroying log server for ${server.containerName}`, "log-server");

    // Clear the refresh interval
    if (server.refreshInterval) {
      clearInterval(server.refreshInterval);
    }

    // Close all WebSocket clients
    server.clients.forEach((client) => {
      try {
        client.close(1000, "Server shutting down");
      } catch (e) {
        // Ignore errors
      }
    });
    server.clients.clear();

    // Close WebSocket server
    try {
      server.wsServer.close();
    } catch (e) {
      // Ignore errors
    }

    // Close HTTP server
    await new Promise<void>((resolve) => {
      server.httpServer.close(() => {
        resolve();
      });
      // Force resolve after timeout
      setTimeout(resolve, 1000);
    });

    // Free the port
    this.usedPorts.delete(server.port);

    // Remove from map
    this.servers.delete(containerId);

    pluginLogger.info(`Log server destroyed for ${server.containerName}`, "log-server");
  }

  /**
   * Destroy all log servers
   */
  async destroyAllServers(): Promise<void> {
    pluginLogger.info(`Destroying all log servers (${this.servers.size} total)`, "log-server");

    const destroyPromises: Promise<void>[] = [];
    for (const containerId of this.servers.keys()) {
      destroyPromises.push(this.destroyServer(containerId));
    }

    await Promise.all(destroyPromises);

    // Clear any remaining state
    this.servers.clear();
    this.usedPorts.clear();

    pluginLogger.info("All log servers destroyed", "log-server");
  }

  /**
   * Get information about active servers
   */
  getActiveServers(): Array<{ containerId: string; containerName: string; port: number; clientCount: number }> {
    return Array.from(this.servers.values()).map((server) => ({
      containerId: server.containerId,
      containerName: server.containerName,
      port: server.port,
      clientCount: server.clients.size
    }));
  }

  /**
   * Check if a server exists for a container
   */
  hasServer(containerId: string): boolean {
    return this.servers.has(containerId);
  }

  /**
   * Get the URL for an existing server
   */
  getServerUrl(containerId: string): string | null {
    const server = this.servers.get(containerId);
    return server ? `http://localhost:${server.port}` : null;
  }
}

// Export singleton instance
export const logServerManager = LogServerManager.getInstance();
