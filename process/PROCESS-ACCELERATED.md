# Process Accéléré - Stream Deck Docker Plugin

**Objectif:** Modifications rapides → Version bump automatique → Build → Package → Git commit/push → Tests locaux

**Quand utiliser:** Développement quotidien, corrections rapides, ajout de features

---

## ⚡ TL;DR - Une Seule Commande!

```bash
npm run release
```

Ça fait **TOUT AUTOMATIQUEMENT**:
- ✅ Incrémente la version (2.3.1 → 2.3.2)
- ✅ Synchronise package.json + manifest.json
- ✅ Build TypeScript → JavaScript
- ✅ Package le plugin .streamDeckPlugin
- ✅ Git add + commit + push

**Temps estimé:** 2-3 minutes

---

## 📝 Processus Automatisé Détaillé

### **Option 1: Release Patch (Bug Fixes) - RECOMMANDÉ**

```bash
npm run release
```

**Ce que ça fait:**
1. Incrémente version **PATCH** (2.3.1 → 2.3.2)
2. Met à jour package.json (2.3.2) et manifest.json (2.3.2.0)
3. Build le projet (`npm run build`)
4. Package le plugin (`streamdeck pack`)
5. Stage tous les fichiers (`git add -A`)
6. Commit avec message "chore: release v2.3.2"
7. Push vers GitHub (`git push`)

**Résultat:**
- ✅ Nouvelle version: v2.3.2
- ✅ Plugin packagé: `io.deckops.containers.streamDeckPlugin`
- ✅ Commit créé et poussé sur GitHub
- ✅ Prêt à installer et tester!

---

### **Option 2: Release Minor (New Features)**

```bash
npm run release:minor
```

**Ce que ça fait:**
1. Incrémente version **MINOR** (2.3.1 → 2.4.0)
2. Met à jour package.json (2.4.0) et manifest.json (2.4.0.0)
3. Build le projet
4. Package le plugin
5. Git add + commit + push

**Quand l'utiliser:**
- Nouvelle action ajoutée (Docker Volumes, etc.)
- Nouvelle fonctionnalité majeure
- Nouvelle UI/Property Inspector

---

## 🔢 Gestion de Version Automatique

### Source de Vérité: `package.json`

La version dans `package.json` est la **source de vérité**. Le script synchronise automatiquement vers `manifest.json`.

### Commandes Manuelles (si besoin)

```bash
# Incrémenter patch (2.3.1 → 2.3.2)
npm run version:patch

# Incrémenter minor (2.3.1 → 2.4.0)
npm run version:minor

# Incrémenter major (2.3.1 → 3.0.0)
npm run version:major

# Juste synchroniser sans incrémenter
npm run version:sync
```

**Note:** Les commandes `npm run release` et `npm run release:minor` incluent déjà le version bump, vous n'avez PAS besoin d'exécuter ces commandes manuellement!

---

## 📦 Après la Release Automatique

### **1. Installer le Plugin Localement**

```bash
# Option A: Double-click sur le fichier
# Fichier: io.deckops.containers.streamDeckPlugin
```

**OU**

```bash
# Option B: Lien symbolique (mode dev)
npm run link
npm run restart
```

### **2. Tester les Modifications**

**Checklist rapide:**
- [ ] Le plugin charge dans Stream Deck
- [ ] Les nouvelles modifications fonctionnent
- [ ] Pas d'erreurs dans les logs
- [ ] Actions existantes toujours fonctionnelles

**Debug logs:**
```
Windows: %APPDATA%\Elgato\StreamDeck\logs\io.deckops.containers.log
macOS: ~/Library/Logs/ElgatoStreamDeck/
```

---

## 🔄 Workflow Complet

```
Modifier Code
     ↓
npm run release  ← UNE SEULE COMMANDE!
     ↓
┌────────────────────────────────┐
│ 1. Version bump (2.3.1→2.3.2) │
│ 2. Build TypeScript            │
│ 3. Package plugin              │
│ 4. Git commit                  │
│ 5. Git push                    │
└────────────────────────────────┘
     ↓
Double-click .streamDeckPlugin
     ↓
Tester dans Stream Deck
```

---

## ⚙️ Commandes Utiles

### Release Automatique
```bash
npm run release         # Patch release (2.3.1 → 2.3.2) + commit + push
npm run release:minor   # Minor release (2.3.1 → 2.4.0) + commit + push
```

### Version Management Manuelle
```bash
npm run version:patch   # 2.3.1 → 2.3.2 (sans build/commit)
npm run version:minor   # 2.3.1 → 2.4.0 (sans build/commit)
npm run version:major   # 2.3.1 → 3.0.0 (sans build/commit)
npm run version:sync    # Sync versions sans incrémenter
```

