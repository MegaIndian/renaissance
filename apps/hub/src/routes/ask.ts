/**
 * POST /ask: the Ask bar's endpoint (F75, F76). JSON by default; with `?stream=1` (or
 * `Accept: text/event-stream`) the instant library hits are sent first as an `instant` event and
 * the full answer follows as `answer`, so the apps show hits at once and the model's cards after.
 */
import type { FastifyInstance } from 'fastify';

import { AskRequest } from '@renaissance/core';

import type { Engine, EngineDeps } from '../ask/engine.js';
import { createEngine } from '../ask/engine.js';
import type { Authenticator } from '../auth/authenticator.js';
import { requireProfile } from '../auth/plugin.js';

export async function askRoutes(
  app: FastifyInstance,
  deps: { authenticator: Authenticator; engine: Engine; engineDeps: Omit<EngineDeps, 'onInstant'> },
): Promise<void> {
  app.post('/ask', { preHandler: requireProfile(deps.authenticator) }, async (request, reply) => {
    const parsed = AskRequest.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const input: Parameters<Engine['ask']>[0] = {
      profile: request.profile!,
      token: request.callerToken!,
      text: parsed.data.text,
    };
    if (parsed.data.language) input.language = parsed.data.language;
    const wantsStream =
      (request.query as { stream?: string }).stream === '1' ||
      (request.headers.accept ?? '').includes('text/event-stream');
    if (!wantsStream) return deps.engine.ask(input);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      ...(reply.getHeader('access-control-allow-origin')
        ? { 'access-control-allow-origin': String(reply.getHeader('access-control-allow-origin')) }
        : {}),
    });
    const streaming = createEngine({
      ...deps.engineDeps,
      onInstant: (instant) =>
        reply.raw.write(`event: instant\ndata: ${JSON.stringify(instant)}\n\n`),
    });
    const answer = await streaming.ask(input);
    reply.raw.write(`event: answer\ndata: ${JSON.stringify(answer)}\n\n`);
    reply.raw.end();
    return reply;
  });
}
