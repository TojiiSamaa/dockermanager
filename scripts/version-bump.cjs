#!/usr/bin/env node

/**
 * Version Management Script
 *
 * This script manages version synchronization between package.json and manifest.json
 * It uses package.json as the source of truth and syncs to manifest.json
 *
 * Usage:
 *   node scripts/version-bump.js patch  # 2.3.0 -> 2.3.1
 *   node scripts/version-bump.js minor  # 2.3.0 -> 2.4.0
 *   node scripts/version-bump.js major  # 2.3.0 -> 3.0.0
 *   node scripts/version-bump.js sync   # Just sync without incrementing
 */

const fs = require('fs');
const path = require('path');

// Paths
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const manifestJsonPath = path.join(__dirname, '..', 'io.deckops.containers.sdPlugin', 'manifest.json');

/**
 * Parse version string (supports both X.Y.Z and X.Y.Z.W formats)
 */
function parseVersion(versionString) {
  const parts = versionString.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    build: parts[3] || 0
  };
}

/**
 * Increment version based on type
 */
function incrementVersion(version, type) {
  const v = parseVersion(version);

  switch (type) {
    case 'major':
      v.major++;
      v.minor = 0;
      v.patch = 0;
      break;
    case 'minor':
      v.minor++;
      v.patch = 0;
      break;
    case 'patch':
      v.patch++;
      break;
    default:
      throw new Error(`Invalid version type: ${type}. Use 'major', 'minor', or 'patch'`);
  }

  return v;
}

/**
 * Format version for package.json (X.Y.Z)
 */
function formatPackageVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * Format version for manifest.json (X.Y.Z.0)
 */
function formatManifestVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}.0`;
}

/**
 * Update versions in both files
 */
function updateVersions(type) {
  // Read files
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const manifestJson = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));

  const currentVersion = packageJson.version;
  console.log(`Current version: ${currentVersion}`);

  let newVersion;
  if (type === 'sync') {
    // Just sync, don't increment
    newVersion = parseVersion(currentVersion);
    console.log('Syncing version without incrementing...');
  } else {
    // Increment version
    newVersion = incrementVersion(currentVersion, type);
    console.log(`Bumping ${type} version...`);
  }

  const newPackageVersion = formatPackageVersion(newVersion);
  const newManifestVersion = formatManifestVersion(newVersion);

  // Update package.json
  packageJson.version = newPackageVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
  console.log(`✓ Updated package.json: ${newPackageVersion}`);

  // Update manifest.json
  manifestJson.Version = newManifestVersion;
  fs.writeFileSync(manifestJsonPath, JSON.stringify(manifestJson, null, 2) + '\n', 'utf8');
  console.log(`✓ Updated manifest.json: ${newManifestVersion}`);

  console.log('\n✅ Version update complete!');
  console.log(`New version: ${newPackageVersion}`);

  return newPackageVersion;
}

// Main
const args = process.argv.slice(2);
const type = args[0];

if (!type || !['major', 'minor', 'patch', 'sync'].includes(type)) {
  console.error('Usage: node scripts/version-bump.js [major|minor|patch|sync]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/version-bump.js patch  # 2.3.0 -> 2.3.1');
  console.error('  node scripts/version-bump.js minor  # 2.3.0 -> 2.4.0');
  console.error('  node scripts/version-bump.js major  # 2.3.0 -> 3.0.0');
  console.error('  node scripts/version-bump.js sync   # Just sync without incrementing');
  process.exit(1);
}

try {
  updateVersions(type);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
