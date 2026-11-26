import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Authenticator } from '../auth/authenticator.js';
import { requireProfile } from '../auth/plugin.js';
import type { Stores } from '../db/index.js';

const Prefs = z.object({
  mode: z.enum(['simple', 'advanced']).optional(),
  language: z.enum(['en', 'gu']).optional(),
});

/** Who the hub thinks the caller is, and their stored preferences (mode, language). */
export async function meRoutes(
  app: FastifyInstance,
  deps: { authenticator: Authenticator; stores: Stores },
): Promise<void> {
  const guard = requireProfile(deps.authenticator);
  app.get('/me', { preHandler: guard }, async (request) => request.profile);
  app.post('/me', { preHandler: guard }, async (request, reply) => {
    const parsed = Prefs.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const me = request.profile!;
    return deps.stores.profiles.setPreferences(
      me.id,
      parsed.data.mode ?? me.mode,
      parsed.data.language ?? me.language,
    );
  });
}
