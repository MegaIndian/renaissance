/**
 * The local listening log (F47, ADR 0014): every play, with device, time, how long was heard and
 * whether it was a skip, kept on the device and optionally pushed to a server as a playlist-free
 * history. Four parts, all platform-neutral:
 *
 * - `ListeningTracker` turns the Player's start and end play events plus its position into
 *   `ListenEvent`s. It never talks to Jellyfin: play counts on the server stay the job of play
 *   reporting (F26), which runs beside it unchanged.
 * - `ListeningLogStore` is the storage contract. Web implements it on IndexedDB, mobile will on
 *   SQLite; `MemoryListeningLogStore` is the reference and the fallback when storage is refused.
 * - The query functions (`topTracks`, `topArtists`, `playsPerTrack`, `lastPlayed`, `skipRate`, ...)
 *   are pure over a list of events; `ListeningLog` runs them over a store and a time window. This is
 *   what "Because you listened", "Rediscover", daily mixes and "Year in review" read.
 * - `ListeningSync` is the optional upload. Only `noopListeningSync` exists until the hub has an
 *   endpoint; `syncListening` already does the batching and the bookkeeping.
 */
import { z } from 'zod';

import type { Track } from './models';
import type { PlayEvent, Player } from './playback';

/**
 * Where a play came from (F47): the screen or feature that queued it, and the id of the album,
 * artist or playlist when there is one. `other` covers a queue restored after a reload.
 */
export const ListenSourceKind = z.enum([
  'album',
  'artist',
  'playlist',
  'radio',
  'search',
  'library',
  'favorites',
  'home',
  'history',
  'queue',
  'other',
]);
export type ListenSourceKind = z.infer<typeof ListenSourceKind>;

export const ListenSource = z.object({
  kind: ListenSourceKind,
  id: z.string().min(1).optional(),
});
export type ListenSource = z.infer<typeof ListenSource>;

/** Why a play ended: the track ran out, the user moved on (and how), or playback stopped. */
export const ListenEndReason = z.enum([
  'ended',
  'next',
  'previous',
  'jump',
  'replaced',
  'removed',
  'cleared',
  'stopped',
  'error',
]);
export type ListenEndReason = z.infer<typeof ListenEndReason>;

/**
 * One play in the local listening log (F47, ADR 0005, ADR 0014): what played, on which device, from
 * when to when, how long was actually heard, and whether it was a skip. The track's title, artist and
 * album are copied in so History reads without the library; the ids are what the query API counts.
 */
export const ListenEvent = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  userId: z.string().min(1),
  trackId: z.string().min(1),
  albumId: z.string().optional(),
  artistIds: z.array(z.string()),
  title: z.string(),
  artistName: z.string(),
  albumTitle: z.string().optional(),
  imageId: z.string().optional(),
  /** The track's length in seconds, 0 when unknown. */
  trackDuration: z.number().nonnegative(),
  /** When the play started (ISO, UTC); the log is ordered and windowed by this. */
  at: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  /** Seconds actually heard: seeks are not counted. */
  listened: z.number().nonnegative(),
  /** Seconds into the track when it ended. */
  position: z.number().nonnegative(),
  completed: z.boolean(),
  skipped: z.boolean(),
  endReason: ListenEndReason,
  source: ListenSource,
  /** The device's name as the server knows it ("Chrome on Windows"). */
  device: z.string(),
  /** Set once a sync target stored this play. */
  syncedAt: z.iso.datetime().optional(),
});
export type ListenEvent = z.infer<typeof ListenEvent>;

/** Under this many seconds heard, moving away from a track is a skip. */
export const SKIP_SECONDS = 30;
/** A play heard for at least this share of the track counts as completed even if it did not end. */
export const COMPLETED_SHARE = 0.9;
/** Plays heard for less than this are not logged at all (a rapid run through the queue). */
export const MIN_LOGGED_SECONDS = 1;
/** Between two position updates more than this is a seek or a stall, not listening. */
const MAX_TICK_SECONDS = 5;

/**
 * The user moved away from the track: these are the reasons that can make a play a skip. Plain
 * arrays, not sets: a module with no top-level calls drops out of a bundle that does not use it.
 */
const USER_MOVES: readonly ListenEndReason[] = ['next', 'previous', 'jump', 'replaced', 'removed'];
/** "Next" and choosing another queue entry: before half the track, these are skips at any length. */
const NEXT_MOVES: readonly ListenEndReason[] = ['next', 'jump'];

