/**
 * The listening log on the web (F47, ADR 0014): core's `ListeningTracker` follows the Player and
 * every finished play lands in an IndexedDB `ListeningLogStore`, one database per server and user,
 * the way the library cache is kept (ADR 0008). When the browser refuses IndexedDB, core's
 * `MemoryListeningLogStore` keeps the log for the session. Jellyfin's own play reporting (F26) is
 * the Player's and is untouched; nothing here talks to the server. The optional upload is core's
 * `ListeningSync`, the no-op one until the hub has an endpoint.
 */
import {
  ListeningLog,
  ListeningTracker,
  MemoryListeningLogStore,
  attachListeningTracker,
  createStore,
  noopListeningSync,
  parseListenEvent,
  syncListening,
} from '@renaissance/core';
import type {
  ListenContext,
  ListenEvent,
  ListenQuery,
  ListeningLogStore,
  ListeningSync,
  PlayEvent,
  Player,
  Session,
} from '@renaissance/core';
import { useQuery } from '@tanstack/react-query';
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

// Who is signed in, whether the setting is on and where errors go are handed in by `attachHistory`
// (app.ts), so this chunk depends on core, idb and the store hook only.
import { useStoreValue } from './useStore';

interface HistorySchema extends DBSchema {
  listens: { key: string; value: ListenEvent; indexes: { at: string } };
}

/** `at` is ISO UTC, so the index orders by time; within one instant the key (the id) orders. */
export class IndexedDbListeningLogStore implements ListeningLogStore {
  private db: Promise<IDBPDatabase<HistorySchema>>;

  constructor(readonly name: string) {
    // An async wrapper: `indexedDB` missing or a getter that throws becomes a rejection, not a throw.
    this.db = (async () =>
      openDB<HistorySchema>(name, 1, {
        upgrade(db) {
          const store = db.createObjectStore('listens', { keyPath: 'id' });
          store.createIndex('at', 'at');
        },
      }))();
  }

  async ready(): Promise<void> {
    await this.db;
  }

  async add(events: readonly ListenEvent[]): Promise<void> {
    const tx = (await this.db).transaction('listens', 'readwrite');
    await Promise.all([...events.map((e) => tx.store.put(e)), tx.done]);
  }

  async list(query: ListenQuery = {}): Promise<ListenEvent[]> {
    const db = await this.db;
    const from = query.from?.toISOString();
    const to = query.to?.toISOString();
    const range =
      from && to
        ? IDBKeyRange.bound(from, to, false, true)
        : from
          ? IDBKeyRange.lowerBound(from)
          : to
            ? IDBKeyRange.upperBound(to, true)
            : undefined;
    const out: ListenEvent[] = [];
    let cursor = await db.transaction('listens').store.index('at').openCursor(range, 'prev');
    while (cursor && (query.limit === undefined || out.length < query.limit)) {
      // A record that no longer parses (an older shape, a hand edit) is skipped, never fatal.
      const event = parseListenEvent(cursor.value);
      if (event) out.push(event);
      cursor = await cursor.continue();
    }
    return out;
  }

  async count(): Promise<number> {
    return (await this.db).count('listens');
  }

