import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController } from 'fastify';
import type { FastifyInstance } from 'fastify';

import { jellyfinAuthenticator } from './auth/authenticator.js';
import type { Authenticator } from './auth/authenticator.js';
import { deezerClient } from './catalogue/deezer.js';
import { musicBrainzClient } from './catalogue/musicbrainz.js';
import type { MusicBrainzClient } from './catalogue/musicbrainz.js';
import { catalogueService } from './catalogue/service.js';
import type { CatalogueService } from './catalogue/service.js';
import type { HubConfig } from './config.js';
import { ownerAccess, noRules, transientCollection } from './contracts.js';
import type { AmbiguityPicker, CollectionSink, RequestAccess, RuleSource } from './contracts.js';
import { createStores } from './db/index.js';
import type { Stores } from './db/index.js';
import { createEventBus } from './events/bus.js';
import { lidarrClient } from './fetch/lidarr.js';
import type { LidarrClient } from './fetch/lidarr.js';
import { navidromeClient } from './fetch/navidrome.js';
import type { NavidromeClient } from './fetch/navidrome.js';
import { anthropicPickModel, modelPicker } from './fetch/pick.js';
import { createPipeline } from './fetch/pipeline.js';
import { createRunner } from './fetch/runner.js';
import { slskdClient } from './fetch/slskd.js';
import type { SlskdClient } from './fetch/slskd.js';
import { createHealthState } from './health.js';
import { HttpError } from './http.js';
import type { Fetch } from './http.js';
import { jellyfinLibrary } from './jellyfin/library.js';
import type { JellyfinLibrary } from './jellyfin/library.js';
import type { Logger } from './log.js';
import { createRequestService } from './requests/service.js';
import { askRoutes } from './routes/ask.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { requestRoutes } from './routes/requests.js';
import { version } from './version.js';

/** Every method a route answers; the preflight for a DELETE (cancel, undo) must allow it. */
export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'DELETE'] as const;

