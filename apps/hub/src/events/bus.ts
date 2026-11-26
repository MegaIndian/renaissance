/**
 * The push channel (F61): request status changes and "Ready" go to the profile that asked and to
 * the profiles watching the request; a late catalogue answer goes to the typist alone. In memory;
 * a reconnecting app lists `/requests` to catch up.
 */
import type { HubEvent } from '@renaissance/core';

export type Listener = (event: HubEvent) => void;

export function createEventBus() {
  const mine = new Map<string, Set<Listener>>();
  return {
    subscribe(profile: string, listener: Listener): () => void {
      const set = mine.get(profile) ?? new Set<Listener>();
      set.add(listener);
      mine.set(profile, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) mine.delete(profile);
      };
    },
    publish(profile: string, event: HubEvent): void {
      for (const l of mine.get(profile) ?? []) l(event);
    },
    /** Keepalives for every open stream. */
    ping(now = new Date()): void {
      const event: HubEvent = { type: 'ping', at: now.toISOString() };
      for (const set of mine.values()) for (const l of set) l(event);
    },
    size(): number {
      let n = 0;
      for (const set of mine.values()) n += set.size;
      return n;
    },
  };
}
export type EventBus = ReturnType<typeof createEventBus>;
