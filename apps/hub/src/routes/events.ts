/**
 * GET /events: Server-Sent Events with the caller's request changes and "Ready" (F63, F87). The
 * token may come as `?token=` because EventSource cannot set headers. `?scope=house` for admins.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { HubEvent } from '@renaissance/core';

import type { Authenticator } from '../auth/authenticator.js';
import { requireProfile } from '../auth/plugin.js';
import type { EventBus } from '../events/bus.js';

const Query = z.object({
  scope: z.enum(['mine', 'house']).default('mine'),
  token: z.string().optional(),
});

export const PING_MS = 25_000;

export function formatEvent(event: HubEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function eventRoutes(
  app: FastifyInstance,
  deps: { authenticator: Authenticator; bus: EventBus; pingMs?: number },
): Promise<void> {
  app.get(
    '/events',
    { preHandler: requireProfile(deps.authenticator, true) },
    async (request, reply) => {
      const query = Query.safeParse(request.query);
      if (!query.success)
        return reply.code(400).send({ error: 'invalid_request', issues: query.error.issues });
      const scope = query.data.scope;
      if (scope === 'house' && request.profile!.role !== 'admin')
        return reply.code(403).send({ error: 'forbidden' });
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        ...(reply.getHeader('access-control-allow-origin')
          ? {
              'access-control-allow-origin': String(reply.getHeader('access-control-allow-origin')),
            }
          : {}),
      });
      reply.raw.write(formatEvent({ type: 'ping', at: new Date().toISOString() }));
      const unsubscribe = deps.bus.subscribe(
        request.profile!.id,
        (event) => reply.raw.write(formatEvent(event)),
        scope,
      );
      const timer = setInterval(
        () => reply.raw.write(formatEvent({ type: 'ping', at: new Date().toISOString() })),
        deps.pingMs ?? PING_MS,
      );
      request.raw.on('close', () => {
        clearInterval(timer);
        unsubscribe();
      });
      // The response stays open until the client goes away; Fastify must not send anything itself.
      await new Promise<void>((resolve) => request.raw.on('close', resolve));
      return reply;
    },
  );
}
