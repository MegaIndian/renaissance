import type { FastifyInstance } from 'fastify';

import type { Authenticator } from '../auth/authenticator.js';
import { tokenFrom } from '../auth/plugin.js';
import { describe } from '../config.js';
import type { HubConfig } from '../config.js';
import type { HealthState } from '../health.js';
import { version } from '../version.js';

/**
 * Liveness for container checks, never rate limited. `status` is public; the `integrations` detail
 * (which services and models are configured) is answered only to a Jellyfin token the hub has
 * checked recently (ADR 0007 addendum). The check is read from the cache alone: an unauthenticated,
 * unlimited route must not turn every header it is sent into a Jellyfin request, nor fail when
 * Jellyfin is down.
 */
export async function healthRoutes(
  app: FastifyInstance,
  config: HubConfig,
  authenticator: Authenticator,
  health?: HealthState,
): Promise<void> {
  app.get('/health', { config: { rateLimit: false } }, async (request, reply) => {
    const databaseOk = health?.database.ok ?? true;
    const body: Record<string, unknown> = {
      status: databaseOk ? 'ok' : 'degraded',
      service: 'renaissance-hub',
      version,
      ...(health ? { database: databaseOk ? 'ok' : 'error' } : {}),
    };
    if (!databaseOk) reply.code(503);
    const token = tokenFrom(request);
    if (token && authenticator.configured) {
      try {
        if (authenticator.peek(token)) body.integrations = describe(config);
      } catch {
        /* a cache error never fails liveness */
      }
    }
    return body;
  });
}
