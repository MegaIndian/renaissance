/** /rules (F80): plain-text household rules per profile. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { HUB_MAX_TEXT } from '@renaissance/core';

import type { Authenticator } from '../auth/authenticator.js';
import { requireProfile } from '../auth/plugin.js';
import type { Stores } from '../db/index.js';
import { parseRules } from '../fetch/rules.js';

const NewRule = z.object({ text: z.string().trim().min(1).max(HUB_MAX_TEXT) });
const Id = z.coerce.number().int().positive();

export async function ruleRoutes(
  app: FastifyInstance,
  deps: { authenticator: Authenticator; stores: Stores },
): Promise<void> {
  const guard = requireProfile(deps.authenticator);
  app.get('/rules', { preHandler: guard }, async (request) =>
    deps.stores.rules.list(request.profile!.id),
  );
  /** How the ranking step reads the caller's rules: which versions are excluded, what is unknown. */
  app.get('/rules/policy', { preHandler: guard }, async (request) =>
    parseRules(deps.stores.rules.list(request.profile!.id).map((r) => r.text)),
  );
  app.post('/rules', { preHandler: guard }, async (request, reply) => {
    const parsed = NewRule.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    return reply.code(201).send(deps.stores.rules.add(request.profile!.id, parsed.data.text));
  });
  app.delete<{ Params: { id: string } }>(
    '/rules/:id',
    { preHandler: guard },
    async (request, reply) => {
      const id = Id.safeParse(request.params.id);
      if (!id.success) return reply.code(400).send({ error: 'invalid_request' });
      const removed = deps.stores.rules.remove(id.data, request.profile!.id);
      if (!removed) return reply.code(404).send({ error: 'not_found' });
      return removed;
    },
  );
}
