# Docker Stream Deck Plugin - Feature Roadmap

## Overview

This document outlines all Docker capabilities that can be managed via a Stream Deck plugin. Each feature is categorized by functionality, with details on the Docker CLI command, Stream Deck feasibility, and implementation priority.

### Feasibility Legend

| Rating | Description |
|--------|-------------|
| **Single Button** | Can be executed with a single button press |
| **Button + Config** | Requires pre-configuration in Property Inspector, then single button execution |
| **Multi-Step** | Requires multiple interactions or complex UI |
| **Display Only** | Information display on button (title/icon updates) |
| **Not Recommended** | Too complex or dangerous for single-button execution |

### Priority Legend

| Priority | Description |
|----------|-------------|
| **High** | Core functionality, implement first |
| **Medium** | Important features, implement in second phase |
| **Low** | Nice-to-have features, implement if time permits |

---

## 1. Container Management

Core container lifecycle operations - the most essential features for a Docker Stream Deck plugin.

| Feature | Docker CLI Command | Feasibility | Priority | Notes |
|---------|-------------------|-------------|----------|-------|
| **Start Container** | `docker start <container>` | Button + Config | **High** | Pre-configure container name/ID in Property Inspector |
| **Stop Container** | `docker stop <container>` | Button + Config | **High** | Pre-configure container; optional timeout flag |
| **Restart Container** | `docker restart <container>` | Button + Config | **High** | Combines stop + start; very useful for quick restarts |
| **Kill Container** | `docker kill <container>` | Button + Config | **High** | Immediate stop (SIGKILL); useful for hung containers |
| **Pause Container** | `docker pause <container>` | Button + Config | **Medium** | Freezes processes without termination |
| **Unpause Container** | `docker unpause <container>` | Button + Config | **Medium** | Resumes paused container |
| **Toggle Container** | `docker start/stop` (conditional) | Button + Config | **High** | Smart toggle based on current state |
| **Rename Container** | `docker rename <old> <new>` | Multi-Step | **Low** | Requires text input for new name |
| **Remove Container** | `docker rm <container>` | Button + Config | **Medium** | Should require confirmation or only work on stopped containers |
| **Prune Stopped Containers** | `docker container prune -f` | Single Button | **Medium** | Removes all stopped containers; use with caution |
| **Create Container** | `docker create <image>` | Multi-Step | **Low** | Too many options for simple button |
| **Run Container** | `docker run <image>` | Button + Config | **Medium** | Pre-configure image and common flags |

### Container Management - Recommended Actions

```
Primary Actions (Phase 1):
- Start/Stop/Restart single container (with pre-configured container)
- Toggle container state (smart start/stop)
- Kill container (for emergencies)

Secondary Actions (Phase 2):
- Pause/Unpause container
- Remove stopped container
- Prune all stopped containers
```

---

## 2. Container Information

Commands for viewing container status, logs, and metrics.

| Feature | Docker CLI Command | Feasibility | Priority | Notes |
|---------|-------------------|-------------|----------|-------|
| **View Logs** | `docker logs <container>` | Button + Config | **High** | Open logs in terminal/popup; configurable tail lines |
| **Follow Logs** | `docker logs -f <container>` | Button + Config | **Medium** | Opens streaming log view |
| **Container Stats** | `docker stats <container>` | Display Only | **High** | Show CPU/Memory on button; real-time updates |
| **All Container Stats** | `docker stats` | Display Only | **Medium** | Overview dashboard |
| **Top Processes** | `docker top <container>` | Button + Config | **Medium** | Shows running processes in container |
| **Inspect Container** | `docker inspect <container>` | Button + Config | **Low** | Opens detailed JSON view; too verbose for button |
| **Container Diff** | `docker diff <container>` | Button + Config | **Low** | Shows filesystem changes |
| **Export Container** | `docker export <container>` | Button + Config | **Low** | Exports as tar; requires file path |
| **Container Health** | `docker inspect --format='{{.State.Health.Status}}'` | Display Only | **High** | Show health status on button icon |
| **Container Status** | `docker inspect --format='{{.State.Status}}'` | Display Only | **High** | Show running/stopped/paused status |

### Container Info - Recommended Actions

```
Primary Actions (Phase 1):
- Container status display (running/stopped indicator)
- Quick stats display (CPU/Memory percentage)
- Open logs in terminal

Secondary Actions (Phase 2):
- Health check status indicator
- Follow logs (streaming)
- Top processes view
```

---

## 3. Image Management

Docker image operations for pulling, building, and managing images.

