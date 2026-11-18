#!/usr/bin/env node
/**
 * Retakes the committed screenshots from the built web app (`pnpm --filter web build` first) with
 * Playwright's Chromium at exact viewports and device scale 2. Starts `vite preview` itself.
 *
 *   node scripts/screenshots.mjs            # docs/screens/phase-1, signed in to the demo server when
 *                                           # RENAISSANCE_DEMO_URL, _USER and _PASSWORD are set (never printed)
 *   node scripts/screenshots.mjs phase-0    # the signed-out set from phase 0
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const phase = process.argv[2] ?? 'phase-1';
const out = fileURLToPath(new URL(`../../../docs/screens/${phase}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const port = 4174;
const base = `http://127.0.0.1:${port}`;
const demo = {
  url: process.env.RENAISSANCE_DEMO_URL,
  user: process.env.RENAISSANCE_DEMO_USER,
  password: process.env.RENAISSANCE_DEMO_PASSWORD,
};
const signedIn = phase === 'phase-1' && demo.url && demo.user && demo.password;

const viewports = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1280, height: 800 },
};

/** Every committed screenshot: [file, route, viewport, lang, theme, mode]. */
const shots = [];
if (phase === 'phase-0') {
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
} else {
  for (const device of Object.keys(viewports)) {
    shots.push(
      [`home-${device}-en-dark`, '/', device, 'en', 'dark'],
      [`home-${device}-gu-light`, '/', device, 'gu', 'light'],
      [`library-songs-${device}-en-dark`, '/library?section=tracks', device, 'en', 'dark'],
      [`now-playing-${device}-en-dark`, '/now-playing', device, 'en', 'dark', 'simple', 'play'],
    );
  }
  shots.push(
    ['home-desktop-en-dark-advanced', '/', 'desktop', 'en', 'dark', 'advanced'],
    [
      'library-songs-desktop-gu-light-advanced',
      '/library?section=tracks&sort=playCount',
      'desktop',
      'gu',
      'light',
      'advanced',
    ],
    ['library-artists-tablet-en-light', '/library?section=artists', 'tablet', 'en', 'light'],
    ['artist-phone-en-dark', '/artist/__ARTIST__', 'phone', 'en', 'dark'],
    ['artist-desktop-gu-dark', '/artist/__ARTIST__', 'desktop', 'gu', 'dark'],
    ['queue-phone-en-light', '/queue', 'phone', 'en', 'light', 'simple', 'play'],
    ['queue-desktop-en-dark', '/queue', 'desktop', 'en', 'dark', 'simple', 'play'],
    [
      'now-playing-phone-gu-light-advanced',
      '/now-playing',
      'phone',
      'gu',
      'light',
      'advanced',
      'play',
    ],
    ['settings-phone-en-dark', '/settings', 'phone', 'en', 'dark'],
    ['settings-desktop-gu-light', '/settings', 'desktop', 'gu', 'light'],
    ['sign-in-phone-en-dark', '/sign-in', 'phone', 'en', 'dark', 'simple', 'signedOut'],
    ['sign-in-desktop-gu-light', '/sign-in', 'desktop', 'gu', 'light', 'simple', 'signedOut'],
    ['ask-results-desktop-en-dark', '/', 'desktop', 'en', 'dark', 'simple', 'ask'],
  );
}

const preview = spawn(
  'pnpm',
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore' },
);

async function signIn(page) {
  await page.goto(`${base}/sign-in?lang=en&theme=dark`);
  await page.getByRole('textbox', { name: 'Server address' }).fill(demo.url);
  await page.getByRole('textbox', { name: 'User name' }).fill(demo.user);
  await page.getByLabel('Password').fill(demo.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText(/Last refreshed|Loading your library/).waitFor({ timeout: 20_000 });
  // Wait for the first sync so the library screens have songs.
  await page.goto(`${base}/library?section=tracks&lang=en&theme=dark`);
  await page
    .getByRole('button', { name: /^Play / })
    .first()
    .waitFor({ timeout: 20_000 });
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  // One context keeps the vault, the cache and the queue across shots; the viewport changes per shot.
  const context = await browser.newContext({ viewport: viewports.desktop, deviceScaleFactor: 2 });
  const page = await context.newPage();
  let artistId = '';
  if (signedIn) {
    await signIn(page);
    await page.goto(`${base}/library?section=artists&lang=en&theme=dark`);
    const href = await page
      .getByRole('link', { name: /Kevin MacLeod/ })
      .first()
      .getAttribute('href');
    artistId = href?.split('/').pop() ?? '';
  }
  for (const [file, route, device, lang, theme, mode = 'simple', action] of shots) {
    if (action === 'signedOut' && signedIn) {
      // Sign out for the sign-in shots, then back in afterwards.
      await page.goto(`${base}/settings?lang=en&theme=dark`);
      await page.getByRole('button', { name: 'Sign out' }).click();
    }
    await page.setViewportSize(viewports[device]);
    await page.emulateMedia({ colorScheme: theme });
    const url = `${base}${route.replace('__ARTIST__', artistId)}${route.includes('?') ? '&' : '?'}lang=${lang}&theme=${theme}&mode=${mode}`;
    if (action === 'play' && signedIn) {
      await page.goto(`${base}/library?section=tracks&lang=${lang}&theme=${theme}&mode=${mode}`);
      await page
        .getByRole('button', { name: /^Play |^વગાડો/ })
        .first()
        .click();
      await page
        .getByRole('contentinfo')
        .getByRole('button', { name: /Pause|થોભાવો/ })
        .waitFor({ timeout: 15_000 });
    }
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    if (action === 'play' && signedIn) {
      // The saved queue comes back from storage after the vault is read; wait for it.
      await page
        .getByText(/Nothing playing|કંઈ વાગતું નથી/)
        .first()
        .waitFor({ state: 'hidden', timeout: 15_000 });
    }
    if (action === 'ask' && signedIn) {
      await page.getByRole('combobox').fill('kevin');
      await page.getByRole('option').first().waitFor();
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}${file}.png` });
    if (action === 'play' && signedIn) {
      await page
        .getByRole('button', { name: /Pause|થોભાવો/ })
        .first()
        .click()
        .catch(() => undefined);
    }
    if (action === 'signedOut' && signedIn) await signIn(page);
    console.log(`wrote ${file}.png`);
  }
  await browser.close();
} finally {
  preview.kill('SIGTERM');
}
