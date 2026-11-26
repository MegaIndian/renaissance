/**
 * The seams F61 leaves for the lanes that build on it. Each is an interface with the smallest
 * default that keeps the one search box whole; the later lane passes its own implementation to
 * `buildApp` and changes nothing else.
 *
 * - `CollectionSink`: per-profile collections (F86, lane Q04). F61 needs one call: "this item is
 *   now this profile's", when a song is already on the server and when a request turns Ready.
 * - `RequestAccess`: who may see and manage a request (F87, lane Q05). F61: the asker and the
 *   profiles watching it see it; only the asker cancels or retries.
 * - `RuleSource`: household rules the ranking reads (F80). F61: none.
 * - `AmbiguityPicker`: the model's pick when the deterministic ranking cannot tell two files apart
 *   (F76). F61: off unless `RENAISSANCE_FETCH_MODEL_PICK` is on and a key is set; the deterministic
 *   order always stands when the picker is off, declines or fails.
 */
import type {
  CollectionItem,
  CollectionSource,
  MusicRequest,
  Profile,
  RequestKind,
} from '@renaissance/core';

import type { Scored } from './fetch/rank.js';

export interface NewCollectionItem {
  profile: string;
  /** Jellyfin item id. */
  item: string;
  kind: RequestKind;
  title: string;
  artist: string;
  album?: string;
  addedBy: string;
  source: CollectionSource;
}

export interface CollectionSink {
  /** Idempotent: adding what the profile already has returns the existing entry. */
  add(input: NewCollectionItem): CollectionItem;
}

/**
 * F61's default: nothing is stored, the answer says what was added. `id` is 0, the mark of an
 * entry no collection holds; Q04's SQLite store returns real ids.
 */
export function transientCollection(now: () => Date = () => new Date()): CollectionSink {
  return {
    add: (input) => ({
      id: 0,
      profile: input.profile,
      item: input.item,
      kind: input.kind,
      title: input.title,
      artist: input.artist,
      ...(input.album ? { album: input.album } : {}),
      addedBy: input.addedBy,
      addedAt: now().toISOString(),
      source: input.source,
    }),
  };
}

export interface RequestAccess {
  /** May this profile read the request (GET, and its events)? */
  canSee(profile: Profile, request: MusicRequest): boolean;
  /** May this profile cancel or retry it? */
  canManage(profile: Profile, request: MusicRequest): boolean;
}

/** F61's default: the asker and the watchers see a request; the asker alone manages it. */
export const ownerAccess: RequestAccess = {
  canSee: (profile, request) =>
    request.requestedBy === profile.id || (request.watchers ?? []).includes(profile.id),
  canManage: (profile, request) => request.requestedBy === profile.id,
};

export interface RuleSource {
  /** The profile's household rules as plain text, in the order they were written. */
  list(profile: string): string[];
}

export const noRules: RuleSource = { list: () => [] };

export interface AmbiguityInput {
  request: Pick<MusicRequest, 'kind' | 'title' | 'artist' | 'album' | 'duration'>;
  /** The deterministic order, best first; only the leading tie is offered. */
  candidates: readonly Scored[];
}

export interface AmbiguityPicker {
  /**
   * The index into `candidates` of the file to take, or `undefined` to keep the deterministic
   * first. Must answer from `candidates` only (ADR 0007: never invent).
   */
  pick(input: AmbiguityInput): Promise<number | undefined>;
}

/** Two files whose scores are this close (out of 100) are a tie the picker may break. */
export const AMBIGUOUS_MARGIN = 3;

/** The leading candidates within `AMBIGUOUS_MARGIN` of the best; one or none means no tie. */
export function leadingTie(ranked: readonly Scored[]): Scored[] {
  const best = ranked[0];
  if (!best) return [];
  const tie = ranked.filter((c) => best.score - c.score <= AMBIGUOUS_MARGIN);
  return tie.length > 1 ? tie.slice(0, 5) : [];
}
