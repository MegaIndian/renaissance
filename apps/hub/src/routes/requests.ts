/**
 * /requests: what is on its way (F61, F63). Phase 0: an in-memory list so the Requests tab has a shape.
 * Phase 2 replaces the store with SQLite and the pipeline (catalogue, slskd, Lidarr import, scan).
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const RequestKind = z.enum(['track', 'album']);
export const RequestStatus = z.enum(['requested', 'finding', 'downloading', 'ready', 'failed']);

export const NewRequest = z.object({
  kind: RequestKind,
  title: z.string().trim().min(1),
  artist: z.string().trim().min(1),
  album: z.string().trim().optional(),
  musicBrainzId: z.string().trim().optional(),
  requestedBy: z.string().trim().min(1).default('local'),
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

export function memoryRequestStore(): RequestStore {
  const items = new Map<string, MusicRequest>();
  return {
    list: () => [...items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
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
