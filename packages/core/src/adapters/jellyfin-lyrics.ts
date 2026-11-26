/**
 * Jellyfin's `/Audio/{id}/Lyrics` (10.9 and later) as `Lyrics` (F39, F40). Loaded on demand by the
 * adapter, so the schema, the mapping and the LRC parser stay out of the app shell.
 */
import { z } from 'zod';

import { lyricsFromText, toLyrics } from '../lyrics';
import type { Lyrics } from '../models';

export const JfLyricLine = z.object({ Text: z.string(), Start: z.number().nullish() });
/** `Offset` is in ticks; 10.10's own LRC parser leaves it unset. Lines' `Start` is in ticks too. */
export const JfLyrics = z.object({
  Metadata: z.object({ Offset: z.number().nullish(), IsSynced: z.boolean().nullish() }).nullish(),
  Lyrics: z.array(JfLyricLine).default([]),
});
export type JfLyrics = z.infer<typeof JfLyrics>;

/**
 * Lines with a start on every one are synced; the server's offset is applied in milliseconds (a
 * positive offset brings the lyrics sooner, as in LRC). Lines without starts are plain text, or an
 * `.lrc` file the server's own parser gave up on, which `lyricsFromText` still reads as synced.
 * Blank lines without a start are spacing, not a sign that the lyrics are unsynced.
 */
export function fromJellyfinLyrics(trackId: string, result: JfLyrics): Lyrics | null {
  const lines = result.Lyrics.filter((l) => typeof l.Start === 'number' || l.Text.trim());
  if (lines.length && lines.every((l) => typeof l.Start === 'number')) {
    const offsetMs = (result.Metadata?.Offset ?? 0) / 10_000;
    return toLyrics(
      trackId,
      true,
      lines.map((l) => ({
        text: l.Text,
        start: Math.max(0, (l.Start ?? 0) / 10_000 - offsetMs),
      })),
    );
  }
  return lyricsFromText(trackId, result.Lyrics.map((l) => l.Text).join('\n'));
}
