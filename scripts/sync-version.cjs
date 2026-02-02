#!/usr/bin/env node

/**
 * Version Synchronization Script
 *
 * Reads version from package.json and updates it everywhere:
 * - manifest.json (already done by version-bump.cjs, but we ensure it's correct)
 * - All HTML files that display the version
 *
 * This ensures we have ONE source of truth (package.json) and everything stays in sync.
 *
 * Usage: node scripts/sync-version.cjs
 */

const fs = require('fs');
const path = require('path');

// Paths
const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'io.deckops.containers.sdPlugin', 'manifest.json');
const uiDir = path.join(rootDir, 'io.deckops.containers.sdPlugin', 'ui');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function main() {
  log('\n📦 Synchronizing version numbers...', 'blue');

  // Read version from package.json (source of truth)
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version;

  if (!version) {
    log('❌ No version found in package.json', 'red');
    process.exit(1);
  }

  log(`   Version from package.json: ${version}`, 'blue');

  let filesUpdated = 0;

  // 1. Update manifest.json (X.Y.Z -> X.Y.Z.0)
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifestVersion = `${version}.0`;

    if (manifest.Version !== manifestVersion) {
      manifest.Version = manifestVersion;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      log(`   ✓ Updated manifest.json: ${manifestVersion}`, 'green');
      filesUpdated++;
    } else {
      log(`   ✓ manifest.json already up to date: ${manifestVersion}`, 'green');
    }
  } catch (error) {
    log(`   ❌ Failed to update manifest.json: ${error.message}`, 'red');
  }

  // 2. Update all HTML files that contain version strings
  const htmlFiles = fs.readdirSync(uiDir).filter(f => f.endsWith('.html'));

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(uiDir, htmlFile);
    let content = fs.readFileSync(htmlPath, 'utf8');

    // Pattern to match: "Docker Manager v2.3.0" or similar
    const versionPattern = /(Docker Manager v)(\d+\.\d+\.\d+)/g;

    if (versionPattern.test(content)) {
      const updatedContent = content.replace(versionPattern, `$1${version}`);

      if (updatedContent !== content) {
        fs.writeFileSync(htmlPath, updatedContent, 'utf8');
        log(`   ✓ Updated ${htmlFile}: v${version}`, 'green');
        filesUpdated++;
      }
    }
  }

  if (filesUpdated === 0) {
    log('\n✓ All files already up to date!', 'green');
  } else {
    log(`\n✓ Updated ${filesUpdated} file(s) to version ${version}`, 'green');
  }
}

// Run
try {
  main();
} catch (error) {
  log(`\n❌ Error: ${error.message}`, 'red');
  process.exit(1);
}
