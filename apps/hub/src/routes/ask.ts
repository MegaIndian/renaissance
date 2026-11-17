/**
 * POST /ask: the Ask bar's endpoint (F75, F76). Phase 0 stub.
 *
 * The rule this route will live by (ADR 0007): the model acts only through a fixed tool set on real
 * data. It can never name a song, album or artist that a tool did not return. The stub returns the
 * fixed tool list and no actions, so clients can be built against the shape now.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const askTools = [
  'search_library',
  'lookup_catalogue',
  'play',
  'queue',
  'make_playlist',
  'request',
  'set_rule',
  'explain',
] as const;

export const AskRequest = z.object({
  text: z.string().trim().min(1).max(2000),
  language: z.enum(['en', 'gu']).optional(),
  userId: z.string().min(1).optional(),
});

export const AskAction = z.object({
  tool: z.enum(askTools),
  /** Arguments as the tool received them; every id must come from a previous tool result. */
  input: z.record(z.string(), z.unknown()),
  /** One line in words saying what happened, for the card. */
  summary: z.string(),
  undoable: z.boolean(),
});

export const AskResponse = z.object({
  status: z.enum(['ok', 'not_implemented']),
  message: z.string(),
  actions: z.array(AskAction),
  tools: z.array(z.enum(askTools)),
});
export type AskResponse = z.infer<typeof AskResponse>;

export async function askRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ask', async (request, reply) => {
    const parsed = AskRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    const response: AskResponse = {
      status: 'not_implemented',
      message: 'The intent engine arrives in phase 2. Nothing was invented and nothing was done.',
      actions: [],
      tools: [...askTools],
    };
    return reply.code(501).send(response);
  });
}
