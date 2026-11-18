/** GET /budget: this month's model spend for the caller, or the house for admins. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { BudgetMeter } from '../ask/budget.js';
import type { Authenticator } from '../auth/authenticator.js';
import { requireProfile } from '../auth/plugin.js';

const Scope = z.object({ scope: z.enum(['mine', 'house']).default('mine') });

export async function budgetRoutes(
  app: FastifyInstance,
  deps: { authenticator: Authenticator; budget: BudgetMeter },
): Promise<void> {
  app.get('/budget', { preHandler: requireProfile(deps.authenticator) }, async (request, reply) => {
    const scope = Scope.safeParse(request.query);
    if (!scope.success)
      return reply.code(400).send({ error: 'invalid_request', issues: scope.error.issues });
    if (scope.data.scope === 'house' && request.profile!.role !== 'admin')
      return reply.code(403).send({ error: 'forbidden' });
    return deps.budget.report(scope.data.scope === 'house' ? 'house' : request.profile!.id);
  });
}
