import type { FastifyInstance } from 'fastify';

import { describe } from '../config.js';
import type { HubConfig } from '../config.js';

export async function healthRoutes(app: FastifyInstance, config: HubConfig): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'renaissance-hub',
    version: process.env['npm_package_version'] ?? '0.0.0',
    integrations: describe(config),
  }));
}
