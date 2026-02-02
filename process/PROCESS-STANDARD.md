# Process Standard - Stream Deck Docker Plugin

**Objectif:** Release complète → Tests → Build → Package → Upload Marketplace Elgato

**Quand utiliser:** Releases publiques, versions majeures, soumissions marketplace

---

## 🔄 Process Accéléré vs Standard

**Vous cherchez le processus rapide pour développement quotidien?**
→ Voir **PROCESS-ACCELERATED.md** (une seule commande: `npm run release`)

**Ce document (Process Standard)** est pour les releases publiques officielles avec tests complets, audit sécurité, et upload marketplace.

---

## 🔧 Scripts Disponibles

Ce process utilise les scripts de version management:

```bash
# Gestion de version (automatique)
npm run version:patch    # 2.3.1 → 2.3.2
npm run version:minor    # 2.3.1 → 2.4.0
npm run version:major    # 2.3.1 → 3.0.0

# Build & Package
npm run build           # Compile TypeScript
npm run pack            # Build + Package plugin
```

**Note:** Le process standard est **manuel** et donne le contrôle total sur chaque étape. Pour automatisation complète, voir PROCESS-ACCELERATED.md.

---

## 📋 Checklist Complète

**Phase 1: Préparation**
- [ ] 1. Audit code & sécurité
- [ ] 2. Tests unitaires
- [ ] 3. Tests fonctionnels
- [ ] 4. Vérification i18n

**Phase 2: Build & Package**
- [ ] 5. Update version dans manifest.json
- [ ] 6. Build le projet
- [ ] 7. Créer le plugin .streamDeckPlugin
- [ ] 8. Tests finaux

**Phase 3: Release**
- [ ] 9. Git commit & tag
- [ ] 10. GitHub Release
- [ ] 11. Upload Elgato Marketplace

**Temps estimé:** 1-2 heures

---

## 📝 Phase 1: Préparation

### **1. Audit Code & Sécurité**

**Analyser le code:**
```bash
# Utiliser l'agent Explore de Claude pour audit complet
# Vérifier:
# - Injections de commandes
# - Credentials en clair
# - Fuites mémoire
# - Type safety
```

**Checklist sécurité:**
- [ ] Toutes les commandes shell utilisent `shell-escape.ts`
- [ ] Credentials chiffrés dans backup (encryption.ts)
- [ ] Pas de logs de credentials/keys
- [ ] Validation de tous les inputs utilisateur
- [ ] URLs et clipboard sanitisés

**Fichiers critiques à vérifier:**
- `src/services/docker-service.ts` - Commandes Docker
- `src/services/settings-manager.ts` - Credentials storage
- `src/actions/docker-toggle.ts` - URL/clipboard operations
- `src/services/compose-service.ts` - Path injection

---

### **2. Tests Unitaires**

**Lancer les tests de connexion:**
```typescript
// Dans Node.js REPL ou script de test
import { runAllConnectionTests } from "./src/tests/connection.test";

const config = {
  connectionType: "ssh",
  sshHost: "YOUR_TEST_SERVER",
  sshUsername: "root",
  sshKeyPath: "~/.ssh/id_rsa"
};

await runAllConnectionTests(config);
```

**Résultat attendu:**
- ✅ SSH Connection: PASSED
- ✅ Backup Address Failover: PASSED (si configuré)

---

### **3. Tests Fonctionnels**

**Lancer les tests fonctionnels:**
```typescript
import { runAllFunctionalityTests } from "./src/tests/functionality.test";

await runAllFunctionalityTests(config, "test-container-name");
```

**Résultat attendu:**
- ✅ List Containers: PASSED
- ✅ Get Container State: PASSED
- ✅ Get Container Health: PASSED
- ✅ Start/Stop Cycle: PASSED
- ✅ Get Container Logs: PASSED

**Tests manuels:**
- [ ] Tester chaque action dans Stream Deck
- [ ] Vérifier toutes les Property Inspectors
- [ ] Tester multi-serveurs
- [ ] Tester Docker Compose operations
- [ ] Tester animations & icônes

---

### **4. Vérification i18n**

**Si i18n activé:**
- [ ] Tous les strings traduits (français + anglais)
- [ ] Pas de strings hardcodés dans les actions
- [ ] Tester avec `i18n.setLanguage("fr")` et `i18n.setLanguage("en")`

---

## 📝 Phase 2: Build & Package

### **5. Update Version**

**Utiliser le script automatique:**

```bash
# Pour une nouvelle feature (Minor)
npm run version:minor    # 2.3.1 → 2.4.0

# Pour un bug fix (Patch)
npm run version:patch    # 2.3.1 → 2.3.2

# Pour breaking changes (Major)
npm run version:major    # 2.3.1 → 3.0.0
```

**Ce que ça fait:**
- ✅ Met à jour `package.json` (ex: 2.4.0)
- ✅ Met à jour `manifest.json` (ex: 2.4.0.0)
- ✅ Synchronise automatiquement les deux fichiers

**Source de vérité:** `package.json` est la source de vérité. Le script synchronise automatiquement vers `manifest.json`.

