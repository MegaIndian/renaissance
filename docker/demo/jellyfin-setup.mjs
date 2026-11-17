/**
 * Completes a fresh Jellyfin 10.10 server's setup through its API: the startup wizard, the first
 * user, the music library, a scan. Pure: everything goes through the `fetch` passed in, so the
 * sequence is unit-tested with a fake and `start.mjs --dry-run` prints it without a server.
 *
 * Endpoints (Jellyfin 10.10 OpenAPI):
 *   GET  /System/Info/Public            server up; StartupWizardCompleted
 *   POST /Startup/Configuration         UI culture, metadata language and country
 *   GET  /Startup/User                  initialises the first user (required before the POST)
 *   POST /Startup/User                  name and password
 *   POST /Startup/RemoteAccess          allow access from other machines, no UPnP
 *   POST /Startup/Complete              closes the wizard
 *   POST /Users/AuthenticateByName      token for the API calls below
 *   GET  /Library/VirtualFolders        is the library already there?
 *   POST /Library/VirtualFolders        add Music at /media/music (and refresh)
 *   POST /Library/Refresh               scan
 */
import { randomBytes } from 'node:crypto';

export const CLIENT = {
  name: 'Renaissance Demo Setup',
  device: 'renaissance-demo',
  deviceId: 'renaissance-demo-setup',
  version: '0.0.0',
};

export const DEMO_USER = 'demo';
export const LIBRARY_NAME = 'Music';
export const LIBRARY_PATH = '/media/music';

export function authorizationHeader(token) {
  const parts = [
    `Client="${CLIENT.name}"`,
    `Device="${CLIENT.device}"`,
    `DeviceId="${CLIENT.deviceId}"`,
    `Version="${CLIENT.version}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

/** 24 URL-safe characters; printed once and written to config/demo-credentials.json. */
export function randomPassword(bytes = randomBytes) {
  return bytes(18).toString('base64url');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls GET /System/Info/Public until the server answers. Returns the public info.
 * @param {object} o
 * @param {typeof fetch} o.fetch
 * @param {string} o.baseUrl
 * @param {number} [o.attempts]
 * @param {number} [o.intervalMs]
 */
export async function waitForServer({ fetch, baseUrl, attempts = 60, intervalMs = 2000 }) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/System/Info/Public`);
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Jellyfin did not answer at ${baseUrl} (${lastError?.message ?? 'no response'})`);
}

/**
 * Runs the wizard and library setup. Returns `{ user, password, token, userId, skipped }` and the
 * list of API calls made, in order, for the dry run and the tests.
 *
 * @param {object} o
 * @param {typeof fetch} o.fetch
 * @param {string} o.baseUrl        for example http://localhost:8096
 * @param {string} [o.password]     defaults to a random one
 * @param {(line: string) => void} [o.log]
 * @param {{ wizardCompleted?: boolean }} [o.publicInfo]  result of waitForServer; fetched if absent
 */
export async function setupJellyfin({
  fetch,
  baseUrl,
  password = randomPassword(),
  log = () => {},
  publicInfo,
}) {
  const calls = [];
  async function call(method, path, { body, token, query } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
      else url.searchParams.set(k, v);
    }
    const headers = { Authorization: authorizationHeader(token) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    calls.push({ method, path: url.pathname + url.search, body });
    log(`${method} ${url.pathname}${url.search}`);
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${url.pathname}: HTTP ${res.status} ${text}`.trim());
    }
    return res;
  }

  const info = publicInfo ?? (await (await fetch(`${baseUrl}/System/Info/Public`)).json());
  const wizardDone = Boolean(info.StartupWizardCompleted);

  if (!wizardDone) {
    await call('POST', '/Startup/Configuration', {
      body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' },
    });
    await call('GET', '/Startup/User');
    await call('POST', '/Startup/User', { body: { Name: DEMO_USER, Password: password } });
    await call('POST', '/Startup/RemoteAccess', {
      body: { EnableRemoteAccess: true, EnableAutomaticPortMapping: false },
    });
    await call('POST', '/Startup/Complete');
  } else {
    log('Startup wizard already completed; keeping the existing user.');
  }

  const auth = await (
    await call('POST', '/Users/AuthenticateByName', {
      body: { Username: DEMO_USER, Pw: password },
    })
  ).json();
  const token = auth.AccessToken;
  const userId = auth.User?.Id;

  const folders = await (await call('GET', '/Library/VirtualFolders', { token })).json();
  const existing = Array.isArray(folders)
    ? folders.find((f) => f.CollectionType === 'music' || f.Name === LIBRARY_NAME)
    : undefined;
  if (!existing) {
    await call('POST', '/Library/VirtualFolders', {
      token,
      query: {
        name: LIBRARY_NAME,
        collectionType: 'music',
        paths: [LIBRARY_PATH],
        refreshLibrary: 'true',
      },
      body: {
        LibraryOptions: {
          EnableRealtimeMonitor: true,
          SaveLocalMetadata: false,
          EnableLUFSScan: false,
          PathInfos: [{ Path: LIBRARY_PATH }],
        },
      },
    });
  } else {
    log(`Library "${existing.Name}" already exists; not adding another.`);
  }
  await call('POST', '/Library/Refresh', { token });

  return { user: DEMO_USER, password, token, userId, skipped: wizardDone, calls };
}

/** A fetch that answers like a fresh server and records nothing: `--dry-run` and the tests. */
export function fakeJellyfinFetch({ wizardCompleted = false, libraries = [] } = {}) {
  const seen = [];
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    seen.push({
      method,
      path: url.pathname + url.search,
      headers: init.headers ?? {},
      body: init.body,
    });
    if (url.pathname === '/System/Info/Public') {
      return json({
        ServerName: 'fake',
        Version: '10.10.7',
        StartupWizardCompleted: wizardCompleted,
      });
    }
    if (url.pathname === '/Startup/User' && method === 'GET')
      return json({ Name: '', Password: '' });
    if (url.pathname.startsWith('/Startup/')) return new Response(null, { status: 204 });
    if (url.pathname === '/Users/AuthenticateByName') {
      return json({ AccessToken: 'fake-token', User: { Id: 'fake-user-id', Name: DEMO_USER } });
    }
    if (url.pathname === '/Library/VirtualFolders' && method === 'GET') return json(libraries);
    if (url.pathname === '/Library/VirtualFolders' || url.pathname === '/Library/Refresh') {
      return new Response(null, { status: 204 });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, seen };
}
