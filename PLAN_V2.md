# Docker Manager v2.0 - Plan de Developpement

## Resume des Fonctionnalites

### 1. Icones Dynamiques avec Indicateur de Statut
- Charger dynamiquement l'icone du conteneur (depuis Docker Hub ou image personnalisee)
- Point de couleur en haut a droite pour indiquer l'etat:
  - Vert: Running
  - Rouge: Stopped/Exited
  - Orange: Restarting/Paused
  - Gris: Unknown

### 2. Support Multi-Serveurs
- Configurer plusieurs serveurs Docker
- Selectionner le serveur par action
- Basculer facilement entre serveurs

### 3. Support Docker Compose
- Build: Construire les images
- Up: Demarrer le stack
- Down: Arreter le stack
- Update: Pull + Recreate
- Logs: Voir les logs du stack

### 4. Edition des Variables Compose
- Interface dynamique pour editer les variables d'environnement
- Modifier le fichier .env
- Variables groupees par section

---

## Architecture Technique

### Nouveaux Fichiers

```
src/
├── actions/
│   ├── docker-toggle.ts         (existant, modifier)
│   ├── docker-logs.ts           (existant, modifier)
│   ├── docker-compose.ts        (NOUVEAU)
│   └── docker-compose-vars.ts   (NOUVEAU)
├── services/
│   ├── docker-service.ts        (existant, modifier)
│   ├── settings-manager.ts      (existant, modifier)
│   ├── compose-service.ts       (NOUVEAU)
│   ├── icon-service.ts          (NOUVEAU)
│   └── server-manager.ts        (NOUVEAU)
└── plugin.ts                    (existant, modifier)

io.deckops.containers.sdPlugin/
├── ui/
│   ├── action-pi.html           (existant, modifier)
│   ├── compose-pi.html          (NOUVEAU)
│   ├── compose-vars-pi.html     (NOUVEAU)
│   └── plugin-config.html       (existant, modifier pour multi-serveur)
└── manifest.json                (modifier pour nouvelles actions)
```

---

## Phase 1: Icones Dynamiques

### 1.1 Service d'Icones (icon-service.ts)

```typescript
interface IconConfig {
  source: "dockerhub" | "custom" | "container-icon";
  customUrl?: string;
  fallbackIcon?: string;
}

class IconService {
  // Cache des icones generees
  private iconCache: Map<string, string> = new Map();

  // Generer une icone avec indicateur de statut
  async generateIcon(
    containerName: string,
    state: ContainerState,
    config?: IconConfig
  ): Promise<string> {
    // 1. Obtenir l'icone de base
    const baseIcon = await this.getBaseIcon(containerName, config);

    // 2. Ajouter l'indicateur de statut
    const finalIcon = this.addStatusIndicator(baseIcon, state);

    // 3. Retourner en base64 pour Stream Deck
    return this.toBase64(finalIcon);
  }

  private getStatusColor(state: ContainerState): string {
    switch (state) {
      case "running": return "#4CAF50";    // Vert
      case "stopped":
      case "exited": return "#F44336";      // Rouge
      case "paused":
      case "restarting": return "#FF9800";  // Orange
      default: return "#9E9E9E";            // Gris
    }
  }

  private addStatusIndicator(baseIcon: Buffer, state: ContainerState): Buffer {
    // Utiliser sharp ou canvas pour dessiner le point
    // Position: coin superieur droit
    // Taille: ~20% de l'icone
    // Avec bordure blanche pour visibilite
  }
}
```

### 1.2 Sources d'Icones

1. **Docker Hub**: Recuperer l'icone depuis Docker Hub si disponible
2. **Icons personnalisees**: URL fournie par l'utilisateur
3. **container-icons**: Utiliser le projet open-source container-icons
4. **Fallback**: Generer une icone avec la premiere lettre du nom

### 1.3 Modification du Property Inspector

Ajouter dans action-pi.html:
- Toggle "Utiliser icone dynamique"
- Option source d'icone (Auto/Custom URL)
- Champ URL personnalisee
- Preview de l'icone

---

## Phase 2: Support Multi-Serveurs

