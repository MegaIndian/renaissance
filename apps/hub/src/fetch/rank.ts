/**
 * Deterministic ranking of Soulseek files (F61, ADR 0006): duration within 3 s of the catalogue,
 * lossless or 320 kbps, a free upload slot, a clean file name, a short queue. Rules exclude versions.
 * No model here; the scores and reasons are stored on the request so a pick can be explained.
 */
import { normalize, tokenOverlap, tokens } from '../text.js';
import { VERSION_TOKENS } from './rules.js';
import type { RulePolicy } from './rules.js';

export const AUDIO_EXTENSIONS = new Set([
  'flac',
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'wav',
  'aiff',
  'aif',
  'alac',
  'ape',
  'wv',
]);
export const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv']);

export interface Candidate {
  username: string;
  /** The remote path with backslashes, as slskd reports it. */
  filename: string;
  size: number;
  extension?: string;
  bitRate?: number;
  /** Seconds. */
  length?: number;
  isLocked?: boolean;
  hasFreeUploadSlot: boolean;
  queueLength: number;
  uploadSpeed: number;
}

export interface Want {
  title: string;
  artist: string;
  /** Catalogue duration in seconds, when known. */
  duration?: number;
  policy: RulePolicy;
}

export interface Scored {
  candidate: Candidate;
  score: number;
  reasons: string[];
}

export const DJ_FOLDER =
  /\b(dj|edit|edits|remix|remixes|mashup|mashups|bootleg|pack|transition|intro|acapella|instrumentals?)\b/i;

export const DURATION_TOLERANCE_S = 3;
export const DURATION_REJECT_S = 10;

export function baseName(filename: string): string {
  const parts = filename.split(/[\\/]/);
  return parts[parts.length - 1] ?? filename;
}

export function parentName(filename: string): string {
  const parts = filename.split(/[\\/]/);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? '') : '';
}

export function extensionOf(c: Candidate): string {
  const ext =
    c.extension?.toLowerCase().replace(/^\./, '') ||
    baseName(c.filename).split('.').pop()?.toLowerCase() ||
    '';
  return ext;
}

/** Score one file, or the reason it is out. */
export function score(c: Candidate, want: Want): { scored?: Scored; excluded?: string } {
  const ext = extensionOf(c);
  if (c.isLocked) return { excluded: 'locked' };
  if (!AUDIO_EXTENSIONS.has(ext)) return { excluded: `not audio (${ext || 'no extension'})` };
  const base = baseName(c.filename).replace(/\.[^.]+$/, '');
  const path = c.filename;
  const reasons: string[] = [];
  let s = 0;

  const titleOverlap = tokenOverlap(want.title, base);
  if (titleOverlap < 0.5) return { excluded: 'title not in file name' };
  s += Math.round(titleOverlap * 15);
  reasons.push(`title ${Math.round(titleOverlap * 100)}% in name`);

  const titleTokens = new Set(tokens(want.title));
  for (const [key, re] of Object.entries(VERSION_TOKENS)) {
    const inName = re.test(base.replace(/[_-]/g, ' '));
    const askedFor = [...titleTokens].some((t) => re.test(t));
    if (!inName || askedFor) continue;
    if (want.policy.exclude.includes(key)) return { excluded: `rule: no ${key}` };
    if (key !== 'explicit' && key !== 'clean') {
      s -= key === 'remix' ? 45 : 30;
      reasons.push(`${key} in name`);
    }
  }
  // DJ edit packs and remix folders: the file is a version even when its name looks plain.
  if (DJ_FOLDER.test(parentName(path).replace(/[_-]/g, ' '))) {
    s -= 25;
    reasons.push('dj folder');
  }

  if (want.duration !== undefined && c.length !== undefined && c.length > 0) {
    const diff = Math.abs(c.length - want.duration);
    if (diff > DURATION_REJECT_S) return { excluded: `duration off by ${Math.round(diff)} s` };
    if (diff <= DURATION_TOLERANCE_S) {
      s += 40;
      reasons.push('duration matches');
    } else {
      s += 10;
      reasons.push(`duration off by ${Math.round(diff)} s`);
    }
  }

  if (LOSSLESS.has(ext)) {
    s += want.policy.preferSmall ? 5 : want.policy.preferLossless ? 35 : 25;
    reasons.push(ext);
  } else if (c.bitRate !== undefined && c.bitRate > 0) {
    if (c.bitRate >= 320) s += want.policy.preferSmall ? 25 : 20;
    else if (c.bitRate >= 256) s += 12;
    else if (c.bitRate >= 192) s += 5;
    else s -= 10;
    reasons.push(`${ext} ${c.bitRate} kbps`);
  } else {
    reasons.push(ext);
  }

  if (c.hasFreeUploadSlot) {
    s += 15;
    reasons.push('free slot');
  }
  const queue = Math.min(Math.max(c.queueLength, 0), 20);
  if (queue > 0) {
    s -= queue;
    reasons.push(`queue ${c.queueLength}`);
  }
  if (c.uploadSpeed > 1_000_000) s += 3;

  if (tokenOverlap(want.artist, path) >= 0.5) {
    s += 10;
    reasons.push('artist in path');
  }
  return { scored: { candidate: c, score: s, reasons } };
}

export interface Ranking {
  ranked: Scored[];
  excluded: { filename: string; reason: string }[];
}

export function rank(candidates: readonly Candidate[], want: Want): Ranking {
  const ranked: Scored[] = [];
  const excluded: Ranking['excluded'] = [];
  for (const c of candidates) {
    const r = score(c, want);
    if (r.scored) ranked.push(r.scored);
    else if (r.excluded) excluded.push({ filename: c.filename, reason: r.excluded });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.candidate.size - a.candidate.size ||
      normalize(a.candidate.filename).localeCompare(normalize(b.candidate.filename)),
  );
  return { ranked, excluded };
}