**Versioning:**
- **Major.Minor.Patch** (ex: 2.4.0)
- Major: Breaking changes
- Minor: Nouvelles features
- Patch: Bug fixes

---

### **6. Build le Projet**

```bash
cd z:\apps\streamdeck-docker
npm run build
```

**Vérifications:**
- ✅ Pas d'erreurs TypeScript
- ✅ Fichier créé: `io.deckops.containers.sdPlugin/bin/plugin.js`
- ✅ Taille raisonnable (~2.7 MB)

---

### **7. Créer le Plugin**

```bash
npm run pack
```

**Vérifications:**
- ✅ Fichier créé: `io.deckops.containers.streamDeckPlugin`
- ✅ Version correcte affichée
- ✅ Taille ~3.0 MB
- ✅ 47+ fichiers packagés

**Renommer pour release:**
```bash
# Optionnel: renommer avec version
cp io.deckops.containers.streamDeckPlugin releases/docker-manager-v2.4.0.streamDeckPlugin
```

---

### **8. Tests Finaux**

**Installation propre:**
1. Désinstaller ancienne version du plugin
2. Installer nouvelle version (double-click)
3. Redémarrer Stream Deck

**Tests complets:**
- [ ] Toutes les actions fonctionnent
- [ ] Settings persistent après redémarrage
- [ ] Credentials chiffrés dans backup file
- [ ] Logs propres (pas d'erreurs critiques)
- [ ] Performance acceptable (pas de lag)

**Vérifier logs:**
```
Windows: %APPDATA%\Elgato\StreamDeck\logs\io.deckops.containers.log
macOS: ~/Library/Logs/ElgatoStreamDeck/
```

---

## 📝 Phase 3: Release

### **9. Git Commit & Tag**

**Vérifier la version actuelle:**
```bash
# La version est dans package.json et manifest.json
# Vérifier avec:
cat package.json | grep version
```

**Commit les changements:**
```bash
git add -A
git commit -m "Release v2.4.0: [description des changements]

- Nouvelle feature X
- Fix bug Y
- Amélioration sécurité Z

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Créer un tag:**
```bash
# Utiliser la version de package.json (ex: 2.4.0)
git tag -a v2.4.0 -m "Release v2.4.0"
git push origin main
git push origin v2.4.0
```

**Note:** Les scripts de version management (`npm run version:*`) mettent à jour les versions mais NE committent PAS automatiquement dans le process standard. C'est intentionnel pour vous laisser le contrôle complet.

---

### **10. GitHub Release**

**Via GitHub Actions (automatique):**
- Le push du tag déclenche le workflow `.github/workflows/release.yml`
- Crée automatiquement une release GitHub
- Attache le fichier `.streamDeckPlugin`

**OU manuellement:**
1. Aller sur https://github.com/YOUR_USERNAME/streamdeck-docker/releases
2. Click "Draft a new release"
3. Remplir:
   - **Tag version:** v2.4.0
   - **Release title:** Docker Manager v2.4.0
   - **Description:** Release notes (voir template ci-dessous)
   - **Attach files:** `io.deckops.containers.streamDeckPlugin`
4. Click "Publish release"

**Template Release Notes:**
```markdown
# Docker Manager v2.4.0

## 🎉 What's New

- 🔒 Improved security with command injection prevention
- 🌍 Internationalization support (French/English)
- 🎨 New icon library with 12 optimized SVG icons
- ✅ Added automated tests (connection + functionality)

## 🔧 Improvements

- Enhanced encryption for SSH keys and passwords
- Better error handling and logging
- Performance optimizations for large container lists

## 🐛 Bug Fixes

- Fixed clipboard injection vulnerability
- Fixed URL opening security issue
- Fixed memory leaks in animations

## 📦 Installation

Download `io.deckops.containers.streamDeckPlugin` and double-click to install.

## 🔗 Links

- [Documentation](https://github.com/YOUR_USERNAME/streamdeck-docker)
- [Report Issues](https://github.com/YOUR_USERNAME/streamdeck-docker/issues)
```

---

### **11. Upload Elgato Marketplace**

**Prérequis:**
- [ ] Compte développeur Elgato
- [ ] Plugin testé et fonctionnel
- [ ] Screenshots/vidéo pour le marketplace
- [ ] Description du plugin en anglais

**Étapes:**

1. **Se connecter au Marketplace Developer Portal**
   - URL: https://marketplace.elgato.com/developer
   - Login avec compte Elgato

2. **Créer ou Modifier le Plugin**
   - Click "My Plugins"
   - Click "Edit" (ou "Create New Plugin" si première fois)

3. **Remplir les informations:**

   **Basic Information:**
   - **Name:** Docker Manager
   - **UUID:** io.deckops.containers
   - **Version:** 2.4.0.0
   - **Short Description:** Manage Docker containers from Stream Deck
   - **Full Description:**
     ```
     Docker Manager allows you to control Docker containers directly from your Stream Deck.

     Features:
     - Start/Stop/Restart containers
     - View real-time container status
     - Stream container logs
     - Manage Docker Compose stacks
     - Multi-server support
     - SSH and Docker API connections

     Perfect for DevOps, developers, and system administrators who want quick access to their Docker infrastructure.
     ```

   **Categories:**
   - Development Tools
   - System Utilities

   **Screenshots:**
   - Upload au moins 3 screenshots
   - Taille recommandée: 1920x1080 ou 1280x720
   - Montrer: actions disponibles, Property Inspector, exemples d'usage

   **Plugin File:**
   - Upload `io.deckops.containers.streamDeckPlugin`

   **Requirements:**
   - **Minimum Stream Deck Version:** 6.5
   - **OS:** Windows 10+, macOS 10.15+
   - **External Requirements:** Docker installation (SSH or Docker API access)

   **Privacy Policy & Terms:**
   - Link vers privacy policy (si applicable)
   - Confirmer que le plugin respecte les guidelines Elgato

4. **Validation:**
   - Elgato review le plugin (peut prendre 1-2 semaines)
   - Recevoir email de confirmation ou demande de corrections

5. **Publication:**
   - Une fois approuvé, le plugin est publié sur le marketplace
   - Les utilisateurs peuvent l'installer depuis Stream Deck

**Notes importantes:**
- ⚠️ Le plugin doit respecter les [Elgato Plugin Guidelines](https://docs.elgato.com/sdk/plugins/guidelines)
- ⚠️ Pas de credentials hardcodés dans le code
- ⚠️ Documentation claire pour la configuration
- ⚠️ Gestion d'erreur gracieuse (pas de crashes)

---

## 📊 Post-Release

**Monitoring:**
- [ ] Vérifier les downloads sur marketplace
- [ ] Monitorer les issues GitHub
- [ ] Répondre aux questions utilisateurs
- [ ] Collecter feedback pour prochaine version

**Changelog:**
- [ ] Mettre à jour CHANGELOG.md avec les changements
- [ ] Documenter les breaking changes (si applicable)

---

## 🔄 Workflow Complet

```
┌─────────────────┐
│  1. Audit Code  │
└────────┬────────┘
         ↓
┌─────────────────┐
│  2. Tests Auto  │ (connection.test + functionality.test)
└────────┬────────┘
         ↓
┌─────────────────┐
│  3. Tests Manu  │ (toutes les actions dans Stream Deck)
└────────┬────────┘
         ↓
┌─────────────────┐
│  4. Update Ver  │ (manifest.json + package.json)
└────────┬────────┘
         ↓
┌─────────────────┐
│  5. Build       │ (npm run build)
└────────┬────────┘
         ↓
┌─────────────────┐
│  6. Package     │ (npm run pack)
└────────┬────────┘
         ↓
┌─────────────────┐
│  7. Test Final  │ (installation propre + tests)
└────────┬────────┘
         ↓
┌─────────────────┐
│  8. Git + Tag   │ (commit, tag v2.4.0, push)
└────────┬────────┘
         ↓
┌─────────────────┐
│  9. GitHub Rel  │ (automatic via workflow OU manual)
└────────┬────────┘
         ↓
┌─────────────────┐
│ 10. Upload Mkt  │ (marketplace.elgato.com)
└────────┬────────┘
         ↓
┌─────────────────┐
│ 11. Monitoring  │ (issues, feedback, downloads)
└─────────────────┘
```

---

## 🚨 Checklist Finale Avant Upload

- [ ] Version incrémentée correctement
- [ ] Tous les tests passent (auto + manuels)
- [ ] Pas d'erreurs dans les logs Stream Deck
- [ ] Documentation à jour (README, CLAUDE.md)
- [ ] Screenshots/vidéo pour marketplace préparés
- [ ] Git commit + tag créés
- [ ] GitHub release publiée
- [ ] Plugin testé sur installation propre
- [ ] Credentials chiffrés, pas de secrets en clair
- [ ] Performance acceptable (pas de lag)

---

## 📚 Ressources

**Documentation Elgato:**
- [Plugin Guidelines](https://docs.elgato.com/sdk/plugins/guidelines)
- [Marketplace Developer Portal](https://marketplace.elgato.com/developer)
- [Stream Deck SDK](https://docs.elgato.com/sdk/)

**GitHub Actions:**
- Workflow: `.github/workflows/release.yml`
- Automatise build + release sur tag push

**Tests:**
- Connection: `src/tests/connection.test.ts`
- Functionality: `src/tests/functionality.test.ts`

---

## 🎯 Différence avec Process Accéléré

| Aspect | Process Accéléré | Process Standard |
|--------|------------------|------------------|
| **Objectif** | Test local rapide | Release publique |
| **Durée** | 2-5 min | 1-2 heures |
| **Tests** | Manuels basiques | Auto + Manuels complets |
| **Sécurité** | Vérification basique | Audit complet |
| **Git** | Optionnel | Obligatoire (commit + tag) |
| **Release** | Non | Oui (GitHub + Marketplace) |

**Quand utiliser lequel:**
- **Accéléré:** Développement quotidien, corrections rapides
- **Standard:** Releases publiques, versions majeures
