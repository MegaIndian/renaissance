/**
 * `GET /catalogue/search?q=`: typeahead for the one search box (F61). Answers at once: the cache
 * when the words were looked up before, else Deezer rows (`partial: true`); MusicBrainz is asked on
 * Enter and when a song is added, never per keystroke.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Authenticator } from '../auth/authenticator.js';
import { requireProfile } from '../auth/plugin.js';
import { LimiterBusyError } from '../catalogue/rate-limiter.js';
import type { CatalogueService } from '../catalogue/service.js';
import type { JellyfinLibrary } from '../jellyfin/library.js';

const Query = z.object({ q: z.string().trim().min(2).max(200) });

export async function catalogueRoutes(
  app: FastifyInstance,
  deps: { authenticator: Authenticator; catalogue: CatalogueService; library: JellyfinLibrary },
): Promise<void> {
  app.get(
    '/catalogue/search',
    { preHandler: requireProfile(deps.authenticator) },
    async (request, reply) => {
      const parsed = Query.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
      }
      let result;
      try {
        result = await deps.catalogue.search(parsed.data.q, {
          owner: request.profile!.id,
          fast: true,
        });
      } catch (error) {
        // Too many people typing, or this prefix was replaced by the caller's next letters: the
        // app retries (or has already asked for the newer words).
        if (error instanceof LimiterBusyError) {
          return reply
            .code(503)
            .header('retry-after', '1')
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
      // Library hits first (F61): songs already on the server carry their Jellyfin id.
      if (deps.library.configured && request.callerToken) {
        const instant = await deps.library.search(request.callerToken, parsed.data.q, 10);
        for (const song of result.songs) {
          const hit = instant.tracks.find(
            (t) =>
              t.title.toLowerCase() === song.title.toLowerCase() &&
              !!t.artist &&
              song.artist.toLowerCase().includes(t.artist.toLowerCase().split(' ')[0] ?? ''),
          );
          if (hit) song.libraryId = hit.id;
        }
        for (const album of result.albums) {
          const hit = instant.albums.find(
            (a) => a.title.toLowerCase() === album.title.toLowerCase(),
          );
          if (hit) album.libraryId = hit.id;
        }
        result.songs.sort((a, b) => Number(!!b.libraryId) - Number(!!a.libraryId));
      }
      return result;
    },
  );
}
