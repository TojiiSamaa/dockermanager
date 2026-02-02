/**
 * SVG Icon Library - Lucide-inspired icons for Docker operations
 * Optimized for Stream Deck display (144x144px)
 */

export interface IconOptions {
  size?: number;
  strokeWidth?: number;
  color?: string;
}

/**
 * Container/Docker icon
 */
export function containerIcon(options: IconOptions = {}): string {
  const { size = 64, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(40, 40)">
      <rect x="0" y="8" width="${size}" height="${size - 8}" rx="4"
            fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <rect x="4" y="0" width="${size - 8}" height="12" rx="2"
            fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <line x1="0" y1="24" x2="${size}" y2="24"
            stroke="${color}" stroke-width="${strokeWidth}"/>
      <line x1="16" y1="32" x2="16" y2="48"
            stroke="${color}" stroke-width="${strokeWidth}" opacity="0.5"/>
      <line x1="32" y1="32" x2="32" y2="48"
            stroke="${color}" stroke-width="${strokeWidth}" opacity="0.5"/>
      <line x1="48" y1="32" x2="48" y2="48"
            stroke="${color}" stroke-width="${strokeWidth}" opacity="0.5"/>
    </g>
  `;
}

/**
 * Play/Start icon
 */
export function playIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  const cx = size / 2;
  const cy = size / 2;
  return `
    <g transform="translate(48, 48)">
      <circle cx="${cx}" cy="${cy}" r="${cx - strokeWidth}"
              fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <polygon points="${cx - 8},${cy - 12} ${cx - 8},${cy + 12} ${cx + 10},${cy}"
               fill="${color}"/>
    </g>
  `;
}

/**
 * Stop icon
 */
export function stopIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  const cx = size / 2;
  const cy = size / 2;
  return `
    <g transform="translate(48, 48)">
      <circle cx="${cx}" cy="${cy}" r="${cx - strokeWidth}"
              fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <rect x="${cx - 10}" y="${cy - 10}" width="20" height="20"
            fill="${color}"/>
    </g>
  `;
}

/**
 * Refresh/Restart icon
 */
export function refreshIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <path d="M 24 8 A 16 16 0 1 1 10.34 13.66"
            fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
      <polygon points="24,4 20,12 28,12" fill="${color}"/>
    </g>
  `;
}

/**
 * Logs/File icon
 */
export function logsIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <path d="M 10 8 L 10 40 L 38 40 L 38 16 L 30 8 Z"
            fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
      <polyline points="30,8 30,16 38,16"
                fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
      <line x1="16" y1="20" x2="32" y2="20" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
      <line x1="16" y1="26" x2="32" y2="26" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
      <line x1="16" y1="32" x2="26" y2="32" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
    </g>
  `;
}

/**
 * Stack/Layers icon (for Docker Compose)
 */
export function stackIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <polygon points="24,10 38,16 24,22 10,16"
               fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
      <polyline points="10,24 24,30 38,24"
                fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
      <polyline points="10,32 24,38 38,32"
                fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
    </g>
  `;
}

/**
 * Image/Package icon
 */
export function imageIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <rect x="8" y="8" width="32" height="32" rx="4"
            fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <circle cx="17" cy="17" r="3" fill="${color}"/>
      <polyline points="14,32 20,26 26,32 32,26 40,34"
                fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  `;
}

/**
 * Network icon
 */
export function networkIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <circle cx="24" cy="12" r="4" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <circle cx="12" cy="36" r="4" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <circle cx="36" cy="36" r="4" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <line x1="24" y1="16" x2="24" y2="24" stroke="${color}" stroke-width="${strokeWidth}"/>
      <line x1="24" y1="24" x2="12" y2="32" stroke="${color}" stroke-width="${strokeWidth}"/>
      <line x1="24" y1="24" x2="36" y2="32" stroke="${color}" stroke-width="${strokeWidth}"/>
    </g>
  `;
}

/**
 * Trash/Delete icon
 */
export function trashIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <path d="M 10 14 L 12 38 A 2 2 0 0 0 14 40 L 34 40 A 2 2 0 0 0 36 38 L 38 14"
            fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
      <line x1="8" y1="14" x2="40" y2="14" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
      <path d="M 18 14 L 18 10 A 2 2 0 0 1 20 8 L 28 8 A 2 2 0 0 1 30 10 L 30 14"
            fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <line x1="20" y1="20" x2="20" y2="34" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
      <line x1="28" y1="20" x2="28" y2="34" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
    </g>
  `;
}

/**
 * Disk/Storage icon
 */
export function diskIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <rect x="8" y="12" width="32" height="28" rx="2"
            fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <line x1="8" y1="20" x2="40" y2="20" stroke="${color}" stroke-width="${strokeWidth}"/>
      <circle cx="14" cy="16" r="1.5" fill="${color}"/>
      <line x1="16" y1="28" x2="34" y2="28" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
      <line x1="16" y1="32" x2="28" y2="32" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
    </g>
  `;
}

/**
 * Settings/Gear icon
 */
export function settingsIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 2, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <circle cx="24" cy="24" r="4" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
      <path d="M 24 10 L 26 16 L 24 10 L 22 16 M 32.5 13.5 L 28 18 M 37.5 22 L 32 24 M 37.5 26 L 32 24 M 32.5 34.5 L 28 30 M 24 38 L 24 32 M 15.5 34.5 L 20 30 M 10.5 26 L 16 24 M 10.5 22 L 16 24 M 15.5 13.5 L 20 18"
            stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
    </g>
  `;
}

/**
 * Status dot indicator
 */
export function statusDot(x: number, y: number, color: string, size: number = 24): string {
  return `
    <circle cx="${x}" cy="${y}" r="${size / 2}" fill="${color}" opacity="0.9"/>
    <circle cx="${x}" cy="${y}" r="${size / 2 - 2}" fill="${color}" opacity="0.6"/>
  `;
}

/**
 * Checkmark icon
 */
export function checkIcon(options: IconOptions = {}): string {
  const { size = 48, strokeWidth = 3, color = "currentColor" } = options;
  return `
    <g transform="translate(48, 48)">
      <polyline points="12,24 20,32 36,16"
                fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  `;
}