/**
 * The skip rule: the user moved away (next, previous, a jump in the queue, a new queue, removing
 * the playing entry) after hearing less than 30 seconds, or pressed Next or jumped before half the
 * track. A track shorter than a minute is a skip under half its length. A natural end, a cleared
 * queue, a sign-out and a failed stream are never skips.
 */
export function isSkip(reason: ListenEndReason, listened: number, duration: number): boolean {
  if (!USER_MOVES.includes(reason)) return false;
  const half = duration > 0 ? duration / 2 : Number.POSITIVE_INFINITY;
  if (listened < Math.min(SKIP_SECONDS, half)) return true;
  return duration > 0 && NEXT_MOVES.includes(reason) && listened < half;
}

/** Completed: the track ran to its end, or at least 90 % of it was heard. */
export function isCompleted(reason: ListenEndReason, listened: number, duration: number): boolean {
  if (reason === 'ended') return true;
  return duration > 0 && listened >= duration * COMPLETED_SHARE;
}

export interface ListenContext {
  serverId: string;
  userId: string;
  /** The device's name ("Chrome on Windows"). */
  device: string;
}

export interface ListeningTrackerDeps {
  /** Who is listening, read when a play starts; `null` (signed out) logs nothing. */
  context: () => ListenContext | null;
  /** Read when a play ends: false (the setting is off) drops it. */
  enabled: () => boolean;
  /** Store the finished play; a failure goes to `onError` and playback is never affected. */
  record: (event: ListenEvent) => Promise<void> | void;
  now?: () => number;
  newId?: () => string;
  onError?: (error: unknown) => void;
}

let counter = 0;

function defaultId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

interface OpenPlay {
  track: Track;
  source: ListenSource;
  context: ListenContext;
  startedAt: number;
  listened: number;
  lastPosition: number;
}

/**
 * Follows one Player: `start` opens a play, `progress` adds the time actually heard (forward steps
 * of up to five seconds while playing; seeks and stalls add nothing), `end` closes it and records a
 * `ListenEvent`. Plays heard for under a second are dropped.
 */
export class ListeningTracker {
  private readonly deps: Required<ListeningTrackerDeps>;
  private open: OpenPlay | null = null;

  constructor(deps: ListeningTrackerDeps) {
    this.deps = {
      now: () => Date.now(),
      newId: defaultId,
      onError: () => undefined,
      ...deps,
    };
  }

  /** The play being followed, for tests and the History screen's "now" line. */
  get current(): { trackId: string; listened: number } | null {
    return this.open ? { trackId: this.open.track.id, listened: this.open.listened } : null;
  }

  start(track: Track, source: ListenSource, position = 0): void {
    const context = this.deps.context();
    this.open = context
      ? {
          track,
          source,
          context,
          startedAt: this.deps.now(),
          listened: 0,
          lastPosition: position,
        }
      : null;
  }

  progress(position: number, playing: boolean): void {
    const open = this.open;
    if (!open) return;
    const step = position - open.lastPosition;
    if (playing && step > 0 && step <= MAX_TICK_SECONDS) open.listened += step;
    open.lastPosition = position;
  }

  end(position: number, reason: ListenEndReason): ListenEvent | null {
    const open = this.open;
    this.open = null;
    if (!open) return null;
    // The last stretch before the end, which no position update reported.
    const step = position - open.lastPosition;
    if (step > 0 && step <= MAX_TICK_SECONDS && reason === 'ended') open.listened += step;
    if (open.listened < MIN_LOGGED_SECONDS || !this.deps.enabled()) return null;
    const { track, source, context } = open;
    const listened = Math.round(open.listened * 10) / 10;
    const duration = track.duration || 0;
    const event: ListenEvent = {
      id: this.deps.newId(),
      serverId: context.serverId,
      userId: context.userId,
      trackId: track.id,
      ...(track.albumId ? { albumId: track.albumId } : {}),
      artistIds: [...track.artistIds],
      title: track.title,
      artistName: track.artistName,
      ...(track.albumTitle ? { albumTitle: track.albumTitle } : {}),
      ...(track.imageId ? { imageId: track.imageId } : {}),
      trackDuration: duration,
      at: new Date(open.startedAt).toISOString(),
      endedAt: new Date(this.deps.now()).toISOString(),
      listened,
      position: Math.max(0, Math.round(position * 10) / 10),
      completed: isCompleted(reason, listened, duration),
      skipped: isSkip(reason, listened, duration),
      endReason: reason,
      source,
      device: context.device,
    };
    try {
      const pending = this.deps.record(event);
      if (pending) pending.catch((error: unknown) => this.deps.onError(error));
    } catch (error) {
      this.deps.onError(error);
    }
    return event;
  }
}

