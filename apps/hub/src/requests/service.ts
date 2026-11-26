/**
 * Requests as the routes and the search box see them (F61): create (with the "already on the
 * server" short-circuit and a guard against the same song twice), list the caller's, cancel,
 * retry. The pipeline runner does the fetching. Who sees what goes through `RequestAccess` and
 * the "already here" entry through `CollectionSink` (contracts.ts).
 */
import type { AlreadyHere, MusicRequest, NewRequest, Profile } from '@renaissance/core';

import { ownerAccess, transientCollection } from '../contracts.js';
import type { CollectionSink, RequestAccess } from '../contracts.js';
import type { Stores } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import { ACTIVE_STATUSES } from '../fetch/pipeline.js';
import type { JellyfinLibrary } from '../jellyfin/library.js';
import { normalize } from '../text.js';

export type CreateResult =
  | { kind: 'request'; request: MusicRequest }
  /**
   * The same song or album is already being fetched (by anyone in the house); the caller is now a
   * watcher of that request, so Ready and the item reach them too.
   */
  | { kind: 'duplicate'; request: MusicRequest }
  | { kind: 'already'; already: AlreadyHere };

/** The same recording or release group, or the same title and artist when there are no ids. */
export function sameItem(a: NewRequest, b: MusicRequest): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'track' && a.recordingId && b.recordingId) return a.recordingId === b.recordingId;
  if (a.kind === 'album' && a.releaseGroupId && b.releaseGroupId)
    return a.releaseGroupId === b.releaseGroupId;
  return normalize(a.title) === normalize(b.title) && normalize(a.artist) === normalize(b.artist);
}

export function createRequestService(deps: {
  stores: Stores;
  /** Where an item already on the server is filed (F86 seam; default: not stored). */
  collection?: CollectionSink;
  access?: RequestAccess;
  library: JellyfinLibrary;
  bus: EventBus;
  enqueue: (id: string) => void;
  /** Called when an album request is cancelled, so Lidarr stops looking; returns a detail line. */
  abandon?: (request: MusicRequest) => Promise<string | undefined>;
}) {
  const { stores, library, bus } = deps;
  const access = deps.access ?? ownerAccess;
  const collection = deps.collection ?? transientCollection();

  function activeDuplicate(input: NewRequest): MusicRequest | undefined {
    for (const status of ACTIVE_STATUSES) {
      const found = stores.requests.listByStatus(status).find((r) => sameItem(input, r));
      if (found) return found;
    }
    return undefined;
  }

  return {
    async create(profile: Profile, input: NewRequest): Promise<CreateResult> {
      const findInput: Parameters<JellyfinLibrary['find']>[0] = {
        kind: input.kind,
        title: input.title,
        artist: input.artist,
      };
      if (input.recordingId) findInput.recordingId = input.recordingId;
      if (input.releaseGroupId) findInput.releaseGroupId = input.releaseGroupId;
      const found = await library.find(findInput).catch(() => undefined);
      if (found) {
        const item = collection.add({
          profile: profile.id,
          item: found.item.Id,
          kind: input.kind,
          title: found.item.Name,
          artist: found.hit.artist ?? input.artist,
          ...(found.hit.album ? { album: found.hit.album } : {}),
          addedBy: profile.id,
          source: 'add',
        });
        return { kind: 'already', already: { alreadyHere: true, item } };
      }
      const duplicate = activeDuplicate(input);
      if (duplicate) {
        const watched = stores.requests.watch(duplicate.id, profile.id) ?? duplicate;
        if (watched.requestedBy !== profile.id)
          bus.publish(profile.id, { type: 'request', request: watched });
        return { kind: 'duplicate', request: watched };
      }
      const request = stores.requests.create(input, profile.id);
      bus.publish(profile.id, { type: 'request', request });
      deps.enqueue(request.id);
      return { kind: 'request', request };
    },

    /** The caller's own requests and the ones they watch, newest first. */
    list(profile: Profile): MusicRequest[] {
      return stores.requests.listMine(profile.id);
    },

    get(profile: Profile, id: string): MusicRequest | undefined {
      const req = stores.requests.get(id);
      return req && access.canSee(profile, req) ? req : undefined;
    },

    /** A watcher only sees a request; stopping or retrying it is `RequestAccess.canManage`. */
    owns(profile: Profile, req: MusicRequest): boolean {
      return access.canManage(profile, req);
    },

    /** Runs a failed request again; one that already downloaded its file resumes at the import. */
    retry(profile: Profile, id: string): MusicRequest | 'not_found' | 'not_failed' {
      const req = this.get(profile, id);
      if (!req || !this.owns(profile, req)) return 'not_found';
      if (req.status !== 'failed') return 'not_failed';
      const next = stores.requests.update(id, {
        status: 'requested',
        detail: `Retried by ${profile.name}`,
      })!;
      // The watchers' streams see the retry too, not only the asker's.
      for (const who of [next.requestedBy, ...(next.watchers ?? [])])
        bus.publish(who, { type: 'request', request: next });
      deps.enqueue(next.id);
      return next;
    },

    /**
     * Stops a request that has not started downloading; the undo of a request action. The row
     * becomes `cancelled` (its own status: nothing failed), and an album is unmonitored in Lidarr.
     * The write is conditional: a poll or a step that finished while Lidarr was being told wins,
     * and the answer is `too_late`.
     */
    async cancel(
      profile: Profile,
      id: string,
    ): Promise<MusicRequest | 'not_found' | 'too_late' | 'not_active'> {
      const req = this.get(profile, id);
      if (!req || !this.owns(profile, req)) return 'not_found';
      // Cancelling twice is fine (the undo button pressed again); a finished one has nothing to stop.
      if (req.status === 'cancelled') return req;
      if (req.status === 'ready' || req.status === 'failed') return 'not_active';
      if (req.status !== 'requested' && req.status !== 'finding') return 'too_late';
      const note = req.kind === 'album' ? await deps.abandon?.(req) : undefined;
      const next = stores.requests.cancel(
        id,
        `Cancelled by ${profile.name}${note ? `; ${note}` : ''}`,
      );
      if (!next) {
        const now = stores.requests.get(id);
        if (!now) return 'not_found';
        return now.status === 'ready' || now.status === 'failed' ? 'not_active' : 'too_late';
      }
      for (const who of [next.requestedBy, ...(next.watchers ?? [])])
        bus.publish(who, { type: 'request', request: next });
      return next;
    },
  };
}
export type RequestService = ReturnType<typeof createRequestService>;