### Build & Package Manuels
```bash
npm run build          # Build TypeScript → JavaScript
npm run watch          # Build continu (alias: npm run dev)
npm run pack           # Build + package plugin
```

### Stream Deck
```bash
npm run link           # Créer lien symbolique (dev mode)
npm run restart        # Redémarrer plugin dans Stream Deck
```

### Git (si besoin manuel)
```bash
git status            # Voir modifications
git add .             # Stage tous les fichiers
git commit -m "..."   # Commit manuel
git push              # Push manuel
```

---

## 🚨 Erreurs Communes & Solutions

### Erreur: Build échoue
```bash
# Erreur TypeScript
→ Corriger les types dans le code
→ Vérifier les imports

# Module not found
→ npm install
```

### Erreur: Git commit échoue
```bash
# Git user non configuré
git config user.name "Your Name"
git config user.email "your@email.com"

# Remote non configuré
git remote add origin https://github.com/YOUR_USERNAME/dockermanager.git
```

### Erreur: Version déjà existante
```bash
# Si vous avez déjà fait npm run release
→ Faire des modifications avant de release à nouveau
→ OU utiliser version:sync pour re-synchroniser
```

### Plugin ne charge pas
```bash
# Vérifier manifest.json
→ Syntaxe JSON valide
→ UUIDs corrects

# Vérifier logs Stream Deck
→ %APPDATA%\Elgato\StreamDeck\logs\
```

---

## 📋 Checklist Avant Release

- [ ] Modifications code terminées
- [ ] Code testé localement (basique)
- [ ] Pas de credentials en clair
- [ ] Pas de console.log inutiles
- [ ] `npm run build` réussit

**Ensuite:**
```bash
npm run release
```

**C'EST TOUT!** 🎉

---

## 🎯 Différence avec Process Standard

| Aspect | **Process Accéléré** | Process Standard |
|--------|---------------------|------------------|
| **Objectif** | Test local rapide | Release publique |
| **Durée** | 2-3 min | 1-2 heures |
| **Tests** | Basiques | Auto + Manuels complets |
| **Sécurité** | Vérification basique | Audit complet |
| **Git** | Automatique (commit + push) | Manual (commit + tag + release) |
| **Version** | Auto-increment | Manual increment |
| **Release** | Non | Oui (GitHub + Marketplace) |
| **Commande** | `npm run release` | Étapes manuelles multiples |

---

## 💡 Exemples d'Usage

### Exemple 1: Correction de Bug
```bash
# 1. Fixer le bug dans src/actions/docker-logs.ts
# 2. Run release
npm run release

# Résultat: version 2.3.1 → 2.3.2, commité, pushé
# 3. Double-click sur .streamDeckPlugin pour tester
```

### Exemple 2: Nouvelle Feature
```bash
# 1. Ajouter nouvelle action docker-volumes.ts
# 2. Modifier manifest.json pour ajouter l'action
# 3. Run release minor (nouvelle feature)
npm run release:minor

# Résultat: version 2.3.1 → 2.4.0, commité, pushé
# 4. Installer et tester la nouvelle action
```

### Exemple 3: Multiples Modifications
```bash
# 1. Faire toutes les modifications nécessaires
# 2. Tester avec npm run build (vérifier erreurs)
# 3. Quand satisfait, run release
npm run release

# Tout est fait automatiquement!
```

---

## 📚 Fichiers Importants

### Scripts de Version Management
- `scripts/version-bump.cjs` - Gère l'incrémentation de version
- `scripts/release.cjs` - Script de release automatique

### Configuration
- `package.json` - Source de vérité pour la version (format: X.Y.Z)
- `io.deckops.containers.sdPlugin/manifest.json` - Version plugin (format: X.Y.Z.0)

### Build
- `io.deckops.containers.sdPlugin/bin/plugin.js` - Plugin compilé
- `io.deckops.containers.streamDeckPlugin` - Package final

---

## 📌 Notes Importantes

**Ce process est pour:**
- ✅ Développement quotidien
- ✅ Corrections rapides
- ✅ Nouvelles features (mineures)
- ✅ Tests locaux
- ✅ Commits fréquents

**Ce process N'EST PAS pour:**
- ❌ Release publique officielle
- ❌ Upload Elgato Marketplace
- ❌ Tests de sécurité complets
- ❌ Audit code approfondi
- ❌ Releases majeures (breaking changes)

**Pour cela → voir PROCESS-STANDARD.md**

---

## 🎉 Résumé Ultra-Court

```bash
# Faire modifications
# Puis:
npm run release

# C'est tout! ✨
# Version incrémentée, build, package, commit, push
# Double-click .streamDeckPlugin pour tester
```

**Gain de temps:** Au lieu de 7-8 étapes manuelles, **1 seule commande** fait tout! 🚀
