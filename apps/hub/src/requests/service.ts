/**
 * Requests as the routes and the Ask bar see them (F61, F86, F87): create (with the "already on the
 * server" short-circuit and a guard against the same song twice), list by profile, cancel, retry.
 * The pipeline runner does the fetching.
 */
import type { AlreadyHere, MusicRequest, NewRequest, Profile } from '@renaissance/core';

import type { Stores } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import { ACTIVE_STATUSES } from '../fetch/pipeline.js';
import type { JellyfinLibrary } from '../jellyfin/library.js';
import { normalize } from '../text.js';

export type CreateResult =
  | { kind: 'request'; request: MusicRequest }
  /** The same song or album is already being fetched (by anyone in the house). */
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
  library: JellyfinLibrary;
  bus: EventBus;
  enqueue: (id: string) => void;
  /** Called when an album request is cancelled, so Lidarr stops looking; returns a detail line. */
  abandon?: (request: MusicRequest) => Promise<string | undefined>;
}) {
  const { stores, library, bus } = deps;

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
        const item = stores.collection.add({
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
      if (duplicate) return { kind: 'duplicate', request: duplicate };
      const request = stores.requests.create(input, profile.id);
      bus.publish(profile.id, { type: 'request', request });
      deps.enqueue(request.id);
      return { kind: 'request', request };
    },

    list(profile: Profile, scope: 'mine' | 'house'): MusicRequest[] {
      return scope === 'house' && profile.role === 'admin'
        ? stores.requests.listHouse()
        : stores.requests.listMine(profile.id);
    },

    /** Own requests (or any, for admins). */
    get(profile: Profile, id: string): MusicRequest | undefined {
      const req = stores.requests.get(id);
      if (!req) return undefined;
      return req.requestedBy === profile.id || profile.role === 'admin' ? req : undefined;
    },

    /** Runs a failed request again; one that already downloaded its file resumes at the import. */
    retry(profile: Profile, id: string): MusicRequest | 'not_found' | 'not_failed' {
      const req = this.get(profile, id);
      if (!req) return 'not_found';
      if (req.status !== 'failed') return 'not_failed';
      const next = stores.requests.update(id, {
        status: 'requested',
        detail: `Retried by ${profile.name}`,
      })!;
      bus.publish(next.requestedBy, { type: 'request', request: next });
      deps.enqueue(next.id);
      return next;
    },

    /**
     * Stops a request that has not started downloading; the undo of a request action. The row
     * becomes `cancelled` (its own status: nothing failed), and an album is unmonitored in Lidarr.
     */
    async cancel(profile: Profile, id: string): Promise<MusicRequest | 'not_found' | 'too_late'> {
      const req = this.get(profile, id);
      if (!req) return 'not_found';
      if (req.status !== 'requested' && req.status !== 'finding') return 'too_late';
      const note = req.kind === 'album' ? await deps.abandon?.(req) : undefined;
      const next = stores.requests.update(id, {
        status: 'cancelled',
        detail: `Cancelled by ${profile.name}${note ? `; ${note}` : ''}`,
      })!;
      bus.publish(next.requestedBy, { type: 'request', request: next });
      return next;
    },
  };
}
export type RequestService = ReturnType<typeof createRequestService>;
