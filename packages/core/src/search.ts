/**
 * The instant layer under the Ask bar (F11, F75): library hits in well under 100 ms from the local
 * cache, no server round trip. Everything is normalised once when indexed; a search is one pass over
 * precomputed strings, which is a few milliseconds for 20,000 tracks.
 */
import type { Album, Artist, Playlist, Track } from './models';
import type { SearchResult } from './server-adapter';

/** Lower case, no accents, no punctuation, single spaces. Gujarati and other scripts pass through. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Entry<T> {
  item: T;
  /** The title or name, normalised. */
  primary: string;
  /** Artist and album names, normalised and joined. */
  secondary: string;
  weight: number;
}

/** Higher is better; 0 means no match. */
export function score(query: string, primary: string, secondary: string): number {
  if (!query) return 0;
  if (primary === query) return 100;
  if (primary.startsWith(query)) return 80;
  if (primary.includes(` ${query}`)) return 60;
  if (primary.includes(query)) return 40;
  const words = query.split(' ');
  if (words.length > 1 && words.every((w) => primary.includes(w) || secondary.includes(w)))
    return 35;
  if (secondary.startsWith(query) || secondary.includes(` ${query}`)) return 30;
  if (secondary.includes(query)) return 20;
  return 0;
}

function rank<T>(entries: Entry<T>[], query: string, limit: number): T[] {
  const hits: { item: T; score: number; weight: number }[] = [];
  for (const entry of entries) {
    const s = score(query, entry.primary, entry.secondary);
    if (s > 0) hits.push({ item: entry.item, score: s, weight: entry.weight });
  }
  hits.sort((a, b) => b.score - a.score || b.weight - a.weight);
  return hits.slice(0, limit).map((h) => h.item);
}

export interface LibraryIndexInput {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export class LibraryIndex {
  private tracks: Entry<Track>[] = [];
  private albums: Entry<Album>[] = [];
  private artists: Entry<Artist>[] = [];
  private playlists: Entry<Playlist>[] = [];

  constructor(input?: Partial<LibraryIndexInput>) {
    if (input) this.rebuild(input);
  }

  rebuild(input: Partial<LibraryIndexInput>): void {
    if (input.tracks) {
      this.tracks = input.tracks.map((t) => ({
        item: t,
        primary: normalize(t.title),
        secondary: normalize(`${t.artistName} ${t.albumTitle ?? ''} ${t.albumArtistName ?? ''}`),
        weight: t.playCount + (t.isFavorite ? 5 : 0),
      }));
    }
    if (input.albums) {
      this.albums = input.albums.map((a) => ({
        item: a,
        primary: normalize(a.title),
        secondary: normalize(`${a.artistName} ${a.year ?? ''}`),
        weight: a.playCount + (a.isFavorite ? 5 : 0),
      }));
    }
    if (input.artists) {
      this.artists = input.artists.map((a) => ({
        item: a,
        primary: normalize(a.name),
        secondary: '',
        weight: a.playCount + (a.isFavorite ? 5 : 0),
      }));
    }
    if (input.playlists) {
      this.playlists = input.playlists.map((p) => ({
        item: p,
        primary: normalize(p.name),
        secondary: '',
        weight: p.playCount,
      }));
    }
  }

  get size(): number {
    return this.tracks.length + this.albums.length + this.artists.length + this.playlists.length;
  }

  search(term: string, limit = 8): SearchResult {
    const query = normalize(term);
    if (!query) return { tracks: [], albums: [], artists: [], playlists: [] };
    return {
      artists: rank(this.artists, query, limit),
      albums: rank(this.albums, query, limit),
      tracks: rank(this.tracks, query, limit),
      playlists: rank(this.playlists, query, limit),
    };
  }
}

export function isEmptyResult(result: SearchResult): boolean {
  return (
    result.tracks.length +
      result.albums.length +
      result.artists.length +
      result.playlists.length ===
    0
  );
}

export const RECENT_SEARCHES_LIMIT = 10;

/** Recent searches, newest first, no duplicates, trimmed and capped (F11). */
export function rememberSearch(
  recent: string[],
  term: string,
  limit = RECENT_SEARCHES_LIMIT,
): string[] {
  const clean = term.trim();
  if (!clean) return recent;
  const key = normalize(clean);
  return [clean, ...recent.filter((r) => normalize(r) !== key)].slice(0, limit);
}