/**
 * Wire a tracker to a Player: its play events open and close plays, its snapshots feed the heard
 * time. Returns the unsubscribe. Play reporting (F26) is the Player's own and is not touched.
 */
export function attachListeningTracker(player: Player, tracker: ListeningTracker): () => void {
  const offPlay = player.onPlay((event: PlayEvent) => {
    if (event.type === 'start') tracker.start(event.track, event.source, event.position);
    else tracker.end(event.position, event.reason);
  });
  const offSnapshot = player.subscribe((snapshot) => {
    tracker.progress(snapshot.position, snapshot.status === 'playing');
  });
  return () => {
    offPlay();
    offSnapshot();
  };
}

/** A time window over `at`: `from` included, `to` excluded; either side open when left out. */
export interface ListenWindow {
  from?: Date;
  to?: Date;
}

export interface ListenQuery extends ListenWindow {
  /** Newest first; at most this many. */
  limit?: number;
}

/**
 * Where the log lives: one store per server and user, so it never mixes household members (F86).
 * Every method is async so IndexedDB (web) and SQLite (mobile) fit the same contract.
 */
export interface ListeningLogStore {
  /** Insert or replace by `id`. */
  add(events: readonly ListenEvent[]): Promise<void>;
  /** Events in the window, newest first (by `at`, then `id`), up to `limit`. */
  list(query?: ListenQuery): Promise<ListenEvent[]>;
  count(): Promise<number>;
  remove(ids: readonly string[]): Promise<void>;
  /** Remove every event; resolves with what was removed, so the screen can offer an undo. */
  clear(): Promise<ListenEvent[]>;
  /** Events not yet stored by the sync target, oldest first. */
  unsynced(limit: number): Promise<ListenEvent[]>;
  markSynced(ids: readonly string[], at: string): Promise<void>;
}

/** Newest first by `at`, then by id so the order is stable. */
export function compareNewestFirst(a: ListenEvent, b: ListenEvent): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** `at` is ISO in UTC from `toISOString`, so string order is time order. */
export function inWindow(event: ListenEvent, window: ListenWindow = {}): boolean {
  if (window.from && event.at < window.from.toISOString()) return false;
  if (window.to && event.at >= window.to.toISOString()) return false;
  return true;
}