| Feature | Docker CLI Command | Feasibility | Priority | Notes |
|---------|-------------------|-------------|----------|-------|
| **Pull Image** | `docker pull <image>` | Button + Config | **High** | Pre-configure image name; show progress |
| **Pull Latest** | `docker pull <image>:latest` | Button + Config | **High** | Quick update to latest version |
| **Push Image** | `docker push <image>` | Button + Config | **Medium** | Requires registry authentication |
| **Build Image** | `docker build -t <tag> <path>` | Button + Config | **Medium** | Pre-configure Dockerfile path and tag |
| **Tag Image** | `docker tag <source> <target>` | Multi-Step | **Low** | Requires two image references |
| **Remove Image** | `docker rmi <image>` | Button + Config | **Medium** | Pre-configure image; may fail if in use |
| **Prune Dangling Images** | `docker image prune -f` | Single Button | **High** | Removes untagged images |
| **Prune All Unused Images** | `docker image prune -a -f` | Single Button | **Medium** | More aggressive; removes all unused |
| **Image History** | `docker history <image>` | Button + Config | **Low** | Shows image layers |
| **Inspect Image** | `docker image inspect <image>` | Button + Config | **Low** | Detailed image metadata |
| **List Images** | `docker images` | Display Only | **Medium** | Could show count on button |

### Image Management - Recommended Actions

```
Primary Actions (Phase 1):
- Pull specific image (pre-configured)
- Prune dangling images
- Image count display

Secondary Actions (Phase 2):
- Build image from Dockerfile
- Remove specific image
- Prune all unused images
```

---

## 4. Network Management

Docker network creation, connection, and management.

| Feature | Docker CLI Command | Feasibility | Priority | Notes |
|---------|-------------------|-------------|----------|-------|
| **Create Network** | `docker network create <name>` | Button + Config | **Medium** | Pre-configure name and driver |
| **Create Bridge Network** | `docker network create -d bridge <name>` | Button + Config | **Medium** | Default network type |
| **Create Overlay Network** | `docker network create -d overlay <name>` | Button + Config | **Low** | For Swarm mode |
| **Create Macvlan Network** | `docker network create -d macvlan <name>` | Multi-Step | **Low** | Requires subnet/gateway config |
| **Remove Network** | `docker network rm <network>` | Button + Config | **Medium** | Pre-configure network name |
| **Connect Container** | `docker network connect <net> <container>` | Button + Config | **Medium** | Pre-configure both parameters |
| **Disconnect Container** | `docker network disconnect <net> <container>` | Button + Config | **Medium** | Pre-configure both parameters |
| **Inspect Network** | `docker network inspect <network>` | Button + Config | **Low** | Shows network details |
| **Prune Networks** | `docker network prune -f` | Single Button | **Medium** | Removes unused networks |
| **List Networks** | `docker network ls` | Display Only | **Low** | Could show count on button |

### Network Management - Recommended Actions

```
Primary Actions (Phase 1):
- Prune unused networks
- Network count display

Secondary Actions (Phase 2):
- Create pre-configured network
- Connect/disconnect container to network
- Remove specific network
```

---

## 5. Volume Management

Persistent data volume operations.

| Feature | Docker CLI Command | Feasibility | Priority | Notes |
|---------|-------------------|-------------|----------|-------|
| **Create Volume** | `docker volume create <name>` | Button + Config | **Medium** | Pre-configure volume name |
| **Remove Volume** | `docker volume rm <volume>` | Button + Config | **Medium** | Must not be in use |
| **Prune Volumes** | `docker volume prune -f` | Single Button | **Medium** | Removes unused volumes; **CAUTION: data loss** |
| **Inspect Volume** | `docker volume inspect <volume>` | Button + Config | **Low** | Shows mount point and metadata |
| **List Volumes** | `docker volume ls` | Display Only | **Low** | Could show count on button |

### Volume Management - Recommended Actions

```
Primary Actions (Phase 1):
- Volume count display
- Prune unused volumes (with warning)

Secondary Actions (Phase 2):
- Create named volume
- Remove specific volume
```

---

## 6. Docker Compose

Multi-container application management with Docker Compose.

| Feature | Docker CLI Command | Feasibility | Priority | Notes |
|---------|-------------------|-------------|----------|-------|
| **Compose Up** | `docker compose up -d` | Button + Config | **High** | Pre-configure compose file path |
| **Compose Down** | `docker compose down` | Button + Config | **High** | Stops and removes containers |
| **Compose Down + Volumes** | `docker compose down -v` | Button + Config | **Medium** | Also removes volumes; use with caution |
| **Compose Restart** | `docker compose restart` | Button + Config | **High** | Restarts all services |
| **Compose Restart Service** | `docker compose restart <service>` | Button + Config | **High** | Restart specific service |
| **Compose Pull** | `docker compose pull` | Button + Config | **High** | Pull latest images for all services |
| **Compose Build** | `docker compose build` | Button + Config | **Medium** | Rebuild all services |
| **Compose Build Service** | `docker compose build <service>` | Button + Config | **Medium** | Rebuild specific service |
| **Compose Logs** | `docker compose logs` | Button + Config | **High** | View combined logs |
| **Compose Logs Service** | `docker compose logs <service>` | Button + Config | **High** | View specific service logs |
| **Compose PS** | `docker compose ps` | Display Only | **Medium** | Show running services count |
| **Compose Exec** | `docker compose exec <service> <cmd>` | Multi-Step | **Low** | Requires command input |
| **Compose Scale** | `docker compose up -d --scale <service>=N` | Button + Config | **Low** | Pre-configure service and replica count |
| **Compose Stop** | `docker compose stop` | Button + Config | **Medium** | Stops without removing |
| **Compose Start** | `docker compose start` | Button + Config | **Medium** | Starts stopped services |

