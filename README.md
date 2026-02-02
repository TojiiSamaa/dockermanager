# Docker Manager for Stream Deck

[![Release](https://img.shields.io/github/v/release/TojiiSamaa/dockermanager?style=flat-square)](https://github.com/TojiiSamaa/dockermanager/releases)
[![License](https://img.shields.io/github/license/TojiiSamaa/dockermanager?style=flat-square)](LICENSE)

A powerful Stream Deck plugin to manage Docker containers on Unraid/Linux servers with real-time health monitoring.

![Plugin Preview](https://via.placeholder.com/600x300?text=Docker+Manager+Preview)

## Features

- **Real-time Health Monitoring** - Visual status indicators with colored dots:
  - 🟢 Green: Stable (running > 30s)
  - 🟡 Yellow/Pulsing: Starting up
  - 🔴 Red: Stopped
  - 🔴 Blinking: Crash loop detected

- **Container Control** - Start, Stop, Restart, Toggle containers
- **Custom Icons** - Use default letters, custom images, or URL-based icons
- **Background Colors** - Customize button backgrounds
- **Long Press Actions** - Configure different actions for short/long press
- **Container Logs** - View container logs in a browser window
- **URL Actions** - Open URLs on button press
- **Clipboard Actions** - Copy text to clipboard

- **Multiple Connection Methods**:
  - SSH connection (recommended for Unraid)
  - Docker API (TCP) for direct Docker daemon access

## Installation

### From GitHub Releases (Recommended)

1. Go to [Releases](https://github.com/TojiiSamaa/dockermanager/releases)
2. Download the latest `io.deckops.containers.streamDeckPlugin` file
3. Double-click to install
4. Restart Stream Deck if needed

### Build from Source

```bash
# Clone the repository
git clone https://github.com/TojiiSamaa/dockermanager.git
cd dockermanager

# Install dependencies
npm install

# Build the plugin
npm run build

# Package the plugin
npm run pack
```

## Configuration

### 1. Server Connection

1. Add any Docker action to your Stream Deck
2. Click "Configure Server Connection" in the property inspector
3. Choose your connection method:

**SSH (Recommended for Unraid):**
- Host: Your server IP/hostname
- Port: 22 (default)
- Username: root (or your user)
- Authentication: Password or Private Key

**Docker API:**
- Host: Your Docker host
- Port: 2375 (or 2376 for TLS)
- TLS Certificate path (if using TLS)

### 2. Container Actions

1. Click "Refresh Containers" to see available containers
2. Select a container from the list
3. Configure:
   - Display name (optional)
   - Action type (Toggle, Start, Stop, Restart, Status)
   - Long press action (optional)
   - Custom icon and background color
   - Refresh interval

## Actions

| Action | Description |
|--------|-------------|
| **Container Toggle** | Toggle container state, or configure specific actions |
| **Container Logs** | View container logs in browser |
| **Server Settings** | Configure server connection |
| **Debug Logs** | View plugin debug logs |

## Unraid Setup

1. Enable SSH in Unraid Settings → Management Access
2. Use your Unraid root credentials
3. The plugin executes Docker commands securely over SSH

## Roadmap (v2.0)

- [ ] Docker Compose support (up, down, restart stacks)
- [ ] Multi-server support
- [ ] Real-time log streaming with WebSocket
- [ ] Environment variable editor
- [ ] Encrypted credential storage

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development documentation.

### Development Workflows

**Quick iterations (testing):**
- 📝 [PROCESS-ACCELERATED.md](PROCESS-ACCELERATED.md) - Fast workflow for daily development
  - Modify → Build → Package → Test locally
  - Time: 2-5 minutes

**Full release (production):**
- 📋 [PROCESS-STANDARD.md](PROCESS-STANDARD.md) - Complete workflow for public releases
  - Audit → Tests → Build → Package → GitHub → Marketplace
  - Time: 1-2 hours

```bash
# Watch mode (auto-rebuild)
npm run watch

# Build once
npm run build

# Link for development
npm run link

# Package for distribution
npm run pack
```

## Security

- Credentials are stored in Stream Deck's global settings
- SSH connections use the secure ssh2 library
- Consider using SSH keys instead of passwords
- See security considerations in [DEVELOPMENT.md](DEVELOPMENT.md)

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

- Built with [@elgato/streamdeck](https://github.com/elgatosf/streamdeck) SDK
- SSH support via [ssh2](https://github.com/mscdex/ssh2)
