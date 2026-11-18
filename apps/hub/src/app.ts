import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController } from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { HubConfig } from './config.js';
import { askRoutes } from './routes/ask.js';
import { healthRoutes } from './routes/health.js';
import { memoryRequestStore, requestRoutes } from './routes/requests.js';
import type { RequestStore } from './routes/requests.js';

export interface BuildOptions {
  config: HubConfig;
  requestStore?: RequestStore;
  logger?: boolean;
}

export async function buildApp({
  config,
  requestStore,
  logger = false,
}: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    // Never log request bodies or headers: they may carry tokens or what the user typed.
    logController: new LogController({ disableRequestLogging: true }),
  });

  if (config.corsOrigins.length > 0) {
    await app.register(cors, { origin: config.corsOrigins });
  }

  // Per client address, every route but /health; 429 with retry-after past the limit.
  if (config.rateLimitPerMinute > 0) {
    await app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: '1 minute' });
  }

  await healthRoutes(app, config);
  await askRoutes(app);
  await requestRoutes(app, requestStore ?? memoryRequestStore());

  return app;
}
