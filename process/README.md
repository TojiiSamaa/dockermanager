# 🚀 Processus de Release

Ce dossier contient la documentation, les scripts et la configuration pour les deux processus de release du plugin Stream Deck Docker Manager.

## 📁 Structure

```
process/
├── scripts/
│   ├── accelerated.cjs          ← Script process rapide
│   └── standard.cjs             ← Script process standard
├── PROCESS-ACCELERATED.md       ← Documentation process rapide
├── PROCESS-STANDARD.md          ← Documentation process standard
├── release-config.json          ← Configuration des releases
└── README.md                    ← Ce fichier
```

**Organisation:**
- `scripts/` - Scripts d'exécution des processus
- Documentation - Guides détaillés de chaque processus
- `release-config.json` - Configuration optionnelle pour automatisation

## 🎯 Deux Processus Disponibles

### Process Accéléré (Recommandé pour développement quotidien)

**Quand l'utiliser:**
- Corrections de bugs
- Petites features
- Développement quotidien
- Tests locaux rapides

**Commande:**
```bash
npm run process:accelerated
```

**Durée:** 2-3 minutes

**Ce qu'il fait:**
1. ✅ Demande ou lit la configuration
2. ✅ Incrémente la version (patch/minor/major)
3. ✅ Build + Package automatique
4. ✅ Commit git avec message détaillé
5. ✅ Push vers GitHub

---

### Process Standard (Pour releases publiques)

**Quand l'utiliser:**
- Releases publiques
- Nouvelles versions majeures
- Upload Marketplace Elgato
- Releases avec tests complets

**Commande:**
```bash
npm run process:standard
```

**Durée:** 10-30 minutes (avec tests)

**Ce qu'il fait:**
1. ✅ Configuration interactive complète
2. ✅ Version bump
3. ✅ Build + Package
4. ✅ Rappel de faire les tests
5. ✅ Git commit + tag
6. ✅ Push commits + tags
7. ✅ GitHub Actions crée la release automatiquement

---

## 📝 Configuration Automatique vs Manuelle

### Option A: Utiliser release-config.json (Recommandé)

Éditez `process/release-config.json` avec vos informations:

```json
{
  "releaseType": "patch",
  "description": "Bug fixes and improvements",
  "changes": [
    "Fixed multi-server connection",
    "Improved log display"
  ],
  "features": [],
  "fixes": [
    "Container logs not displaying"
  ],
  "breaking": [],
  "notes": ""
}
```

Ensuite lancez:
```bash
npm run process:accelerated
```

Le script va lire automatiquement le fichier.

### Option B: Mode Interactif

Lancez simplement:
```bash
npm run process:accelerated
```

Le script va vous demander:
1. Type de release (patch/minor/major)
2. Description
3. Liste des changements
4. Bugs fixés
5. Etc.

---

## 🎨 Configuration des Releases

### Type de Release

- **patch** (2.3.1 → 2.3.2): Bug fixes, petites corrections
- **minor** (2.3.1 → 2.4.0): Nouvelles features
- **major** (2.3.1 → 3.0.0): Breaking changes

### Description

Courte description de ce que fait cette release (1 ligne).

### Changes

Liste des modifications principales:
- Nouvelles features ajoutées
- Bugs corrigés
- Améliorations apportées

### Features (Process Standard uniquement)

Liste spécifique des nouvelles fonctionnalités.

### Fixes (Process Standard uniquement)

Liste spécifique des bugs corrigés.

### Breaking Changes (Process Standard uniquement)

Changements qui cassent la compatibilité avec les versions précédentes.

---

## 📚 Exemples d'Utilisation

### Exemple 1: Correction Rapide de Bug

```bash
# 1. Corriger le bug dans le code
# 2. Éditer process/release-config.json:
{
  "releaseType": "patch",
  "description": "Fixed container logs display issue",
  "changes": ["Fixed logs not showing on correct server"],
  "fixes": ["Container logs connection bug"]
}

# 3. Lancer le process accéléré
npm run process:accelerated

# 4. Installer et tester le plugin
```

### Exemple 2: Nouvelle Feature (Mode Interactif)

```bash
# 1. Implémenter la nouvelle feature
# 2. Lancer le process accéléré
npm run process:accelerated

# 3. Répondre aux questions:
# - Type: minor
# - Description: Add Docker volumes management
# - Changes: Docker volumes action, Volume list display
# - Fixes: (vide)

# 4. Le script fait tout automatiquement
```

### Exemple 3: Release Publique

```bash
# 1. Compléter toutes les features
# 2. Éditer release-config.json avec infos complètes
# 3. Lancer le process standard
npm run process:standard

# 4. Confirmer la configuration
# 5. Tests manuels (le script attend)
# 6. Valider les tests
# 7. Le script commit, tag, et push
# 8. GitHub Actions crée la release
```

---

## 🔄 Workflow Typique

### Développement Quotidien

```
Modifier Code
     ↓
npm run process:accelerated
     ↓
(Config auto OU interactive)
     ↓
Tout automatique!
     ↓
Installer plugin et tester
```

### Release Publique

```
Finaliser Features
     ↓
npm run process:standard
     ↓
Configuration complète
     ↓
Build + Package
     ↓
Tests manuels complets
     ↓
Valider
     ↓
Git commit + tag + push
     ↓
GitHub Release automatique
     ↓
(Optionnel) Upload Marketplace
```

---

## ⚙️ Commandes Rapides

```bash
# Process Accéléré (rapide, quotidien)
npm run process:accelerated

# Process Standard (complet, public)
npm run process:standard

# Build seul (sans release)
npm run build

# Package seul (sans commit)
npm run pack

# Version bump manuel (sans build)
npm run version:patch
npm run version:minor
npm run version:major
```

---

## 🚨 Important

### Process Accéléré
- ✅ Utiliser pour développement quotidien
- ✅ Commit automatique
- ✅ Push automatique
- ❌ Pas de git tag
- ❌ Pas de GitHub Release

### Process Standard
- ✅ Git tag créé
- ✅ Push tags
- ✅ GitHub Actions crée release
- ✅ Tests manuels requis
- ✅ Message de commit détaillé

---

## 📖 Documentation Complète

Pour plus de détails sur chaque processus:

- **Process Accéléré**: Voir [PROCESS-ACCELERATED.md](./PROCESS-ACCELERATED.md)
- **Process Standard**: Voir [PROCESS-STANDARD.md](./PROCESS-STANDARD.md)

---

## 💡 Conseils

1. **Éditez release-config.json** avant chaque release pour éviter le mode interactif
2. **Utilisez process:accelerated** par défaut (95% du temps)
3. **Utilisez process:standard** seulement pour releases publiques importantes
4. **Testez toujours** après installation du plugin
5. **Commitez souvent** avec le process accéléré

---

## 🎯 TL;DR

**Pour 95% des cas (développement):**
```bash
npm run process:accelerated
```

**Pour releases publiques importantes:**
```bash
npm run process:standard
```

C'est tout! 🚀
