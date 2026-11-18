/**
 * The local library cache (F14): everything the library screens read comes from here, so browsing is
 * instant and works offline. The store itself is injected (IndexedDB on web, SQLite on mobile); this
 * module owns what goes in and how it is refreshed.
 *
 * Refresh strategy, shaped by Jellyfin 10.10 (see JellyfinAdapter):
 * - first run: every track, album, artist and playlist, in pages, with progress callbacks;
 * - later runs ("delta"): new tracks and albums by paging `dateAdded` descending until the last sync
 *   time; recently edited items by one page of `lastSaved`; favourite and play-count changes through
 *   `userDataChangedSince`; artists and playlists refetched whole (they are small); deletions and
 *   misses found by comparing the server's total with the cache's count and reconciling ids when
 *   they differ: ids the server no longer has are dropped, ids the cache lacks are fetched.
 * - the delta reads from a watermark the server itself stamped, not from a clock: the newest
 *   `dateAdded` and the newest `lastSaved` the previous sync saw. Neither side's clock matters, and
 *   nothing is read from response headers (Jellyfin does not expose `Date` to another origin).
 *   `syncedAt` is this device's own clock and only says "last refreshed" on screen.
 */
import { z } from 'zod';

import { mergeArtists } from './artists';
import type { Album, Artist, Playlist, Track } from './models';
import {
  Album as AlbumSchema,
  Artist as ArtistSchema,
  Playlist as PlaylistSchema,
  Track as TrackSchema,
} from './models';
import type { Library, Page, PageRequest } from './server-adapter';

export type CacheKind = 'track' | 'album' | 'artist' | 'playlist';
export type CacheItem = Track | Album | Artist | Playlist;

/**
 * Where the last sync got to, in the server's own stamps: the delta pages `dateAdded` down to
 * `added` and asks for user data saved since `saved`. A full sync that saw no dated item leaves it
 * unset, and the next sync is full again.
 */
export const SyncWatermark = z.object({
  added: z.iso.datetime({ offset: true }),
  saved: z.iso.datetime({ offset: true }),
});
export type SyncWatermark = z.infer<typeof SyncWatermark>;

export const LibraryMeta = z.object({
  /** When this device last finished a sync, by its own clock. Shown as "last refreshed"; never compared with server dates. */
  syncedAt: z.iso.datetime(),
  /** The server-side watermark the next delta reads from. */
  watermark: SyncWatermark.optional(),
  /** Ids of artists that are album artists, from the server's own list. */
  albumArtistIds: z.array(z.string()).default([]),
});
export type LibraryMeta = z.infer<typeof LibraryMeta>;

/** What a platform store must offer; every method may reject and the sync reports it. */
export interface LibraryStore {
  read(kind: CacheKind): Promise<CacheItem[]>;
  write(kind: CacheKind, items: readonly CacheItem[]): Promise<void>;
  remove(kind: CacheKind, ids: readonly string[]): Promise<void>;
  /** Replace a whole kind (used on a full sync and when the server's id list says the cache drifted). */
  replace(kind: CacheKind, items: readonly CacheItem[]): Promise<void>;
  /** How many items of a kind are stored, without reading them. */
  count(kind: CacheKind): Promise<number>;
  readMeta(): Promise<LibraryMeta | null>;
  writeMeta(meta: LibraryMeta): Promise<void>;
  clear(): Promise<void>;
}

export interface LibrarySnapshot {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  albumArtists: Artist[];
  playlists: Playlist[];
  genres: string[];
  years: number[];
  syncedAt: string | null;
}

export const emptySnapshot: LibrarySnapshot = {
  tracks: [],
  albums: [],
  artists: [],
  albumArtists: [],
  playlists: [],
  genres: [],
  years: [],
  syncedAt: null,
};

/**
 * Derived lists (genres, years, album artists) come from the cached items, so they need no extra
 * call. Artists are the server's list merged with the ids the tracks and albums carry (`artists.ts`).
 */
