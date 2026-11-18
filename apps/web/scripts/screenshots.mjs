#!/usr/bin/env node
/**
 * Retakes docs/screens/phase-0 from the built web app (`pnpm --filter web build` first) with
 * Playwright's Chromium at exact viewports and device scale 2. Starts `vite preview` itself.
 * `--phase-2` retakes docs/screens/phase-2 instead: the Requests tab, "My music" and the Ask bar's
 * answer, against a hub played by Playwright's route interception (the canned answers below), so
 * the pictures show the screens with data and nothing real is contacted.
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
const hub = 'http://127.0.0.1:8787';

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
    ['requests-advanced-desktop-en-dark', '/requests?mode=advanced', 'desktop', 'en', 'dark'],
  ];
}

const at = '2026-11-18T05:30:00.000Z';
const request = (over) => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'track',
  title: 'Fireman',
  artist: 'Lil Wayne',
  album: 'Tha Carter II',
  requestedBy: 'u-sahil',
  requestedByName: 'Sahil',
  status: 'requested',
  createdAt: at,
  updatedAt: at,
  steps: [{ at, status: 'requested' }],
  ...over,
});
const cannedRequests = [
  request({
    id: '11111111-1111-4111-8111-111111111111',
    status: 'downloading',
    progress: { unit: 'percent', done: 42, total: 100, etaSeconds: 70 },
    steps: [
      { at, status: 'finding', detail: '"lil wayne fireman": 0 files, 0 usable' },
      {
        at,
        status: 'downloading',
        detail:
          '04 Fireman.flac from a sharer (score 108: title 100% in name, duration matches, flac, free slot, artist in path)',
      },
    ],
  }),
  request({
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Red (Taylor’s Version)',
    artist: 'Taylor Swift',
    album: 'Red (Taylor’s Version)',
    kind: 'album',
    requestedByName: 'Sahil',
    status: 'finding',
    progress: { unit: 'songs', done: 14, total: 30 },
    steps: [
      {
        at,
        status: 'finding',
        detail:
          'Lidarr is looking for Red (Taylor’s Version) (album 91); the hub checks every minute for up to 7 days',
      },
    ],
  }),
  request({
    id: '66666666-6666-4666-8666-666666666666',
    title: 'Monkeys Spinning Monkeys',
    artist: 'Kevin MacLeod',
    requestedByName: 'Mom',
    status: 'cancelled',
    steps: [{ at, status: 'cancelled', detail: 'Cancelled by Mom' }],
  }),
  request({
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Red (Taylor’s Version)',
    artist: 'Taylor Swift',
    album: 'Red (Taylor’s Version)',
    kind: 'album',
    requestedByName: 'Kevin',
    status: 'ready',
    steps: [{ at, status: 'ready', detail: 'Lidarr imported 30 of 30 tracks' }],
  }),
  request({
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Drowning',
    artist: 'A Boogie Wit da Hoodie',
    album: 'The Bigger Artist',
    requestedByName: 'Mom',
    status: 'failed',
    reason: 'no_results',
    steps: [
      {
        at,
        status: 'failed',
        reason: 'no_results',
        detail: 'Soulseek: "a boogie wit da hoodie drowning": 0 files; "drowning": 0 files',
      },
    ],
  }),
];
const cannedCollection = [
  {
    id: 1,
    profile: 'u-sahil',
    item: 'mb:recording:1',
    kind: 'track',
    title: 'Fireman',
    artist: 'Lil Wayne',
    album: 'Tha Carter II',
    addedBy: 'u-sahil',
    addedAt: at,
    source: 'request',
  },
  {
    id: 2,
    profile: 'u-sahil',
    item: 'jf-1',
    kind: 'album',
    title: 'Red (Taylor’s Version)',
    artist: 'Taylor Swift',
    addedBy: 'u-sahil',
    addedAt: at,
    source: 'add',
  },
  {
    id: 3,
    profile: 'u-sahil',
    item: 'jf-2',
    kind: 'track',
    title: 'Kabhi Kabhie Mere Dil Mein',
    artist: 'Mukesh',
    album: 'Kabhi Kabhie',
    addedBy: 'u-sahil',
    addedAt: at,
    source: 'import',
  },
];
const cannedCatalogue = {
  query: 'fireman',
  songs: [
    {
      id: 'mb:recording:da9023df-cd6b-48dc-b82c-2c43ad9a89dc',
      recordingId: 'da9023df-cd6b-48dc-b82c-2c43ad9a89dc',
      title: 'Fireman',
      artist: 'Lil Wayne',
      album: 'Tha Carter II',
      duration: 264,
      year: 2005,
      preview: 'https://cdn.deezer.test/fireman.mp3',
    },
    {
      id: 'mb:recording:9c1a7a4e-0000-4000-8000-000000000002',
      recordingId: '9c1a7a4e-0000-4000-8000-000000000002',
      title: 'Drowning',
      artist: 'A Boogie Wit da Hoodie',
      album: 'The Bigger Artist',
      duration: 209,
      libraryId: 'jf-drowning',
    },
    {
      id: 'mb:recording:9c1a7a4e-0000-4000-8000-000000000003',
      recordingId: '9c1a7a4e-0000-4000-8000-000000000003',
      title: 'Fireman',
      artist: 'Elliphant',
      album: 'Living Life Golden',
      duration: 211,
    },
  ],
  albums: [
    {
      id: 'mb:release-group:d97d9f3b-3dc1-3330-a240-b84b74e62044',
      releaseGroupId: 'd97d9f3b-3dc1-3330-a240-b84b74e62044',
      title: 'Tha Carter II',
      artist: 'Lil Wayne',
      type: 'Album',
      year: 2005,
    },
  ],
  artists: [
    {
      id: 'mb:artist:ac9a487a-d9d2-4f27-bb23-0f4686488345',
      artistId: 'ac9a487a-d9d2-4f27-bb23-0f4686488345',
      name: 'Lil Wayne',
    },
  ],
  cached: false,
};
const answerFor = (lang) => ({
  model: 'claude-opus-5-5',
  language: lang,
  instant: {
    tracks: [
      {
        id: 't1',
        kind: 'track',
        title: 'Fireman',
        artist: 'Lil Wayne',
        album: 'Tha Carter II',
        duration: 264,
      },
    ],
    albums: [],
    artists: [],
  },
  catalogue: { ...cannedCatalogue, songs: cannedCatalogue.songs.slice(2) },
  actions: [
    {
      tool: 'request',
      input: { kind: 'album', title: 'Tha Carter II', artist: 'Lil Wayne' },
      summary:
        lang === 'gu' ? 'Lil Wayneનું Tha Carter II માગ્યું' : 'Requested Tha Carter II by Lil Wayne',
      ranBy: 'hub',
      undoable: true,
      undo: { method: 'DELETE', path: '/requests/44444444-4444-4444-8444-444444444444' },
    },
    {
      tool: 'queue',
      input: { trackIds: ['t1'] },
      summary: lang === 'gu' ? '1 ગીત કતારમાં મૂકો' : 'Queue 1 song',
      doneSummary: lang === 'gu' ? 'કતારમાં 1 ગીત ઉમેર્યું' : 'Added 1 song to the queue',
      ranBy: 'app',
      undoable: true,
    },
  ],
  why:
    lang === 'gu'
      ? 'Fireman તમારી લાઇબ્રેરીમાં છે; બાકીનું આલ્બમ માગ્યું.'
      : 'Fireman is in your library; the rest of the album is on its way.',
  rejected: [],
  usage: { inputTokens: 2100, outputTokens: 140, cacheReadTokens: 1800, costUsd: 0.0117 },
  tools: [
    'search_library',
    'lookup_catalogue',
    'play',
    'queue',
    'make_playlist',
    'request',
    'set_rule',
    'explain',
  ],
});

/** The hub as the screenshots see it: every route answered from the canned data above. */
async function playHub(context, lang) {
  const json = (body, status = 200) => ({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
  await context.route(`${hub}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization,content-type,accept',
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        },
      });
    }
    if (path === '/me') {
      return route.fulfill(
        json({ id: 'u-sahil', name: 'Sahil', role: 'admin', mode: 'simple', language: lang }),
      );
    }
    if (path === '/requests') return route.fulfill(json(cannedRequests));
    if (path === '/catalogue/search') return route.fulfill(json(cannedCatalogue));
    if (path === '/collection') return route.fulfill(json(cannedCollection));
    if (path === '/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'access-control-allow-origin': '*' },
        body: `event: ping\ndata: ${JSON.stringify({ type: 'ping', at })}\n\n`,
      });
    }
    if (path === '/ask') {
      const answer = answerFor(lang);
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'access-control-allow-origin': '*' },
        body: `event: instant\ndata: ${JSON.stringify(answer.instant)}\n\nevent: answer\ndata: ${JSON.stringify(answer)}\n\n`,
      });
    }
    return route.fulfill(json({ error: 'not_found' }, 404));
  });
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
    if (phase2) await playHub(context, lang);
    await page.goto(
      `${base}${route}?lang=${lang}&theme=${theme}${phase2 ? '&hubToken=screenshot' : ''}`,
    );
    await page.waitForLoadState('networkidle');
    if (phase2 && file.startsWith('ask-answer')) {
      const box = page.getByRole('searchbox').first();
      await box.fill(
        lang === 'gu'
          ? 'fireman vagad ane aakhu album lavo'
          : 'play fireman and get the whole album',
      );
      await box.press('Enter');
      await page
        .getByText(lang === 'gu' ? 'Tha Carter II' : 'Requested Tha Carter II by Lil Wayne')
        .first()
        .waitFor();
    }
    if (phase2 && file.startsWith('ask-typeahead')) {
      const box = page.getByRole('searchbox').first();
      await box.fill('fireman');
      await page.getByRole('button', { name: lang === 'gu' ? 'આલ્બમ ઉમેરો' : 'Add album' }).waitFor();
    }
    if (phase2 && file.startsWith('requests')) await page.getByText('Fireman').first().waitFor();
    if (phase2 && file.startsWith('requests-advanced')) {
      await page.getByText('What happened').first().click();
    }
    if (phase2 && file.startsWith('library')) await page.getByText('Fireman').first().waitFor();
    await page.screenshot({ path: `${out}${file}.png` });
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
