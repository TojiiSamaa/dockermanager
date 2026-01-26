import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imgsDir = path.join(__dirname, '..', 'io.deckops.containers.sdPlugin', 'imgs');

const icons = [
  { name: 'plugin-icon', size: 144 },
  { name: 'plugin-icon@2x', size: 288 },
  { name: 'category-icon', size: 28 },
  { name: 'category-icon@2x', size: 56 },
  { name: 'action-status', size: 20 },
  { name: 'action-status@2x', size: 40 },
  { name: 'action-toggle', size: 20 },
  { name: 'action-toggle@2x', size: 40 },
  { name: 'action-settings', size: 20 },
  { name: 'action-settings@2x', size: 40 },
  { name: 'state-running', size: 72 },
  { name: 'state-running@2x', size: 144 },
  { name: 'state-stopped', size: 72 },
  { name: 'state-stopped@2x', size: 144 },
];

async function generateIcons() {
  for (const icon of icons) {
    const svgPath = path.join(imgsDir, `${icon.name}.svg`);
    const pngPath = path.join(imgsDir, `${icon.name}.png`);

    if (fs.existsSync(svgPath)) {
      try {
        await sharp(svgPath)
          .resize(icon.size, icon.size)
          .png()
          .toFile(pngPath);
        console.log(`Generated: ${icon.name}.png`);
      } catch (err) {
        console.error(`Failed to generate ${icon.name}.png:`, err.message);
      }
    } else {
      console.warn(`SVG not found: ${svgPath}`);
    }
  }
}

generateIcons().then(() => console.log('Done!'));
