/**
 * `GET /catalogue/search?q=`: typeahead for the one search box (F61). Answers at once: the cache
 * when the words were looked up before, else Deezer rows (`partial: true`); MusicBrainz is asked on
 * Enter and when a song is added, never per keystroke. Deezer calls are spaced through their own
 * limiter, so the typist's older prefix is dropped (`503 superseded`) and a full queue answers
 * `503 busy`; the app keeps the rows it has and asks again. A Jellyfin failure costs the rows
 * their library marks, never the rows.
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
      // Library hits first (F61): songs already on the server carry their Jellyfin id. The words
      // are searched as a name, and the rows' artists are looked up too, so an artist query
      // ("kevin macleod") still marks the songs the server has.
      if (deps.library.configured && request.callerToken) {
        const token = request.callerToken;
        const artists = [...new Set(result.songs.map((s) => s.artist))].slice(0, 4);
        // Jellyfin down, restarting or refusing the token must not take the catalogue rows with
        // it: the typeahead is the whole add path with the model off. Its hits are marked when it
        // answers and left out, with a warning, when it does not (production AI).
        const orNothing = <T>(call: Promise<T>, empty: T): Promise<T> =>
          call.catch((error: unknown) => {
            request.log.warn(
              { error: error instanceof Error ? error.message : String(error) },
              'library lookup failed; typeahead answered from the catalogue alone',
            );
            return empty;
          });
        const [instant, byArtist] = await Promise.all([
          orNothing(deps.library.search(token, parsed.data.q, 10), {
            tracks: [],
            albums: [],
            artists: [],
          }),
          orNothing(deps.library.tracksByArtists(token, artists), []),
        ]);
        const sameSong = (
          t: { title: string; artist?: string | undefined },
          song: { title: string; artist: string },
        ) =>
          t.title.toLowerCase() === song.title.toLowerCase() &&
          !!t.artist &&
          song.artist.toLowerCase().includes(t.artist.toLowerCase().split(' ')[0] ?? '');
        for (const song of result.songs) {
          const hit =
            instant.tracks.find((t) => sameSong(t, song)) ??
            byArtist.find((t) => sameSong(t, song));
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
