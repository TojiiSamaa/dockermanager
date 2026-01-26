# Stream Deck Plugin Development Guide

This document provides comprehensive process documentation for building a Stream Deck plugin using the `@elgato/streamdeck` SDK. It uses the Docker Manager plugin as a reference implementation.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [How the @elgato/streamdeck SDK Works](#how-the-elgatostreamdeck-sdk-works)
4. [Creating and Registering Actions](#creating-and-registering-actions)
5. [Property Inspector (UI)](#property-inspector-ui)
6. [Building and Packaging](#building-and-packaging)
7. [Key Files and Their Purposes](#key-files-and-their-purposes)
8. [Debugging Tips](#debugging-tips)
9. [Best Practices](#best-practices)

---

## Prerequisites

### Required Software

1. **Node.js v20 or higher**
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version`

2. **Stream Deck Software v6.5 or higher**
   - Download from [Elgato's website](https://www.elgato.com/downloads)
   - Required for plugin development and testing

3. **Stream Deck CLI** (optional but recommended)
   - Install globally: `npm install -g @elgato/cli`
   - Provides commands like `streamdeck link`, `streamdeck pack`, `streamdeck restart`

4. **A Physical Stream Deck Device** (optional for development)
   - While helpful, you can develop using the Stream Deck software's preview feature

### Development Tools

- **TypeScript** - For type-safe development
- **Rollup** - For bundling the plugin code
- **VS Code** (recommended) - With TypeScript support

---

## Project Structure

A Stream Deck plugin follows a specific directory structure:

```
streamdeck-docker/
├── src/                              # TypeScript source code
│   ├── plugin.ts                     # Main entry point
│   ├── actions/                      # Action implementations
│   │   ├── docker-toggle.ts          # Toggle container action
│   │   ├── docker-logs.ts            # View logs action
│   │   ├── docker-status.ts          # Status display action
│   │   └── debug-logs.ts             # Debug logging action
│   └── services/                     # Business logic services
│       ├── docker-service.ts         # Docker/SSH communication
│       ├── settings-manager.ts       # Global settings management
│       └── icon-generator.ts         # Dynamic icon generation
│
├── io.deckops.containers.sdPlugin/   # Plugin package directory
│   ├── manifest.json                 # Plugin manifest (required)
│   ├── package.json                  # Plugin package metadata
│   ├── bin/                          # Compiled JavaScript output
│   │   └── plugin.js                 # Bundled plugin code
│   ├── imgs/                         # Plugin icons and images
│   │   ├── plugin-icon.svg           # Main plugin icon
│   │   ├── category-icon.svg         # Category icon in Stream Deck
│   │   ├── action-toggle.svg         # Action icons
│   │   ├── state-running.svg         # State-specific icons
│   │   └── state-stopped.svg
│   └── ui/                           # Property Inspector HTML files
│       ├── action-pi.html            # Main action settings UI
│       ├── plugin-config.html        # Global configuration UI
│       └── debug-pi.html             # Debug panel UI
│
├── scripts/                          # Build utilities
│   └── generate-icons.mjs            # Icon generation script
│
├── package.json                      # Project dependencies and scripts
├── tsconfig.json                     # TypeScript configuration
├── rollup.config.mjs                 # Rollup bundler configuration
└── README.md                         # User documentation
```

### Key Directories

- **`src/`**: Contains all TypeScript source code that gets compiled
- **`*.sdPlugin/`**: The final plugin package directory (must end with `.sdPlugin`)
- **`ui/`**: HTML files for the Property Inspector UI

---

## How the @elgato/streamdeck SDK Works

### Overview

The `@elgato/streamdeck` SDK provides a Node.js-based framework for building Stream Deck plugins. It handles:

- WebSocket communication with the Stream Deck software
- Action registration and lifecycle management
- Settings persistence
- Image/title updates on buttons
- Event handling (key press, appear/disappear, etc.)

### Core Concepts

#### 1. Plugin Entry Point

The main plugin file initializes the SDK and registers actions:

```typescript
import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { DockerToggleAction } from "./actions/docker-toggle";

// Configure logging
streamDeck.logger.setLevel(LogLevel.DEBUG);

// Register actions
streamDeck.actions.registerAction(new DockerToggleAction());

// Connect to Stream Deck
streamDeck.connect();
```

#### 2. Action Classes

Actions are TypeScript classes that extend `SingletonAction<TSettings>`:

```typescript
import { action, SingletonAction, KeyDownEvent } from "@elgato/streamdeck";

interface MySettings {
  someOption: string;
}

@action({ UUID: "com.example.plugin.myaction" })
export class MyAction extends SingletonAction<MySettings> {
  // Action lifecycle methods
}
```

#### 3. Event Lifecycle

Actions receive events throughout their lifecycle:

| Event | Method | Description |
|-------|--------|-------------|
| Will Appear | `onWillAppear` | Action becomes visible on Stream Deck |
| Will Disappear | `onWillDisappear` | Action is removed from Stream Deck |
| Key Down | `onKeyDown` | Button is pressed |
| Key Up | `onKeyUp` | Button is released |
| Settings Changed | `onDidReceiveSettings` | Settings updated from Property Inspector |
| Message from PI | `onSendToPlugin` | Message received from Property Inspector |

#### 4. Settings Management

The SDK provides two types of settings:

**Action Settings** - Per-button settings:
```typescript
// Read settings in event handler
const { containerName, action } = ev.payload.settings;

// Settings are saved automatically when Property Inspector sends them
```

**Global Settings** - Plugin-wide settings:
```typescript
// Read global settings
const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();

// Save global settings
await streamDeck.settings.setGlobalSettings(settings);

// Listen for changes
streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
  console.log("Global settings changed:", ev.settings);
});
```

---

## Creating and Registering Actions

### Step 1: Define the Action Class

```typescript
// src/actions/my-action.ts
import streamDeck, {
  action,
  KeyDownEvent,
  KeyUpEvent,
  WillAppearEvent,
  WillDisappearEvent,
  DidReceiveSettingsEvent,
  SendToPluginEvent,
  SingletonAction,
  Action
} from "@elgato/streamdeck";

// Define settings interface
interface MyActionSettings {
  containerName: string;
  displayName?: string;
  refreshInterval?: number;
}

// Define Property Inspector message interface
interface PIMessage {
  action?: string;
}

@action({ UUID: "io.deckops.containers.myaction" })
export class MyAction extends SingletonAction<MyActionSettings> {
  // Store intervals/timers per action instance
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();

  // Called when action appears on Stream Deck
  override async onWillAppear(ev: WillAppearEvent<MyActionSettings>): Promise<void> {
    const { containerName, refreshInterval = 10 } = ev.payload.settings;

    if (!containerName) {
      await ev.action.setTitle("Config\nRequired");
      return;
    }

    // Initial setup
    await this.updateStatus(ev.action, containerName);

    // Set up periodic refresh
    const intervalId = setInterval(async () => {
      await this.updateStatus(ev.action, containerName);
    }, refreshInterval * 1000);

    this.refreshIntervals.set(ev.action.id, intervalId);
  }

  // Called when action is removed
  override async onWillDisappear(ev: WillDisappearEvent<MyActionSettings>): Promise<void> {
    // Clean up intervals
    const intervalId = this.refreshIntervals.get(ev.action.id);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshIntervals.delete(ev.action.id);
    }
  }

  // Called when button is pressed
  override async onKeyDown(ev: KeyDownEvent<MyActionSettings>): Promise<void> {
    const { containerName } = ev.payload.settings;
    // Perform action...
  }

  // Called when button is released
  override async onKeyUp(ev: KeyUpEvent<MyActionSettings>): Promise<void> {
    // Handle key release...
  }

  // Called when settings change
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MyActionSettings>): Promise<void> {
    // Handle settings update...
  }

  // Called when Property Inspector sends a message
  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, MyActionSettings>): Promise<void> {
    if (ev.payload.action === "listContainers") {
      // Handle request from PI
      const containers = await getContainerList();
      await ev.action.sendToPropertyInspector({ containers });
    }
  }

  // Helper method
  private async updateStatus(action: Action<MyActionSettings>, containerName: string): Promise<void> {
    // Update button appearance
    await action.setTitle(containerName);
    await action.setState(1); // 0 or 1 based on states in manifest
    // await action.setImage("data:image/svg+xml;base64,...");
  }
}
```

### Step 2: Register the Action

In your main `plugin.ts`:

```typescript
import streamDeck from "@elgato/streamdeck";
import { MyAction } from "./actions/my-action";

// Register the action
streamDeck.actions.registerAction(new MyAction());

// Connect to Stream Deck
streamDeck.connect();
```

### Step 3: Add to Manifest

In `manifest.json`, add the action definition:

```json
{
  "Actions": [
    {
      "UUID": "io.deckops.containers.myaction",
      "Name": "My Action",
      "Tooltip": "Description of what this action does",
      "Icon": "imgs/action-icon",
      "States": [
        {
          "Image": "imgs/state-off",
          "TitleAlignment": "bottom",
          "FontSize": 10
        },
        {
          "Image": "imgs/state-on",
          "TitleAlignment": "bottom",
          "FontSize": 10
        }
      ],
      "PropertyInspectorPath": "ui/my-action-pi.html",
      "SupportedInMultiActions": true
    }
  ]
}
```

---

## Property Inspector (UI)

The Property Inspector is the settings panel shown when configuring an action in Stream Deck.

### Overview

- HTML-based UI that runs in a webview
- Communicates with the plugin via WebSocket
- Uses the `connectElgatoStreamDeckSocket` callback function

### Basic Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Action Settings</title>
  <style>
    /* Stream Deck-style dark theme */
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 16px;
      background: #2D2D2D;
      color: #E8E8E8;
      font-size: 12px;
    }

    input, select {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #3C3C3C;
      border-radius: 6px;
      background: #1E1E1E;
      color: #E8E8E8;
      font-size: 12px;
    }

    input:focus, select:focus {
      outline: none;
      border-color: #0db7ed;
    }

    .form-group {
      margin-bottom: 12px;
    }

    .form-label {
      display: block;
      font-size: 11px;
      color: #aaa;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="form-group">
    <label class="form-label">Container Name</label>
    <input type="text" id="containerName" placeholder="Enter container name">
  </div>

  <div class="form-group">
    <label class="form-label">Refresh Interval (seconds)</label>
    <input type="number" id="refreshInterval" value="10" min="1" max="300">
  </div>

  <button id="refreshButton">Load Containers</button>

  <script>
    let websocket = null;
    let uuid = null;
    let actionInfo = null;
    let settings = {};

    // Called by Stream Deck when PI loads
    function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
      uuid = inUUID;
      actionInfo = JSON.parse(inActionInfo);
      settings = actionInfo.payload.settings || {};

      // Connect to Stream Deck
      websocket = new WebSocket('ws://127.0.0.1:' + inPort);

      websocket.onopen = function() {
        // Register the Property Inspector
        websocket.send(JSON.stringify({
          event: inRegisterEvent,
          uuid: inUUID
        }));

        // Load saved settings into UI
        loadSettings();
      };

      websocket.onmessage = function(evt) {
        const data = JSON.parse(evt.data);

        if (data.event === 'didReceiveSettings') {
          settings = data.payload.settings || {};
          loadSettings();
        }

        // Handle messages from plugin
        if (data.event === 'sendToPropertyInspector') {
          handlePluginMessage(data.payload);
        }
      };
    }

    function loadSettings() {
      document.getElementById('containerName').value = settings.containerName || '';
      document.getElementById('refreshInterval').value = settings.refreshInterval || 10;
    }

    function saveSettings() {
      settings = {
        containerName: document.getElementById('containerName').value,
        refreshInterval: parseInt(document.getElementById('refreshInterval').value) || 10
      };

      // Send settings to Stream Deck
      websocket.send(JSON.stringify({
        event: 'setSettings',
        context: uuid,
        payload: settings
      }));
    }

    function handlePluginMessage(payload) {
      if (payload.containers) {
        // Display container list...
      }
      if (payload.error) {
        // Show error...
      }
    }

    // Send message to plugin
    function sendToPlugin(message) {
      websocket.send(JSON.stringify({
        event: 'sendToPlugin',
        context: uuid,
        payload: message
      }));
    }

    // Auto-save on change
    document.getElementById('containerName').addEventListener('change', saveSettings);
    document.getElementById('refreshInterval').addEventListener('change', saveSettings);

    // Request container list from plugin
    document.getElementById('refreshButton').addEventListener('click', () => {
      sendToPlugin({ action: 'listContainers' });
    });
  </script>
</body>
</html>
```

### Communication Patterns

#### PI to Plugin
```javascript
// Send message to plugin
websocket.send(JSON.stringify({
  event: 'sendToPlugin',
  context: uuid,
  payload: { action: 'listContainers' }
}));
```

#### Plugin to PI
```typescript
// In action class
await ev.action.sendToPropertyInspector({
  containers: containerList,
  status: 'success'
});
```

#### Save Settings
```javascript
// From PI
websocket.send(JSON.stringify({
  event: 'setSettings',
  context: uuid,
  payload: settings
}));
```

#### Global Settings
```javascript
// Request global settings
websocket.send(JSON.stringify({
  event: 'getGlobalSettings',
  context: uuid
}));

// Save global settings
websocket.send(JSON.stringify({
  event: 'setGlobalSettings',
  context: uuid,
  payload: globalSettings
}));
```

---

## Building and Packaging

### Build Configuration

#### package.json

```json
{
  "name": "streamdeck-docker-manager",
  "version": "1.0.0",
  "type": "module",
  "main": "io.deckops.containers.sdPlugin/bin/plugin.js",
  "scripts": {
    "build": "rollup -c --bundleConfigAsCjs",
    "watch": "rollup -c --bundleConfigAsCjs -w",
    "dev": "npm run watch",
    "pack": "npm run build && streamdeck pack io.deckops.containers.sdPlugin",
    "link": "streamdeck link io.deckops.containers.sdPlugin",
    "restart": "streamdeck restart io.deckops.containers"
  },
  "devDependencies": {
    "@rollup/plugin-commonjs": "^25.0.7",
    "@rollup/plugin-json": "^6.1.0",
    "@rollup/plugin-node-resolve": "^15.2.3",
    "@rollup/plugin-typescript": "^11.1.6",
    "@types/node": "^20.11.0",
    "rollup": "^4.9.6",
    "tslib": "^2.6.2",
    "typescript": "^5.3.3"
  },
  "dependencies": {
    "@elgato/streamdeck": "^0.3.0"
  }
}
```

#### rollup.config.mjs

```javascript
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

const isWatching = process.env.ROLLUP_WATCH === "true";

export default {
  input: "src/plugin.ts",
  output: {
    file: "io.deckops.containers.sdPlugin/bin/plugin.js",
    format: "cjs",
    sourcemap: isWatching,
  },
  plugins: [
    json(),
    nodeResolve({
      preferBuiltins: true,
    }),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
      sourceMap: isWatching,
    }),
  ],
  external: [],
};
```

#### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "outDir": "./io.deckops.containers.sdPlugin/bin",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### Build Commands

```bash
# Install dependencies
npm install

# Build once
npm run build

# Watch mode (rebuild on changes)
npm run watch

# Link plugin for development (creates symlink in Stream Deck plugins folder)
npm run link

# Restart the plugin in Stream Deck
npm run restart

# Package for distribution
npm run pack
```

### Plugin Installation Paths

- **Windows**: `%APPDATA%\Elgato\StreamDeck\Plugins\`
- **macOS**: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`

---

## Key Files and Their Purposes

### manifest.json

The manifest is the most critical file - it defines your plugin's metadata, actions, and requirements.

```json
{
  "Name": "Docker Manager",
  "Version": "1.0.0.0",
  "Author": "Your Name",
  "Description": "Manage Docker containers from Stream Deck",
  "Category": "Docker Manager",
  "CategoryIcon": "imgs/category-icon",
  "Icon": "imgs/plugin-icon",
  "CodePath": "bin/plugin.js",
  "UUID": "io.deckops.containers",
  "SDKVersion": 2,
  "Software": {
    "MinimumVersion": "6.5"
  },
  "OS": [
    {
      "Platform": "windows",
      "MinimumVersion": "10"
    },
    {
      "Platform": "mac",
      "MinimumVersion": "10.15"
    }
  ],
  "Nodejs": {
    "Version": "20",
    "Debug": "enabled"
  },
  "Actions": [
    {
      "UUID": "io.deckops.containers.toggle",
      "Name": "Container Control",
      "Tooltip": "Control Docker containers",
      "Icon": "imgs/action-toggle",
      "States": [
        {
          "Image": "imgs/state-stopped",
          "TitleAlignment": "bottom",
          "FontSize": 10
        },
        {
          "Image": "imgs/state-running",
          "TitleAlignment": "bottom",
          "FontSize": 10
        }
      ],
      "PropertyInspectorPath": "ui/action-pi.html",
      "SupportedInMultiActions": true
    }
  ]
}
```

#### Key Manifest Fields

| Field | Description |
|-------|-------------|
| `UUID` | Unique identifier (reverse domain notation) |
| `CodePath` | Path to compiled JavaScript entry point |
| `SDKVersion` | Always `2` for Node.js plugins |
| `Nodejs.Version` | Required Node.js version |
| `Nodejs.Debug` | Set to `"enabled"` for debug logging |
| `Actions` | Array of action definitions |
| `Actions[].States` | Button states with default images |
| `Actions[].PropertyInspectorPath` | Path to settings UI HTML |

### plugin.ts (Entry Point)

```typescript
import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { DockerToggleAction } from "./actions/docker-toggle";
import { DockerLogsAction } from "./actions/docker-logs";
import { globalSettings } from "./services/settings-manager";
import { dockerService } from "./services/docker-service";

// Configure logging level
streamDeck.logger.setLevel(LogLevel.DEBUG);

// Register all actions
streamDeck.actions.registerAction(new DockerToggleAction());
streamDeck.actions.registerAction(new DockerLogsAction());

// Initialize plugin
async function initialize() {
  // Load global settings
  await globalSettings.load();

  // Auto-connect if settings exist
  const serverConfig = globalSettings.getServerConfig();
  if (serverConfig) {
    await dockerService.configure(serverConfig);
    await dockerService.connect();
  }
}

// Listen for global settings changes
streamDeck.settings.onDidReceiveGlobalSettings(async (ev) => {
  const serverConfig = ev.settings?.serverConfig;
  if (serverConfig) {
    await dockerService.configure(serverConfig);
    await dockerService.connect();
  }
});

// Start plugin
streamDeck.connect().then(() => {
  initialize();
});
```

### Icon Files

Icons should be provided in SVG format with @2x versions for high-DPI displays:

| Icon | Size | Purpose |
|------|------|---------|
| `plugin-icon.svg` | 144x144 | Main plugin icon |
| `plugin-icon@2x.svg` | 288x288 | High-DPI plugin icon |
| `category-icon.svg` | 28x28 | Category in action list |
| `category-icon@2x.svg` | 56x56 | High-DPI category icon |
| `action-*.svg` | 20x20 | Action icons in list |
| `action-*@2x.svg` | 40x40 | High-DPI action icons |
| `state-*.svg` | 72x72 | Button state images |
| `state-*@2x.svg` | 144x144 | High-DPI state images |

---

## Debugging Tips

### 1. Enable Debug Logging

In `manifest.json`:
```json
{
  "Nodejs": {
    "Version": "20",
    "Debug": "enabled"
  }
}
```

In your code:
```typescript
streamDeck.logger.setLevel(LogLevel.DEBUG);
streamDeck.logger.debug("Debug message");
streamDeck.logger.info("Info message");
streamDeck.logger.error("Error message");
```

### 2. View Logs

**Log file locations:**
- **Windows**: `%APPDATA%\Elgato\StreamDeck\logs\`
- **macOS**: `~/Library/Logs/ElgatoStreamDeck/`

Look for files named after your plugin UUID.

### 3. Use the Stream Deck CLI

```bash
# Link plugin for development
streamdeck link io.deckops.containers.sdPlugin

# Restart plugin after changes
streamdeck restart io.deckops.containers

# View plugin status
streamdeck status
```

### 4. Property Inspector Debugging

Add a debug panel to your PI:

```html
<div id="debugLogs" style="
  max-height: 150px;
  overflow-y: auto;
  background: #0d0d1a;
  border: 1px solid #3C3C3C;
  padding: 8px;
  font-family: monospace;
  font-size: 10px;
">Logs appear here...</div>

<script>
function addDebugLog(message, type = 'info') {
  const debugLogs = document.getElementById('debugLogs');
  const timestamp = new Date().toLocaleTimeString();
  const color = type === 'error' ? '#F44336' : '#4CAF50';
  debugLogs.innerHTML += `<div><span style="color:#666;">[${timestamp}]</span> <span style="color:${color};">${message}</span></div>`;
  debugLogs.scrollTop = debugLogs.scrollHeight;
}
</script>
```

### 5. Common Issues

#### Plugin Not Loading
- Check `manifest.json` syntax (use JSON validator)
- Verify `CodePath` points to correct file
- Check Node.js version compatibility

#### Settings Not Saving
- Ensure WebSocket is connected before sending
- Verify settings object structure matches expected format
- Check for JSON serialization errors

#### Icons Not Showing
- Verify file paths in manifest (no extension needed)
- Ensure @2x versions exist
- Check SVG syntax validity

#### Actions Not Appearing
- Verify UUID matches between manifest and `@action` decorator
- Check that action is registered in `plugin.ts`
- Restart Stream Deck software

### 6. Create a Debug Action

Create a dedicated debug action to inspect plugin state:

```typescript
@action({ UUID: "io.deckops.containers.debug" })
export class DebugLogsAction extends SingletonAction<DebugSettings> {
  override async onKeyDown(ev: KeyDownEvent<DebugSettings>): Promise<void> {
    // Log current state
    pluginLogger.info(`Total logs: ${pluginLogger.getLogs().length}`);
    await ev.action.showOk();
  }

  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, DebugSettings>): Promise<void> {
    if (ev.payload.action === "getLogs") {
      const logs = pluginLogger.getLogsForPI();
      await ev.action.sendToPropertyInspector({ logs });
    }
  }
}
```

---

## Best Practices

### 1. Resource Management

Always clean up resources when actions disappear:

```typescript
override async onWillDisappear(ev: WillDisappearEvent<Settings>): Promise<void> {
  // Clear intervals
  const intervalId = this.intervals.get(ev.action.id);
  if (intervalId) {
    clearInterval(intervalId);
    this.intervals.delete(ev.action.id);
  }

  // Clear any cached state
  this.stateCache.delete(ev.action.id);
}
```

### 2. Error Handling

Wrap async operations in try-catch:

```typescript
override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
  try {
    await performAction();
    await ev.action.showOk();
  } catch (error) {
    streamDeck.logger.error(`Action failed: ${error.message}`);
    await ev.action.showAlert();
  }
}
```

### 3. Settings Validation

Validate settings before use:

```typescript
const { containerName, refreshInterval = 10 } = ev.payload.settings;

