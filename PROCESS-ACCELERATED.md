# Process Accéléré / Test - Stream Deck Docker Plugin

**Objectif:** Modifications rapides → Build → Plugin pour tests locaux

**Quand utiliser:** Développement quotidien, corrections rapides, ajout de features

---

## ⚡ Checklist Rapide

- [ ] 1. Faire les modifications dans le code
- [ ] 2. Build le projet
- [ ] 3. Créer le plugin .streamDeckPlugin
- [ ] 4. Tester localement

**Temps estimé:** 2-5 minutes

---

## 📝 Étapes Détaillées

### **1. Modifications Code**

Modifier les fichiers dans:
- `src/actions/*.ts` - Actions Stream Deck
- `src/services/*.ts` - Services (docker, settings, etc.)
- `io.deckops.containers.sdPlugin/ui/*.html` - Property Inspector

**Vérifier:**
- ✅ Imports corrects
- ✅ Pas d'erreurs TypeScript évidentes
- ✅ Logs avec `pluginLogger` pour debug

---

### **2. Build le Projet**

```bash
cd z:\apps\streamdeck-docker
npm run build
```

**Vérifications:**
- ✅ Build réussi sans erreurs
- ✅ Warnings acceptables (circular dependencies dans ssh2 = OK)
- ✅ Fichier créé: `io.deckops.containers.sdPlugin/bin/plugin.js`

**Si erreurs TypeScript:**
- Corriger les erreurs
- Re-run `npm run build`

---

### **3. Créer le Plugin**

```bash
npm run pack
```

**Résultat:**
- ✅ Fichier créé: `io.deckops.containers.streamDeckPlugin`
- ✅ Version affichée (ex: v2.3.0.0)
- ✅ Taille ~3.0 MB
- ✅ 47 fichiers packagés

**Emplacement final:**
```
z:\apps\streamdeck-docker\io.deckops.containers.streamDeckPlugin
```

---

### **4. Test Local**

**Installation:**
1. Double-cliquer sur `io.deckops.containers.streamDeckPlugin`
2. Stream Deck installe automatiquement

**OU avec CLI:**
```bash
npm run link    # Crée un lien symbolique (dev mode)
npm run restart # Redémarre le plugin
```

**Vérification:**
1. Ouvrir Stream Deck
2. Chercher "Docker Manager" dans la liste d'actions
3. Glisser une action sur le Stream Deck
4. Tester la fonctionnalité

**Debug:**
- Logs plugin: `%APPDATA%\Elgato\StreamDeck\logs\`
- Console Property Inspector: F12 dans Stream Deck

---

## 🔄 Workflow Typique

```
Modification → npm run build → npm run pack → Test
     ↓              ↓              ↓            ↓
  Code edit    TypeScript→JS   .streamDeck   Double-click
                                 Plugin       ou npm link
```

---

## ⚙️ Commandes Utiles

```bash
# Development
npm run build        # Build une fois
npm run watch        # Build continu (alias: npm run dev)
npm run pack         # Build + créer plugin
npm run link         # Lien symbolique pour dev
npm run restart      # Redémarrer plugin dans Stream Deck

# Git
git status          # Voir les modifications
git add .           # Ajouter tous les fichiers
git commit -m "..."  # Commit avec message
```

---

## 🚨 Erreurs Communes

### Build échoue
```bash
# Erreur: TypeScript errors
→ Corriger les types dans le code
→ Vérifier les imports

# Erreur: Module not found
→ npm install
```

### Plugin ne charge pas
```bash
# Vérifier manifest.json
→ Syntaxe JSON valide
→ UUIDs corrects

# Vérifier logs Stream Deck
→ %APPDATA%\Elgato\StreamDeck\logs\
```

### Modifications non visibles
```bash
# Forcer rebuild
npm run build

# Redémarrer Stream Deck
npm run restart
# OU fermer/rouvrir Stream Deck
```

---

## 📋 Checklist Avant Commit

- [ ] `npm run build` réussit sans erreurs
- [ ] Plugin créé avec `npm run pack`
- [ ] Testé localement (au moins 1 action)
- [ ] Pas de credentials en clair dans le code
- [ ] Logs debug retirés ou commentés
- [ ] CLAUDE.md à jour si architecture change

---

## 🎯 Process Complet

Si modifications majeures nécessitant tests complets, release, etc.:
→ Voir **PROCESS-STANDARD.md**

---

## 📌 Notes

**Ce process est pour:**
- ✅ Développement rapide
- ✅ Tests locaux
- ✅ Corrections de bugs
- ✅ Ajout de features

**Ce process N'EST PAS pour:**
- ❌ Release publique
- ❌ Upload marketplace
- ❌ Tests de sécurité complets
- ❌ Audit code

Pour cela → **PROCESS-STANDARD.md**
