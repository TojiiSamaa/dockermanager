# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stream Deck plugin for managing Docker containers on Unraid/Linux servers. Built with the `@elgato/streamdeck` SDK (Node.js-based, SDK v2).

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # TypeScript → JavaScript (single build via Rollup)
npm run watch        # Continuous rebuild on file changes (alias: npm run dev)
npm run pack         # Build + create .streamDeckPlugin file for distribution
npm run link         # Symlink plugin to Stream Deck plugins folder for testing
npm run restart      # Reload plugin in running Stream Deck
```

Releases are automated via GitHub Actions on tag push (format: `v*`).

## Architecture

### Directory Structure

- `src/plugin.ts` - Entry point: registers actions, connects to Stream Deck
- `src/actions/` - Stream Deck action implementations (one file per action)
- `src/services/` - Business logic (Docker, SSH, settings, icons)
- `io.deckops.containers.sdPlugin/` - Final plugin package
  - `bin/plugin.js` - Bundled output (generated)
  - `ui/*.html` - Property Inspector HTML files
  - `manifest.json` - Plugin definition

### Core Services

- **docker-service.ts** - Docker/SSH communication with connection pooling for multi-server support
- **settings-manager.ts** - Global settings with backup to `~/.deckops-docker/settings-backup.json`
- **compose-service.ts** - Docker Compose stack operations
- **log-server.ts** - WebSocket log streaming server
- **icon-generator.ts** - Dynamic SVG icon generation with health animations
- **server-manager.ts** - Multi-server connection management

### Action Pattern

Actions extend `SingletonAction<TSettings>` with the `@action` decorator:

```typescript
@action({ UUID: "io.deckops.containers.toggle" })
export class DockerToggleAction extends SingletonAction<ToggleSettings> {
  override async onWillAppear(ev: WillAppearEvent<ToggleSettings>): Promise<void>
  override async onWillDisappear(ev: WillDisappearEvent<ToggleSettings>): Promise<void>
  override async onKeyDown(ev: KeyDownEvent<ToggleSettings>): Promise<void>
  override async onSendToPlugin(ev: SendToPluginEvent<PIMessage, ToggleSettings>): Promise<void>
}
```

Key lifecycle: `onWillAppear` sets up refresh intervals, `onWillDisappear` cleans them up.

### Settings Types

- **Action Settings**: Per-button (container name, display options) - accessed via `ev.payload.settings`
- **Global Settings**: Plugin-wide (server config, multi-server support) - via `streamDeck.settings.getGlobalSettings()`

### Multi-Server Architecture

The plugin supports multiple Docker servers simultaneously via connection pooling in `docker-service.ts`:
- Each server maintains its own SSH/Docker connection in the pool
- Connections are keyed by primary host
- Use `ensureServerConnection(config)` to connect to a specific server without disconnecting others
- Use `execSSHCommandForServer(config, command)` to execute commands on a specific server

### Connection Methods

Plugin supports two Docker connection methods:
- SSH (recommended for Unraid) - uses `ssh2` library with backup addresses for failover
- Docker API (TCP 2375/2376) - uses `dockerode` library

### Property Inspector Communication

PI (HTML in `ui/`) communicates with plugin backend via WebSocket:
- PI → Plugin: `sendToPlugin` event → handled in `onSendToPlugin`
- Plugin → PI: `ev.action.sendToPropertyInspector(payload)`
- Settings save: PI sends `setSettings` event, triggers `onDidReceiveSettings`

## Key Patterns

### Resource Cleanup

Always clean up intervals in `onWillDisappear`:
```typescript
const intervalId = this.refreshIntervals.get(ev.action.id);
if (intervalId) {
  clearInterval(intervalId);
  this.refreshIntervals.delete(ev.action.id);
}
```

### Version Tracking for Async Operations

Prevent race conditions when settings change during async operations:
```typescript
private settingsVersion: Map<string, number> = new Map();

// Increment version when settings change
const version = (this.settingsVersion.get(ev.action.id) || 0) + 1;
this.settingsVersion.set(ev.action.id, version);

// Check version before updating after async operations
if (this.settingsVersion.get(action.id) !== version) {
  return; // Settings changed, abort
}
```

### Plugin Logger

Use `pluginLogger` from `debug-logs.ts` for consistent logging:
```typescript
import { pluginLogger } from "./debug-logs";
pluginLogger.info("Message", "category");
pluginLogger.error("Error message", "category");
pluginLogger.debug("Debug info", "category");
```

### Dynamic Icons

Icons generated as SVG with status dots (icon-generator.ts):
- Green (#4CAF50): Running/Stable
- Yellow (pulsing): Starting
- Red (#F44336): Stopped
- Red (blinking): Crash loop

### Visual Feedback

Use `await ev.action.showOk()` on success, `await ev.action.showAlert()` on error.

## Adding a New Action

1. Create `src/actions/docker-{feature}.ts` extending `SingletonAction`
2. Register in `src/plugin.ts`: `streamDeck.actions.registerAction(new MyAction())`
3. Add to `manifest.json` Actions array with UUID, states, PropertyInspectorPath
4. Create `io.deckops.containers.sdPlugin/ui/{feature}-pi.html` for settings UI

## Important Files

- [manifest.json](io.deckops.containers.sdPlugin/manifest.json) - Plugin definition, action UUIDs, version
- [docker-service.ts](src/services/docker-service.ts) - Docker/SSH communication layer with connection pooling
- [docker-toggle.ts](src/actions/docker-toggle.ts) - Main container control action (reference implementation)
- [settings-manager.ts](src/services/settings-manager.ts) - Settings persistence with backup/restore
- [DEVELOPMENT.md](DEVELOPMENT.md) - Detailed SDK documentation and patterns
