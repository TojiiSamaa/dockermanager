import * as http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { dockerService, ServerConfig } from "./docker-service";
import { globalSettings } from "./settings-manager";
import { pluginLogger } from "../actions/debug-logs";
import { logServerManager } from "./log-server";

// WebSocket ready states
const WS_OPEN = 1;

interface ContainerStatus {
  id: string;
  name: string;
  state: string;
  status: string;
  image: string;
  health?: string;
  uptime?: string;
}

interface ServerStatus {
  serverId: string;
  serverName: string;
  host: string;
  connectedHost?: string;
  connected: boolean;
  containers: ContainerStatus[];
  error?: string;
}

interface StatusMessage {
  type: "status" | "error";
  servers?: ServerStatus[];
  message?: string;
  timestamp: number;
}

/**
 * GlobalStatusServer - Singleton class that manages a status dashboard
 * showing all containers from all configured servers
 */
class GlobalStatusServer {
  private static instance: GlobalStatusServer;
  private httpServer: http.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private refreshInterval: NodeJS.Timeout | null = null;
  private readonly PORT = 9600;
  private isRunning = false;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): GlobalStatusServer {
    if (!GlobalStatusServer.instance) {
      GlobalStatusServer.instance = new GlobalStatusServer();
    }
    return GlobalStatusServer.instance;
  }

  /**
   * Generate the HTML page content for the global status dashboard
   */
  private generateStatusHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Docker Manager - Global Status</title>
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
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
      color: #0db7ed;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #888;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #4CAF50;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .tabs-container {
      display: flex;
      background: #16213e;
      border-bottom: 1px solid #333;
      padding: 0 16px;
      gap: 4px;
      overflow-x: auto;
      flex-shrink: 0;
    }
    .tab {
      padding: 12px 24px;
      cursor: pointer;
      border-radius: 8px 8px 0 0;
      font-size: 14px;
      font-weight: 500;
      background: transparent;
      color: #888;
      border: none;
      transition: all 0.2s;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tab:hover {
      background: rgba(255,255,255,0.05);
      color: #E8E8E8;
    }
    .tab.active {
      background: #1a1a2e;
      color: #0db7ed;
      border-bottom: 2px solid #0db7ed;
    }
    .tab-icon {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4CAF50;
    }
    .tab-icon.disconnected {
      background: #F44336;
    }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }
    .server-panel {
      display: none;
    }
    .server-panel.active {
      display: block;
    }
    .server-info {
      background: rgba(13,183,237,0.1);
      border: 1px solid rgba(13,183,237,0.3);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .server-info-row {
      display: flex;
      gap: 32px;
      flex-wrap: wrap;
    }
    .server-info-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .server-info-label {
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .server-info-value {
      font-size: 14px;
      color: #E8E8E8;
      font-weight: 500;
    }
    .containers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .container-card {
      background: #0d0d1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 16px;
      transition: all 0.2s;
      cursor: pointer;
      position: relative;
    }
    .container-card:hover {
      border-color: #0db7ed;
      box-shadow: 0 4px 12px rgba(13,183,237,0.2);
      transform: translateY(-2px);
    }
    .container-card::after {
      content: '📋 Click to view logs';
      position: absolute;
      top: 8px;
      right: 12px;
      font-size: 10px;
      color: #666;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .container-card:hover::after {
      opacity: 1;
    }
    .container-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .container-name {
      font-size: 15px;
      font-weight: 600;
      color: #E8E8E8;
    }
    .container-status {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .container-status.running {
      background: rgba(76,175,80,0.2);
      color: #4CAF50;
    }
    .container-status.stopped {
      background: rgba(244,67,54,0.2);
      color: #F44336;
    }
    .container-status.paused {
      background: rgba(255,152,0,0.2);
      color: #FF9800;
    }
    .container-details {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
      color: #aaa;
    }
    .container-detail {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .container-detail-label {
      color: #666;
      min-width: 60px;
    }
    .container-detail-value {
      color: #E8E8E8;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
    .empty-state h2 {
      font-size: 18px;
      margin-bottom: 10px;
      color: #888;
    }
    .error-state {
      background: rgba(244,67,54,0.1);
      border: 1px solid rgba(244,67,54,0.3);
      border-radius: 8px;
      padding: 20px;
      color: #F44336;
      text-align: center;
    }
    /* Scrollbar styling */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #1a1a2e;
    }
    ::-webkit-scrollbar-thumb {
      background: #444;
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🐳 Global Docker Status</h1>
    <div class="status-indicator">
      <span class="status-dot"></span>
      <span>Live updating...</span>
    </div>
  </div>

  <div class="tabs-container" id="tabsContainer">
    <div class="empty-state" style="padding: 12px; width: 100%;">
      <span style="color: #888;">Loading servers...</span>
    </div>
  </div>

  <div class="content" id="content">
    <div class="empty-state">
      <h2>Loading...</h2>
      <p>Connecting to servers and fetching container status</p>
    </div>
  </div>

  <script>
    let ws = null;
    let currentTab = null;
    let serversData = [];

    function connect() {
      console.log('Attempting to connect to WebSocket at ws://localhost:' + ${this.PORT});
      ws = new WebSocket('ws://localhost:' + ${this.PORT});

      ws.onopen = function() {
        console.log('✅ WebSocket connected successfully');
      };

      ws.onmessage = function(event) {
        console.log('📨 Received raw message:', event.data.substring(0, 200) + (event.data.length > 200 ? '...' : ''));
        try {
          const msg = JSON.parse(event.data);
          console.log('📋 Parsed message type:', msg.type, 'servers:', msg.servers?.length);
          handleMessage(msg);
        } catch (e) {
          console.error('❌ Failed to parse message:', e);
          console.error('Raw data:', event.data);
        }
      };

      ws.onclose = function(event) {
        console.log('🔌 WebSocket disconnected (code:', event.code, 'reason:', event.reason, '), reconnecting in 2s...');
        setTimeout(connect, 2000);
      };

      ws.onerror = function(error) {
        console.error('❌ WebSocket error:', error);
      };
    }

    function handleMessage(msg) {
      console.log('Received message:', msg);
      if (msg.type === 'status' && msg.servers) {
        console.log('Received status update with', msg.servers.length, 'servers');
        serversData = msg.servers;
        renderTabs();
        renderContent();
      } else if (msg.type === 'error') {
        console.error('Received error message:', msg.message);
        document.getElementById('content').innerHTML =
          '<div class="error-state"><h2>Error</h2><p>' + escapeHtml(msg.message) + '</p></div>';
      } else {
        console.warn('Received unknown message type:', msg.type);
      }
    }

    function renderTabs() {
      const container = document.getElementById('tabsContainer');

      if (serversData.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 12px; width: 100%;"><span style="color: #888;">No servers configured</span></div>';
        return;
      }

      container.innerHTML = serversData.map((server, index) => {
        const isActive = currentTab === null ? index === 0 : currentTab === index;
        const iconClass = server.connected ? '' : 'disconnected';
        return '<button class="tab ' + (isActive ? 'active' : '') + '" onclick="switchTab(' + index + ')">' +
          '<span class="tab-icon ' + iconClass + '"></span>' +
          escapeHtml(server.serverName) +
          '</button>';
      }).join('');

      if (currentTab === null) {
        currentTab = 0;
      }
    }

    function renderContent() {
      const content = document.getElementById('content');

      if (serversData.length === 0) {
        content.innerHTML = '<div class="empty-state"><h2>No servers configured</h2><p>Please configure servers in the plugin settings</p></div>';
        return;
      }

      content.innerHTML = serversData.map((server, index) => {
        const isActive = currentTab === index;
        return '<div class="server-panel ' + (isActive ? 'active' : '') + '" id="panel-' + index + '">' +
          renderServerPanel(server) +
          '</div>';
      }).join('');
    }

    function renderServerPanel(server) {
      let html = '<div class="server-info"><div class="server-info-row">';

      html += '<div class="server-info-item">';
      html += '<div class="server-info-label">Server Name</div>';
      html += '<div class="server-info-value">' + escapeHtml(server.serverName) + '</div>';
      html += '</div>';

      html += '<div class="server-info-item">';
      html += '<div class="server-info-label">Host</div>';
      html += '<div class="server-info-value">' + escapeHtml(server.host) + '</div>';
      html += '</div>';

      if (server.connectedHost) {
        html += '<div class="server-info-item">';
        html += '<div class="server-info-label">Connected to</div>';
        html += '<div class="server-info-value">' + escapeHtml(server.connectedHost) + '</div>';
        html += '</div>';
      }

      html += '<div class="server-info-item">';
      html += '<div class="server-info-label">Status</div>';
      html += '<div class="server-info-value" style="color: ' + (server.connected ? '#4CAF50' : '#F44336') + '">';
      html += server.connected ? 'Connected ✓' : 'Disconnected ✗';
      html += '</div>';
      html += '</div>';

      html += '</div></div>';

      if (!server.connected) {
        html += '<div class="error-state">';
        html += '<h2>Cannot connect to server</h2>';
        if (server.error) {
          html += '<p>' + escapeHtml(server.error) + '</p>';
        }
        html += '</div>';
        return html;
      }

      if (server.containers.length === 0) {
        html += '<div class="empty-state">';
        html += '<h2>No containers found</h2>';
        html += '<p>This server has no containers</p>';
        html += '</div>';
        return html;
      }

      html += '<div class="containers-grid">';
      server.containers.forEach(container => {
        html += renderContainerCard(container, server.serverId, server.serverName);
      });
      html += '</div>';

      return html;
    }

    function renderContainerCard(container, serverId, serverName) {
      const openLogsUrl = '/open-logs?containerId=' + encodeURIComponent(container.id) +
                          '&containerName=' + encodeURIComponent(container.name) +
                          '&serverId=' + encodeURIComponent(serverId) +
                          '&serverName=' + encodeURIComponent(serverName);

      let html = '<div class="container-card" onclick="openContainerLogs(\'' + openLogsUrl.replace(/'/g, "\\'") + '\')">';

      html += '<div class="container-header">';
      html += '<div class="container-name">' + escapeHtml(container.name) + '</div>';
      html += '<span class="container-status ' + container.state.toLowerCase() + '">' + container.state + '</span>';
      html += '</div>';

      html += '<div class="container-details">';

      html += '<div class="container-detail">';
      html += '<span class="container-detail-label">Image:</span>';
      html += '<span class="container-detail-value">' + escapeHtml(container.image) + '</span>';
      html += '</div>';

      html += '<div class="container-detail">';
      html += '<span class="container-detail-label">Status:</span>';
      html += '<span class="container-detail-value">' + escapeHtml(container.status) + '</span>';
      html += '</div>';

      if (container.health) {
        html += '<div class="container-detail">';
        html += '<span class="container-detail-label">Health:</span>';
        html += '<span class="container-detail-value">' + escapeHtml(container.health) + '</span>';
        html += '</div>';
      }

      if (container.uptime) {
        html += '<div class="container-detail">';
        html += '<span class="container-detail-label">Uptime:</span>';
        html += '<span class="container-detail-value">' + escapeHtml(container.uptime) + '</span>';
        html += '</div>';
      }

      html += '</div>';
      html += '</div>';

      return html;
    }

    function switchTab(index) {
      currentTab = index;
      renderTabs();

      // Hide all panels
      document.querySelectorAll('.server-panel').forEach(panel => {
        panel.classList.remove('active');
      });

      // Show selected panel
      const panel = document.getElementById('panel-' + index);
      if (panel) {
        panel.classList.add('active');
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function openContainerLogs(url) {
      // Open logs in a new window
      window.open(url, '_blank', 'width=1200,height=800');
    }

    // Start connection
    connect();
  </script>
</body>
</html>`;
  }

  /**
   * Start the global status server
   */
  async start(): Promise<{ port: number; url: string } | null> {
    if (this.isRunning) {
      return { port: this.PORT, url: `http://localhost:${this.PORT}` };
    }

    try {
      // Create HTTP server
      this.httpServer = http.createServer(async (req, res) => {
        if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.generateStatusHtml());
        } else if (req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", clients: this.clients.size }));
        } else if (req.url && req.url.startsWith("/open-logs?")) {
          // Handle opening container logs
          await this.handleOpenLogs(req, res);
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      // Create WebSocket server
      this.wsServer = new WebSocketServer({ server: this.httpServer });

      this.wsServer.on("connection", async (ws: WebSocket) => {
        pluginLogger.info("WebSocket client connected to global status server", "global-status");
        this.clients.add(ws);

        // Send initial status
        try {
          pluginLogger.info("Sending initial status to new client...", "global-status");
          await this.broadcastStatus();
          pluginLogger.info("Initial status sent successfully", "global-status");
        } catch (error) {
          pluginLogger.error(`Failed to send initial status: ${error instanceof Error ? error.message : "Unknown error"}`, "global-status");
        }

        ws.on("close", () => {
          pluginLogger.info("WebSocket client disconnected from global status server", "global-status");
          this.clients.delete(ws);
        });

        ws.on("error", (error) => {
          pluginLogger.error(`WebSocket error: ${error.message}`, "global-status");
          this.clients.delete(ws);
        });
      });

      // Start the HTTP server
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.on("error", (err) => {
          reject(err);
        });
        this.httpServer!.listen(this.PORT, "127.0.0.1", () => {
          resolve();
        });
      });

      // Set up refresh interval (every 5 seconds)
      this.refreshInterval = setInterval(async () => {
        if (this.clients.size > 0) {
          await this.broadcastStatus();
        }
      }, 5000);

      this.isRunning = true;
      pluginLogger.info(`Global status server started on port ${this.PORT}`, "global-status");

      return { port: this.PORT, url: `http://localhost:${this.PORT}` };
    } catch (error) {
      pluginLogger.error(`Failed to start global status server: ${error instanceof Error ? error.message : "Unknown error"}`, "global-status");
      return null;
    }
  }

  /**
   * Handle opening logs for a container
   */
  private async handleOpenLogs(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // Parse query parameters
      const url = new URL(req.url || "", `http://localhost:${this.PORT}`);
      const containerId = url.searchParams.get("containerId");
      const containerName = url.searchParams.get("containerName");
      const serverId = url.searchParams.get("serverId");
      const serverName = url.searchParams.get("serverName");

      if (!containerId || !containerName) {
        res.writeHead(400);
        res.end("Missing containerId or containerName");
        return;
      }

      pluginLogger.info(`Opening logs for container ${containerName} on server ${serverName || "default"}`, "global-status");

      // Get server config
      let config: ServerConfig | null = null;
      if (serverId && serverId !== "default") {
        config = globalSettings.getServerById(serverId) || null;
      } else {
        config = globalSettings.getServerConfig() || null;
      }

      if (!config) {
        res.writeHead(500);
        res.end("Server configuration not found");
        return;
      }

      // Connect to the server using multi-server safe method
      pluginLogger.info(`Connecting to server for logs: ${serverName}`, "global-status");
      const connected = await dockerService.ensureServerConnection(config);

      if (!connected) {
        res.writeHead(500);
        res.end("Failed to connect to Docker server");
        return;
      }

      pluginLogger.info(`Creating log server for ${containerName} on server ${serverName}`, "global-status");

      // Create log server with serverConfig for multi-server support
      const logServer = await logServerManager.createServer(
        containerId,
        containerName,
        200, // logLines
        2,   // refreshRate
        "full", // windowFormat
        serverName || undefined,
        config  // Pass server config for multi-server support
      );

      if (!logServer) {
        res.writeHead(500);
        res.end("Failed to create log server");
        return;
      }

      // Redirect to log server
      res.writeHead(302, { "Location": logServer.url });
      res.end();

    } catch (error) {
      pluginLogger.error(`Failed to open logs: ${error instanceof Error ? error.message : "Unknown error"}`, "global-status");
      res.writeHead(500);
      res.end("Internal server error");
    }
  }

  /**
   * Fetch status from all servers and broadcast to clients
   */
  private async broadcastStatus(): Promise<void> {
    try {
      pluginLogger.info(`Broadcasting status to ${this.clients.size} client(s)`, "global-status");
      const servers: ServerStatus[] = [];

      // Get all configured servers
      const serverConfigs = globalSettings.getServers();
      pluginLogger.info(`Got ${serverConfigs.length} server configs from getServers()`, "global-status");
      pluginLogger.info(`Server configs: ${JSON.stringify(serverConfigs.map(s => ({ id: (s as any).id, name: (s as any).name, host: s.sshHost || s.dockerHost })))}`, "global-status");

      const singleServer = globalSettings.getServerConfig();
      pluginLogger.info(`Got single server config: ${singleServer ? 'yes' : 'no'}`, "global-status");
      if (singleServer) {
        pluginLogger.info(`Single server: ${singleServer.sshHost || singleServer.dockerHost}`, "global-status");
      }

      // Use multi-server config if available, otherwise fall back to single server
      const serversToCheck = serverConfigs.length > 0 ? serverConfigs : (singleServer ? [singleServer] : []);

      pluginLogger.info(`Found ${serversToCheck.length} server(s) to check`, "global-status");

      if (serversToCheck.length === 0) {
        pluginLogger.warn(`No servers configured! Sending empty status.`, "global-status");
        // Send empty status immediately so the UI can show "No servers configured"
        const emptyMessage: StatusMessage = {
          type: "status",
          servers: [],
          timestamp: Date.now()
        };
        const messageStr = JSON.stringify(emptyMessage);
        this.clients.forEach((client) => {
          if (client.readyState === WS_OPEN) {
            client.send(messageStr);
          }
        });
        pluginLogger.info(`Sent empty server list to clients`, "global-status");
        return;
      }

      // Fetch status from each server
      for (const config of serversToCheck) {
        const serverId = (config as any).id || "default";
        const serverName = (config as any).name || config.sshHost || config.dockerHost || "Unknown";

        const serverStatus: ServerStatus = {
          serverId,
          serverName,
          host: config.sshHost || config.dockerHost || "Unknown",
          connected: false,
          containers: []
        };

        try {
          // Use multi-server safe method - does NOT change global state
          pluginLogger.info(`Connecting to server ${serverName} (${serverStatus.host})`, "global-status");
          const connected = await dockerService.ensureServerConnection(config);
          serverStatus.connected = connected;

          if (connected) {
            serverStatus.connectedHost = config.sshHost || config.dockerHost || "Unknown";

            // Get containers using server-specific method
            const containers = await dockerService.listContainersForServer(config);
            pluginLogger.info(`Found ${containers.length} containers on server ${serverName}`, "global-status");

            // Add all containers (running and stopped)
            for (const container of containers) {
              serverStatus.containers.push({
                id: container.id,
                name: container.name,
                state: container.state,
                status: container.status,
                image: container.image
              });
            }
          }
        } catch (error) {
          serverStatus.error = error instanceof Error ? error.message : "Unknown error";
          pluginLogger.error(`Failed to get status for server ${serverStatus.serverName}: ${serverStatus.error}`, "global-status");
        }

        servers.push(serverStatus);
      }

      pluginLogger.info(`Collected status for ${servers.length} server(s), total containers: ${servers.reduce((sum, s) => sum + s.containers.length, 0)}`, "global-status");

      // Broadcast to all clients
      const message: StatusMessage = {
        type: "status",
        servers,
        timestamp: Date.now()
      };

      pluginLogger.info(`Preparing to send message with ${servers.length} servers`, "global-status");

      const messageStr = JSON.stringify(message);
      pluginLogger.info(`Message serialized successfully, length: ${messageStr.length} chars`, "global-status");

      let sentCount = 0;
      this.clients.forEach((client) => {
        if (client.readyState === WS_OPEN) {
          try {
            client.send(messageStr);
            sentCount++;
          } catch (sendError) {
            pluginLogger.error(`Failed to send to client: ${sendError instanceof Error ? sendError.message : "Unknown error"}`, "global-status");
          }
        } else {
          pluginLogger.warn(`Client not in OPEN state, readyState: ${client.readyState}`, "global-status");
        }
      });

      pluginLogger.info(`Sent status update to ${sentCount} client(s)`, "global-status");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      pluginLogger.error(`Failed to broadcast status: ${errorMsg}`, "global-status");
      pluginLogger.error(`Stack trace: ${error instanceof Error ? error.stack : "No stack"}`, "global-status");

      // Send error message to clients
      const errorMessage: StatusMessage = {
        type: "error",
        message: `Failed to fetch server status: ${errorMsg}`,
        timestamp: Date.now()
      };

      const messageStr = JSON.stringify(errorMessage);
      this.clients.forEach((client) => {
        if (client.readyState === WS_OPEN) {
          client.send(messageStr);
        }
      });
    }
  }

  /**
   * Stop the global status server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    pluginLogger.info("Stopping global status server", "global-status");

    // Clear refresh interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    // Close all WebSocket clients
    this.clients.forEach((client) => {
      try {
        client.close(1000, "Server shutting down");
      } catch (e) {
        // Ignore errors
      }
    });
    this.clients.clear();

    // Close WebSocket server
    if (this.wsServer) {
      try {
        this.wsServer.close();
      } catch (e) {
        // Ignore errors
      }
      this.wsServer = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => {
          resolve();
        });
        // Force resolve after timeout
        setTimeout(resolve, 1000);
      });
      this.httpServer = null;
    }

    this.isRunning = false;
    pluginLogger.info("Global status server stopped", "global-status");
  }

  /**
   * Check if the server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the server URL
   */
  getUrl(): string | null {
    return this.isRunning ? `http://localhost:${this.PORT}` : null;
  }
}

// Export singleton instance
export const globalStatusServer = GlobalStatusServer.getInstance();
