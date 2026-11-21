/**
 * Sort and filter over cached items (F15), one implementation for every list on web and mobile.
 * `random` is seeded so a list does not reshuffle on every render.
 */
import type { Album, Artist, Playlist, Track } from './models';
import type { SortKey, SortOrder } from './server-adapter';

export const sortKeys: readonly SortKey[] = [
  'name',
  'dateAdded',
  'year',
  'playCount',
  'lastPlayed',
  'random',
];

/** The order a key defaults to when the user has not chosen one: names ascend, everything else descends. */
export function defaultOrder(key: SortKey): SortOrder {
  return key === 'name' ? 'asc' : 'desc';
}

type Sortable = Track | Album | Artist | Playlist;

function nameOf(item: Sortable): string {
  return 'title' in item ? item.title : item.name;
}

function yearOf(item: Sortable): number {
  return 'year' in item && item.year !== undefined ? item.year : 0;
}

function time(value: string | undefined): number {
  return value ? Date.parse(value) : 0;
}

/** A small deterministic PRNG (mulberry32) so random order is stable for one seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sortItems<T extends Sortable>(
  items: readonly T[],
  key: SortKey,
  order: SortOrder = defaultOrder(key),
  seed = 1,
): T[] {
  const out = [...items];
  if (key === 'random') {
    const random = seededRandom(seed);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const byName = (a: T, b: T) => collator.compare(nameOf(a), nameOf(b));
  const primary: (a: T, b: T) => number = {
    name: byName,
    dateAdded: (a: T, b: T) => time(a.dateAdded) - time(b.dateAdded),
    year: (a: T, b: T) => yearOf(a) - yearOf(b),
    playCount: (a: T, b: T) => a.playCount - b.playCount,
    lastPlayed: (a: T, b: T) => time(a.lastPlayed) - time(b.lastPlayed),
    lastSaved: byName,
  }[key];
  // Ties always fall back to the name ascending, whichever way the main key runs.
  out.sort((a, b) => (order === 'asc' ? primary(a, b) : primary(b, a)) || byName(a, b));
  return out;
}

export interface TrackFilter {
  favorites?: boolean;
  genre?: string;
  year?: number;
  artistId?: string;
  albumId?: string;
}

export function filterTracks(tracks: readonly Track[], filter: TrackFilter): Track[] {
  return tracks.filter(
    (t) =>
      (!filter.favorites || t.isFavorite) &&
      (!filter.genre || t.genres.includes(filter.genre)) &&
      (filter.year === undefined || t.year === filter.year) &&
      (!filter.artistId || t.artistIds.includes(filter.artistId)) &&
      (!filter.albumId || t.albumId === filter.albumId),
  );
}

export interface AlbumFilter {
  favorites?: boolean;
  genre?: string;
  year?: number;
  artistId?: string;
}

export function filterAlbums(albums: readonly Album[], filter: AlbumFilter): Album[] {
  return albums.filter(
    (a) =>
      (!filter.favorites || a.isFavorite) &&
      (!filter.genre || a.genres.includes(filter.genre)) &&
      (filter.year === undefined || a.year === filter.year) &&
      (!filter.artistId || a.artistIds.includes(filter.artistId)),
  );
}

/** Album tracks in disc then track order, for the album page's disc split (F9). */
export function sortAlbumTracks(tracks: readonly Track[]): Track[] {
  return [...tracks].sort(
    (a, b) =>
      (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
      (a.trackNumber ?? 0) - (b.trackNumber ?? 0) ||
      a.title.localeCompare(b.title),
  );
}

export function groupByDisc(tracks: readonly Track[]): { disc: number; tracks: Track[] }[] {
  const discs = new Map<number, Track[]>();
  for (const track of sortAlbumTracks(tracks)) {
    const disc = track.discNumber ?? 1;
    discs.set(disc, [...(discs.get(disc) ?? []), track]);
  }
  return [...discs.entries()].map(([disc, list]) => ({ disc, tracks: list }));
}

/** "3:07" or "1:02:09"; whole seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
