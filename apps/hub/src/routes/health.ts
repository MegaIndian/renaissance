import type { FastifyInstance } from 'fastify';

import { describe } from '../config.js';
import type { HubConfig } from '../config.js';
import { version } from '../version.js';

export async function healthRoutes(app: FastifyInstance, config: HubConfig): Promise<void> {
  // Container health checks poll this; it is never rate limited.
  app.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    service: 'renaissance-hub',
    version,
    integrations: describe(config),
  }));
}