export function buildSnapshot(
  tracks: Track[],
  albums: Album[],
  serverArtists: Artist[],
  playlists: Playlist[],
  meta: LibraryMeta | null,
): LibrarySnapshot {
  const artists = mergeArtists(serverArtists, tracks, albums);
  const genres = new Set<string>();
  const years = new Set<number>();
  for (const t of tracks) {
    for (const g of t.genres) genres.add(g);
    if (t.year) years.add(t.year);
  }
  for (const a of albums) {
    for (const g of a.genres) genres.add(g);
    if (a.year) years.add(a.year);
  }
  const albumArtistIds = new Set(meta?.albumArtistIds ?? []);
  for (const a of albums) for (const id of a.artistIds) albumArtistIds.add(id);
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  return {
    tracks,
    albums,
    artists,
    albumArtists: artists.filter((a) => (a.ids ?? [a.id]).some((id) => albumArtistIds.has(id))),
    playlists,
    genres: [...genres].sort((a, b) => collator.compare(a, b)),
    years: [...years].sort((a, b) => b - a),
    syncedAt: meta?.syncedAt ?? null,
  };
}

function valid<T>(schema: z.ZodType<T>, items: unknown[]): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** What is on disk right now, validated item by item so one bad record cannot hide the library. */
export async function loadSnapshot(store: LibraryStore): Promise<LibrarySnapshot> {
  const [tracks, albums, artists, playlists, meta] = await Promise.all([
    store.read('track'),
    store.read('album'),
    store.read('artist'),
    store.read('playlist'),
    store.readMeta(),
  ]);
  return buildSnapshot(
    valid(TrackSchema, tracks),
    valid(AlbumSchema, albums),
    valid(ArtistSchema, artists),
    valid(PlaylistSchema, playlists),
    meta,
  );
}

export interface SyncProgress {
  kind: CacheKind;
  done: number;
  total: number;
}

export interface SyncOptions {
  /** Items per request. */
  pageSize?: number;
  onProgress?: (progress: SyncProgress) => void;
  /** This device's clock, for `syncedAt` ("last refreshed" on screen); nothing else reads it. */
  now?: () => Date;
  /** Force the first-run path even when a sync time exists. */
  full?: boolean;
}

export interface SyncResult {
  mode: 'full' | 'delta';
  snapshot: LibrarySnapshot;
  counts: Record<CacheKind, number>;
  /** Tracks and albums the delta had missed and that were fetched by id. */
  healed: number;
}

type Dated = { dateAdded?: string | undefined; lastSaved?: string | undefined };

/** The newest `dateAdded` and `lastSaved` across items, starting from a previous watermark. */
class Watermark {
  private added = Number.NaN;
  private saved = Number.NaN;

  constructor(previous?: SyncWatermark) {
    if (previous) {
      this.added = Date.parse(previous.added);
      this.saved = Date.parse(previous.saved);
    }
  }

  see(items: readonly Dated[]): void {
    for (const item of items) {
      if (item.dateAdded) this.added = later(this.added, Date.parse(item.dateAdded));
      // An item with no save stamp counts its creation as its last save.
      const saved = item.lastSaved ?? item.dateAdded;
      if (saved) this.saved = later(this.saved, Date.parse(saved));
    }
  }

  value(): SyncWatermark | undefined {
    if (Number.isNaN(this.added)) return undefined;
    const saved = Number.isNaN(this.saved) ? this.added : this.saved;
    return { added: new Date(this.added).toISOString(), saved: new Date(saved).toISOString() };
  }
}

function later(a: number, b: number): number {
  if (Number.isNaN(b)) return a;
  if (Number.isNaN(a)) return b;
  return Math.max(a, b);
}