/** Reads a stored event; anything that does not match the schema is `null` and is skipped. */
export function parseListenEvent(raw: unknown): ListenEvent | null {
  const parsed = ListenEvent.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The reference store, and the one used when the platform refuses storage (a private window). */
export class MemoryListeningLogStore implements ListeningLogStore {
  private readonly events = new Map<string, ListenEvent>();

  add(events: readonly ListenEvent[]): Promise<void> {
    for (const event of events) this.events.set(event.id, event);
    return Promise.resolve();
  }

  list(query: ListenQuery = {}): Promise<ListenEvent[]> {
    const out = [...this.events.values()]
      .filter((e) => inWindow(e, query))
      .sort(compareNewestFirst);
    return Promise.resolve(query.limit === undefined ? out : out.slice(0, query.limit));
  }

  count(): Promise<number> {
    return Promise.resolve(this.events.size);
  }

  remove(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.events.delete(id);
    return Promise.resolve();
  }

  clear(): Promise<ListenEvent[]> {
    const all = [...this.events.values()].sort(compareNewestFirst);
    this.events.clear();
    return Promise.resolve(all);
  }

  unsynced(limit: number): Promise<ListenEvent[]> {
    return Promise.resolve(
      [...this.events.values()]
        .filter((e) => !e.syncedAt)
        .sort((a, b) => compareNewestFirst(b, a))
        .slice(0, limit),
    );
  }

  markSynced(ids: readonly string[], at: string): Promise<void> {
    for (const id of ids) {
      const event = this.events.get(id);
      if (event) this.events.set(id, { ...event, syncedAt: at });
    }
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------------------------
// Queries: pure functions over events. Skips count as plays nowhere; they are counted on their own.
// ---------------------------------------------------------------------------------------------

export interface TrackStat {
  trackId: string;
  title: string;
  artistName: string;
  albumId?: string;
  /** Plays that were not skips. */
  plays: number;
  skips: number;
  /** Seconds heard across every play, skips included. */
  listened: number;
  /** The newest play's start (ISO). */
  lastPlayed: string;
}

export interface ArtistStat {
  artistId: string;
  artistName: string;
  plays: number;
  skips: number;
  listened: number;
  lastPlayed: string;
}

export interface AlbumStat {
  albumId: string;
  albumTitle: string;
  artistName: string;
  plays: number;
  skips: number;
  listened: number;
  lastPlayed: string;
}

export interface SkipRate {
  /** Every logged play, skips included. */
  plays: number;
  skips: number;
  /** skips / plays; 0 when there are no plays. */
  rate: number;
}

interface Tally {
  plays: number;
  skips: number;
  listened: number;
  lastPlayed: string;
}

function tally<K extends string, T extends Tally>(
  events: readonly ListenEvent[],
  keysOf: (event: ListenEvent) => K[],
  create: (event: ListenEvent, key: K) => T,
): Map<K, T> {
  const out = new Map<K, T>();
  for (const event of events) {
    for (const key of keysOf(event)) {
      let stat = out.get(key);
      if (!stat) {
        stat = create(event, key);
        out.set(key, stat);
      }
      if (event.skipped) stat.skips += 1;
      else stat.plays += 1;
      stat.listened += event.listened;
      if (event.at > stat.lastPlayed) stat.lastPlayed = event.at;
    }
  }
  return out;
}

/** Most plays first, then most time heard, then the most recent. Items with no real play are left out. */
function rank<T extends Tally>(stats: Iterable<T>, limit: number | undefined): T[] {
  const ranked = [...stats]
    .filter((s) => s.plays > 0)
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        b.listened - a.listened ||
        (a.lastPlayed < b.lastPlayed ? 1 : a.lastPlayed > b.lastPlayed ? -1 : 0),
    );
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

const blank = (event: ListenEvent): Tally => ({
  plays: 0,
  skips: 0,
  listened: 0,
  lastPlayed: event.at,
});

function trackStats(events: readonly ListenEvent[]): Map<string, TrackStat> {
  return tally(
    events,
    (e) => [e.trackId],
    (e) => ({
      trackId: e.trackId,
      title: e.title,
      artistName: e.artistName,
      ...(e.albumId ? { albumId: e.albumId } : {}),
      ...blank(e),
    }),
  );
}

export function topTracks(events: readonly ListenEvent[], limit?: number): TrackStat[] {
  return rank(trackStats(events).values(), limit);
}

/** A play credits every artist on the track; the name is the track's artist line. */
export function topArtists(events: readonly ListenEvent[], limit?: number): ArtistStat[] {
  const stats = tally(
    events,
    (e) => [...new Set(e.artistIds)],
    (e, artistId) => ({ artistId, artistName: e.artistName, ...blank(e) }),
  );
  return rank(stats.values(), limit);
}

export function topAlbums(events: readonly ListenEvent[], limit?: number): AlbumStat[] {
  const stats = tally(
    events,
    (e) => (e.albumId ? [e.albumId] : []),
    (e, albumId) => ({
      albumId,
      albumTitle: e.albumTitle ?? '',
      artistName: e.artistName,
      ...blank(e),
    }),
  );
  return rank(stats.values(), limit);
}

/** Plays (skips excluded) per track id. */
export function playsPerTrack(events: readonly ListenEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) if (!e.skipped) out.set(e.trackId, (out.get(e.trackId) ?? 0) + 1);
  return out;
}

/** The newest start (ISO) per track id, skips included: a skip is still a time it was played. */
export function lastPlayed(events: readonly ListenEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    const seen = out.get(e.trackId);
    if (!seen || e.at > seen) out.set(e.trackId, e.at);
  }
  return out;
}

export interface SkipRateFilter {
  trackId?: string;
  artistId?: string;
  albumId?: string;
}

export function skipRate(events: readonly ListenEvent[], filter: SkipRateFilter = {}): SkipRate {
  let plays = 0;
  let skips = 0;
  for (const e of events) {
    if (filter.trackId && e.trackId !== filter.trackId) continue;
    if (filter.artistId && !e.artistIds.includes(filter.artistId)) continue;
    if (filter.albumId && e.albumId !== filter.albumId) continue;
    plays += 1;
    if (e.skipped) skips += 1;
  }
  return { plays, skips, rate: plays ? skips / plays : 0 };
}

/** Seconds heard in total. */
export function totalListened(events: readonly ListenEvent[]): number {
  return events.reduce((sum, e) => sum + e.listened, 0);
}

export type ListenFilter = 'all' | 'skipped' | 'completed';

export function filterListens(events: readonly ListenEvent[], filter: ListenFilter): ListenEvent[] {
  if (filter === 'skipped') return events.filter((e) => e.skipped);
  if (filter === 'completed') return events.filter((e) => e.completed);
  return [...events];
}

/** The local calendar day of an instant, as `YYYY-MM-DD`. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface ListenDay {
  /** `YYYY-MM-DD` in the device's time zone. */
  day: string;
  events: ListenEvent[];
}