if (!containerName) {
  await ev.action.setTitle("Config\nRequired");
  return;
}

// Clamp refresh interval to valid range
const interval = Math.max(1, Math.min(300, refreshInterval));
```

### 4. Efficient Updates

Avoid unnecessary updates by tracking state:

```typescript
private lastKnownStates: Map<string, string> = new Map();

private async updateIfChanged(action: Action<Settings>, newState: string): Promise<void> {
  const lastState = this.lastKnownStates.get(action.id);
  if (lastState !== newState) {
    await action.setState(newState === "running" ? 1 : 0);
    this.lastKnownStates.set(action.id, newState);
  }
}
```

### 5. Version Tracking for Async Operations

Prevent race conditions when settings change:

```typescript
private settingsVersion: Map<string, number> = new Map();

override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
  const version = (this.settingsVersion.get(ev.action.id) || 0) + 1;
  this.settingsVersion.set(ev.action.id, version);

  // Long-running operation
  await this.performUpdate(ev.action, version);
}

private async performUpdate(action: Action<Settings>, version: number): Promise<void> {
  // Check version before updating
  if (this.settingsVersion.get(action.id) !== version) {
    return; // Settings changed, abort
  }

  // Perform update...
}
```

### 6. Icon Generation

Generate icons dynamically for better visual feedback:

```typescript
const iconBase64 = generateIconSvg(containerName, isRunning ? "green" : "red");
await action.setImage(`data:image/svg+xml;base64,${iconBase64}`);

