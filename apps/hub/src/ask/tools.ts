/**
 * The fixed tool set (ADR 0007, ADR 0010). The model acts only through these; the JSON schemas are
 * strict so the API guarantees the shape, and the Zod schemas re-check on the way in. Every id an
 * action names must be in the grounding context of the same call.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { askTools } from '@renaissance/core';

const id = z.string().min(1).max(200);
const ids = z.array(id).min(1).max(100);

export const toolInputs = {
  search_library: z.object({ query: z.string().min(1).max(200) }),
  lookup_catalogue: z.object({
    query: z.string().min(1).max(200),
    kind: z.enum(['song', 'album', 'artist', 'any']),
  }),
  play: z.object({ itemId: id, kind: z.enum(['track', 'album', 'artist']) }),
  queue: z.object({ trackIds: ids }),
  make_playlist: z.object({ name: z.string().min(1).max(200), trackIds: ids }),
  request: z.object({
    kind: z.enum(['track', 'album']),
    title: z.string().min(1).max(200),
    artist: z.string().min(1).max(200),
    catalogueId: z.string().max(200).nullable().optional(),
  }),
  set_rule: z.object({ text: z.string().min(1).max(200) }),
  explain: z.object({ subjectId: id }),
} as const satisfies Record<(typeof askTools)[number], z.ZodType>;

export type ToolName = keyof typeof toolInputs;
export type ToolInput<T extends ToolName> = z.infer<(typeof toolInputs)[T]>;

const strictObject = (
  properties: Record<string, unknown>,
  required: string[],
): Anthropic.Tool['input_schema'] => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** Deterministic order and text: the tool list is part of the cached prefix. */
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'search_library',
    description:
      "Search the household's own music library (Jellyfin) for songs, albums or artists. The context already holds the library results for the user's words; call this only with different words, for example a lyric fragment or an artist name the user implied.",
    strict: true,
    input_schema: strictObject(
      { query: { type: 'string', description: 'Words to search the library for' } },
      ['query'],
    ),
  },
  {
    name: 'lookup_catalogue',
    description:
      "Look up songs, albums or artists in the public catalogue (MusicBrainz) for music that is not in the library yet. The context already holds catalogue results for the user's words; call this with different words when needed, for example the artist alone to find their albums.",
    strict: true,
    input_schema: strictObject(
      {
        query: { type: 'string' },
        kind: { type: 'string', enum: ['song', 'album', 'artist', 'any'] },
      },
      ['query', 'kind'],
    ),
  },
  {
    name: 'play',
    description:
      'Play a library item now. itemId must be an id from the library results in the context.',
    strict: true,
    input_schema: strictObject(
      { itemId: { type: 'string' }, kind: { type: 'string', enum: ['track', 'album', 'artist'] } },
      ['itemId', 'kind'],
    ),
  },
  {
    name: 'queue',
    description:
      'Add library tracks to the end of the queue. Every id must come from the library results in the context.',
    strict: true,
    input_schema: strictObject({ trackIds: { type: 'array', items: { type: 'string' } } }, [
      'trackIds',
    ]),
  },
  {
    name: 'make_playlist',
    description:
      'Create a playlist from library tracks. Every id must come from the library results in the context.',
    strict: true,
    input_schema: strictObject(
      { name: { type: 'string' }, trackIds: { type: 'array', items: { type: 'string' } } },
      ['name', 'trackIds'],
    ),
  },
  {
    name: 'request',
    description:
      "Ask the hub to fetch a song or album that is not in the library. Use catalogueId from the catalogue results when there is a match; title and artist must be copied from a catalogue result or from the user's own words, never from memory.",
    strict: true,
    input_schema: strictObject(
      {
        kind: { type: 'string', enum: ['track', 'album'] },
        title: { type: 'string' },
        artist: { type: 'string' },
        catalogueId: { type: ['string', 'null'] },
      },
      ['kind', 'title', 'artist', 'catalogueId'],
    ),
  },
  {
    name: 'set_rule',
    description:
      'Remember a standing preference for this person in their own words, for example "no live versions". The fetch pipeline and the mixes read it.',
    strict: true,
    input_schema: strictObject({ text: { type: 'string' } }, ['text']),
  },
  {
    name: 'explain',
    description:
      'Tell the user about a song, album or artist from the context, using only the facts in the context (titles, artists, albums, years). subjectId is a library or catalogue id from the context.',
    strict: true,
    input_schema: strictObject({ subjectId: { type: 'string' } }, ['subjectId']),
  },
];

export function isToolName(name: string): name is ToolName {
  return (askTools as readonly string[]).includes(name);
}
