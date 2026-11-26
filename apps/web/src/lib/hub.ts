/**
 * The hub for the one search box (F61, ADR 0007 point 4). The hub client is built from the
 * signed-in session: the app sends the Jellyfin token it already holds and the hub turns it into a
 * profile, so there is nothing else to sign in to. Adding a catalogue row is one call; the row then
 * follows its request through the event stream ("on its way", then "Ready"). The person never sees
 * Lidarr or slskd: only these words.
 */
import { HubClientError, createHubClient, createStore, normalize } from '@renaissance/core';
import type {
  CatalogueAlbum,
  CatalogueSearch,
  CatalogueSong,
  HubClient,
  HubEvent,
  MusicRequest,
  NewRequest,
} from '@renaissance/core';
import type { TFunction } from 'i18next';

import { refreshLibrary } from './library';
import { swallow } from './log';
import { sessionStore } from './session';
import type { SessionState } from './session';
import { toast } from './toast';

/** The hub's address: `VITE_HUB_URL`, else this host on the hub's default port. */
export function hubUrl(): string {
  const fromEnv = import.meta.env['VITE_HUB_URL'] as string | undefined;
  if (fromEnv) return fromEnv;
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

/**
 * `off`: signed out. `ready`: the hub answered. `unreachable`: no hub at the address (the box is
 * the library search alone). `unauthorized`: the hub refused this Jellyfin token.
 */
export type HubStatus = 'off' | 'ready' | 'unreachable' | 'unauthorized';

export interface HubState {
  client: HubClient | null;
  status: HubStatus;
  /** The signed-in Jellyfin user id; the hub's profile id is the same. */
  userId: string | null;
}

export const hubStore = createStore<HubState>({ client: null, status: 'off', userId: null });

/** Requests this profile can see, by id, as the hub last reported them. */
export const requestsStore = createStore<ReadonlyMap<string, MusicRequest>>(new Map());

/** A full catalogue answer that arrived on the stream after the typeahead could not wait for it. */
export const lateCatalogueStore = createStore<CatalogueSearch | null>(null);

/** What tapping a catalogue row did, by row id, until a request takes over the wording. */
export type AddState =
  | { kind: 'adding' }
  | { kind: 'requested'; requestId: string }
  /** Someone in the house is already fetching it; this profile now watches that request. */
  | { kind: 'watching'; requestId: string; name: string; mine: boolean }
  /** Already on the server: nothing to fetch, added at once. */
  | { kind: 'already' }
  | { kind: 'failed'; code?: string };

export const addsStore = createStore<ReadonlyMap<string, AddState>>(new Map());

/** A catalogue row, as the box and the search page show it. */
export type CatalogueRow =
  { kind: 'song'; item: CatalogueSong } | { kind: 'album'; item: CatalogueAlbum };

export function rowTitle(row: CatalogueRow): string {
  return row.item.title;
}

/** The request the hub needs for a row: every id the catalogue gave, so nothing is looked up twice. */
export function newRequestFor(row: CatalogueRow): NewRequest {
  if (row.kind === 'album') {
    const a = row.item;
    const input: NewRequest = { kind: 'album', title: a.title, artist: a.artist };
    if (a.releaseGroupId) input.releaseGroupId = a.releaseGroupId;
    if (a.artistId) input.artistId = a.artistId;
    return input;
  }
  const s = row.item;
  const input: NewRequest = { kind: 'track', title: s.title, artist: s.artist };
  if (s.album) input.album = s.album;
  if (s.recordingId) input.recordingId = s.recordingId;
  if (s.releaseGroupId) input.releaseGroupId = s.releaseGroupId;
  if (s.releaseId) input.releaseId = s.releaseId;
  if (s.artistId) input.artistId = s.artistId;
  if (s.duration !== undefined) input.duration = s.duration;
  return input;
}

const ACTIVE = new Set(['requested', 'finding', 'downloading', 'importing']);

/** The request a row stands for: the one its tap made, else one for the same song (after a reload). */
export function requestForRow(
  row: CatalogueRow,
  adds: ReadonlyMap<string, AddState>,
  requests: ReadonlyMap<string, MusicRequest>,
): MusicRequest | undefined {
  const added = adds.get(row.item.id);
  if (added && (added.kind === 'requested' || added.kind === 'watching'))
    return requests.get(added.requestId);
  if (added) return undefined;
  const kind = row.kind === 'album' ? 'album' : 'track';
  const title = normalize(row.item.title);
  const artist = normalize(row.item.artist);
  let best: MusicRequest | undefined;
  for (const r of requests.values()) {
    if (r.kind !== kind || r.status === 'cancelled') continue;
    const sameId =
      row.kind === 'song'
        ? !!row.item.recordingId && r.recordingId === row.item.recordingId
        : !!row.item.releaseGroupId && r.releaseGroupId === row.item.releaseGroupId;
    const sameWords = normalize(r.title) === title && normalize(r.artist) === artist;
    if (!sameId && !sameWords) continue;
    // A live request wins over an old failed one for the same song.
    if (!best || (ACTIVE.has(r.status) && !ACTIVE.has(best.status))) best = r;
  }
  return best;
}

/**
 * What the row says about itself, in one short phrase (DESIGN.md rule 9): nothing before a tap,
 * then adding, on its way (with the step and a percentage or song count), Ready, already here, or
 * why it could not be added.
 */
export type RowStatus =
  | { kind: 'none' }
  | { kind: 'adding' }
  | { kind: 'onItsWay'; request: MusicRequest; watching?: { name: string; mine: boolean } }
  | { kind: 'ready'; request?: MusicRequest }
  | { kind: 'already' }
  | { kind: 'failed'; request?: MusicRequest; code?: string };

export function rowStatus(
  row: CatalogueRow,
  adds: ReadonlyMap<string, AddState>,
  requests: ReadonlyMap<string, MusicRequest>,
): RowStatus {
  const added = adds.get(row.item.id);
  if (added?.kind === 'adding') return { kind: 'adding' };
  if (added?.kind === 'already') return { kind: 'already' };
  if (added?.kind === 'failed')
    return added.code ? { kind: 'failed', code: added.code } : { kind: 'failed' };
  const request = requestForRow(row, adds, requests);
  if (!request) {
    if (row.item.libraryId) return { kind: 'already' };
    return { kind: 'none' };
  }
  if (request.status === 'ready') return { kind: 'ready', request };
  if (request.status === 'failed') return { kind: 'failed', request };
  if (request.status === 'cancelled') return { kind: 'none' };
  const watching = added?.kind === 'watching' ? { name: added.name, mine: added.mine } : undefined;
  return watching ? { kind: 'onItsWay', request, watching } : { kind: 'onItsWay', request };
}

/** The phrase for a row's status; empty when there is nothing to say. */
export function rowStatusText(status: RowStatus, t: TFunction): string {
  switch (status.kind) {
    case 'none':
      return '';
    case 'adding':
      return t('catalogue.adding');
    case 'already':
      return t('catalogue.already');
    case 'ready':
      return t('catalogue.ready');
    case 'failed':
      return status.code === 'offline' || status.code === 'http_error'
        ? t('catalogue.hubAway')
        : t('catalogue.failed');
    case 'onItsWay': {
      const p = status.request.progress;
      const step =
        status.request.status === 'downloading' && p && p.total > 0
          ? p.unit === 'percent'
            ? t('catalogue.downloadingPercent', { percent: Math.round((p.done / p.total) * 100) })
            : t('catalogue.downloadingSongs', { done: p.done, total: p.total })
          : t(`catalogue.step.${status.request.status}`);
      const who = status.watching
        ? status.watching.mine
          ? t('catalogue.alreadyAskedMine')
          : t('catalogue.alreadyAsked', { name: status.watching.name })
        : '';
      return [t('catalogue.onItsWay'), step, who].filter(Boolean).join(' · ');
    }
  }
}

function setAdd(id: string, state: AddState | null): void {
  addsStore.set((current) => {
    const next = new Map(current);
    if (state) next.set(id, state);
    else next.delete(id);
    return next;
  });
}

function putRequest(request: MusicRequest): void {
  requestsStore.set((current) => new Map(current).set(request.id, request));
}

/**
 * One tap: the row's catalogue entry goes to the hub. The row says what happened; the toast says
 * it too, with an Undo while nothing has been downloaded (DESIGN.md rule 10).
 */
export async function addRow(row: CatalogueRow, t: TFunction): Promise<AddState> {
  const { client, userId } = hubStore.get();
  if (!client) {
    const failed: AddState = { kind: 'failed', code: 'offline' };
    setAdd(row.item.id, failed);
    return failed;
  }
  const id = row.item.id;
  const title = rowTitle(row);
  setAdd(id, { kind: 'adding' });
  let state: AddState;
  try {
    const result = await client.createRequest(newRequestFor(row));
    if ('alreadyHere' in result) {
      state = { kind: 'already' };
      toast(t('catalogue.toastAlready', { title }));
    } else if ('alreadyRequested' in result) {
      putRequest(result.request);
      state = {
        kind: 'watching',
        requestId: result.request.id,
        name: result.request.requestedByName,
        mine: result.request.requestedBy === userId,
      };
      toast(t('catalogue.toastWatching', { title }));
    } else {
      putRequest(result);
      state = { kind: 'requested', requestId: result.id };
      toast(t('catalogue.toastRequested', { title }), {
        undo: () => void cancelRow(row, result.id, t),
      });
    }
  } catch (error) {
    state =
      error instanceof HubClientError
        ? { kind: 'failed', code: error.code }
        : { kind: 'failed', code: 'offline' };
    toast(t('catalogue.toastFailed', { title }), { tone: 'danger' });
  }
  setAdd(id, state);
  return state;
}

/** The undo of an add: stops the request if nothing has been downloaded yet, and says which. */
export async function cancelRow(row: CatalogueRow, requestId: string, t: TFunction): Promise<void> {
  const { client } = hubStore.get();
  if (!client) return;
  const title = rowTitle(row);
  try {
    putRequest(await client.cancelRequest(requestId));
    setAdd(row.item.id, null);
    toast(t('catalogue.toastCancelled', { title }));
  } catch (error) {
    const tooLate = error instanceof HubClientError && error.code === 'too_late';
    toast(tooLate ? t('catalogue.toastTooLate', { title }) : t('catalogue.toastUndoFailed'), {
      tone: tooLate ? 'info' : 'danger',
    });
  }
}

/** What the stream says: request changes update the rows; Ready also refreshes the library. */
export function applyEvent(event: HubEvent, t: TFunction): void {
  if (event.type === 'catalogue') {
    lateCatalogueStore.set(event.result);
    return;
  }
  if (event.type !== 'request' && event.type !== 'ready') return;
  const previous = requestsStore.get().get(event.request.id);
  putRequest(event.request);
  const becameReady =
    event.request.status === 'ready' && (event.type === 'ready' || previous?.status !== 'ready');
  if (becameReady && previous?.status !== 'ready') {
    toast(
      t('catalogue.toastReady', { title: event.request.matched?.title ?? event.request.title }),
    );
    // The new song is on the server: the library picks it up now, not at the next refresh.
    void refreshLibrary().catch(swallow('library refresh after Ready'));
  }
}

let stopEvents: (() => void) | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let currentKey: string | null = null;

/** Reconnect delay after the stream drops; the list is read again on every connect. */
export const EVENTS_RETRY_MS = 5_000;

function connect(client: HubClient, t: TFunction, key: string): void {
  stopEvents?.();
  stopEvents = client.events(
    (event) => applyEvent(event, t),
    () => {
      if (currentKey !== key) return;
      retry = setTimeout(() => {
        if (currentKey === key) void start(client, t, key);
      }, EVENTS_RETRY_MS);
    },
  );
}

async function start(client: HubClient, t: TFunction, key: string): Promise<void> {
  try {
    const list = await client.requests();
    if (currentKey !== key) return;
    requestsStore.set(new Map(list.map((r) => [r.id, r])));
    hubStore.set((s) => ({ ...s, status: 'ready' }));
    connect(client, t, key);
  } catch (error) {
    if (currentKey !== key) return;
    const unauthorized = error instanceof HubClientError && error.status === 401;
    hubStore.set((s) => ({ ...s, status: unauthorized ? 'unauthorized' : 'unreachable' }));
    if (!unauthorized) {
      retry = setTimeout(() => {
        if (currentKey === key) void start(client, t, key);
      }, EVENTS_RETRY_MS);
    }
  }
}

/** Marks the hub reachable again when a call through it succeeds (the typeahead, an add). */
export function hubAnswered(): void {
  if (hubStore.get().client && hubStore.get().status !== 'ready')
    hubStore.set((s) => ({ ...s, status: 'ready' }));
}

function follow(state: SessionState, t: TFunction): void {
  const session = state.status === 'signedIn' ? state.session : null;
  const key = session ? `${session.server.id}:${session.userId}:${session.token}` : null;
  if (key === currentKey) return;
  currentKey = key;
  if (retry) clearTimeout(retry);
  stopEvents?.();
  stopEvents = null;
  addsStore.set(new Map());
  requestsStore.set(new Map());
  lateCatalogueStore.set(null);
  if (!session || !key) {
    hubStore.set({ client: null, status: 'off', userId: null });
    return;
  }
  const client = createHubClient({ url: hubUrl(), token: session.token });
  // Usable at once: the typeahead does not wait for the list or the stream.
  hubStore.set({ client, status: 'ready', userId: session.userId });
  void start(client, t, key);
}

/** Follows the session for the life of the app; returns a stop function (tests). */
export function startHub(t: TFunction): () => void {
  follow(sessionStore.get(), t);
  const unsubscribe = sessionStore.subscribe((state) => follow(state, t));
  return () => {
    unsubscribe();
    follow({ ...sessionStore.get(), status: 'signedOut', session: null }, t);
  };
}

/** Tests: a client without a session or a network; with `t`, its event stream is opened too. */
export function setHubForTests(client: HubClient | null, userId = 'u1', t?: TFunction): void {
  currentKey = null;
  stopEvents?.();
  stopEvents = null;
  addsStore.set(new Map());
  requestsStore.set(new Map());
  lateCatalogueStore.set(null);
  hubStore.set(
    client ? { client, status: 'ready', userId } : { client: null, status: 'off', userId: null },
  );
  if (client && t) {
    currentKey = `test:${userId}`;
    connect(client, t, currentKey);
  }
}
