/**
 * `pnpm --filter hub request [--dry-run] "<title>" "<artist>"`: runs one request through the
 * pipeline from the command line, without the HTTP server, and prints every step. With
 * `--dry-run` the searches are real and every write to slskd, Lidarr, Navidrome or Jellyfin is
 * logged instead of sent. The request is stored under a local `cli` profile in the configured
 * database (use `RENAISSANCE_HUB_DB=:memory:` to keep nothing).
 */
import { pathToFileURL } from 'node:url';

import { deezerClient } from './catalogue/deezer.js';
import { musicBrainzClient } from './catalogue/musicbrainz.js';
import { catalogueService } from './catalogue/service.js';
import { loadConfig } from './config.js';
import { createStores } from './db/index.js';
import { createEventBus } from './events/bus.js';
import { lidarrClient } from './fetch/lidarr.js';
import { navidromeClient } from './fetch/navidrome.js';
import { createPipeline } from './fetch/pipeline.js';
import { slskdClient } from './fetch/slskd.js';
import { jellyfinLibrary } from './jellyfin/library.js';
import { recordingLogger } from './log.js';
import { version } from './version.js';

export type CliArgs =
  | { dryRun: boolean; kind: 'track' | 'album'; title: string; artist: string }
  | { dryRun: boolean; retry: string };

export function parseArgs(argv: string[]): CliArgs | string {
  const args = [...argv];
  const dryRun = args.includes('--dry-run');
  const album = args.includes('--album');
  const retryAt = args.indexOf('--retry');
  if (retryAt !== -1) {
    const id = args[retryAt + 1];
    return id ? { dryRun, retry: id } : 'usage: request --retry <request id>';
  }
  const rest = args.filter((a) => !a.startsWith('--'));
  const [title, artist] = rest;
  if (!title || !artist) {
    return 'usage: request [--dry-run] [--album] "<title>" "<artist>" | request --retry <request id>';
  }
  return { dryRun, kind: album ? 'album' : 'track', title, artist };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (typeof parsed === 'string') {
    console.error(parsed);
    return 2;
  }
  const config = loadConfig({
    ...process.env,
    ...(parsed.dryRun ? { RENAISSANCE_HUB_DRY_RUN: 'true' } : {}),
  });
  const log = recordingLogger((line) => console.log(line));
  const stores = createStores(config.databasePath);
  const bus = createEventBus();
  const library = jellyfinLibrary({ url: config.jellyfin.url, apiKey: config.jellyfin.apiKey });
  const catalogue = catalogueService({
    musicBrainz: musicBrainzClient({ version, contact: config.contact }),
    deezer: deezerClient(),
    cache: stores.cache,
  });
  const slskd =
    config.slskd.url && config.slskd.apiKey
      ? slskdClient({
          url: config.slskd.url,
          apiKey: config.slskd.apiKey,
          dryRun: config.dryRun,
          log,
        })
      : undefined;
  const lidarr =
    config.lidarr.url && config.lidarr.apiKey
      ? lidarrClient({
          url: config.lidarr.url,
          apiKey: config.lidarr.apiKey,
          dryRun: config.dryRun,
          log,
        })
      : undefined;
  const navidrome =
    config.navidrome.url && config.navidrome.user && config.navidrome.password
      ? navidromeClient({
          url: config.navidrome.url,
          user: config.navidrome.user,
          password: config.navidrome.password,
          dryRun: config.dryRun,
        })
      : undefined;
  const pipeline = createPipeline({
    stores,
    bus,
    catalogue,
    library,
    ...(slskd ? { slskd } : {}),
    ...(lidarr ? { lidarr } : {}),
    ...(navidrome ? { navidrome } : {}),
    lidarrDownloadsDir: config.lidarrDownloadsDir,
    dryRun: config.dryRun,
    ...(config.lidarr.rootFolder ? { rootFolder: config.lidarr.rootFolder } : {}),
    log,
  });
  const profile = stores.profiles.seen('cli', 'cli', 'admin');
  bus.subscribe(profile.id, (event) => {
    if (event.type === 'request') {
      const last = event.request.steps[event.request.steps.length - 1];
      console.log(
        `${event.request.status}${last?.reason ? ` (${last.reason})` : ''}${last?.detail ? `: ${last.detail}` : ''}`,
      );
    }
  });
  let request: ReturnType<typeof stores.requests.get>;
  if ('retry' in parsed) {
    request = stores.requests.get(parsed.retry);
    if (!request) {
      console.error(`no request ${parsed.retry} in ${config.databasePath}`);
      stores.close();
      return 2;
    }
    request = stores.requests.update(request.id, {
      status: 'requested',
      detail: 'Retried from the CLI',
    });
    console.log(`retrying request ${parsed.retry} ("${request!.title}" by ${request!.artist})`);
  } else {
    request = stores.requests.create(
      { kind: parsed.kind, title: parsed.title, artist: parsed.artist },
      profile.id,
    );
    console.log(
      `${parsed.dryRun ? 'dry run: ' : ''}request ${request.id} for "${parsed.title}" by ${parsed.artist}`,
    );
  }
  const result = await pipeline.run(request!.id);
  stores.close();
  if (!result) return 1;
  console.log(
    `final: ${result.status}${result.reason ? ` (${result.reason})` : ''}${result.detail ? `: ${result.detail}` : ''}`,
  );
  return result.status === 'failed' ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