### 2.1 Gestionnaire de Serveurs (server-manager.ts)

```typescript
interface Server {
  id: string;           // UUID unique
  name: string;         // Nom affiche (ex: "Unraid Home")
  config: ServerConfig; // Configuration de connexion
  isDefault: boolean;   // Serveur par defaut
}

class ServerManager {
  private servers: Map<string, Server> = new Map();
  private connections: Map<string, DockerService> = new Map();

  // Ajouter un serveur
  addServer(server: Server): void;

  // Supprimer un serveur
  removeServer(id: string): void;

  // Obtenir une connexion
  async getConnection(serverId: string): Promise<DockerService>;

  // Lister tous les serveurs
  listServers(): Server[];
}
```

### 2.2 Modification des Settings

```typescript
interface GlobalSettings {
  servers: Server[];
  defaultServerId?: string;
}

interface ActionSettings {
  serverId?: string;  // Si non specifie, utiliser le default
  containerName: string;
  // ... autres settings
}
```

### 2.3 UI Multi-Serveurs

**plugin-config.html**:
- Liste des serveurs configurés
- Bouton "Ajouter un serveur"
- Editer/Supprimer chaque serveur
- Definir le serveur par defaut

**action-pi.html**:
- Dropdown pour selectionner le serveur
- Option "Serveur par defaut"
- Rafraichir la liste des conteneurs selon le serveur

---

## Phase 3: Docker Compose

### 3.1 Service Compose (compose-service.ts)

```typescript
interface ComposeStack {
  name: string;
  path: string;           // Chemin vers docker-compose.yml
  services: string[];     // Liste des services
  state: "running" | "partial" | "stopped";
}

interface ComposeVariable {
  key: string;
  value: string;
  description?: string;
  section?: string;       // Pour grouper les variables
}

class ComposeService {
  // Lister les stacks (depuis un dossier configure)
  async listStacks(basePath: string): Promise<ComposeStack[]>;

  // Operations sur un stack
  async up(path: string, options?: { build?: boolean }): Promise<boolean>;
  async down(path: string, options?: { volumes?: boolean }): Promise<boolean>;
  async build(path: string): Promise<boolean>;
  async pull(path: string): Promise<boolean>;
  async restart(path: string): Promise<boolean>;

  // Mise a jour (pull + down + up)
  async update(path: string): Promise<boolean>;

  // Logs
  async getLogs(path: string, lines?: number): Promise<string>;

  // Variables d'environnement
  async getEnvVariables(path: string): Promise<ComposeVariable[]>;
  async setEnvVariable(path: string, key: string, value: string): Promise<void>;
  async setEnvVariables(path: string, vars: Record<string, string>): Promise<void>;
}
```

### 3.2 Implementation SSH

```bash
# Lister les stacks (exemple: trouver tous les docker-compose.yml)
find /mnt/user/appdata -name "docker-compose.yml" -o -name "compose.yml"

# Operations
cd /path/to/stack && docker compose up -d
cd /path/to/stack && docker compose down
cd /path/to/stack && docker compose build
cd /path/to/stack && docker compose pull
cd /path/to/stack && docker compose logs --tail=100

# Lire .env
cat /path/to/stack/.env

# Modifier .env (avec sed ou echo)
sed -i 's/^KEY=.*/KEY=new_value/' /path/to/stack/.env
```

### 3.3 Action Docker Compose (docker-compose.ts)

```typescript
interface ComposeSettings {
  serverId?: string;
  stackPath: string;      // Chemin vers le dossier compose
  stackName?: string;     // Nom affiche
  action: "up" | "down" | "restart" | "update" | "build";
  longPressAction?: "up" | "down" | "restart" | "update" | "build";
}

@action({ UUID: "io.deckops.containers.compose" })
export class DockerComposeAction extends SingletonAction<ComposeSettings> {
  // Afficher l'etat du stack (running/stopped/partial)
  // Executer l'action configuree
}
```

### 3.4 UI Compose (compose-pi.html)

- Selecteur de serveur
- Bouton "Scanner les stacks"
- Liste des stacks trouves
- Configuration:
  - Chemin du stack
  - Nom d'affichage
  - Action principale (Up/Down/Restart/Update)
  - Action long press

