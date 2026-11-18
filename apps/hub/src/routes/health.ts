import type { FastifyInstance } from 'fastify';

import type { Authenticator } from '../auth/authenticator.js';
import { tokenFrom } from '../auth/plugin.js';
import { describe } from '../config.js';
import type { HubConfig } from '../config.js';
import { version } from '../version.js';

/**
 * Liveness for container checks, never rate limited. `status` is public; the `integrations` detail
 * (which services and models are configured) is answered only to a valid Jellyfin token (ADR 0007
 * addendum).
 */
export async function healthRoutes(
  app: FastifyInstance,
  config: HubConfig,
  authenticator: Authenticator,
): Promise<void> {
  app.get('/health', { config: { rateLimit: false } }, async (request) => {
    const body: Record<string, unknown> = { status: 'ok', service: 'renaissance-hub', version };
    const token = tokenFrom(request);
    if (token && authenticator.configured && (await authenticator.authenticate(token))) {
      body.integrations = describe(config);
    }
    return body;
  });
}
