#!/usr/bin/env node
/**
 * The hub as the browser tests see it (F61): the real server (routes, CORS, the request service,
 * the pipeline, the household database in memory) in front of stand-ins for every outside service,
 * so Playwright can type in the box, tap a song and watch it go from "on its way" to "Ready".
 * MusicBrainz and Deezer answer through a fetch stand-in routed by hostname; slskd, Lidarr and
 * Navidrome are the unit tests' in-memory fakes (a download takes two transfer polls); Jellyfin's
 * library holds one song, "Carefree" by Kevin MacLeod, so its row is added at once. Nothing outside
 * this process is contacted. Started by `apps/web/playwright.config.ts`; token `e2e-token`, port
 * 8787 (the web app's default hub address for the host it is served from).
 *
 *   node --disable-warning=ExperimentalWarning --import tsx apps/hub/scripts/e2e-hub.mjs
 */
import { buildApp } from '../src/app.ts';
import { staticAuthenticator } from '../src/auth/authenticator.ts';
import { loadConfig } from '../src/config.ts';
import { createStores } from '../src/db/index.ts';
import { FLAC, fakeLidarr, fakeNavidrome, fakeSlskd, ids, response } from '../test/fakes.ts';

const port = Number(process.env.E2E_HUB_PORT ?? 8787);
const origins = process.env.E2E_WEB_ORIGINS ?? 'http://127.0.0.1:4173,http://localhost:4173';
/** The Jellyfin user the page signs in as (the page's Jellyfin stand-in answers with the same). */
const profile = { id: 'u-e2e', name: 'Sahil', role: 'member', mode: 'simple', language: 'en' };

const wayne = { name: 'Lil Wayne', artist: { id: ids.artist, name: 'Lil Wayne' } };
const recording = {
  id: ids.recording,
  title: 'Fireman',
  length: 183_000,
  'artist-credit': [wayne],
  releases: [
    {
      id: ids.release,
      title: 'Tha Carter II',
      status: 'Official',
      date: '2005-12-06',
      'release-group': { id: ids.releaseGroup, title: 'Tha Carter II', 'primary-type': 'Album' },
    },
  ],
};
const deezerTrack = (id, title, artist, album) => ({
  id,
  title,
  duration: 183,
  preview: `https://cdn.e2e/preview-${id}.mp3`,
  artist: { id: id * 10, name: artist },
  album: { id: id * 100, title: album, cover_medium: `https://cdn.e2e/cover-${id}.jpg` },
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** MusicBrainz and Deezer, by hostname. */
const standIn = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const words = (url.searchParams.get('query') ?? url.searchParams.get('q') ?? '').toLowerCase();
  switch (url.hostname) {
    case 'musicbrainz.org':
      if (url.pathname.endsWith('/recording'))
        return json({ recordings: words.includes('fireman') ? [recording] : [] });
      if (url.pathname.endsWith('/release-group')) return json({ 'release-groups': [] });
      if (url.pathname.includes('/release/')) return json({ ...recording.releases[0], media: [] });
      return json({});
    case 'api.deezer.com':
      if (url.pathname === '/search') {
        if (words.includes('fireman'))
          return json({
            data: [
              deezerTrack(1, 'Fireman', 'Lil Wayne', 'Tha Carter II'),
              deezerTrack(2, 'Fireman', 'Elliphant', 'Living Life Golden'),
            ],
          });
        if (words.includes('carefree'))
          return json({ data: [deezerTrack(3, 'Carefree', 'Kevin MacLeod', 'Royalty Free')] });
      }
      return json({ data: [] });
    default:
      return json({ error: 'no stand-in' }, 404);
  }
};

/** Jellyfin's library as the hub sees it: Carefree is on the server, nothing else is. */
const carefree = {
  item: { Id: 'jf-carefree', Name: 'Carefree', Type: 'Audio', Artists: ['Kevin MacLeod'] },
  hit: { id: 'jf-carefree', kind: 'track', title: 'Carefree', artist: 'Kevin MacLeod' },
};
const library = {
  configured: true,
  find: async (input) => (input.title.toLowerCase() === 'carefree' ? carefree : undefined),
  search: async () => ({ tracks: [], albums: [], artists: [] }),
  tracksByArtists: async () => [],
  refresh: async () => true,
};

// A download that is under way for two polls, then done.
const slskd = fakeSlskd({
  results: { 'lil wayne fireman': [response('cuchillo', [{}])] },
  transfers: {
    [FLAC]: [
      { state: 'InProgress', bytesTransferred: 9_000_000 },
      { state: 'InProgress', bytesTransferred: 21_000_000 },
      { state: 'Completed, Succeeded', bytesTransferred: 30_000_000 },
    ],
  },
});

const stores = createStores(':memory:');
stores.profiles.seen(profile.id, profile.name, profile.role);
const app = await buildApp({
  config: loadConfig({
    RENAISSANCE_HUB_DB: ':memory:',
    RENAISSANCE_HUB_PORT: String(port),
    RENAISSANCE_HUB_HOST: '127.0.0.1',
    RENAISSANCE_HUB_CORS_ORIGINS: origins,
    RENAISSANCE_HUB_RATE_LIMIT: '0',
    JELLYFIN_URL: 'http://jellyfin.e2e',
    LIDARR_ROOT_FOLDER: '/files/media/music',
  }),
  stores,
  authenticator: staticAuthenticator({ 'e2e-token': profile }),
  library,
  slskd: slskd.client,
  lidarr: fakeLidarr().client,
  navidrome: fakeNavidrome().client,
  fetch: standIn,
});
await app.listen({ host: '127.0.0.1', port });
console.log(`e2e hub listening on http://127.0.0.1:${port} (token e2e-token)`);
const stop = () => void app.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
