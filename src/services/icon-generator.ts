export type ContainerState = "running" | "stopped" | "paused" | "restarting" | "exited" | "starting" | "stopping";
export type HealthState = "stable" | "starting" | "unstable" | "crashloop" | "stopped" | "loading";

interface IconOptions {
  size?: number;
  statusDotSize?: number;
  statusDotPosition?: "bottom-right" | "top-right" | "bottom-left" | "top-left";
  backgroundColor?: string; // Custom background color (hex) - shown behind the icon
}

const STATE_COLORS: Record<ContainerState, string> = {
  running: "#4CAF50",      // Green
  stopped: "#F44336",      // Red
  paused: "#FF9800",       // Orange
  restarting: "#2196F3",   // Blue
  exited: "#9E9E9E",       // Gray
  starting: "#8BC34A",     // Light green
  stopping: "#FF5722",     // Deep orange
};

const HEALTH_COLORS: Record<HealthState, string> = {
  stable: "#4CAF50",       // Solid green - confirmed stable
  starting: "#4CAF50",     // Green - starting up (will blink)
  unstable: "#FF9800",     // Orange - running but not stable yet
  crashloop: "#F44336",    // Red - crash looping
  stopped: "#F44336",      // Red - stopped
  loading: "#9E9E9E",      // Gray - loading/unknown state
};

const DEFAULT_ICON_SIZE = 144;
const DEFAULT_DOT_SIZE = 32;

class IconGenerator {
  private iconCache: Map<string, string> = new Map();

  /**
   * Convert SVG string to base64 data URI
   */
  private svgToBase64(svg: string): string {
    const base64 = Buffer.from(svg).toString("base64");
    return base64;
  }

  /**
   * Generate a dynamic icon with status indicator
   */
  async generateIcon(
    containerName: string,
    state: ContainerState,
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const dotSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const dotPosition = options.statusDotPosition || "top-right";
    const backgroundColor = options.backgroundColor;

    const cacheKey = `${containerName}-${state}-${size}-${dotSize}-${customIconBase64 ? 'custom' : 'default'}-${backgroundColor || 'none'}`;

    // Check cache first (skip cache for custom icons as they might change)
    if (!customIconBase64 && !backgroundColor) {
      const cached = this.iconCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const color = STATE_COLORS[state] || STATE_COLORS.stopped;
      const icon = this.createIconSvg(containerName, color, size, dotSize, dotPosition, customIconBase64, backgroundColor);
      const base64 = this.svgToBase64(icon);

      // Cache the result (only for default icons without custom background)
      if (!customIconBase64 && !backgroundColor) {
        this.iconCache.set(cacheKey, base64);
      }

      return base64;
    } catch (error) {
      console.error("Failed to generate icon:", error);
      // Return a simple fallback icon
      return this.generateFallbackIcon(state, size);
    }
  }

