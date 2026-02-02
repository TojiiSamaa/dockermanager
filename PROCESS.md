# Development & Release Process

This document describes the standard and accelerated build/release processes for the Stream Deck Docker Manager plugin.

## Version Management

### Version Source of Truth

**package.json** is the single source of truth for versioning. The version management script automatically syncs versions between:
- `package.json` (format: `X.Y.Z`)
- `io.deckops.containers.sdPlugin/manifest.json` (format: `X.Y.Z.0`)

### Version Numbering

We use semantic versioning:
- **Major** (X.0.0): Breaking changes, major architectural changes
- **Minor** (X.Y.0): New features, new actions, significant improvements
- **Patch** (X.Y.Z): Bug fixes, small improvements, UI tweaks

### Manual Version Increment

Use these npm scripts to increment version:

```bash
# Increment patch version (2.3.0 -> 2.3.1)
npm run version:patch

# Increment minor version (2.3.0 -> 2.4.0)
npm run version:minor

# Increment major version (2.3.0 -> 3.0.0)
npm run version:major

# Sync version without incrementing
npm run version:sync
```

These scripts automatically update both `package.json` and `manifest.json`.

---

## Standard Process (Step-by-Step Development)

Use this process when developing features incrementally with manual control over each step.

### 1. Make Code Changes
Edit source files in `src/` or UI files in `io.deckops.containers.sdPlugin/ui/`.

### 2. Test During Development (Optional)
```bash
# Watch mode - auto-rebuild on file changes
npm run watch
# or
npm run dev
```

### 3. Build
```bash
npm run build
```
This compiles TypeScript to JavaScript in `io.deckops.containers.sdPlugin/bin/plugin.js`.

### 4. Increment Version
**IMPORTANT**: Always increment version after making changes.

For bug fixes and small improvements:
```bash
npm run version:patch
```

For new features:
```bash
npm run version:minor
```

For breaking changes:
```bash
npm run version:major
```

### 5. Package Plugin
```bash
npm run pack
```
This creates the `.streamDeckPlugin` file for distribution.

### 6. Test Installation
```bash
# Uninstall old version from Stream Deck
# Then double-click the .streamDeckPlugin file to install
# Or use:
npm run link    # Symlink for development testing
npm run restart # Restart plugin in Stream Deck
```

### 7. Git Commit & Push
Once testing is complete:

```bash
# Stage all changes
git add -A

# Commit with descriptive message
git commit -m "feat: add new Docker network action"
# or
git commit -m "fix: resolve container log connection issue"
# or
git commit -m "chore: update dependencies"

# Push to repository
git push
```

**Commit Message Conventions:**
- `feat:` - New features
- `fix:` - Bug fixes
- `refactor:` - Code refactoring
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `style:` - Code style/formatting
- `test:` - Test additions/changes

---

## Accelerated Process (One-Command Release)

Use this process when you want to quickly release a patch or minor version with automatic version increment, build, package, and git commit.

### For Patch Release (Bug Fixes)

```bash
npm run release
```

This single command:
1. ✓ Increments patch version (2.3.0 → 2.3.1)
2. ✓ Syncs version to manifest.json (2.3.1.0)
3. ✓ Builds the plugin (TypeScript → JavaScript)
4. ✓ Packages the .streamDeckPlugin file
5. ✓ Stages all changes (`git add -A`)
6. ✓ Commits with message: "chore: release v2.3.1"
7. ✓ Pushes to repository

### For Minor Release (New Features)

```bash
npm run release:minor
```

This single command:
1. ✓ Increments minor version (2.3.0 → 2.4.0)
2. ✓ Syncs version to manifest.json (2.4.0.0)
3. ✓ Builds the plugin
4. ✓ Packages the .streamDeckPlugin file
5. ✓ Stages all changes
6. ✓ Commits with message: "chore: release v2.4.0"
7. ✓ Pushes to repository

### After Accelerated Release

1. Uninstall old plugin version from Stream Deck
2. Double-click the new `.streamDeckPlugin` file to install
3. Test the changes

