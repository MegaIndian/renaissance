import type { FastifyReply, FastifyRequest } from 'fastify';

import type { Profile } from '@renaissance/core';

import type { Authenticator } from './authenticator.js';

declare module 'fastify' {
  interface FastifyRequest {
    profile: Profile | null;
    /** The raw Jellyfin token, for calls the hub makes on the caller's behalf. Never logged. */
    callerToken: string | null;
  }
}

/** `Authorization: Bearer <token>`, `X-Emby-Token`, or `?token=` (EventSource cannot set headers). */
export function tokenFrom(request: FastifyRequest, allowQuery = false): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^(?:Bearer|MediaBrowser)\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) {
      const token = /Token="([^"]+)"/.exec(m[1]);
      return token?.[1] ?? m[1].trim();
    }
  }
  const emby = request.headers['x-emby-token'];
  if (typeof emby === 'string' && emby.length > 0) return emby;
  if (allowQuery) {
    const q = (request.query as { token?: unknown } | undefined)?.token;
    if (typeof q === 'string' && q.length > 0) return q;
  }
  return null;
}

export function requireProfile(authenticator: Authenticator, allowQuery = false) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!authenticator.configured) {
      return reply.code(503).send({
        error: 'jellyfin_not_configured',
        message: 'Set JELLYFIN_URL so the hub can check who is asking.',
      });
    }
    const token = tokenFrom(request, allowQuery);
    if (!token) return reply.code(401).send({ error: 'unauthorized' });
    let profile: Profile | null;
    try {
      profile = await authenticator.authenticate(token);
    } catch {
      return reply.code(503).send({
        error: 'jellyfin_unreachable',
        message: 'Jellyfin did not answer; try again shortly.',
      });
    }
    if (!profile) return reply.code(401).send({ error: 'unauthorized' });
    request.profile = profile;
    request.callerToken = token;
  };
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.profile?.role !== 'admin') {
    return reply.code(403).send({ error: 'forbidden', message: 'Admins only.' });
  }
}
