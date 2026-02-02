/**
 * Internationalization (i18n) service
 * Supports French and English
 */

export type Language = "fr" | "en";

interface Translations {
  [key: string]: string | Translations;
}

const translations: Record<Language, Translations> = {
  en: {
    // Common
    error: "Error",
    success: "Success",
    loading: "Loading",
    noServer: "No\nserver",
    configRequired: "Config\nrequired",

    // Connection
    connecting: "Connecting",
    connected: "Connected",
    disconnected: "Disconnected",
    connectionFailed: "Connection failed",
    noServerConfigured: "No server configured",

    // Container states
    running: "Running",
    stopped: "Stopped",
    starting: "Starting",
    stopping: "Stopping",
    restarting: "Restarting",
    paused: "Paused",

    // Actions
    start: "Start",
    stop: "Stop",
    restart: "Restart",
    toggle: "Toggle",
    viewLogs: "View logs",
    refresh: "Refresh",

    // Errors
    containerNotFound: "Container not found",
    commandFailed: "Command failed",
    invalidSettings: "Invalid settings",
    connectionTimeout: "Connection timeout",
    sshKeyError: "SSH key error",

    // Compose
    composeStack: "Stack",
    composeUp: "Start Stack",
    composeDown: "Stop Stack",
    composeRestart: "Restart Stack",
    noComposeFile: "No compose file",

    // Logs
    logsTitle: "Docker Logs",
    noLogs: "No logs available",

    // Settings
    serverSettings: "Server Settings",
    language: "Language",
    refreshInterval: "Refresh Interval",

    // System
    diskUsage: "Disk Usage",
    systemPrune: "System Prune",
    networkManagement: "Networks",
    imageManagement: "Images",

    // Tests
    testConnection: "Test Connection",
    testSuccessful: "Test successful",
    testFailed: "Test failed",
  },

  fr: {
    // Common
    error: "Erreur",
    success: "Succès",
    loading: "Chargement",
    noServer: "Aucun\nserveur",
    configRequired: "Config\nrequise",

    // Connection
    connecting: "Connexion",
    connected: "Connecté",
    disconnected: "Déconnecté",
    connectionFailed: "Échec connexion",
    noServerConfigured: "Aucun serveur configuré",

    // Container states
    running: "Actif",
    stopped: "Arrêté",
    starting: "Démarrage",
    stopping: "Arrêt",
    restarting: "Redémarrage",
    paused: "Pause",

    // Actions
    start: "Démarrer",
    stop: "Arrêter",
    restart: "Redémarrer",
    toggle: "Basculer",
    viewLogs: "Voir logs",
    refresh: "Actualiser",

    // Errors
    containerNotFound: "Container introuvable",
    commandFailed: "Commande échouée",
    invalidSettings: "Paramètres invalides",
    connectionTimeout: "Délai connexion dépassé",
    sshKeyError: "Erreur clé SSH",

    // Compose
    composeStack: "Stack",
    composeUp: "Démarrer Stack",
    composeDown: "Arrêter Stack",
    composeRestart: "Redémarrer Stack",
    noComposeFile: "Aucun fichier compose",

    // Logs
    logsTitle: "Logs Docker",
    noLogs: "Aucun log disponible",

    // Settings
    serverSettings: "Paramètres Serveur",
    language: "Langue",
    refreshInterval: "Intervalle Actualisation",

    // System
    diskUsage: "Espace Disque",
    systemPrune: "Nettoyage Système",
    networkManagement: "Réseaux",
    imageManagement: "Images",

    // Tests
    testConnection: "Tester Connexion",
    testSuccessful: "Test réussi",
    testFailed: "Test échoué",
  },
};

/**
 * I18n service class
 */
export class I18nService {
  private currentLanguage: Language = "en";

  /**
   * Set the current language
   */
  setLanguage(lang: Language): void {
    this.currentLanguage = lang;
  }

  /**
   * Get the current language
   */
  getLanguage(): Language {
    return this.currentLanguage;
  }

  /**
   * Translate a key
   * Supports nested keys using dot notation: "errors.connectionFailed"
   */
  t(key: string, fallback?: string): string {
    const keys = key.split(".");
    let value: any = translations[this.currentLanguage];

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        // Key not found, try English fallback
        let englishValue: any = translations.en;
        for (const ek of keys) {
          if (englishValue && typeof englishValue === "object" && ek in englishValue) {
            englishValue = englishValue[ek];
          } else {
            return fallback || key;
          }
        }
        return typeof englishValue === "string" ? englishValue : (fallback || key);
      }
    }

    return typeof value === "string" ? value : (fallback || key);
  }

  /**
   * Check if a translation key exists
   */
  has(key: string): boolean {
    const keys = key.split(".");
    let value: any = translations[this.currentLanguage];

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return false;
      }
    }

    return typeof value === "string";
  }
}

// Global singleton instance
export const i18n = new I18nService();