/** Events grouped by local day, newest day first, each day newest first. */
export function groupByDay(events: readonly ListenEvent[]): ListenDay[] {
  const days = new Map<string, ListenEvent[]>();
  for (const e of [...events].sort(compareNewestFirst)) {
    const day = localDay(e.at);
    const list = days.get(day);
    if (list) list.push(e);
    else days.set(day, [e]);
  }
  return [...days].map(([day, list]) => ({ day, events: list }));
}

/** The window of the last `days` days up to `now`. */
export function lastDays(days: number, now: Date = new Date()): Required<ListenWindow> {
  return { from: new Date(now.getTime() - days * 86_400_000), to: now };
}

/**
 * The query API over a store (the contract for F44, F45, F42 and F48): every method takes a
 * window over the play's start time and reads only that slice.
 */
export class ListeningLog {
  constructor(readonly store: ListeningLogStore) {}

  /** Raw events in the window, newest first. */
  events(query: ListenQuery = {}): Promise<ListenEvent[]> {
    return this.store.list(query);
  }

  async topTracks(window: ListenWindow = {}, limit?: number): Promise<TrackStat[]> {
    return topTracks(await this.store.list(window), limit);
  }

  async topArtists(window: ListenWindow = {}, limit?: number): Promise<ArtistStat[]> {
    return topArtists(await this.store.list(window), limit);
  }

  async topAlbums(window: ListenWindow = {}, limit?: number): Promise<AlbumStat[]> {
    return topAlbums(await this.store.list(window), limit);
  }

  async playsPerTrack(window: ListenWindow = {}): Promise<Map<string, number>> {
    return playsPerTrack(await this.store.list(window));
  }

  async playsOf(trackId: string, window: ListenWindow = {}): Promise<number> {
    return (await this.playsPerTrack(window)).get(trackId) ?? 0;
  }

  async lastPlayed(window: ListenWindow = {}): Promise<Map<string, string>> {
    return lastPlayed(await this.store.list(window));
  }

  async lastPlayedOf(trackId: string): Promise<string | undefined> {
    return (await this.lastPlayed()).get(trackId);
  }

  async skipRate(window: ListenWindow = {}, filter: SkipRateFilter = {}): Promise<SkipRate> {
    return skipRate(await this.store.list(window), filter);
  }

  async totalListened(window: ListenWindow = {}): Promise<number> {
    return totalListened(await this.store.list(window));
  }
}

// ---------------------------------------------------------------------------------------------
// Optional sync to a server, as a playlist-free history.
// ---------------------------------------------------------------------------------------------

/**
 * Where plays are uploaded. `push` sends a batch and resolves with the ids the target stored; ids
 * it did not name are sent again next time, so the target must accept a repeat by `id`.
 */
export interface ListeningSync {
  push(events: readonly ListenEvent[]): Promise<string[]>;
}

/** No server stores the log yet (the hub endpoint comes later): nothing is sent, nothing is marked. */
export const noopListeningSync: ListeningSync = {
  push: () => Promise.resolve([]),
};

/**
 * Push unsynced plays in batches until the target stops accepting or nothing is left; returns how
 * many were stored. The no-op target stores none, so this is one empty round.
 */
export async function syncListening(
  store: ListeningLogStore,
  sync: ListeningSync,
  options: { batch?: number; now?: () => Date } = {},
): Promise<number> {
  const batch = options.batch ?? 200;
  const now = options.now ?? (() => new Date());
  let stored = 0;
  for (;;) {
    const pending = await store.unsynced(batch);
    if (!pending.length) return stored;
    const accepted = new Set(await sync.push(pending));
    const ids = pending.filter((e) => accepted.has(e.id)).map((e) => e.id);
    if (!ids.length) return stored;
    await store.markSynced(ids, now().toISOString());
    stored += ids.length;
    if (ids.length < pending.length) return stored;
  }
}