function generateIconSvg(label: string, color: string): string {
  const svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" fill="#1a1a1a"/>
    <circle cx="110" cy="34" r="24" fill="${color}"/>
    <text x="72" y="80" text-anchor="middle" fill="white" font-size="40">${label[0]}</text>
  </svg>`;
  return Buffer.from(svg).toString("base64");
}
```

---

## Additional Resources

- [Stream Deck SDK Documentation](https://docs.elgato.com/sdk/)
- [@elgato/streamdeck npm package](https://www.npmjs.com/package/@elgato/streamdeck)
- [Stream Deck CLI](https://www.npmjs.com/package/@elgato/cli)
- [Sample Plugins](https://github.com/elgatosf/streamdeck-plugin-samples)

---

## Summary

Building a Stream Deck plugin involves:

1. **Setting up the project** with TypeScript, Rollup, and the `@elgato/streamdeck` SDK
2. **Creating actions** as classes that extend `SingletonAction`
3. **Defining the manifest** with plugin metadata and action definitions
4. **Building the Property Inspector** for user-facing settings
5. **Handling lifecycle events** for button interactions
6. **Managing settings** at both action and global levels
7. **Packaging and distributing** the final `.streamDeckPlugin` file

The key to a successful plugin is understanding the event-driven architecture and maintaining clean communication between your plugin code and the Property Inspector UI.