  async remove(ids: readonly string[]): Promise<void> {
    const tx = (await this.db).transaction('listens', 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }

  async clear(): Promise<ListenEvent[]> {
    const tx = (await this.db).transaction('listens', 'readwrite');
    const all = await tx.store.index('at').getAll();
    await tx.store.clear();
    await tx.done;
    return all.reverse();
  }

  async unsynced(limit: number): Promise<ListenEvent[]> {
    const out: ListenEvent[] = [];
    let cursor = await (await this.db).transaction('listens').store.index('at').openCursor();
    while (cursor && out.length < limit) {
      const event = parseListenEvent(cursor.value);
      if (event && !event.syncedAt) out.push(event);
      cursor = await cursor.continue();
    }
    return out;
  }

  async markSynced(ids: readonly string[], at: string): Promise<void> {
    const tx = (await this.db).transaction('listens', 'readwrite');
    await Promise.all([
      ...ids.map(async (id) => {
        const event = await tx.store.get(id);
        if (event) await tx.store.put({ ...event, syncedAt: at });
      }),
      tx.done,
    ]);
  }

  async close(): Promise<void> {
    (await this.db).close();
  }
}

export type WebListeningLogStore = ListeningLogStore & { close?: () => Promise<void> };

export function historyDbName(serverId: string, userId: string): string {
  return `renaissance-history-${serverId}-${userId}`.replace(/[^\w.-]/g, '_');
}

export async function openHistoryStore(
  name: string,
): Promise<{ store: WebListeningLogStore; persisted: boolean }> {
  try {
    const store = new IndexedDbListeningLogStore(name);
    await store.ready();
    return { store, persisted: true };
  } catch {
    return { store: new MemoryListeningLogStore(), persisted: false };
  }
}

export interface HistoryState {
  /** `server:user` of the open log, `null` signed out. */
  key: string | null;
  /** Bumped on every change, so screens read the log again. */
  version: number;
  /** Plays in the log. */
  count: number;
  ready: boolean;
  /** False when the browser refused IndexedDB and the log lives in memory for this tab. */
  persisted: boolean;
}

export const historyStore = createStore<HistoryState>({
  key: null,
  version: 0,
  count: 0,
  ready: false,
  persisted: true,
});

let active: { key: string; store: WebListeningLogStore; log: ListeningLog } | null = null;
let opening: Promise<void> | null = null;
let sync: ListeningSync = noopListeningSync;
/** Where survivable failures go; `attachHistory` sets the app's debug channel. */
let reportError: (error: unknown) => void = () => undefined;
/** Memory stores for users whose IndexedDB was refused, kept so a sign-in again finds the session's log. */
const memory = new Map<string, WebListeningLogStore>();

const keyOf = (serverId: string, userId: string): string => `${serverId}:${userId}`;

async function refreshCount(): Promise<void> {
  const current = active;
  if (!current) return;
  const count = await current.store.count().catch(() => historyStore.get().count);
  if (active !== current) return;
  historyStore.set((s) => ({ ...s, count, version: s.version + 1 }));
}

/**
 * Plays that ended as the page went away (a reload, a closed tab). An IndexedDB write started then
 * does not survive the unload, so they are kept in localStorage, synchronously, and moved into
 * their user's log on the next start. At most the last 50 are kept.
 */
const PENDING_KEY = 'renaissance.history.pending';

function readPending(): ListenEvent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.flatMap((e) => parseListenEvent(e) ?? []) : [];
  } catch {
    return [];
  }
}

function writePending(events: readonly ListenEvent[]): void {
  try {
    if (events.length) localStorage.setItem(PENDING_KEY, JSON.stringify(events.slice(-50)));
    else localStorage.removeItem(PENDING_KEY);
  } catch (error) {
    reportError(error);
  }
}

/** Move this user's stashed plays into its log; another user's stay for their own sign-in. */
async function drainPending(key: string, store: ListeningLogStore): Promise<void> {
  const pending = readPending();
  const mine = pending.filter((e) => keyOf(e.serverId, e.userId) === key);
  if (!mine.length) return;
  await store.add(mine);
  writePending(pending.filter((e) => keyOf(e.serverId, e.userId) !== key));
}

async function storeFor(key: string, name: string) {
  const known = memory.get(key);
  if (known) return { store: known, persisted: false };
  const opened = await openHistoryStore(name);
  if (!opened.persisted) memory.set(key, opened.store);
  return opened;
}

/** Open this user's log (sign-in). A later call for another user closes the first. */
export function startHistory(session: Session): Promise<void> {
  const key = keyOf(session.server.id, session.userId);
  if (active?.key === key) return opening ?? Promise.resolve();
  stopHistory();
  historyStore.set((s) => ({ ...s, key, ready: false, count: 0, version: s.version + 1 }));
  const run = (async () => {
    const { store, persisted } = await storeFor(
      key,
      historyDbName(session.server.id, session.userId),
    );
    if (historyStore.get().key !== key) {
      void store.close?.();
      return;
    }
    active = { key, store, log: new ListeningLog(store) };
    historyStore.set((s) => ({ ...s, ready: true, persisted }));
    await drainPending(key, store).catch(reportError);
    await refreshCount();
  })();
  opening = run;
  void run.finally(() => {
    if (opening === run) opening = null;
  });
  return run;
}

