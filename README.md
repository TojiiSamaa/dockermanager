# Stream Deck Docker Manager

A Stream Deck plugin to manage Docker containers on Unraid/Linux servers.

## Features

- **Container Status**: Display the real-time status of Docker containers (running/stopped)
- **Container Toggle**: Start/Stop/Restart containers with a single button press
- **Multiple Connection Methods**:
  - SSH connection (recommended for Unraid)
  - Docker API (TCP) for direct Docker daemon access

## Installation

### Prerequisites

- Stream Deck software v6.5 or higher
- Node.js v20 or higher
- A Stream Deck device

### Build from Source

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Or watch for changes during development
npm run watch
```

### Install Plugin

1. Build the plugin using the commands above
2. Copy the `com.glennMusic.docker.sdPlugin` folder to your Stream Deck plugins directory:
   - Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\`
   - macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
3. Restart Stream Deck

## Configuration

### Server Settings

1. Add a "Server Settings" action to your Stream Deck
2. Configure your connection method:
   - **SSH**: Enter host, port, username, and authentication (key or password)
   - **Docker API**: Enter host, port, and optional TLS certificates path

### Container Actions

1. Add "Container Status" or "Container Toggle" actions
2. Enter the container name or ID
3. Optionally set a custom display name
4. Configure the refresh interval

## Actions

### Container Status
Displays the current state of a container. Press to refresh.
- Green = Running
- Red = Stopped

### Container Toggle
Toggles the container state on press.
- Options: Toggle, Start Only, Stop Only, Restart

### Server Settings
Configure the connection to your Docker server.

## Unraid Setup

For Unraid servers, SSH is the recommended connection method:

1. Enable SSH in Unraid settings
2. Use your Unraid credentials or set up SSH key authentication
3. The plugin will execute Docker commands over SSH

## Docker API Setup (Alternative)

To use the Docker API directly:

1. Enable Docker TCP socket on your server
2. Configure TLS if exposing over network (recommended)
3. Enter the host and port in plugin settings

## Development

```bash
# Install dependencies
npm install

# Watch mode (auto-rebuild on changes)
npm run watch

# Single build
npm run build
```

## License

MIT