### Docker Compose - Recommended Actions

```
Primary Actions (Phase 1):
- Compose Up (start stack)
- Compose Down (stop stack)
- Compose Restart (restart stack)
- Compose Pull (update images)
- Compose Logs (view logs)

Secondary Actions (Phase 2):
- Restart specific service
- Build/rebuild services
- Service-specific logs
- Compose PS status display
```

---

## 7. Docker Swarm

Orchestration features for Docker Swarm mode (optional advanced feature).

| Feature | Docker CLI Command | Feasibility | Priority | Notes |
|---------|-------------------|-------------|----------|-------|
| **List Services** | `docker service ls` | Display Only | **Medium** | Show service count/status |
| **Scale Service** | `docker service scale <service>=N` | Button + Config | **Medium** | Pre-configure service and replica count |
| **Service Logs** | `docker service logs <service>` | Button + Config | **Medium** | View service logs |
| **Update Service** | `docker service update <service>` | Button + Config | **Low** | Many options; complex |
| **Remove Service** | `docker service rm <service>` | Button + Config | **Low** | Remove a service |
| **List Nodes** | `docker node ls` | Display Only | **Low** | Show cluster nodes |
| **Node Status** | `docker node inspect <node>` | Display Only | **Low** | Show node availability |
| **Deploy Stack** | `docker stack deploy -c <file> <name>` | Button + Config | **Medium** | Pre-configure stack file |
| **Remove Stack** | `docker stack rm <stack>` | Button + Config | **Medium** | Remove entire stack |
| **List Stacks** | `docker stack ls` | Display Only | **Low** | Show deployed stacks |
| **Stack Services** | `docker stack services <stack>` | Display Only | **Low** | Show stack services |

### Docker Swarm - Recommended Actions

```
Primary Actions (if implementing Swarm):
- Deploy stack
- Remove stack
- Scale service
- Service status display

Secondary Actions:
- Service logs
- Node status overview
```

---

## 8. System Operations

Docker system-wide commands for monitoring and maintenance.

| Feature | Docker CLI Command | Feasibility | Priority | Notes |
|---------|-------------------|-------------|----------|-------|
| **System Info** | `docker system info` | Button + Config | **Low** | Opens detailed system info |
| **Docker Version** | `docker version` | Display Only | **Low** | Show version on button |
| **Disk Usage** | `docker system df` | Display Only | **High** | Show disk usage summary |
| **Disk Usage Detailed** | `docker system df -v` | Button + Config | **Medium** | Opens detailed breakdown |
| **System Events** | `docker events` | Button + Config | **Low** | Opens event stream |
| **Prune All** | `docker system prune -f` | Single Button | **High** | Prune containers, networks, images |
| **Prune All + Volumes** | `docker system prune -a --volumes -f` | Single Button | **Medium** | **EXTREME CAUTION**: removes everything unused |
| **Prune Build Cache** | `docker builder prune -f` | Single Button | **Medium** | Clear build cache |

### System Operations - Recommended Actions

```
Primary Actions (Phase 1):
- Disk usage display
- System prune (without volumes)
- Build cache prune

Secondary Actions (Phase 2):
- Full system prune (with confirmation)
- Disk usage detailed view
- Event stream viewer
```

---

## Implementation Phases

### Phase 1: Core Features (MVP)

Essential features for initial release:

#### Container Actions
- [ ] Start container (pre-configured)
- [ ] Stop container (pre-configured)
- [ ] Restart container (pre-configured)
- [ ] Toggle container state
- [ ] Container status indicator (running/stopped icon)

#### Docker Compose Actions
- [ ] Compose Up
- [ ] Compose Down
- [ ] Compose Restart
- [ ] Compose Pull

#### Quick Actions
- [ ] View container logs
- [ ] Container stats display (CPU/Memory)
- [ ] Prune dangling images
- [ ] System prune

### Phase 2: Extended Features

Additional useful features:

