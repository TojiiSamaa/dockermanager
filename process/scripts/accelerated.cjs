#!/usr/bin/env node

/**
 * Process Accéléré - Script Interactif & Automatique
 *
 * Ce script automatise le processus de release rapide avec interaction:
 * 1. Lit release-config.json OU demande les infos
 * 2. Incrémente la version
 * 3. Build + Package
 * 4. Commit + Push avec message détaillé
 *
 * Usage:
 *   node scripts/process-accelerated.cjs
 *   npm run process:accelerated
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const configPath = path.join(__dirname, '..', 'process', 'release-config.json');

// Colors for console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function run(command, description) {
  log(`\n🔄 ${description}...`, 'blue');
  try {
    execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    log(`✅ ${description} complete`, 'green');
  } catch (error) {
    log(`❌ ${description} failed`, 'red');
    process.exit(1);
  }
}

function getVersion() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function loadOrPromptConfig() {
  log('\n📋 Configuration de la Release', 'bright');
  log('─'.repeat(50), 'blue');

  // Check if config file exists
  if (fs.existsSync(configPath)) {
    const useConfig = await promptUser('\n📄 Fichier release-config.json trouvé. Utiliser? (O/n): ');

    if (useConfig.toLowerCase() !== 'n') {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      log('\n✅ Configuration chargée depuis release-config.json', 'green');
      return config;
    }
  }

  // Interactive prompts
  log('\n📝 Mode interactif - Entrez les informations:', 'yellow');

  const releaseType = await promptUser('\n1. Type de release (patch/minor/major) [patch]: ');
  const description = await promptUser('2. Description courte de la release: ');
  const changesInput = await promptUser('3. Changements (séparés par des virgules): ');
  const fixesInput = await promptUser('4. Bugs fixés (séparés par des virgules, optionnel): ');

  const changes = changesInput.split(',').map(c => c.trim()).filter(c => c);
  const fixes = fixesInput ? fixesInput.split(',').map(f => f.trim()).filter(f => f) : [];

  return {
    releaseType: releaseType || 'patch',
    description: description || 'Bug fixes and improvements',
    changes,
    fixes,
    features: [],
    breaking: []
  };
}

function generateCommitMessage(version, config) {
  let message = `chore: release v${version}`;

  if (config.description) {
    message += `\n\n${config.description}`;
  }

  if (config.changes && config.changes.length > 0) {
    message += '\n\nChanges:';
    config.changes.forEach(change => {
      message += `\n- ${change}`;
    });
  }

  if (config.features && config.features.length > 0) {
    message += '\n\nFeatures:';
    config.features.forEach(feature => {
      message += `\n- ${feature}`;
    });
  }

  if (config.fixes && config.fixes.length > 0) {
    message += '\n\nFixes:';
    config.fixes.forEach(fix => {
      message += `\n- ${fix}`;
    });
  }

  message += '\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>';

  return message;
}

async function main() {
  log('🚀 Process Accéléré - Release Automatique', 'bright');
  log('═'.repeat(50), 'blue');

  // Step 1: Load or prompt for configuration
  const config = await loadOrPromptConfig();

  // Validate release type
  if (!['patch', 'minor', 'major'].includes(config.releaseType)) {
    log(`\n❌ Type de release invalide: ${config.releaseType}`, 'red');
    log('   Utilisez: patch, minor, ou major', 'yellow');
    process.exit(1);
  }

  // Confirm
  log('\n📦 Configuration:', 'bright');
  log(`   Type: ${config.releaseType}`, 'blue');
  log(`   Description: ${config.description}`, 'blue');
  log(`   Changements: ${config.changes.length} élément(s)`, 'blue');

  const confirm = await promptUser('\n▶️  Continuer avec cette configuration? (O/n): ');
  if (confirm.toLowerCase() === 'n') {
    log('\n❌ Release annulée', 'yellow');
    process.exit(0);
  }

  // Step 2: Version bump
  run(`node scripts/version-bump.cjs ${config.releaseType}`, 'Version increment');

  // Get new version
  const newVersion = getVersion();
  log(`\n📦 Nouvelle version: ${newVersion}`, 'green');

  // Step 3: Build
  run('npm run build', 'Build');

  // Step 4: Package
  const packCommand = process.platform === 'win32'
    ? 'npx streamdeck pack io.deckops.containers.sdPlugin --force'
    : 'npm run pack';
  run(packCommand, 'Package plugin');

  // Step 4b: Rename and archive to releases folder
  log('\n🔄 Archivage de la release...', 'blue');
  const releasesDir = path.join(__dirname, '..', '..', 'releases');
  if (!fs.existsSync(releasesDir)) {
    fs.mkdirSync(releasesDir, { recursive: true });
  }

  const oldPluginPath = path.join(__dirname, '..', '..', 'io.deckops.containers.streamDeckPlugin');
  const newPluginName = `docker-manager-v${newVersion}.streamDeckPlugin`;
  const newPluginPath = path.join(releasesDir, newPluginName);

  if (fs.existsSync(oldPluginPath)) {
    fs.copyFileSync(oldPluginPath, newPluginPath);
    log(`✅ Plugin archivé: releases/${newPluginName}`, 'green');
  }

  // Step 5: Git add
  run('git add -A', 'Stage changes');

  // Step 6: Git commit
  const commitMessage = generateCommitMessage(newVersion, config);
  const commitFile = path.join(__dirname, '..', '.commit-message.tmp');
  fs.writeFileSync(commitFile, commitMessage, 'utf8');

  try {
    run(`git commit -F "${commitFile}"`, 'Commit changes');
  } finally {
    // Clean up temp file
    if (fs.existsSync(commitFile)) {
      fs.unlinkSync(commitFile);
    }
  }

  // Step 7: Git push
  run('git push', 'Push to remote');

  // Success
  const finalPluginName = `docker-manager-v${newVersion}.streamDeckPlugin`;
  log('\n✅ Release complete! 🎉', 'green');
  log('═'.repeat(50), 'blue');
  log('\n📌 Prochaines étapes:', 'bright');
  log('   1. Désinstaller l\'ancien plugin du Stream Deck', 'yellow');
  log(`   2. Double-cliquer sur: releases/${finalPluginName}`, 'yellow');
  log('   3. Tester les modifications', 'yellow');
  log(`\n📦 Fichier de release: releases/${finalPluginName}`, 'green');
  log('');
}

// Run
main().catch(error => {
  log(`\n❌ Erreur: ${error.message}`, 'red');
  process.exit(1);
});