---

## Quick Reference

### Common Commands

```bash
# Development
npm run dev              # Watch mode (auto-rebuild)
npm run build            # Single build
npm run pack             # Build + package

# Version Management
npm run version:patch    # 2.3.0 -> 2.3.1
npm run version:minor    # 2.3.0 -> 2.4.0
npm run version:major    # 2.3.0 -> 3.0.0

# Accelerated Release
npm run release          # Patch release + commit + push
npm run release:minor    # Minor release + commit + push

# Stream Deck Tools
npm run link             # Symlink plugin for testing
npm run restart          # Restart plugin in Stream Deck
```

### File Locations

- **Source code**: `src/`
- **Built plugin**: `io.deckops.containers.sdPlugin/bin/plugin.js`
- **Package file**: `io.deckops.containers.sdPlugin.streamDeckPlugin`
- **Version script**: `scripts/version-bump.js`

### When to Use Which Process

| Situation | Process | Command |
|-----------|---------|---------|
| Quick bug fix | Accelerated | `npm run release` |
| New small feature | Accelerated | `npm run release:minor` |
| Multiple experimental changes | Standard | Manual steps 1-7 |
| Major refactoring | Standard | Manual steps 1-7 |
| Testing without release | Standard (stop at step 6) | `npm run build && npm run pack` |

---

## Troubleshooting

### Version not syncing
```bash
# Manually sync version from package.json to manifest.json
npm run version:sync
```

### Build errors
```bash
# Clean rebuild
rm -rf io.deckops.containers.sdPlugin/bin/
npm run build
```

### Plugin not updating in Stream Deck
1. Uninstall old version from Stream Deck
2. Restart Stream Deck application
3. Install new version

### Git commit fails
Make sure you have:
- Configured git user: `git config user.name "Your Name"`
- Configured git email: `git config user.email "your@email.com"`
- Remote repository set up: `git remote -v`

---

## Release Checklist

Before using the accelerated process or committing manually:

- [ ] Code changes are complete and tested
- [ ] Build succeeds without errors (`npm run build`)
- [ ] Plugin works correctly in Stream Deck
- [ ] Version increment is appropriate (patch/minor/major)
- [ ] Git status is clean (no unwanted files)

---

## Examples

### Example 1: Fix a Bug (Accelerated)
```bash
# 1. Fix the bug in src/actions/docker-logs.ts
# 2. Run accelerated release
npm run release
# 3. Reinstall plugin in Stream Deck
# Done! Version bumped from 2.3.0 to 2.3.1, built, committed, and pushed.
```

### Example 2: Add New Feature (Standard)
```bash
# 1. Create new action file: src/actions/docker-volumes.ts
# 2. Update manifest.json to add new action
# 3. Test with watch mode
npm run dev
# (make changes, test, repeat)

# 4. Build final version
npm run build

# 5. Increment version (new feature = minor)
npm run version:minor

# 6. Package
npm run pack

# 7. Test installation in Stream Deck
# 8. Commit and push
git add -A
git commit -m "feat: add Docker volumes management action"
git push
```

### Example 3: Major Refactoring (Standard)
```bash
# 1. Make extensive changes to architecture
# 2. Build and test thoroughly
npm run build
npm run pack
# Test extensively

# 3. Increment major version
npm run version:major

# 4. Package
npm run pack

# 5. Git commit with detailed message
git add -A
git commit -m "refactor!: migrate to new multi-server connection pool architecture

BREAKING CHANGE: Server configuration format has changed.
Users need to reconfigure their servers after this update."
git push
```

---

## Notes

- Always increment version after making changes (required for users to know which version they have)
- The version in `package.json` is the source of truth
- The `release` scripts automatically handle version sync, build, package, and git commit
- For Windows, the release scripts use PowerShell syntax for version extraction
- Use meaningful commit messages to help track changes
- Tag releases in git for important versions: `git tag v2.3.0 && git push --tags`
