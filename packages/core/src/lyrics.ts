/**
 * Lyrics (F39, F40): the LRC parser, the line that is sung at a position, and the rule for when
 * the lyrics view follows the song. Framework-free so the web and mobile views share it.
 *
 * Jellyfin parses `.lrc` files itself (and the LrcLib plugin saves `.lrc` files next to the music),
 * so `/Audio/{id}/Lyrics` usually arrives with a start on every line. When its LRC parser fails on a
 * file it falls back to the plain-text parser and sends the raw LRC lines without starts; those are
 * parsed here, so a slightly malformed file still scrolls with the song.
 */
import type { LyricLine, Lyrics } from './models';

/** How long the view waits after the listener scrolls before it follows the song again. */
export const LYRICS_RESUME_MS = 4000;

/** `[mm:ss]`, `[mm:ss.x]`, `[mm:ss.xx]`, `[mm:ss.xxx]`, and the `[mm:ss:xx]` some editors write. */
const TIME_TAG = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/;
/** The ID tags of the LRC format. Anything else in brackets (`[Chorus]`) is part of the text. */
const ID_TAGS = new Set([
  'ar',
  'al',
  'ti',
  'au',
  'length',
  'by',
  'offset',
  're',
  've',
  'tool',
  '#',
]);
/** Enhanced LRC word timings (`<00:12.34>`) inside a line; the view highlights whole lines. */
const WORD_TIME = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function timeTagMs(tag: string): number | null {
  const match = TIME_TAG.exec(tag.trim());
  if (!match) return null;
  const [, minutes = '0', seconds = '0', fraction] = match;
  if (Number(seconds) >= 60) return null;
  const ms = fraction ? Number(fraction.padEnd(3, '0')) : 0;
  return (Number(minutes) * 60 + Number(seconds)) * 1000 + ms;
}

/** Does this text carry LRC timings (a line that starts with a time tag)? */
export function hasLrcTimings(text: string): boolean {
  return text.split(/\r\n|\r|\n/).some((line) => {
    const tag = /^\s*\[([^\]]*)\]/.exec(line);
    return !!tag && timeTagMs(tag[1] ?? '') !== null;
  });
}

export interface ParsedLrc {
  synced: boolean;
  /** Sorted by start for synced lyrics, with the file's `[offset:]` applied; file order otherwise. */
  lines: LyricLine[];
  /** The `[offset:]` tag in milliseconds; positive means the lyrics come sooner. */
  offsetMs: number;
}

/**
 * Parse LRC text. A line with several time tags (`[00:12.00][00:47.50]chorus`) is sung at each of
 * them. `[offset:+500]` moves every line 500 ms earlier, as the format defines. Lines without a
 * time tag are dropped once any line has one; text without any time tags comes back unsynced, so a
 * plain lyrics file passes through unchanged.
 */
export function parseLrc(text: string): ParsedLrc {
  let offsetMs = 0;
  const timed: { start: number; text: string; order: number }[] = [];
  const plain: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    let rest = raw.trim();
    const starts: number[] = [];
    let idTag = false;
    for (;;) {
      const tag = /^\[([^\]]*)\]/.exec(rest);
      if (!tag) break;
      const body = tag[1] ?? '';
      const ms = timeTagMs(body);
      const colon = body.indexOf(':');
      const key = colon > 0 ? body.slice(0, colon).trim().toLowerCase() : '';
      if (ms !== null) {
        starts.push(ms);
      } else if (ID_TAGS.has(key)) {
        idTag = true;
        if (key === 'offset') {
          const value = Number.parseInt(body.slice(colon + 1).trim(), 10);
          if (Number.isFinite(value)) offsetMs = value;
        }
      } else {
        break;
      }
      rest = rest.slice(tag[0].length);
    }
    const lineText = rest.replace(WORD_TIME, '').replace(/\s+/g, ' ').trim();
    if (starts.length) {
      for (const start of starts) timed.push({ start, text: lineText, order: timed.length });
    } else if (!idTag) {
      plain.push(lineText);
    }
  }
  if (!timed.length) return { synced: false, lines: plain.map((t) => ({ text: t })), offsetMs };
  timed.sort((a, b) => a.start - b.start || a.order - b.order);
  return {
    synced: true,
    lines: timed.map((l) => ({ start: Math.max(0, l.start - offsetMs), text: l.text })),
    offsetMs,
  };
}

/**
 * The lyrics as the views show them, or null when there is nothing to show. Synced lines are
 * sorted by start; unsynced text loses the blank lines at its ends and keeps the ones between
 * verses (one blank line, however many there were).
 */
export function toLyrics(trackId: string, synced: boolean, lines: LyricLine[]): Lyrics | null {
  if (!lines.some((l) => l.text.trim())) return null;
  if (synced) {
    const sorted = lines
      .map((l, order) => ({ ...l, order }))
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.order - b.order)
      .map(({ start, text }) => ({ start: start ?? 0, text: text.trim() }));
    return { trackId, synced: true, lines: sorted };
  }
  const out: LyricLine[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text && (!out.length || !out[out.length - 1]?.text)) continue;
    out.push({ text });
  }
  while (out.length && !out[out.length - 1]?.text) out.pop();
  return { trackId, synced: false, lines: out };
}

/** Lyrics from raw text: LRC when it has timings, plain lines when it has none. */
export function lyricsFromText(trackId: string, text: string): Lyrics | null {
  const parsed = parseLrc(text);
  return toLyrics(trackId, parsed.synced, parsed.lines);
}

/**
 * The index of the line being sung at `positionMs`: the last line that has started. -1 before
 * the first line starts, and always -1 for unsynced lyrics.
 */
export function activeLyricIndex(lyrics: Lyrics | null | undefined, positionMs: number): number {
  if (!lyrics?.synced) return -1;
  const { lines } = lyrics;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lines[mid]?.start ?? 0) <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * When the lyrics view scrolls itself to the sung line. It follows the song until the listener
 * scrolls; then it waits `resumeAfterMs` after their last scroll and follows again. A tap on a line
 * (a seek) or the "back to the current line" button resumes at once. Times are passed in so the
 * rule is tested without timers.
 */
export class LyricsFollow {
  private pausedAt: number | null = null;

  constructor(readonly resumeAfterMs: number = LYRICS_RESUME_MS) {}

  /** The listener scrolled (or moved through the lines with the keyboard) at `now`. */
  pause(now: number): void {
    this.pausedAt = now;
  }

  resume(): void {
    this.pausedAt = null;
  }

  following(now: number): boolean {
    if (this.pausedAt === null) return true;
    if (now - this.pausedAt >= this.resumeAfterMs) {
      this.pausedAt = null;
      return true;
    }
    return false;
  }

  /** Milliseconds until the view follows again; 0 when it already does. */
  resumesIn(now: number): number {
    if (this.pausedAt === null) return 0;
    return Math.max(0, this.pausedAt + this.resumeAfterMs - now);
  }
}
