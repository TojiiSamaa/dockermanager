#!/usr/bin/env node

/**
 * Release Script - Automated Build and Git Commit
 *
 * This script automates the release process:
 * 1. Increments version (patch or minor)
 * 2. Builds and packages the plugin
 * 3. Commits changes to git
 * 4. Pushes to remote repository
 *
 * Usage:
 *   node scripts/release.js patch  # For bug fixes (2.3.0 -> 2.3.1)
 *   node scripts/release.js minor  # For new features (2.3.0 -> 2.4.0)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');

function run(command, description) {
  console.log(`\n🔄 ${description}...`);
  try {
    execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log(`✅ ${description} complete`);
  } catch (error) {
    console.error(`❌ ${description} failed`);
    process.exit(1);
  }
}

function getVersion() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

// Main
const args = process.argv.slice(2);
const releaseType = args[0];

if (!releaseType || !['patch', 'minor'].includes(releaseType)) {
  console.error('Usage: node scripts/release.js [patch|minor]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/release.js patch  # Bug fixes (2.3.0 -> 2.3.1)');
  console.error('  node scripts/release.js minor  # New features (2.3.0 -> 2.4.0)');
  process.exit(1);
}

console.log('🚀 Starting accelerated release process...\n');
console.log(`Release type: ${releaseType}`);

// Step 1: Increment version
run(`node scripts/version-bump.cjs ${releaseType}`, 'Version increment');

// Get new version
const newVersion = getVersion();
console.log(`\n📦 New version: ${newVersion}`);

// Step 2: Build
run('npm run build', 'Build');

// Step 3: Package
const packCommand = process.platform === 'win32'
  ? 'npx streamdeck pack io.deckops.containers.sdPlugin --force'
  : 'npm run pack';
run(packCommand, 'Package plugin');

// Step 4: Git add
run('git add -A', 'Stage changes');

// Step 5: Git commit
const commitMessage = `chore: release v${newVersion}`;
run(`git commit -m "${commitMessage}"`, 'Commit changes');

// Step 6: Git push
run('git push', 'Push to remote');

console.log('\n✅ Release complete! 🎉');
console.log(`\n📌 Next steps:`);
console.log(`   1. Uninstall old plugin from Stream Deck`);
console.log(`   2. Install new version: io.deckops.containers.sdPlugin.streamDeckPlugin`);
console.log(`   3. Test the changes\n`);