/** Everything the app wires; each piece can be replaced in tests. */
export interface BuildOptions {
  config: HubConfig;
  logger?: boolean;
  stores?: Stores;
  authenticator?: Authenticator;
  library?: JellyfinLibrary;
  musicBrainz?: MusicBrainzClient;
  catalogue?: CatalogueService;
  slskd?: SlskdClient;
  lidarr?: LidarrClient;
  navidrome?: NavidromeClient;
  /** Per-profile collections (F86); default: nothing stored (contracts.ts). */
  collection?: CollectionSink;
  /** Who sees and manages a request (F87); default: the asker and the watchers. */
  access?: RequestAccess;
  /** Household rules for the ranking (F80); default: none. */
  rules?: RuleSource;
  /** The tie-break; default: the model when `config.modelPick`, else none. */
  picker?: AmbiguityPicker;
  fetch?: Fetch;
  /** Milliseconds between SSE keepalives; tests shorten it. */
  pingMs?: number;
  /** Milliseconds between Lidarr album polls. */
  albumPollMs?: number;
  /** Start the pipeline runner (recovery and album polling) with the server. */
  startRunner?: boolean;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.trustProxy,
    // Never log request bodies or headers: they may carry tokens or what the user typed.
    logController: new LogController({ disableRequestLogging: true }),
    // A stop must not wait for an open `/events` stream to leave: its connection is ended with
    // the rest (production AK).
    forceCloseConnections: true,
  });
  const log: Logger = app.log;
  const doFetch = options.fetch ?? fetch;
  // An upstream failure a route did not catch is a hub-side 502 that names the service and
  // nothing else: Fastify's default would answer with Jellyfin's or Lidarr's own status and
  // message, so a revoked token read as the hub's 401 and a path leaked (production AI).
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      request.log.error(
        { service: error.service, status: error.status, url: request.url.split('?')[0] },
        'upstream call failed inside a route',
      );
      return reply.code(502).send({ error: 'upstream_error', service: error.service });
    }
    return reply.send(error);
  });

  const stores = options.stores ?? createStores(config.databasePath);
  const bus = createEventBus();
  const authenticator =
    options.authenticator ??
    jellyfinAuthenticator({
      url: config.jellyfin.url,
      // Admins (F87) arrive with the whole-house view; Jellyfin's own flag sets the role meanwhile.
      admins: [],
      profiles: stores.profiles,
      cache: stores.cache,
      fetch: doFetch,
    });
  const library =
    options.library ??
    jellyfinLibrary({
      url: config.jellyfin.url,
      apiKey: config.jellyfin.apiKey,
      fetch: doFetch,
      dryRun: config.dryRun,
      log,
    });
  const musicBrainz =
    options.musicBrainz ?? musicBrainzClient({ version, contact: config.contact, fetch: doFetch });
  const catalogue =
    options.catalogue ??
    catalogueService({
      musicBrainz,
      deezer: deezerClient({ fetch: doFetch }),
      cache: stores.cache,
      // The full answer the typeahead could not wait for reaches the typist's open panel.
      onLateAnswer: (owner, result) => bus.publish(owner, { type: 'catalogue', result }),
    });

  const slskd =
    options.slskd ??
    (config.slskd.url && config.slskd.apiKey
      ? slskdClient({
          url: config.slskd.url,
          apiKey: config.slskd.apiKey,
          dryRun: config.dryRun,
          log,
          fetch: doFetch,
        })
      : undefined);
  const lidarr =
    options.lidarr ??
    (config.lidarr.url && config.lidarr.apiKey
      ? lidarrClient({
          url: config.lidarr.url,
          apiKey: config.lidarr.apiKey,
          dryRun: config.dryRun,
          log,
          fetch: doFetch,
        })
      : undefined);
  const navidrome =
    options.navidrome ??
    (config.navidrome.url && config.navidrome.user && config.navidrome.password
      ? navidromeClient({
          url: config.navidrome.url,
          user: config.navidrome.user,
          password: config.navidrome.password,
          fetch: doFetch,
          dryRun: config.dryRun,
        })
      : undefined);

  const collection = options.collection ?? transientCollection();
  const picker =
    options.picker ??
    (config.modelPick && config.anthropic.apiKey
      ? modelPicker({
          model: anthropicPickModel({
            apiKey: config.anthropic.apiKey,
            model: config.anthropic.intentModel,
          }),
          log,
        })
      : undefined);
  const pipeline = createPipeline({
    stores,
    bus,
    catalogue,
    library,
    collection,
    rules: options.rules ?? noRules,
    ...(picker ? { picker } : {}),
    ...(slskd ? { slskd } : {}),
    ...(lidarr ? { lidarr } : {}),
    ...(navidrome ? { navidrome } : {}),
    lidarrDownloadsDir: config.lidarrDownloadsDir,
    dryRun: config.dryRun,
    albumDeadlineMs: config.albumDeadlineMs,
    ...(config.lidarr.rootFolder ? { rootFolder: config.lidarr.rootFolder } : {}),
    ...(config.lidarrFailedImportsDir
      ? { lidarrFailedImportsDir: config.lidarrFailedImportsDir }
      : {}),
    log,
  });
  const health = createHealthState();
  const runner = createRunner({
    pipeline,
    stores,
    bus,
    log,
    health,
    ...(options.albumPollMs ? { albumPollMs: options.albumPollMs } : {}),
  });
  const requests = createRequestService({
    stores,
    collection,
    access: options.access ?? ownerAccess,
    library,
    bus,
    enqueue: (id) => runner.enqueue(id),
    abandon: (req) => pipeline.abandon(req),
  });

  if (config.corsOrigins.length > 0) {
    // The browser preflights every DELETE (cancel, every undo): the methods must be listed, or the
    // app's Cancel and Undo die in the preflight while the hub never sees them.
    await app.register(cors, { origin: config.corsOrigins, methods: [...CORS_METHODS] });
  }
  // Per client address, every route but /health; 429 with retry-after past the limit.
  if (config.rateLimitPerMinute > 0) {
    await app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: '1 minute' });
  }

  await healthRoutes(app, config, authenticator, health);
  await catalogueRoutes(app, { authenticator, catalogue, library });
  await requestRoutes(app, { authenticator, requests });
  await eventRoutes(app, {
    authenticator,
    bus,
    ...(options.pingMs ? { pingMs: options.pingMs } : {}),
  });
  // The intent engine (F76) replaces this stub; the box's add path never goes through it.
  await askRoutes(app);

  app.decorate('hub', {
    stores,
    bus,
    runner,
    pipeline,
    requests,
    catalogue,
    library,
  });
  if (options.startRunner ?? true) {
    app.addHook('onReady', async () => runner.start());
  }
  app.addHook('onClose', async () => {
    runner.stop();
    if (!options.stores) stores.close();
  });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    hub: {
      stores: Stores;
      bus: ReturnType<typeof createEventBus>;
      runner: ReturnType<typeof createRunner>;
      pipeline: ReturnType<typeof createPipeline>;
      requests: ReturnType<typeof createRequestService>;
      catalogue: CatalogueService;
      library: JellyfinLibrary;
    };
  }
}

/**
 * The hub when its database cannot be used at start (a read-only volume, a bad path): instead of
 * exiting and restarting in a loop that nothing reports, the process stays up and answers `503`
 * everywhere, `/health` saying `database: error` and why, so the container check fails visibly
 * and the message is one `curl` away. Nothing else runs: no runner, no routes, no keys in use.
 */
export async function buildDegradedApp(options: {
  config: HubConfig;
  error: Error;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.config.trustProxy,
    logController: new LogController({ disableRequestLogging: true }),
    forceCloseConnections: true,
  });
  app.log.error({ error: options.error.message }, 'database unusable; serving degraded');
  app.get('/health', async (_request, reply) => {
    reply.code(503);
    return {
      status: 'degraded',
      service: 'renaissance-hub',
      version,
      database: 'error',
      error: options.error.message,
    };
  });
  app.setNotFoundHandler(async (_request, reply) => {
    reply.code(503);
    return { error: 'storage_error', message: 'The hub cannot use its database; see /health' };
  });
  return app;
}