async function allPages<T>(
  fetchPage: (page: PageRequest) => Promise<Page<T>>,
  pageSize: number,
  onPage?: (total: number, done: number) => void,
  stopWhen?: (item: T) => boolean,
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const page = await fetchPage({ start, limit: pageSize });
    let stop = false;
    for (const item of page.items) {
      if (stopWhen?.(item)) {
        stop = true;
        break;
      }
      out.push(item);
    }
    onPage?.(page.total, Math.min(start + page.items.length, page.total));
    if (stop || page.items.length < pageSize || start + page.items.length >= page.total) break;
  }
  return out;
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * Bring the store up to date and return the snapshot to show. Runs a full sync the first time (or
 * when asked, or when the stored meta carries no watermark), a delta afterwards. Writes happen per
 * kind and the meta is recorded last, so a failure half-way leaves the previous watermark and the
 * next run picks the changes up again.
 */
export async function syncLibrary(
  library: Library,
  store: LibraryStore,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const pageSize = options.pageSize ?? 1000;
  const now = options.now ?? (() => new Date());
  const stored = options.full ? null : await store.readMeta();
  const meta = stored?.watermark ? stored : null;
  const progress = (kind: CacheKind) => (total: number, done: number) =>
    options.onProgress?.({ kind, done, total });

  const artists = await allPages(
    (p) => library.artists(p, { sort: 'name' }),
    pageSize,
    progress('artist'),
  );
  const albumArtistIds = (
    await allPages((p) => library.albumArtists(p, { sort: 'name' }), pageSize)
  ).map((a) => a.id);
  const playlists = await allPages(
    (p) => library.playlists(p, { sort: 'name' }),
    pageSize,
    progress('playlist'),
  );
  const watermark = new Watermark(meta?.watermark);
  const finish = (): LibraryMeta => {
    const value = watermark.value();
    return {
      syncedAt: now().toISOString(),
      ...(value ? { watermark: value } : {}),
      albumArtistIds,
    };
  };

  if (!meta) {
    const tracks = await allPages(
      (p) => library.tracks(p, { sort: 'dateAdded', order: 'desc' }),
      pageSize,
      progress('track'),
    );
    const albums = await allPages(
      (p) => library.albums(p, { sort: 'dateAdded', order: 'desc' }),
      pageSize,
      progress('album'),
    );
    watermark.see(tracks);
    watermark.see(albums);
    const newMeta = finish();
    await store.replace('track', tracks);
    await store.replace('album', albums);
    await store.replace('artist', artists);
    await store.replace('playlist', playlists);
    await store.writeMeta(newMeta);
    return {
      mode: 'full',
      snapshot: buildSnapshot(tracks, albums, artists, playlists, newMeta),
      counts: {
        track: tracks.length,
        album: albums.length,
        artist: artists.length,
        playlist: playlists.length,
      },
      healed: 0,
    };
  }

  // `meta.watermark` is set: that is what made this a delta.
  const mark = meta.watermark as SyncWatermark;
  const since = Date.parse(mark.added);
  // Strictly older stops the paging; an item stamped exactly at the watermark is fetched again,
  // which is harmless, rather than skipped, which is not.
  const isOld = (item: { dateAdded?: string | undefined }) =>
    item.dateAdded !== undefined && Date.parse(item.dateAdded) < since;
  const [newTracks, newAlbums, changedUserData, editedTracks, editedAlbums] = await Promise.all([
    allPages(
      (p) => library.tracks(p, { sort: 'dateAdded', order: 'desc' }),
      pageSize,
      undefined,
      isOld,
    ),
    allPages(
      (p) => library.albums(p, { sort: 'dateAdded', order: 'desc' }),
      pageSize,
      undefined,
      isOld,
    ),
    allPages((p) => library.userDataChangedSince(mark.saved, p), pageSize),
    library.tracks({ start: 0, limit: 200 }, { sort: 'lastSaved', order: 'desc' }),
    library.albums({ start: 0, limit: 200 }, { sort: 'lastSaved', order: 'desc' }),
  ]);
  const trackUpdates = dedupe([...newTracks, ...changedUserData, ...editedTracks.items]);
  const albumUpdates = dedupe([...newAlbums, ...editedAlbums.items]);
  watermark.see(trackUpdates);
  watermark.see(albumUpdates);
  await store.write('track', trackUpdates);
  await store.write('album', albumUpdates);
  await store.replace('artist', artists);
  await store.replace('playlist', playlists);

  // Reconcile: when the server's total differs from the cache's count, compare id lists. Ids the
  // server no longer has are dropped; ids the cache lacks (a delta that missed them) are fetched.
  let healed = 0;
  let tracks: unknown[] | null = null;
  let albums: unknown[] | null = null;
  for (const kind of ['track', 'album'] as const) {
    const total = (
      kind === 'track'
        ? await library.tracks({ start: 0, limit: 1 })
        : await library.albums({ start: 0, limit: 1 })
    ).total;
    if (total === (await store.count(kind))) continue;
    const cached = await store.read(kind);
    const serverIds = await library.ids(kind);
    const serverSet = new Set(serverIds);
    const cachedSet = new Set(cached.map((item) => item.id));
    const gone = cached.filter((item) => !serverSet.has(item.id)).map((item) => item.id);
    if (gone.length) await store.remove(kind, gone);
    const missing = serverIds.filter((id) => !cachedSet.has(id));
    if (missing.length) {
      const fetched =
        kind === 'track'
          ? await library.byIds('track', missing)
          : await library.byIds('album', missing);
      watermark.see(fetched);
      await store.write(kind, fetched);
      healed += fetched.length;
    }
    if (gone.length || missing.length) {
      const fresh = await store.read(kind);
      if (kind === 'track') tracks = fresh;
      else albums = fresh;
    } else if (kind === 'track') tracks = cached;
    else albums = cached;
  }

  const newMeta = finish();
  await store.writeMeta(newMeta);
  tracks ??= await store.read('track');
  albums ??= await store.read('album');
  return {
    mode: 'delta',
    snapshot: buildSnapshot(
      valid(TrackSchema, tracks),
      valid(AlbumSchema, albums),
      artists,
      playlists,
      newMeta,
    ),
    counts: {
      track: trackUpdates.length,
      album: albumUpdates.length,
      artist: artists.length,
      playlist: playlists.length,
    },
    healed,
  };
}