  /**
   * Create complete icon SVG with status dot
   */
  private createIconSvg(
    containerName: string,
    dotColor: string,
    size: number,
    dotSize: number,
    dotPosition: string,
    customIconBase64?: string,
    backgroundColor?: string
  ): string {
    const letter = containerName.charAt(0).toUpperCase();
    const fontSize = Math.floor(size * 0.5);
    const glowSize = dotSize + 8;
    const { x, y } = this.calculateDotPosition(size, dotSize, dotPosition);
    const dotCenterX = x + glowSize / 2;
    const dotCenterY = y + glowSize / 2;

    // Build the layers: background → content → status dot
    let bgDef: string;
    let bgRect: string;
    let content: string;

    // Layer 1: Background (solid color or gradient)
    if (backgroundColor) {
      bgDef = "";
      bgRect = `<rect width="${size}" height="${size}" fill="${backgroundColor}"/>`;
    } else {
      bgDef = `
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3a3a3a"/>
          <stop offset="100%" style="stop-color:#1a1a1a"/>
        </linearGradient>`;
      bgRect = `<rect width="${size}" height="${size}" fill="url(#bg)"/>`;
    }

    // Layer 2: Content (custom image or letter)
    if (customIconBase64) {
      content = `
        <image href="data:image/png;base64,${customIconBase64}"
               width="${size}" height="${size}"
               preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      content = `
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="${fontSize}"
              font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
          ${letter}
        </text>`;
    }

    return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        ${bgDef}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      ${bgRect}
      ${content}
      <circle cx="${dotCenterX}" cy="${dotCenterY}" r="${dotSize / 2 - 2}"
              fill="${dotColor}" filter="url(#glow)" stroke="#000" stroke-width="2"/>
    </svg>`;
  }

  /**
   * Calculate dot position based on corner preference
   */
  private calculateDotPosition(
    iconSize: number,
    dotSize: number,
    position: string
  ): { x: number; y: number } {
    const padding = 4;
    const glowSize = dotSize + 8;

    switch (position) {
      case "top-right":
        return { x: iconSize - glowSize - padding, y: padding };
      case "top-left":
        return { x: padding, y: padding };
      case "bottom-left":
        return { x: padding, y: iconSize - glowSize - padding };
      case "bottom-right":
      default:
        return { x: iconSize - glowSize - padding, y: iconSize - glowSize - padding };
    }
  }

  /**
   * Generate a simple fallback icon
   */
  private generateFallbackIcon(state: ContainerState, size: number): string {
    const color = STATE_COLORS[state] || STATE_COLORS.stopped;

    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#2d2d2d"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 4}" fill="${color}"/>
    </svg>`;

    return this.svgToBase64(svg);
  }

  /**
   * Generate animation frame for transitions
   */
  async generateAnimationFrame(
    containerName: string,
    fromState: ContainerState,
    toState: ContainerState,
    progress: number, // 0 to 1
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const dotSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const backgroundColor = options.backgroundColor;

    // Interpolate color between states
    const fromColor = STATE_COLORS[fromState];
    const toColor = STATE_COLORS[toState];
    const interpolatedColor = this.interpolateColor(fromColor, toColor, progress);

    // Create pulsing effect during transition
    const pulseScale = 1 + Math.sin(progress * Math.PI * 2) * 0.2;
    const actualDotSize = Math.floor(dotSize * pulseScale);

    return this.generateIconWithCustomColor(containerName, interpolatedColor, actualDotSize, size, customIconBase64, backgroundColor);
  }

  /**
   * Generate loading/spinner animation frame
   */
  async generateLoadingFrame(
    containerName: string,
    frameIndex: number,
    totalFrames: number = 8,
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const dotSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const backgroundColor = options.backgroundColor;
    const angle = (frameIndex / totalFrames) * 360;

    const letter = containerName.charAt(0).toUpperCase();
    const fontSize = Math.floor(size * 0.4);
    const glowSize = dotSize + 8;
    // Position spinner at top-right (same as status dot)
    const dotX = size - glowSize - 4;
    const dotY = 4;

    // Build the layers: background → content → spinner
    let bgDef: string;
    let bgRect: string;
    let content: string;

    // Layer 1: Background (solid color or gradient)
    if (backgroundColor) {
      bgDef = "";
      bgRect = `<rect width="${size}" height="${size}" fill="${backgroundColor}"/>`;
    } else {
      bgDef = `
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3a3a3a"/>
          <stop offset="100%" style="stop-color:#1a1a1a"/>
        </linearGradient>`;
      bgRect = `<rect width="${size}" height="${size}" fill="url(#bg)"/>`;
    }

    // Layer 2: Content (custom image or letter)
    if (customIconBase64) {
      content = `
        <image href="data:image/png;base64,${customIconBase64}"
               width="${size}" height="${size}"
               preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      content = `
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="${fontSize}"
              font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
          ${letter}
        </text>`;
    }

    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        ${bgDef}
      </defs>
      ${bgRect}
      ${content}
      <g transform="translate(${dotX + glowSize / 2}, ${dotY + glowSize / 2})">
        <circle r="${dotSize / 2}" fill="none" stroke="#2196F3" stroke-width="3"
                stroke-dasharray="${dotSize * 0.8} ${dotSize * 0.8}"
                transform="rotate(${angle})"/>
      </g>
    </svg>`;

    return this.svgToBase64(svg);
  }

  /**
   * Generate icon with custom color (for animations)
   */
  private generateIconWithCustomColor(
    containerName: string,
    color: string,
    dotSize: number,
    iconSize: number,
    customIconBase64?: string,
    backgroundColor?: string
  ): string {
    const letter = containerName.charAt(0).toUpperCase();
    const fontSize = Math.floor(iconSize * 0.4);
    const glowSize = dotSize + 8;
    // Position dot at top-right
    const dotX = iconSize - glowSize - 4;
    const dotY = 4;

    // Build the layers: background color/gradient → custom image OR letter → status dot
    let bgDef: string;
    let bgRect: string;
    let content: string;

    // Layer 1: Background (solid color or gradient)
    if (backgroundColor) {
      // Solid background color
      bgDef = "";
      bgRect = `<rect width="${iconSize}" height="${iconSize}" fill="${backgroundColor}"/>`;
    } else {
      // Default gradient background
      bgDef = `
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3a3a3a"/>
          <stop offset="100%" style="stop-color:#1a1a1a"/>
        </linearGradient>`;
      bgRect = `<rect width="${iconSize}" height="${iconSize}" fill="url(#bg)"/>`;
    }

    // Layer 2: Content (custom image on top of background, or letter)
    if (customIconBase64) {
      // Custom image overlaid on the background
      content = `
        <image href="data:image/png;base64,${customIconBase64}"
               width="${iconSize}" height="${iconSize}"
               preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      // Letter text
      content = `
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="${fontSize}"
              font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
          ${letter}
        </text>`;
    }

