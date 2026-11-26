/**
 * The model's tie-break for the fetch step (F61: "Claude pick only when ambiguous"). It is asked
 * only when the deterministic ranking leaves the leading files within a few points of each other
 * (`leadingTie`), and only when `RENAISSANCE_FETCH_MODEL_PICK` is on with a key set. It sees the
 * song asked for and the tied files with their scores, and answers one index, as JSON, from the
 * files it was shown (ADR 0007). Anything else (a refusal, no answer, an index out of range, a
 * failed call) keeps the deterministic first.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { AmbiguityInput, AmbiguityPicker } from '../contracts.js';
import type { Logger } from '../log.js';
import { baseName, parentName } from './rank.js';

export const PICK_MODEL_TIMEOUT_MS = 20_000;

const Answer = z.object({
  /** 0-based index into the files listed; -1 when none is clearly better. */
  index: z.number().int(),
});

/** The one call the picker makes; the SDK's `messages.parse` in production, a fake in tests. */
export type PickModel = (params: {
  system: string;
  user: string;
}) => Promise<{ stopReason: string | null; index: number | undefined }>;

export const PICK_SYSTEM = [
  'You choose which downloaded audio file best matches a requested song.',
  'The files are already ranked by a scoring step and their scores are close; break the tie.',
  'Prefer the studio version of the requested song by the requested artist, then lossless over lossy,',
  'then a file whose folder names the right album. Reject live takes, remixes, covers, karaoke and',
  'edits unless the request asks for one.',
  'Answer with the 0-based index of one listed file, or -1 when none is clearly better than the first.',
  'Never name a file that is not in the list.',
].join(' ');

export function pickPrompt(input: AmbiguityInput): string {
  const r = input.request;
  const wanted = [
    `Requested ${r.kind === 'album' ? 'album' : 'song'}: "${r.title}" by ${r.artist}`,
    r.album ? `Album: ${r.album}` : '',
    r.duration !== undefined ? `Length: ${Math.round(r.duration)} s` : '',
  ].filter(Boolean);
  const files = input.candidates.map((s, i) => {
    const c = s.candidate;
    const parts = [
      `${i}. ${baseName(c.filename)}`,
      `folder: ${parentName(c.filename) || '-'}`,
      `score: ${s.score}`,
      c.length !== undefined ? `length: ${c.length} s` : '',
      c.bitRate !== undefined ? `bitrate: ${c.bitRate}` : '',
      `format: ${c.extension || '-'}`,
    ].filter(Boolean);
    return parts.join(' | ');
  });
  return [...wanted, '', 'Files:', ...files].join('\n');
}

/** The production call: Claude Opus 5.5 at low effort, a strict JSON answer, a short timeout. */
export function anthropicPickModel(options: { apiKey: string; model: string }): PickModel {
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: 1,
    timeout: PICK_MODEL_TIMEOUT_MS,
  });
  return async ({ system, user }) => {
    const response = await client.messages.parse({
      model: options.model,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: 'low', format: zodOutputFormat(Answer) },
    });
    return {
      stopReason: response.stop_reason,
      index: response.parsed_output?.index,
    };
  };
}

export function modelPicker(deps: { model: PickModel; log: Logger }): AmbiguityPicker {
  return {
    async pick(input) {
      const answer = await deps.model({ system: PICK_SYSTEM, user: pickPrompt(input) });
      if (answer.stopReason === 'refusal') {
        deps.log.warn({ files: input.candidates.length }, 'tie pick declined by the model');
        return undefined;
      }
      const index = answer.index;
      if (index === undefined || index < 0 || index >= input.candidates.length) return undefined;
      deps.log.info({ index, files: input.candidates.length }, 'tie broken by the model');
      return index;
    },
  };
}
