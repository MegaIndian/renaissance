/**
 * Requests as the routes and the Ask bar see them (F61, F86, F87): create (with the "already on the
 * server" short-circuit), list by profile, cancel. The pipeline runner does the fetching.
 */
import type { AlreadyHere, MusicRequest, NewRequest, Profile } from '@renaissance/core';

import type { Stores } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import type { JellyfinLibrary } from '../jellyfin/library.js';

export type CreateResult =
  { kind: 'request'; request: MusicRequest } | { kind: 'already'; already: AlreadyHere };

export function createRequestService(deps: {
  stores: Stores;
  library: JellyfinLibrary;
  bus: EventBus;
  enqueue: (id: string) => void;
}) {
  const { stores, library, bus } = deps;
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

    /** Stops a request that has not started downloading; the undo of a request action. */
    cancel(profile: Profile, id: string): MusicRequest | 'not_found' | 'too_late' {
      const req = this.get(profile, id);
      if (!req) return 'not_found';
      if (req.status !== 'requested' && req.status !== 'finding') return 'too_late';
      const next = stores.requests.update(id, {
        status: 'failed',
        reason: 'cancelled',
        detail: `Cancelled by ${profile.name}`,
      })!;
      bus.publish(next.requestedBy, { type: 'request', request: next });
      return next;
    },
  };
}
export type RequestService = ReturnType<typeof createRequestService>;
