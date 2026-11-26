import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  DEMO_USER,
  LIBRARY_PATH,
  authorizationHeader,
  fakeJellyfinFetch,
  randomPassword,
  setupJellyfin,
  waitForServer,
} from './jellyfin-setup.mjs';

const baseUrl = 'http://jellyfin.test:8096';

describe('setupJellyfin', () => {
  it('runs the wizard, creates the user, adds the library and scans, in order', async () => {
    const { fetch, seen } = fakeJellyfinFetch();
    const result = await setupJellyfin({ fetch, baseUrl, password: 'pw-1234' });
    assert.deepEqual(
      result.calls.map((c) => `${c.method} ${c.path}`),
      [
        'POST /Startup/Configuration',
        'GET /Startup/User',
        'POST /Startup/User',
        'POST /Startup/RemoteAccess',
        'POST /Startup/Complete',
        'POST /Users/AuthenticateByName',
        'GET /Library/VirtualFolders',
        'POST /Library/VirtualFolders?name=Music&collectionType=music&paths=%2Fmedia%2Fmusic&refreshLibrary=true',
        'POST /Library/Refresh',
      ],
    );
    assert.equal(result.user, DEMO_USER);
    assert.equal(result.password, 'pw-1234');
    assert.equal(result.token, 'fake-token');
    assert.equal(result.userId, 'fake-user-id');
    assert.equal(result.skipped, false);

    const user = seen.find((c) => c.method === 'POST' && c.path === '/Startup/User');
    assert.deepEqual(JSON.parse(user.body), { Name: 'demo', Password: 'pw-1234' });
    const auth = seen.find((c) => c.path === '/Users/AuthenticateByName');
    assert.deepEqual(JSON.parse(auth.body), { Username: 'demo', Pw: 'pw-1234' });
    assert.match(auth.headers.Authorization, /^MediaBrowser Client="Renaissance Demo Setup"/);
    assert.equal(auth.headers['Content-Type'], 'application/json');

    const library = seen.find(
      (c) => c.method === 'POST' && c.path.startsWith('/Library/VirtualFolders'),
    );
    assert.match(library.headers.Authorization, /Token="fake-token"/);
    assert.deepEqual(JSON.parse(library.body).LibraryOptions.PathInfos, [{ Path: LIBRARY_PATH }]);
    const refresh = seen.find((c) => c.path === '/Library/Refresh');
    assert.match(refresh.headers.Authorization, /Token="fake-token"/);
  });

  it('skips the wizard and the library when both already exist', async () => {
    const { fetch } = fakeJellyfinFetch({
      wizardCompleted: true,
      libraries: [{ Name: 'Music', CollectionType: 'music', Locations: [LIBRARY_PATH] }],
    });
    const lines = [];
    const result = await setupJellyfin({
      fetch,
      baseUrl,
      password: 'pw',
      log: (l) => lines.push(l),
    });
    assert.deepEqual(
      result.calls.map((c) => `${c.method} ${c.path}`),
      ['POST /Users/AuthenticateByName', 'GET /Library/VirtualFolders', 'POST /Library/Refresh'],
    );
    assert.equal(result.skipped, true);
    assert.ok(lines.some((l) => l.includes('already completed')));
    assert.ok(lines.some((l) => l.includes('already exists')));
  });

  it('on a re-run, refreshes only the songs with a lyrics file so Jellyfin reads it', async () => {
    const { fetch, seen } = fakeJellyfinFetch({
      wizardCompleted: true,
      libraries: [{ Name: 'Music', CollectionType: 'music' }],
      songs: [
        { Id: 'a', Name: 'Carefree', Path: '/media/music/Kevin MacLeod - Carefree.mp3' },
        { Id: 'b', Name: 'Sneaky Snitch', Path: '/media/music/Kevin MacLeod - Sneaky Snitch.mp3' },
        {
          Id: 'c',
          Name: 'Fluffing a Duck',
          Path: 'D:\\music\\Kevin MacLeod - Fluffing a Duck.mp3',
        },
        { Id: 'd', Name: 'No path' },
      ],
    });
    const lines = [];
    const result = await setupJellyfin({
      fetch,
      baseUrl,
      password: 'pw',
      log: (l) => lines.push(l),
      lyricTracks: ['Kevin MacLeod - Carefree.mp3', 'Kevin MacLeod - Fluffing a Duck.mp3'],
    });
    const refresh =
      '/Refresh?metadataRefreshMode=FullRefresh&imageRefreshMode=None&replaceAllMetadata=false&replaceAllImages=false';
    assert.deepEqual(
      result.calls.slice(3).map((c) => `${c.method} ${c.path}`),
      [
        'GET /Items?Recursive=true&IncludeItemTypes=Audio&Fields=Path',
        `POST /Items/a${refresh}`,
        `POST /Items/c${refresh}`,
      ],
    );
    assert.match(seen.at(-1).headers.Authorization, /Token="fake-token"/);
    assert.ok(lines.some((l) => l.includes('Refreshing "Carefree"')));
  });

  it('a fresh server has no songs yet, so the first scan reads the lyrics and nothing is refreshed', async () => {
    const { fetch } = fakeJellyfinFetch();
    const result = await setupJellyfin({
      fetch,
      baseUrl,
      password: 'pw',
      lyricTracks: ['Kevin MacLeod - Carefree.mp3'],
    });
    assert.equal(
      result.calls.at(-1).path,
      '/Items?Recursive=true&IncludeItemTypes=Audio&Fields=Path',
    );
  });

  it('every lyrics file tracks.json names is committed beside its song', () => {
    const manifest = JSON.parse(readFileSync(new URL('./tracks.json', import.meta.url), 'utf8'));
    const withLyrics = manifest.tracks.filter((t) => t.lyrics);
    assert.equal(withLyrics.length, 2);
    for (const track of withLyrics) {
      assert.equal(track.lyrics.replace(/\.(lrc|txt)$/, ''), track.file.replace(/\.mp3$/, ''));
      assert.ok(existsSync(new URL(`./music/${track.lyrics}`, import.meta.url)), track.lyrics);
    }
  });

  it('fails loudly on an unexpected status', async () => {
    const fetch = async () => new Response('nope', { status: 500 });
    await assert.rejects(
      setupJellyfin({
        fetch,
        baseUrl,
        password: 'pw',
        publicInfo: { StartupWizardCompleted: false },
      }),
      /POST \/Startup\/Configuration: HTTP 500 nope/,
    );
  });
});

describe('helpers', () => {
  it('builds the MediaBrowser header with and without a token', () => {
    assert.equal(
      authorizationHeader(),
      'MediaBrowser Client="Renaissance Demo Setup", Device="renaissance-demo", DeviceId="renaissance-demo-setup", Version="0.0.0"',
    );
    assert.match(authorizationHeader('t'), /, Token="t"$/);
  });

  it('makes a 24-character URL-safe password', () => {
    const pw = randomPassword();
    assert.equal(pw.length, 24);
    assert.match(pw, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(randomPassword(), pw);
  });

  it('waits for the server and gives up with the last error', async () => {
    let n = 0;
    const flaky = async () => {
      n++;
      if (n < 3) throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify({ StartupWizardCompleted: false }), { status: 200 });
    };
    const info = await waitForServer({ fetch: flaky, baseUrl, intervalMs: 1 });
    assert.equal(info.StartupWizardCompleted, false);
    assert.equal(n, 3);
    const never = async () => new Response('', { status: 503 });
    await assert.rejects(
      waitForServer({ fetch: never, baseUrl, attempts: 2, intervalMs: 1 }),
      /HTTP 503/,
    );
  });
});
