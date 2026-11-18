/** /collection (F86): what counts as "mine". Admins may read the whole house with `?scope=house`. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Authenticator } from '../auth/authenticator.js';
import { requireProfile } from '../auth/plugin.js';
import type { Stores } from '../db/index.js';

const Scope = z.object({ scope: z.enum(['mine', 'house']).default('mine') });
const Id = z.coerce.number().int().positive();

export async function collectionRoutes(
  app: FastifyInstance,
  deps: { authenticator: Authenticator; stores: Stores },
): Promise<void> {
  const guard = requireProfile(deps.authenticator);
  app.get('/collection', { preHandler: guard }, async (request, reply) => {
    const scope = Scope.safeParse(request.query);
    if (!scope.success)
      return reply.code(400).send({ error: 'invalid_request', issues: scope.error.issues });
    if (scope.data.scope === 'house') {
      if (request.profile!.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
      return deps.stores.collection.listHouse();
    }
    return deps.stores.collection.list(request.profile!.id);
  });
  app.delete<{ Params: { id: string } }>(
    '/collection/:id',
    { preHandler: guard },
    async (request, reply) => {
      const id = Id.safeParse(request.params.id);
      if (!id.success) return reply.code(400).send({ error: 'invalid_request' });
      const removed = deps.stores.collection.remove(id.data, request.profile!.id);
      if (!removed) return reply.code(404).send({ error: 'not_found' });
      return removed;
    },
  );
}
