#!/usr/bin/env node

/**
 * Process Standard - Script Interactif & Automatique
 *
 * Ce script automatise le processus de release standard avec:
 * 1. Configuration interactive ou depuis fichier
 * 2. Version bump
 * 3. Build + Package
 * 4. Git commit + tag
 * 5. Push avec tags
 *
 * Usage:
 *   node scripts/process-standard.cjs
 *   npm run process:standard
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const configPath = path.join(__dirname, '..', 'process', 'release-config.json');

// Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function run(command, description) {
  log(`\n🔄 ${description}...`, 'blue');
  try {
    execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    log(`✅ ${description} complete`, 'green');
    return true;
  } catch (error) {
    log(`❌ ${description} failed`, 'red');
    return false;
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
  log('\n📋 Configuration de la Release Standard', 'bright');
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
  log('\n📝 Mode interactif - Release Standard:', 'yellow');

  const releaseType = await promptUser('\n1. Type de release (patch/minor/major) [minor]: ');
  const description = await promptUser('2. Description de la release: ');
  const featuresInput = await promptUser('3. Nouvelles features (séparées par des virgules): ');
  const fixesInput = await promptUser('4. Bugs fixés (séparés par des virgules): ');
  const breakingInput = await promptUser('5. Breaking changes (séparés par des virgules, optionnel): ');
  const notes = await promptUser('6. Notes additionnelles (optionnel): ');

  const features = featuresInput ? featuresInput.split(',').map(f => f.trim()).filter(f => f) : [];
  const fixes = fixesInput ? fixesInput.split(',').map(f => f.trim()).filter(f => f) : [];
  const breaking = breakingInput ? breakingInput.split(',').map(b => b.trim()).filter(b => b) : [];

  const changes = [...features, ...fixes];

  return {
    releaseType: releaseType || 'minor',
    description: description || 'New release',
    changes,
    features,
    fixes,
    breaking,
    notes: notes || ''
  };
}

function generateCommitMessage(version, config) {
  let message = `Release v${version}: ${config.description}`;

  if (config.features && config.features.length > 0) {
    message += '\n\n🎉 New Features:';
    config.features.forEach(feature => {
      message += `\n- ${feature}`;
    });
  }

  if (config.fixes && config.fixes.length > 0) {
    message += '\n\n🐛 Bug Fixes:';
    config.fixes.forEach(fix => {
      message += `\n- ${fix}`;
    });
  }

  if (config.breaking && config.breaking.length > 0) {
    message += '\n\n⚠️  BREAKING CHANGES:';
    config.breaking.forEach(change => {
      message += `\n- ${change}`;
    });
  }

  if (config.notes) {
    message += `\n\n📝 Notes:\n${config.notes}`;
  }

  message += '\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>';

  return message;
}

async function main() {
  log('🎯 Process Standard - Release Publique', 'bright');
  log('═'.repeat(50), 'magenta');

  // Step 1: Load or prompt for configuration
  const config = await loadOrPromptConfig();

  // Validate
  if (!['patch', 'minor', 'major'].includes(config.releaseType)) {
    log(`\n❌ Type de release invalide: ${config.releaseType}`, 'red');
    process.exit(1);
  }

  // Display configuration
  log('\n📦 Configuration:', 'bright');
  log(`   Type: ${config.releaseType}`, 'blue');
  log(`   Description: ${config.description}`, 'blue');
  log(`   Features: ${config.features.length}`, 'blue');
  log(`   Fixes: ${config.fixes.length}`, 'blue');
  if (config.breaking.length > 0) {
    log(`   Breaking Changes: ${config.breaking.length}`, 'yellow');
  }

  const confirm = await promptUser('\n▶️  Continuer avec cette configuration? (O/n): ');
  if (confirm.toLowerCase() === 'n') {
    log('\n❌ Release annulée', 'yellow');
    process.exit(0);
  }

  // Step 2: Version bump
  log('\n📝 Phase 1: Version Management', 'magenta');
  log('─'.repeat(50), 'blue');
  run(`node scripts/version-bump.cjs ${config.releaseType}`, 'Version increment');

  const newVersion = getVersion();
  log(`\n📦 Nouvelle version: v${newVersion}`, 'green');

  // Step 2b: Sync version everywhere
  run('node scripts/sync-version.cjs', 'Sync version to all files');

  // Step 3: Build
  log('\n🔨 Phase 2: Build & Package', 'magenta');
  log('─'.repeat(50), 'blue');

  const buildSuccess = run('npm run build', 'Build TypeScript');
  if (!buildSuccess) {
    log('\n❌ Build échoué. Arrêt du process.', 'red');
    process.exit(1);
  }

  // Step 4: Package
  const packCommand = process.platform === 'win32'
    ? 'npx streamdeck pack io.deckops.containers.sdPlugin --force'
    : 'npm run pack';
  const packSuccess = run(packCommand, 'Package plugin');
  if (!packSuccess) {
    log('\n❌ Package échoué. Arrêt du process.', 'red');
    process.exit(1);
  }

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

  // Step 5: Tests reminder
  const testPluginName = `docker-manager-v${newVersion}.streamDeckPlugin`;
  log('\n🧪 Phase 3: Tests', 'magenta');
  log('─'.repeat(50), 'blue');
  log('\n⚠️  Process Standard: Tests manuels requis', 'yellow');
  log(`   1. Installer le plugin: releases/${testPluginName}`, 'yellow');
  log('   2. Tester toutes les actions', 'yellow');
  log('   3. Vérifier les logs (pas d\'erreurs)', 'yellow');

  const testsOk = await promptUser('\n✅ Tests effectués et validés? (O/n): ');
  if (testsOk.toLowerCase() === 'n') {
    log('\n❌ Tests non validés. Corrigez les problèmes avant de continuer.', 'red');
    log('   Le build et le package sont prêts mais pas committés.', 'yellow');
    process.exit(0);
  }

  // Step 6: Git commit
  log('\n📝 Phase 4: Git Commit & Tag', 'magenta');
  log('─'.repeat(50), 'blue');

  run('git add -A', 'Stage changes');

  const commitMessage = generateCommitMessage(newVersion, config);
  const commitFile = path.join(__dirname, '..', '.commit-message.tmp');
  fs.writeFileSync(commitFile, commitMessage, 'utf8');

  try {
    run(`git commit -F "${commitFile}"`, 'Commit changes');
  } finally {
    if (fs.existsSync(commitFile)) {
      fs.unlinkSync(commitFile);
    }
  }

  // Step 7: Git tag
  const tagMessage = `Release v${newVersion}`;
  run(`git tag -a v${newVersion} -m "${tagMessage}"`, 'Create git tag');

  // Step 8: Push
  log('\n🚀 Phase 5: Push to Remote', 'magenta');
  log('─'.repeat(50), 'blue');

  run('git push origin main', 'Push commits');
  run(`git push origin v${newVersion}`, 'Push tag');

  // Success
  const finalPluginName = `docker-manager-v${newVersion}.streamDeckPlugin`;
  log('\n✅ Release Standard Complete! 🎉', 'green');
  log('═'.repeat(50), 'magenta');
  log('\n📌 Prochaines étapes:', 'bright');
  log(`   1. Tag v${newVersion} créé et poussé`, 'green');
  log('   2. GitHub Actions va créer la release automatiquement', 'blue');
  log('   3. Vérifier: https://github.com/YOUR_REPO/releases', 'blue');
  log('   4. (Optionnel) Upload vers Elgato Marketplace', 'yellow');
  log(`\n📦 Fichier de release: releases/${finalPluginName}`, 'green');
  log('');
}

// Run
main().catch(error => {
  log(`\n❌ Erreur: ${error.message}`, 'red');
  process.exit(1);
});