/** Close the log (sign-out). The database stays: the history is the user's and outlives a session. */
export function stopHistory(): void {
  const current = active;
  active = null;
  if (current) void current.store.close?.().catch(reportError);
  historyStore.set((s) => ({
    ...s,
    key: null,
    ready: false,
    count: 0,
    version: s.version + 1,
  }));
}

/** The query API for the signed-in user (top tracks and artists, plays, last played, skip rate). */
export function getListeningLog(): ListeningLog | null {
  return active?.log ?? null;
}

/** Swap the upload target; the hub endpoint plugs in here when it exists. */
export function setListeningSync(next: ListeningSync): void {
  sync = next;
}

/**
 * Store one finished play in its user's log. A play that ends after a sign-out (the sign-out stops
 * it) still belongs to the user who started it, so a store that is not the open one is opened for
 * the write and closed again.
 */
export async function recordListen(event: ListenEvent): Promise<void> {
  const key = keyOf(event.serverId, event.userId);
  if (active?.key !== key && opening) await opening;
  const current = active;
  if (current?.key === key) {
    await current.store.add([event]);
    await refreshCount();
    await syncListening(current.store, sync).catch(reportError);
    return;
  }
  const { store } = await storeFor(key, historyDbName(event.serverId, event.userId));
  await store.add([event]);
  if (!memory.has(key)) await store.close?.();
}

/**
 * Remove every play of the signed-in user. Resolves with what was removed, for the undo, or `null`
 * when no log is open; a refused write rejects.
 */
export async function clearHistory(): Promise<ListenEvent[] | null> {
  const current = active;
  if (!current) return null;
  const removed = await current.store.clear();
  await refreshCount();
  return removed;
}

/** Put cleared plays back (the undo), if the same log is still open. */
export async function restoreHistory(events: readonly ListenEvent[]): Promise<void> {
  const current = active;
  if (!current) return;
  await current.store.add(events);
  await refreshCount();
}

export interface AttachHistoryOptions {
  /** Who is listening, read when a play starts; `null` signed out. */
  context: () => ListenContext | null;
  /** The Settings switch, read when a play ends. */
  enabled: () => boolean;
  onError?: (error: unknown) => void;
  /** Play events the shell held while this chunk loaded, applied first in order. */
  earlier?: readonly PlayEvent[];
}

/**
 * Follow the Player for the page's life; returns the unsubscribe. When the page goes away the open
 * play ends as `stopped` and is stashed (see `PENDING_KEY`) for the next start.
 */
export function attachHistory(player: Player, options: AttachHistoryOptions): () => void {
  if (options.onError) reportError = options.onError;
  let unloading = false;
  const tracker = new ListeningTracker({
    context: options.context,
    enabled: options.enabled,
    record: (event) => {
      if (unloading) writePending([...readPending(), event]);
      else return recordListen(event);
    },
    onError: reportError,
  });
  for (const event of options.earlier ?? []) {
    if (event.type === 'start') tracker.start(event.track, event.source, event.position);
    else tracker.end(event.position, event.reason);
  }
  const onPageHide = (): void => {
    unloading = true;
    try {
      tracker.end(player.snapshot.position, 'stopped');
    } finally {
      unloading = false;
    }
  };
  window.addEventListener('pagehide', onPageHide);
  const detach = attachListeningTracker(player, tracker);
  return () => {
    detach();
    window.removeEventListener('pagehide', onPageHide);
  };
}

export function useHistory(): HistoryState {
  return useStoreValue(historyStore);
}

/** The newest `limit` plays of the signed-in user, read again whenever the log changes. */
export function useListens(limit: number) {
  const { key, version, ready } = useHistory();
  return useQuery({
    queryKey: ['history', key, version, limit],
    queryFn: () => active?.log.events({ limit }) ?? Promise.resolve([]),
    enabled: ready && key !== null,
    // While the next page loads the rows stay; another user's rows never stand in (F86).
    placeholderData: (previous, query) => (query?.queryKey[1] === key ? previous : undefined),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** For tests. */
export function resetHistoryForTests(): void {
  stopHistory();
  opening = null;
  memory.clear();
  sync = noopListeningSync;
  reportError = () => undefined;
}
