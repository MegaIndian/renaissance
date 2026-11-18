#!/usr/bin/env node
/**
 * Retakes docs/screens/phase-0 from the built web app (`pnpm --filter web build` first) with
 * Playwright's Chromium at exact viewports and device scale 2. Starts `vite preview` itself.
 * `--phase-2` retakes docs/screens/phase-2 instead: the Requests tab, "My music" and the Ask bar
 * against a real hub (`HUB_URL`, default http://127.0.0.1:8787) started by hand in dry-run mode
 * (`RENAISSANCE_HUB_DRY_RUN=true`, CORS origin http://127.0.0.1:4174) with a token in `HUB_TOKEN`.
 * The script seeds the requests through the hub's own API (a song that reaches ready through the
 * dry pipeline, an album Lidarr is looking for, a cancelled one, a failed one) and the pictures
 * show what the hub really answers; nothing is mocked and nothing is downloaded.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const phase2 = process.argv.includes('--phase-2');
const out = fileURLToPath(
  new URL(`../../../docs/screens/${phase2 ? 'phase-2' : 'phase-0'}/`, import.meta.url),
);
mkdirSync(out, { recursive: true });
const port = 4174;
const base = `http://127.0.0.1:${port}`;
const hub = process.env.HUB_URL ?? 'http://127.0.0.1:8787';
const hubToken = process.env.HUB_TOKEN;

const viewports = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1280, height: 800 },
};

/** Every committed screenshot: [file, route, viewport, lang, theme]. */
let shots = [];
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
if (phase2) {
  shots = [
    ['requests-phone-en-dark', '/requests', 'phone', 'en', 'dark'],
    ['requests-phone-gu-light', '/requests', 'phone', 'gu', 'light'],
    ['requests-tablet-en-light', '/requests', 'tablet', 'en', 'light'],
    ['requests-desktop-en-dark', '/requests', 'desktop', 'en', 'dark'],
    ['requests-desktop-gu-dark', '/requests', 'desktop', 'gu', 'dark'],
    ['library-mine-phone-en-dark', '/library', 'phone', 'en', 'dark'],
    ['library-mine-desktop-gu-light', '/library', 'desktop', 'gu', 'light'],
    ['ask-answer-phone-en-dark', '/', 'phone', 'en', 'dark'],
    ['ask-answer-desktop-en-light', '/', 'desktop', 'en', 'light'],
    ['ask-answer-desktop-gu-dark', '/', 'desktop', 'gu', 'dark'],
    ['ask-typeahead-phone-en-dark', '/', 'phone', 'en', 'dark'],
    ['ask-typeahead-phone-gu-light', '/', 'phone', 'gu', 'light'],
    ['ask-typeahead-desktop-en-dark', '/', 'desktop', 'en', 'dark'],
    ['ask-add-tapped-phone-gu-light', '/', 'phone', 'gu', 'light'],
    ['ask-add-tapped-phone-en-dark', '/', 'phone', 'en', 'dark'],
    ['ask-sentence-phone-en-dark', '/', 'phone', 'en', 'dark'],
    ['ask-sentence-phone-gu-light', '/', 'phone', 'gu', 'light'],
    ['requests-advanced-desktop-en-dark', '/requests?mode=advanced', 'desktop', 'en', 'dark'],
  ];
}