---

## Phase 4: Edition Variables Compose

### 4.1 Action Variables (docker-compose-vars.ts)

```typescript
interface ComposeVarsSettings {
  serverId?: string;
  stackPath: string;
  variableKey?: string;  // Pour afficher une variable specifique
}

@action({ UUID: "io.deckops.containers.compose-vars" })
export class DockerComposeVarsAction extends SingletonAction<ComposeVarsSettings> {
  // Afficher la valeur actuelle d'une variable
  // Au clic: ouvrir l'editeur de variables
}
```

### 4.2 UI Variables (compose-vars-pi.html)

Interface dynamique avec:
- Liste des variables du fichier .env
- Groupement par section (commentaires # SECTION dans .env)
- Champs editables pour chaque valeur
- Bouton Sauvegarder
- Option "Redemarrer apres modification"

```
+------------------------------------------+
| Variables: my-stack                       |
+------------------------------------------+
| # DATABASE                                |
| ├── DB_HOST:     [ localhost    ]        |
| ├── DB_PORT:     [ 5432         ]        |
| └── DB_NAME:     [ myapp        ]        |
|                                          |
| # APPLICATION                            |
| ├── APP_ENV:     [ production   ]        |
| ├── APP_DEBUG:   [ false        ]        |
| └── APP_URL:     [ https://...  ]        |
|                                          |
| [x] Redemarrer apres sauvegarde          |
| [      Sauvegarder      ]                |
+------------------------------------------+
```

---

## Phase 5: Manifest et Integration

### 5.1 Nouveau manifest.json

```json
{
  "Name": "Docker Manager",
  "Version": "2.0.0.0",
  "Actions": [
    {
      "UUID": "io.deckops.containers.toggle",
      "Name": "Container Control",
      "Icon": "imgs/action-toggle"
    },
    {
      "UUID": "io.deckops.containers.logs",
      "Name": "Container Logs",
      "Icon": "imgs/action-logs"
    },
    {
      "UUID": "io.deckops.containers.compose",
      "Name": "Compose Stack",
      "Tooltip": "Control Docker Compose stacks",
      "Icon": "imgs/action-compose"
    },
    {
      "UUID": "io.deckops.containers.compose-vars",
      "Name": "Compose Variables",
      "Tooltip": "Edit Docker Compose environment variables",
      "Icon": "imgs/action-vars"
    }
  ]
}
```

---

## Dependances Additionnelles

```json
{
  "dependencies": {
    "sharp": "^0.33.0",    // Pour manipulation d'images (icones)
    "canvas": "^2.11.0"    // Alternative a sharp si besoin
  }
}
```

Note: sharp peut etre problematique avec le packaging Stream Deck.
Alternative: generer les icones cote serveur via SSH et les envoyer en base64.

---

## Ordre d'Implementation Suggere

1. **Phase 1.1**: Indicateur de statut simple (point colore)
2. **Phase 2.1**: Multi-serveurs (base)
3. **Phase 3.1**: Docker Compose basique (up/down)
4. **Phase 1.2**: Icones dynamiques completes
5. **Phase 2.2**: UI multi-serveurs complete
6. **Phase 3.2**: Compose avance (build/update/logs)
7. **Phase 4**: Edition variables

---

## Risques et Considerations

1. **Performance**:
   - Cache des icones pour eviter regeneration
   - Connexions SSH persistantes
   - Debounce des rafraichissements

2. **Securite**:
   - Variables sensibles dans .env
   - Stockage securise des credentials

3. **Compatibilite**:
   - sharp/canvas avec electron/node du Stream Deck
   - Differentes versions de Docker Compose (v1 vs v2)

4. **UX**:
   - Feedback clair pendant les operations longues
   - Gestion des erreurs comprehensible

---

## Timeline Estimee

- Phase 1 (Icones): 2-3 sessions
- Phase 2 (Multi-serveurs): 2 sessions
- Phase 3 (Compose): 3-4 sessions
- Phase 4 (Variables): 2 sessions

Total: ~10 sessions de developpement
