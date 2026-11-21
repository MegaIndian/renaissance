#!/usr/bin/env node
/**
 * The hub as the browser tests see it: the real server (routes, CORS, the request service, the
 * pipeline in dry-run mode, the household database in memory) in front of stand-ins for Jellyfin,
 * MusicBrainz, Deezer, slskd and Lidarr, routed by hostname, so Playwright can add a song, undo it
 * and cancel it through real DELETE requests from a real page. Nothing outside this process is
 * contacted. Started by `apps/web/playwright.config.ts`; token `e2e-token`, port 8787 (the web
 * app's default hub address for the host it is served from).
 *
 *   node --disable-warning=ExperimentalWarning --import tsx apps/hub/scripts/e2e-hub.mjs
 */
import { buildApp } from '../src/app.ts';
import { staticAuthenticator } from '../src/auth/authenticator.ts';
import { loadConfig } from '../src/config.ts';
import { createStores } from '../src/db/index.ts';

const port = Number(process.env.E2E_HUB_PORT ?? 8787);
const origins = process.env.E2E_WEB_ORIGINS ?? 'http://127.0.0.1:4173,http://localhost:4173';
const profile = { id: 'u-e2e', name: 'Sahil', role: 'admin', mode: 'simple', language: 'en' };

const recording = {
  id: '3f3d2a1e-5c5e-4a1a-9b1e-7f0c4a6d2b10',
  title: 'Fireman',
  length: 263_000,
  'artist-credit': [
    {
      name: 'Lil Wayne',
      artist: { id: 'ac9a487a-d9d2-4f27-bb23-0f4686488345', name: 'Lil Wayne' },
    },
  ],
  releases: [
    {
      id: 'c0ffee00-0000-4000-8000-000000000003',
      title: 'Tha Carter II',
      status: 'Official',
      date: '2005-12-06',
      'release-group': {
        id: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
        title: 'Tha Carter II',
        'primary-type': 'Album',
      },
    },
  ],
};
const deezerTrack = (id, title, artist, album) => ({
  id,
  title,
  duration: 263,
  artist: { id: id * 10, name: artist },
  album: { id: id * 100, title: album },
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Every outside service, by hostname. slskd searches never complete: a request stays `finding`. */
const standIn = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method ?? 'GET';
  switch (url.hostname) {
    case 'musicbrainz.org':
      if (url.pathname.endsWith('/recording')) return json({ recordings: [recording] });
      if (url.pathname.endsWith('/release-group')) return json({ 'release-groups': [] });
      if (url.pathname.includes('/release/')) return json({ ...recording.releases[0], media: [] });
      return json({});
    case 'api.deezer.com':
      if (url.pathname === '/search')
        return json({
          data: [
            deezerTrack(1, 'Fireman', 'Lil Wayne', 'Tha Carter II'),
            deezerTrack(2, 'Fireman', 'Elliphant', 'Living Life Golden'),
          ],
        });
      return json({ data: [] });
    case 'slskd.e2e':
      if (url.pathname.endsWith('/searches') && method === 'POST')
        return json({ id: 'search-1', state: 'InProgress' }, 200);
      if (url.pathname.endsWith('/responses')) return json([]);
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return json({ id: 'search-1', state: 'InProgress' });
    case 'lidarr.e2e':
      return json([]);
    default:
      // Jellyfin: an empty library.
      return json({ Items: [], TotalRecordCount: 0 });
  }
};

const stores = createStores(':memory:');
stores.profiles.seen(profile.id, profile.name, profile.role);
const app = await buildApp({
  config: loadConfig({
    RENAISSANCE_HUB_DB: ':memory:',
    RENAISSANCE_HUB_PORT: String(port),
    RENAISSANCE_HUB_HOST: '127.0.0.1',
    RENAISSANCE_HUB_CORS_ORIGINS: origins,
    RENAISSANCE_HUB_RATE_LIMIT: '0',
    RENAISSANCE_HUB_DRY_RUN: 'true',
    JELLYFIN_URL: 'http://jellyfin.e2e',
    JELLYFIN_API_KEY: 'e2e',
    SLSKD_URL: 'http://slskd.e2e',
    SLSKD_API_KEY: 'e2e',
    LIDARR_URL: 'http://lidarr.e2e',
    LIDARR_API_KEY: 'e2e',
  }),
  stores,
  authenticator: staticAuthenticator({ 'e2e-token': profile }),
  fetch: standIn,
});
await app.listen({ host: '127.0.0.1', port });
console.log(`e2e hub listening on http://127.0.0.1:${port} (token e2e-token)`);
const stop = () => void app.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