    const svg = `<svg width="${iconSize}" height="${iconSize}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        ${bgDef}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      ${bgRect}
      ${content}
      <circle cx="${dotX + glowSize / 2}" cy="${dotY + glowSize / 2}" r="${dotSize / 2}"
              fill="${color}" filter="url(#glow)" stroke="#000" stroke-width="2"/>
    </svg>`;

    return this.svgToBase64(svg);
  }

  /**
   * Interpolate between two hex colors
   */
  private interpolateColor(color1: string, color2: string, factor: number): string {
    const c1 = this.hexToRgb(color1);
    const c2 = this.hexToRgb(color2);

    const r = Math.round(c1.r + (c2.r - c1.r) * factor);
    const g = Math.round(c1.g + (c2.g - c1.g) * factor);
    const b = Math.round(c1.b + (c2.b - c1.b) * factor);

    return `rgb(${r}, ${g}, ${b})`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  /**
   * Clear the icon cache
   */
  clearCache(): void {
    this.iconCache.clear();
  }

  /**
   * Generate blinking icon for starting state
   * The dot blinks on/off (not size change) to indicate starting
   */
  async generatePulsingFrame(
    containerName: string,
    healthState: HealthState,
    frameIndex: number,
    totalFrames: number = 6,
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const dotSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const backgroundColor = options.backgroundColor;

    // Simple on/off blink - alternating visibility
    const isVisible = frameIndex % 2 === 0;
    const color = isVisible ? HEALTH_COLORS[healthState] : "#1a1a1a"; // Green or dark (hidden)

    return this.generateIconWithCustomColor(containerName, color, dotSize, size, customIconBase64, backgroundColor);
  }

  /**
   * Generate blinking icon for crash loop state
   * The dot blinks on/off to indicate error
   */
  async generateBlinkingFrame(
    containerName: string,
    frameIndex: number,
    totalFrames: number = 6,
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const dotSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const backgroundColor = options.backgroundColor;

    // Blink: alternate between visible and dim
    const isVisible = frameIndex % 2 === 0;
    const color = isVisible ? HEALTH_COLORS.crashloop : "#661111"; // Bright red / dim red
    const actualDotSize = isVisible ? dotSize : Math.floor(dotSize * 0.8);

    return this.generateIconWithCustomColor(containerName, color, actualDotSize, size, customIconBase64, backgroundColor);
  }

  /**
   * Generate transition animation frame
   * Smoothly transitions from one color to another with blinking
   * @param direction - "starting" (red→green) or "stopping" (green→red)
   * @param progress - 0 to 1 (0 = start color, 1 = end color)
   * @param frameIndex - for blinking effect
   */
  async generateTransitionFrame(
    containerName: string,
    direction: "starting" | "stopping",
    progress: number,
    frameIndex: number,
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const dotSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const backgroundColor = options.backgroundColor;

    // Colors for transition
    // When starting: begin green (starting up) and stay green
    // When stopping: begin green (was running) and transition to red (stopped)
    const startColor = direction === "starting" ? "#4CAF50" : "#4CAF50"; // Green for both
    const endColor = direction === "starting" ? "#4CAF50" : "#F44336";   // Green for starting, Red for stopping
    const dimStartColor = direction === "starting" ? "#1a3d1a" : "#1a3d1a";
    const dimEndColor = direction === "starting" ? "#1a3d1a" : "#661111";

    // Interpolate between colors based on progress
    const brightColor = this.interpolateColor(startColor, endColor, progress);
    const dimColor = this.interpolateColor(dimStartColor, dimEndColor, progress);

    // Blink effect
    const isVisible = frameIndex % 2 === 0;
    const color = isVisible ? brightColor : dimColor;

    return this.generateIconWithCustomColor(containerName, color, dotSize, size, customIconBase64, backgroundColor);
  }

  /**
   * Generate icon based on container health status
   */
  async generateHealthIcon(
    containerName: string,
    healthState: HealthState,
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const dotSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const backgroundColor = options.backgroundColor;

    const color = HEALTH_COLORS[healthState] || HEALTH_COLORS.stopped;

    // For stable state with no custom icon, use cached icon
    if (!customIconBase64 && !backgroundColor && (healthState === "stable" || healthState === "stopped" || healthState === "loading")) {
      const cacheKey = `health-${containerName}-${healthState}-${size}-${dotSize}`;
      const cached = this.iconCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const icon = this.generateIconWithCustomColor(containerName, color, dotSize, size, customIconBase64, backgroundColor);
      this.iconCache.set(cacheKey, icon);
      return icon;
    }

    // For dynamic states, custom icons, or custom background, don't cache
    return this.generateIconWithCustomColor(containerName, color, dotSize, size, customIconBase64, backgroundColor);
  }

  /**
   * Generate icon with a logs badge overlay
   * Shows the container icon with a small logs icon in the corner
   */
  async generateLogsIcon(
    containerName: string,
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const badgeSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const backgroundColor = options.backgroundColor;

    const letter = containerName.charAt(0).toUpperCase();
    const fontSize = Math.floor(size * 0.5);

    // Position badge at top-right
    const badgeX = size - badgeSize - 8;
    const badgeY = 8;

    // Build the layers: background → content → badge
    let bgDef: string;
    let bgRect: string;
    let content: string;

    // Layer 1: Background
    if (backgroundColor) {
      bgDef = "";
      bgRect = `<rect width="${size}" height="${size}" fill="${backgroundColor}"/>`;
    } else {
      bgDef = `
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3a3a3a"/>
          <stop offset="100%" style="stop-color:#1a1a1a"/>
        </linearGradient>`;
      bgRect = `<rect width="${size}" height="${size}" fill="url(#bg)"/>`;
    }

    // Layer 2: Content
    if (customIconBase64) {
      content = `
        <image href="data:image/png;base64,${customIconBase64}"
               width="${size}" height="${size}"
               preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      content = `
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="${fontSize}"
              font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
          ${letter}
        </text>`;
    }

    // Logs icon - document with lines
    const logIconSize = badgeSize * 0.7;
    const logX = badgeX + (badgeSize - logIconSize) / 2;
    const logY = badgeY + (badgeSize - logIconSize) / 2;

    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        ${bgDef}
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.5"/>
        </filter>
      </defs>
      ${bgRect}
      ${content}
      <!-- Logs badge background -->
      <circle cx="${badgeX + badgeSize / 2}" cy="${badgeY + badgeSize / 2}" r="${badgeSize / 2}"
              fill="#5C6BC0" stroke="#000" stroke-width="2" filter="url(#shadow)"/>
      <!-- Document icon -->
      <g transform="translate(${logX}, ${logY})">
        <rect x="2" y="0" width="${logIconSize - 4}" height="${logIconSize}" rx="2" fill="#fff"/>
        <!-- Lines representing text -->
        <line x1="5" y1="${logIconSize * 0.25}" x2="${logIconSize - 5}" y2="${logIconSize * 0.25}" stroke="#5C6BC0" stroke-width="2"/>
        <line x1="5" y1="${logIconSize * 0.5}" x2="${logIconSize - 5}" y2="${logIconSize * 0.5}" stroke="#5C6BC0" stroke-width="2"/>
        <line x1="5" y1="${logIconSize * 0.75}" x2="${logIconSize - 8}" y2="${logIconSize * 0.75}" stroke="#5C6BC0" stroke-width="2"/>
      </g>
    </svg>`;

    return this.svgToBase64(svg);
  }

  /**
   * Generate icon with action badge (for showing what action will be performed)
   * @param actionType - The type of action: "start", "stop", "restart", "logs", "url"
   */
  async generateActionIcon(
    containerName: string,
    actionType: "start" | "stop" | "restart" | "logs" | "url",
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const badgeSize = options.statusDotSize || DEFAULT_DOT_SIZE;
    const backgroundColor = options.backgroundColor;

    const letter = containerName.charAt(0).toUpperCase();
    const fontSize = Math.floor(size * 0.5);

    // Position badge at top-right
    const badgeX = size - badgeSize - 8;
    const badgeY = 8;
    const badgeCenterX = badgeX + badgeSize / 2;
    const badgeCenterY = badgeY + badgeSize / 2;

    // Build the layers: background → content → badge
    let bgDef: string;
    let bgRect: string;
    let content: string;

    // Layer 1: Background
    if (backgroundColor) {
      bgDef = "";
      bgRect = `<rect width="${size}" height="${size}" fill="${backgroundColor}"/>`;
    } else {
      bgDef = `
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3a3a3a"/>
          <stop offset="100%" style="stop-color:#1a1a1a"/>
        </linearGradient>`;
      bgRect = `<rect width="${size}" height="${size}" fill="url(#bg)"/>`;
    }

    // Layer 2: Content
    if (customIconBase64) {
      content = `
        <image href="data:image/png;base64,${customIconBase64}"
               width="${size}" height="${size}"
               preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      content = `
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="${fontSize}"
              font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
          ${letter}
        </text>`;
    }

    // Badge colors and icons based on action type
    let badgeColor: string;
    let badgeIcon: string;
    const iconSize = badgeSize * 0.5;

    switch (actionType) {
      case "start":
        badgeColor = "#4CAF50"; // Green
        // Play triangle
        badgeIcon = `<polygon points="${badgeCenterX - iconSize / 3},${badgeCenterY - iconSize / 2} ${badgeCenterX - iconSize / 3},${badgeCenterY + iconSize / 2} ${badgeCenterX + iconSize / 2},${badgeCenterY}" fill="#fff"/>`;
        break;
      case "stop":
        badgeColor = "#F44336"; // Red
        // Stop square
        badgeIcon = `<rect x="${badgeCenterX - iconSize / 2}" y="${badgeCenterY - iconSize / 2}" width="${iconSize}" height="${iconSize}" fill="#fff"/>`;
        break;
      case "restart":
        badgeColor = "#2196F3"; // Blue
        // Circular arrow
        badgeIcon = `<path d="M${badgeCenterX - iconSize / 2},${badgeCenterY} A${iconSize / 2},${iconSize / 2} 0 1,1 ${badgeCenterX + iconSize / 2},${badgeCenterY}" fill="none" stroke="#fff" stroke-width="2"/>
                     <polygon points="${badgeCenterX + iconSize / 2 - 3},${badgeCenterY - 4} ${badgeCenterX + iconSize / 2 + 3},${badgeCenterY} ${badgeCenterX + iconSize / 2 - 3},${badgeCenterY + 4}" fill="#fff"/>`;
        break;
      case "logs":
        badgeColor = "#5C6BC0"; // Indigo
        // Document lines
        const logW = iconSize * 0.8;
        const logH = iconSize;
        badgeIcon = `<rect x="${badgeCenterX - logW / 2}" y="${badgeCenterY - logH / 2}" width="${logW}" height="${logH}" rx="1" fill="#fff"/>
                     <line x1="${badgeCenterX - logW / 3}" y1="${badgeCenterY - logH / 4}" x2="${badgeCenterX + logW / 3}" y2="${badgeCenterY - logH / 4}" stroke="${badgeColor}" stroke-width="1.5"/>
                     <line x1="${badgeCenterX - logW / 3}" y1="${badgeCenterY}" x2="${badgeCenterX + logW / 3}" y2="${badgeCenterY}" stroke="${badgeColor}" stroke-width="1.5"/>
                     <line x1="${badgeCenterX - logW / 3}" y1="${badgeCenterY + logH / 4}" x2="${badgeCenterX + logW / 4}" y2="${badgeCenterY + logH / 4}" stroke="${badgeColor}" stroke-width="1.5"/>`;
        break;
      case "url":
        badgeColor = "#9C27B0"; // Purple
        // Link/chain icon
        badgeIcon = `<circle cx="${badgeCenterX - iconSize / 4}" cy="${badgeCenterY}" r="${iconSize / 3}" fill="none" stroke="#fff" stroke-width="2"/>
                     <circle cx="${badgeCenterX + iconSize / 4}" cy="${badgeCenterY}" r="${iconSize / 3}" fill="none" stroke="#fff" stroke-width="2"/>`;
        break;
      default:
        badgeColor = "#9E9E9E";
        badgeIcon = "";
    }

    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        ${bgDef}
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.5"/>
        </filter>
      </defs>
      ${bgRect}
      ${content}
      <!-- Action badge -->
      <circle cx="${badgeCenterX}" cy="${badgeCenterY}" r="${badgeSize / 2}"
              fill="${badgeColor}" stroke="#000" stroke-width="2" filter="url(#shadow)"/>
      ${badgeIcon}
    </svg>`;

    return this.svgToBase64(svg);
  }

  /**
   * Generate icon with a validation checkmark badge (top-left corner)
   * Used to show brief confirmation after an action is completed
   */
  async generateValidationIcon(
    containerName: string,
    customIconBase64?: string,
    options: IconOptions = {}
  ): Promise<string> {
    const size = options.size || DEFAULT_ICON_SIZE;
    const badgeSize = 28; // Smaller badge for validation
    const backgroundColor = options.backgroundColor;

    const letter = containerName.charAt(0).toUpperCase();
    const fontSize = Math.floor(size * 0.5);

    // Position badge at top-left
    const badgeX = 8;
    const badgeY = 8;
    const badgeCenterX = badgeX + badgeSize / 2;
    const badgeCenterY = badgeY + badgeSize / 2;

    // Build the layers: background → content → badge
    let bgDef: string;
    let bgRect: string;
    let content: string;

    // Layer 1: Background
    if (backgroundColor) {
      bgDef = "";
      bgRect = `<rect width="${size}" height="${size}" fill="${backgroundColor}"/>`;
    } else {
      bgDef = `
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3a3a3a"/>
          <stop offset="100%" style="stop-color:#1a1a1a"/>
        </linearGradient>`;
      bgRect = `<rect width="${size}" height="${size}" fill="url(#bg)"/>`;
    }

    // Layer 2: Content
    if (customIconBase64) {
      content = `
        <image href="data:image/png;base64,${customIconBase64}"
               width="${size}" height="${size}"
               preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      content = `
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="${fontSize}"
              font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">
          ${letter}
        </text>`;
    }

    // Checkmark path
    const checkSize = badgeSize * 0.45;
    const checkX = badgeCenterX - checkSize / 2;
    const checkY = badgeCenterY;

    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        ${bgDef}
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.5"/>
        </filter>
      </defs>
      ${bgRect}
      ${content}
      <!-- Validation badge background -->
      <circle cx="${badgeCenterX}" cy="${badgeCenterY}" r="${badgeSize / 2}"
              fill="#4CAF50" stroke="#000" stroke-width="2" filter="url(#shadow)"/>
      <!-- Checkmark -->
      <path d="M${checkX},${checkY} l${checkSize * 0.35},${checkSize * 0.35} l${checkSize * 0.65},-${checkSize * 0.7}"
            fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    return this.svgToBase64(svg);
  }
}

export const iconGenerator = new IconGenerator();
