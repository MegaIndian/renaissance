#!/usr/bin/env node
/**
 * One brand mark on every surface: the note glyph from apps/web/public/favicon.svg (white note on
 * the primary blue, 8/32 corner radius) is exported as the Expo app icon, splash image, Android
 * adaptive icon layers and web favicon into apps/mobile/assets/images, on the dark background
 * `#0f0f14` (`colors.dark.background`), the colour app.json names for the splash and adaptive icon.
 *
 *   cd scripts/brand-icons && npm install && node export.mjs
 *
 * Re-run after changing favicon.svg; the PNGs are committed, so a reviewer sees the diff.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = new URL('../../', import.meta.url);
const out = (name) => fileURLToPath(new URL(`apps/mobile/assets/images/${name}`, root));

const favicon = await readFile(new URL('apps/web/public/favicon.svg', root), 'utf8');
const notePath = favicon.match(/<path d="([^"]+)"/)[1];
const primary = favicon.match(/fill="(#[0-9a-f]{6})"/i)[1];
const background = '#0f0f14';

/**
 * An SVG of `size` px: optional solid background, then the mark (rounded blue square with the white
 * note, drawn in favicon.svg's 32-unit space) scaled to `markSize` px and centred.
 */
function mark({ size, markSize = size, bg = null, glyphOnly = false, glyphFill = '#fff' }) {
  const scale = markSize / 32;
  const offset = (size - markSize) / 2;
  const square = glyphOnly ? '' : `<rect width="32" height="32" rx="8" fill="${primary}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${square}<path d="${notePath}" fill="${glyphFill}"/></g>
</svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

const files = {
  // App icon: the mark on the dark background; iOS and Android round the corners themselves.
  'icon.png': mark({ size: 1024, markSize: 704, bg: background }),
  // Splash: the mark alone, transparent, on the `#0f0f14` splash background from app.json.
  'splash-icon.png': mark({ size: 512 }),
  // Adaptive icon: the launcher masks to the inner 66 %, so the mark stays inside that circle.
  'android-icon-foreground.png': mark({ size: 1024, markSize: 560 }),
  'android-icon-background.png': mark({ size: 1024, markSize: 0, bg: background, glyphOnly: true }),
  // Monochrome layer: the launcher tints the alpha, so just the note.
  'android-icon-monochrome.png': mark({ size: 1024, markSize: 560, glyphOnly: true }),
  // Expo web favicon: the same picture as apps/web/public/favicon.svg.
  'favicon.png': mark({ size: 48 }),
};

for (const [name, svg] of Object.entries(files)) {
  await writeFile(out(name), await png(svg));
  console.log(`wrote apps/mobile/assets/images/${name}`);
}