#### Container Actions
- [ ] Kill container
- [ ] Pause/Unpause container
- [ ] Remove container
- [ ] Prune stopped containers
- [ ] Container health status

#### Image Actions
- [ ] Pull specific image
- [ ] Build image
- [ ] Prune all unused images
- [ ] Remove specific image

#### Compose Actions
- [ ] Restart specific service
- [ ] Service-specific logs
- [ ] Compose build
- [ ] Compose PS status

#### System Actions
- [ ] Disk usage display
- [ ] Build cache prune
- [ ] Full system prune

### Phase 3: Advanced Features

Power user features:

#### Network/Volume Management
- [ ] Prune networks
- [ ] Prune volumes
- [ ] Create network
- [ ] Create volume

#### Swarm Features (if applicable)
- [ ] Deploy stack
- [ ] Remove stack
- [ ] Scale service
- [ ] Service status

#### Advanced Monitoring
- [ ] Follow logs (streaming)
- [ ] Event stream
- [ ] Multi-container stats dashboard

---

## Stream Deck Action Types

### Key Press Actions
Most Docker commands work well as key press actions:
- Single press to execute command
- Use `onKeyDown` event handler
- Show feedback via title/icon change

### Long Press Actions
Potentially useful for dangerous operations:
- Normal press: Show confirmation
- Long press: Execute with caution

### Toggle Actions
Perfect for container state management:
- Running state: Green icon, shows "Stop" action
- Stopped state: Red icon, shows "Start" action

### Status Display Actions
For monitoring without interaction:
- Update icon/title periodically
- Show container status, stats, health
- Use timer-based polling

---

## Property Inspector Configuration

Each action should support configuration via Property Inspector UI:

### Container Actions
- Container name/ID (dropdown or text input)
- Container selection method (name, ID, label filter)
- Timeout settings
- Confirmation toggle

### Compose Actions
- Compose file path
- Working directory
- Project name
- Service filter

### Image Actions
- Image name:tag
- Registry URL
- Build context path
- Dockerfile path

### System Actions
- Prune filters (age, label)
- Confirmation requirements
- Verbose output toggle

---

## Safety Considerations

### Dangerous Commands (Require Confirmation)
- `docker system prune -a --volumes`
- `docker volume prune`
- `docker rm -f`
- `docker compose down -v`

### Recommended Safety Features
1. Confirmation dialogs for destructive operations
2. Visual indicators for dangerous actions (red icons)
3. Settings to disable destructive commands
4. Audit log of executed commands
5. Dry-run mode for testing

---

## Technical Requirements

### Docker Integration
- Docker CLI or Docker API via SDK
- Socket connection for real-time stats
- Event stream subscription for status updates

### Stream Deck SDK
- Node.js 20+ required
- SingletonAction class for each command type
- Property Inspector for configuration
- WebSocket communication for real-time updates

### Platform Considerations
- Windows: Named pipe `//./pipe/docker_engine`
- macOS/Linux: Unix socket `/var/run/docker.sock`
- Docker Desktop API availability

---

## References

- [Docker CLI Reference](https://docs.docker.com/reference/cli/docker/)
- [Docker Compose Reference](https://docs.docker.com/reference/cli/docker/compose/)
- [Docker Container Commands](https://docs.docker.com/reference/cli/docker/container/)
- [Docker Image Commands](https://docs.docker.com/reference/cli/docker/image/)
- [Docker Network Commands](https://docs.docker.com/reference/cli/docker/network/)
- [Docker Volume Commands](https://docs.docker.com/reference/cli/docker/volume/)
- [Docker System Commands](https://docs.docker.com/reference/cli/docker/system/)
- [Docker Swarm Services](https://docs.docker.com/engine/swarm/services/)
- [Stream Deck SDK - Actions](https://docs.elgato.com/streamdeck/sdk/guides/actions/)
- [Stream Deck SDK - Property Inspectors](https://docs.elgato.com/streamdeck/sdk/guides/ui/)
- [Stream Deck SDK - Settings](https://docs.elgato.com/streamdeck/sdk/guides/settings/)

---

## Summary Statistics

| Category | Total Commands | High Priority | Medium Priority | Low Priority |
|----------|---------------|---------------|-----------------|--------------|
| Container Management | 12 | 5 | 4 | 3 |
| Container Info | 10 | 4 | 3 | 3 |
| Image Management | 11 | 3 | 4 | 4 |
| Network Management | 10 | 0 | 6 | 4 |
| Volume Management | 5 | 0 | 3 | 2 |
| Docker Compose | 15 | 6 | 5 | 4 |
| Docker Swarm | 11 | 0 | 4 | 7 |
| System Operations | 8 | 2 | 4 | 2 |
| **Total** | **82** | **20** | **33** | **29** |

---

*Document generated for Stream Deck Docker Plugin development*
*Last updated: January 2026*