/** An in-memory store for tests and for platforms without persistence. */
export class MemoryLibraryStore implements LibraryStore {
  private data: Record<CacheKind, Map<string, CacheItem>> = {
    track: new Map(),
    album: new Map(),
    artist: new Map(),
    playlist: new Map(),
  };
  private meta: LibraryMeta | null = null;

  read(kind: CacheKind): Promise<CacheItem[]> {
    return Promise.resolve([...this.data[kind].values()]);
  }
  write(kind: CacheKind, items: readonly CacheItem[]): Promise<void> {
    for (const item of items) this.data[kind].set(item.id, item);
    return Promise.resolve();
  }
  remove(kind: CacheKind, ids: readonly string[]): Promise<void> {
    for (const id of ids) this.data[kind].delete(id);
    return Promise.resolve();
  }
  replace(kind: CacheKind, items: readonly CacheItem[]): Promise<void> {
    this.data[kind] = new Map(items.map((i) => [i.id, i]));
    return Promise.resolve();
  }
  count(kind: CacheKind): Promise<number> {
    return Promise.resolve(this.data[kind].size);
  }
  readMeta(): Promise<LibraryMeta | null> {
    return Promise.resolve(this.meta);
  }
  writeMeta(meta: LibraryMeta): Promise<void> {
    this.meta = meta;
    return Promise.resolve();
  }
  clear(): Promise<void> {
    for (const kind of Object.keys(this.data) as CacheKind[]) this.data[kind] = new Map();
    this.meta = null;
    return Promise.resolve();
  }
}
