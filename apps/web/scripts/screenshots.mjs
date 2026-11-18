#!/usr/bin/env node
/**
 * Retakes docs/screens/phase-0 from the built web app (`pnpm --filter web build` first) with
 * Playwright's Chromium at exact viewports and device scale 2. Starts `vite preview` itself.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const out = fileURLToPath(new URL('../../../docs/screens/phase-0/', import.meta.url));
mkdirSync(out, { recursive: true });
const port = 4174;
const base = `http://127.0.0.1:${port}`;

const viewports = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1280, height: 800 },
};

/** Every committed screenshot: [file, route, viewport, lang, theme]. */
const shots = [];
for (const device of Object.keys(viewports))
  for (const lang of ['en', 'gu'])
    for (const theme of ['dark', 'light'])
      shots.push([`home-${device}-${lang}-${theme}`, '/', device, lang, theme]);
shots.push(
  ['library-phone-gu-dark', '/library', 'phone', 'gu', 'dark'],
  ['library-tablet-gu-light', '/library', 'tablet', 'gu', 'light'],
  ['requests-desktop-en-dark', '/requests', 'desktop', 'en', 'dark'],
  ['requests-phone-en-light', '/requests', 'phone', 'en', 'light'],
  ['sign-in-desktop-gu-light', '/sign-in', 'desktop', 'gu', 'light'],
  ['sign-in-phone-en-dark', '/sign-in', 'phone', 'en', 'dark'],
);

const preview = spawn(
  'pnpm',
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'ignore',
  },
);
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const browser = await chromium.launch();
  for (const [file, route, device, lang, theme] of shots) {
    const context = await browser.newContext({
      viewport: viewports[device],
      deviceScaleFactor: 2,
      colorScheme: theme,
      locale: lang === 'gu' ? 'gu-IN' : 'en-US',
    });
    const page = await context.newPage();
    await page.goto(`${base}${route}?lang=${lang}&theme=${theme}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${out}${file}.png` });
    if (file === 'home-phone-en-dark') {
      await page.getByRole('heading', { name: 'Made for you' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}home-phone-en-dark-scrolled.png` });
    }
    await context.close();
    console.log(`wrote ${file}.png`);
  }
  await browser.close();
} finally {
  preview.kill('SIGTERM');
}
