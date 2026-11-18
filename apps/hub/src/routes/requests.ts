/**
 * /requests (F61, F63, F87): the caller's own; `?scope=house` for admins; create with the "already
 * on the server" short-circuit (F86) and the duplicate guard; cancel while nothing has been downloaded.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { NewRequest } from '@renaissance/core';

import type { Authenticator } from '../auth/authenticator.js';
import { requireProfile } from '../auth/plugin.js';
import type { RequestService } from '../requests/service.js';

const Scope = z.object({ scope: z.enum(['mine', 'house']).default('mine') });

export async function requestRoutes(
  app: FastifyInstance,
  deps: { authenticator: Authenticator; requests: RequestService },
): Promise<void> {
  const guard = requireProfile(deps.authenticator);

  app.get('/requests', { preHandler: guard }, async (request, reply) => {
    const scope = Scope.safeParse(request.query);
    if (!scope.success)
      return reply.code(400).send({ error: 'invalid_request', issues: scope.error.issues });
    if (scope.data.scope === 'house' && request.profile!.role !== 'admin') {
      return reply
        .code(403)
        .send({ error: 'forbidden', message: 'Only an admin sees the whole house.' });
    }
    return deps.requests.list(request.profile!, scope.data.scope);
  });

  app.get<{ Params: { id: string } }>(
    '/requests/:id',
    { preHandler: guard },
    async (request, reply) => {
      const item = deps.requests.get(request.profile!, request.params.id);
      if (!item) return reply.code(404).send({ error: 'not_found' });
      return item;
    },
  );

  app.post('/requests', { preHandler: guard }, async (request, reply) => {
    const parsed = NewRequest.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const result = await deps.requests.create(request.profile!, parsed.data);
    if (result.kind === 'already') return reply.code(200).send(result.already);
    // The same song is already on its way (for anyone in the house): the caller now watches it.
    if (result.kind === 'duplicate')
      return reply.code(200).send({ alreadyRequested: true, request: result.request });
    return reply.code(201).send(result.request);
  });

  app.post<{ Params: { id: string } }>(
    '/requests/:id/retry',
    { preHandler: guard },
    async (request, reply) => {
      const result = deps.requests.retry(request.profile!, request.params.id);
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result === 'not_failed') {
        return reply
          .code(409)
          .send({ error: 'not_failed', message: 'Only a failed request can be retried.' });
      }
      return reply.code(202).send(result);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/requests/:id',
    { preHandler: guard },
    async (request, reply) => {
      const result = await deps.requests.cancel(request.profile!, request.params.id);
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result === 'too_late') {
        return reply.code(409).send({
          error: 'too_late',
          message: 'The download has started; it cannot be cancelled.',
        });
      }
      if (result === 'not_active') {
        return reply.code(409).send({
          error: 'not_active',
          message: 'The request has already finished; there is nothing to cancel.',
        });
      }
      return result;
    },
  );
}
