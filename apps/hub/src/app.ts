import Anthropic from '@anthropic-ai/sdk';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController } from 'fastify';
import type { FastifyInstance } from 'fastify';

import { createBudget } from './ask/budget.js';
import { createEngine } from './ask/engine.js';
import type { ModelClient } from './ask/engine.js';
import { jellyfinAuthenticator } from './auth/authenticator.js';
import type { Authenticator } from './auth/authenticator.js';
import { deezerClient } from './catalogue/deezer.js';
import { musicBrainzClient } from './catalogue/musicbrainz.js';
import type { MusicBrainzClient } from './catalogue/musicbrainz.js';
import { catalogueService } from './catalogue/service.js';
import type { CatalogueService } from './catalogue/service.js';
import type { HubConfig } from './config.js';
import { createStores } from './db/index.js';
import type { Stores } from './db/index.js';
import { createEventBus } from './events/bus.js';
import { lidarrClient } from './fetch/lidarr.js';
import type { LidarrClient } from './fetch/lidarr.js';
import { navidromeClient } from './fetch/navidrome.js';
import type { NavidromeClient } from './fetch/navidrome.js';
import { createPipeline } from './fetch/pipeline.js';
import { createRunner } from './fetch/runner.js';
import { slskdClient } from './fetch/slskd.js';
import type { SlskdClient } from './fetch/slskd.js';
import type { Fetch } from './http.js';
import { jellyfinLibrary } from './jellyfin/library.js';
import type { JellyfinLibrary } from './jellyfin/library.js';
import type { Logger } from './log.js';
import { createRequestService } from './requests/service.js';
import { askRoutes } from './routes/ask.js';
import { budgetRoutes } from './routes/budget.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { collectionRoutes } from './routes/collection.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { requestRoutes } from './routes/requests.js';
import { ruleRoutes } from './routes/rules.js';
import { version } from './version.js';

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
  modelClient?: ModelClient;
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
  });
  const log: Logger = app.log;
  const doFetch = options.fetch ?? fetch;

  const stores = options.stores ?? createStores(config.databasePath);
  const bus = createEventBus();
  const authenticator =
    options.authenticator ??
    jellyfinAuthenticator({
      url: config.jellyfin.url,
      admins: config.admins,
      profiles: stores.profiles,
      cache: stores.cache,
      fetch: doFetch,
    });
  const library =
    options.library ??
    jellyfinLibrary({ url: config.jellyfin.url, apiKey: config.jellyfin.apiKey, fetch: doFetch });
  const musicBrainz =
    options.musicBrainz ?? musicBrainzClient({ version, contact: config.contact, fetch: doFetch });
  const catalogue =
    options.catalogue ??
    catalogueService({
      musicBrainz,
      deezer: deezerClient({ fetch: doFetch }),
      cache: stores.cache,
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

  const pipeline = createPipeline({
    stores,
    bus,
    catalogue,
    library,
    ...(slskd ? { slskd } : {}),
    ...(lidarr ? { lidarr } : {}),
    ...(navidrome ? { navidrome } : {}),
    lidarrDownloadsDir: config.lidarrDownloadsDir,
    ...(config.lidarr.rootFolder ? { rootFolder: config.lidarr.rootFolder } : {}),
    log,
  });
  const runner = createRunner({
    pipeline,
    stores,
    bus,
    log,
    ...(options.albumPollMs ? { albumPollMs: options.albumPollMs } : {}),
  });
  const requests = createRequestService({
    stores,
    library,
    bus,
    enqueue: (id) => runner.enqueue(id),
  });

  const budget = createBudget({
    usage: stores.usage,
    capUsd: config.budgetUsdPerMonth,
    model: config.anthropic.intentModel,
  });
  const modelClient =
    options.modelClient ??
    (config.anthropic.apiKey
      ? (new Anthropic({
          apiKey: config.anthropic.apiKey,
          maxRetries: 1,
          timeout: 30_000,
        }) as ModelClient)
      : undefined);
  const engineDeps = {
    client: modelClient,
    model: config.anthropic.intentModel,
    budget,
    stores,
    library,
    catalogue,
    requests,
    log,
  };
  const engine = createEngine(engineDeps);

  if (config.corsOrigins.length > 0) {
    await app.register(cors, { origin: config.corsOrigins });
  }
  // Per client address, every route but /health; 429 with retry-after past the limit.
  if (config.rateLimitPerMinute > 0) {
    await app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: '1 minute' });
  }

  await healthRoutes(app, config, authenticator);
  await meRoutes(app, { authenticator, stores });
  await catalogueRoutes(app, { authenticator, catalogue, library });
  await requestRoutes(app, { authenticator, requests });
  await collectionRoutes(app, { authenticator, stores });
  await ruleRoutes(app, { authenticator, stores });
  await budgetRoutes(app, { authenticator, budget });
  await eventRoutes(app, {
    authenticator,
    bus,
    ...(options.pingMs ? { pingMs: options.pingMs } : {}),
  });
  await askRoutes(app, { authenticator, engine, engineDeps });

  app.decorate('hub', {
    stores,
    bus,
    runner,
    pipeline,
    requests,
    budget,
    engine,
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
      budget: ReturnType<typeof createBudget>;
      engine: ReturnType<typeof createEngine>;
      catalogue: CatalogueService;
      library: JellyfinLibrary;
    };
  }
}