/** The hub's API with the screenshot token. */
async function hubCall(method, path, body) {
  const res = await fetch(`${hub}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${hubToken}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function waitForStatus(id, wanted, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await hubCall('GET', `/requests/${id}`);
    if (body && wanted.includes(body.status)) return body;
    if (Date.now() > deadline)
      throw new Error(`request ${id} is ${body?.status}, wanted ${wanted.join('/')}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * What the Requests tab and "Mine" show: created through the real hub in dry-run mode. The song
 * goes through the real slskd search and a logged import (ready); the album is handed to Lidarr
 * (finding, with whatever soularr already fetched filed); one request is cancelled, one fails;
 * a song the demo server has lands in "Mine" as an add.
 */
async function seedHub() {
  if (!hubToken)
    throw new Error('HUB_TOKEN is needed for --phase-2 (a Jellyfin token the hub accepts)');
  const health = await fetch(`${hub}/health`).then((r) => r.json());
  console.log(`hub ${hub}: ${health.status} ${health.version}`);
  const me = await hubCall('GET', '/me');
  if (me.status !== 200) throw new Error(`hub refused the token: ${me.status}`);
  console.log(`signed in as ${me.body.name} (${me.body.role})`);
  const existing = (await hubCall('GET', '/requests')).body ?? [];
  if (existing.length > 0) {
    console.log(`hub already holds ${existing.length} requests; reusing them`);
    return;
  }
  const failed = await hubCall('POST', '/requests', {
    kind: 'track',
    title: 'Zzqqxxv Blorp',
    artist: 'Nobody Known',
  });
  // Cancelled before the runner reaches it: the first request holds the queue for a moment.
  const cancelled = await hubCall('POST', '/requests', {
    kind: 'track',
    title: 'Why This Kolaveri Di',
    artist: 'Dhanush',
  });
  const stop = await hubCall('DELETE', `/requests/${cancelled.body.id}`);
  console.log(`cancel answered ${stop.status} ${stop.body?.status ?? stop.body?.error ?? ''}`);
  const album = await hubCall('POST', '/requests', {
    kind: 'album',
    title: 'Look Back at It',
    artist: 'A Boogie Wit da Hoodie',
  });
  const song = await hubCall('POST', '/requests', {
    kind: 'track',
    title: 'Fireman',
    artist: 'Lil Wayne',
  });
  const already = await hubCall('POST', '/requests', {
    kind: 'track',
    title: 'Carefree',
    artist: 'Kevin MacLeod',
  });
  console.log(
    `seeded: ${failed.status} ${album.status} ${cancelled.status} ${song.status}; Carefree ${already.body?.alreadyHere ? 'already here' : already.status}`,
  );
  await waitForStatus(failed.body.id, ['failed']);
  await waitForStatus(album.body.id, ['finding', 'ready', 'failed']);
  await waitForStatus(song.body.id, ['ready', 'failed']);
  for (const r of (await hubCall('GET', '/requests')).body)
    console.log(
      `  ${r.status.padEnd(10)} ${r.title} by ${r.artist}${r.reason ? ` (${r.reason})` : ''}`,
    );
}

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
  if (phase2) await seedHub();
  const browser = await chromium.launch();
  for (const [file, route, device, lang, theme] of shots) {
    const context = await browser.newContext({
      viewport: viewports[device],
      deviceScaleFactor: 2,
      colorScheme: theme,
      locale: lang === 'gu' ? 'gu-IN' : 'en-US',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.error(`${file}: page error ${error.message}`));
    page.on('requestfailed', (request) =>
      console.error(
        `${file}: request failed ${request.url()} ${request.failure()?.errorText ?? ''}`,
      ),
    );
    const join = route.includes('?') ? '&' : '?';
    const token = phase2 ? `&hubToken=${encodeURIComponent(hubToken)}` : '';
    await page.goto(`${base}${route}${join}lang=${lang}&theme=${theme}${token}`);
    // Not `networkidle`: the hub's event stream stays open. Each shot waits for its own content.
    await page.waitForLoadState('load');
    await page.getByRole('searchbox').first().waitFor();
    const box = page.getByRole('searchbox').first();
    const add = lang === 'gu' ? 'ઉમેરો' : 'Add';
    const undoName = lang === 'gu' ? 'પાછું વાળો' : 'Undo';
    if (phase2 && file.startsWith('ask-answer')) {
      // Deterministic: an exact library title (the demo server has Carefree) plays without the model.
      await box.fill(lang === 'gu' ? 'Carefree વગાડો' : 'play carefree');
      await box.press('Enter');
      await page
        .getByText(lang === 'gu' ? 'Carefree વગાડો' : 'Play Carefree', { exact: true })
        .first()
        .waitFor();
    }
    if (phase2 && file.startsWith('ask-typeahead')) {
      await box.fill('fireman lil wayne');
      await page.getByRole('button', { name: add, exact: true }).first().waitFor();
    }
    if (phase2 && file.startsWith('ask-add-tapped')) {
      await box.fill('fireman lil wayne');
      await page.getByRole('button', { name: add, exact: true }).first().click();
      await page
        .getByText(lang === 'gu' ? /વિનંતીઓમાં/ : /in Requests/)
        .first()
        .waitFor();
    }
    if (phase2 && file.startsWith('ask-sentence')) {
      // The model is off on this hub: a sentence shows the model-off line and nothing to add.
      await box.fill(lang === 'gu' ? 'રસોઈ માટે શાંત ગીત વગાડ' : 'play something calm for cooking');
      await box.press('Enter');
      await page.getByText(lang === 'gu' ? /સ્માર્ટ જવાબ/ : /Smart answers are off/).waitFor();
    }
    if (phase2 && file.startsWith('requests')) await page.getByText('Fireman').first().waitFor();
    if (phase2 && file.startsWith('requests-advanced')) {
      await page.getByText('What happened').first().click();
    }
    if (phase2 && file.startsWith('library')) await page.getByText('Fireman').first().waitFor();
    await page.screenshot({ path: `${out}${file}.png` });
    if (phase2 && file.startsWith('ask-add-tapped')) {
      // Leave the hub as it was: undo the add when the row offers it.
      const undo = page.getByRole('button', { name: undoName });
      if ((await undo.count()) > 0) {
        await undo.first().click();
        await page.getByText(lang === 'gu' ? 'પાછું વાળ્યું' : 'Undone').waitFor();
      }
    }
    if (!phase2 && file === 'home-phone-en-dark') {
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
