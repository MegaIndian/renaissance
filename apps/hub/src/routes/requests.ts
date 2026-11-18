/**
 * /requests: what is on its way (F61, F63). Phase 0: an in-memory list so the Requests tab has a shape.
 * Phase 2 replaces the store with SQLite and the pipeline (catalogue, slskd, Lidarr import, scan).
 * Strings are bounded and the store is capped so an unauthenticated phase-0 hub cannot be filled up.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** Longest title, artist, album or name the hub accepts. */
export const MAX_TEXT = 200;
/** Requests kept in memory; the oldest are dropped past this. */
export const STORE_CAP = 500;

export const RequestKind = z.enum(['track', 'album']);
export const RequestStatus = z.enum(['requested', 'finding', 'downloading', 'ready', 'failed']);

const text = z.string().trim().min(1).max(MAX_TEXT);

export const NewRequest = z.object({
  kind: RequestKind,
  title: text,
  artist: text,
  album: text.optional(),
  musicBrainzId: z.uuid().optional(),
  requestedBy: z.string().trim().min(1).max(64).default('local'),
});

export const MusicRequest = NewRequest.extend({
  id: z.uuid(),
  status: RequestStatus,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  progress: z.object({ done: z.number().int(), total: z.number().int() }).optional(),
});
export type MusicRequest = z.infer<typeof MusicRequest>;

export interface RequestStore {
  list(): MusicRequest[];
  add(input: z.infer<typeof NewRequest>): MusicRequest;
  get(id: string): MusicRequest | undefined;
}

export function memoryRequestStore(cap: number = STORE_CAP): RequestStore {
  const items = new Map<string, MusicRequest>();
  return {
    // Newest first by insertion order, not by timestamp: two requests in one millisecond keep their order.
    list: () => [...items.values()].reverse(),
    get: (id) => items.get(id),
    add: (input) => {
      const now = new Date().toISOString();
      const item: MusicRequest = {
        ...input,
        id: randomUUID(),
        status: 'requested',
        createdAt: now,
        updatedAt: now,
      };
      items.set(item.id, item);
      // Map keeps insertion order, so the first key is the oldest.
      while (items.size > cap) {
        const oldest = items.keys().next().value;
        if (oldest === undefined) break;
        items.delete(oldest);
      }
      return item;
    },
  };
}

export async function requestRoutes(app: FastifyInstance, store: RequestStore): Promise<void> {
  app.get('/requests', async () => ({ items: store.list() }));

  app.get<{ Params: { id: string } }>('/requests/:id', async (request, reply) => {
    const item = store.get(request.params.id);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return item;
  });

  app.post('/requests', async (request, reply) => {
    const parsed = NewRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    return reply.code(201).send(store.add(parsed.data));
  });
}
