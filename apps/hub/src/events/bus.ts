/**
 * The push channel (F63, F87): request status changes go to the profile that asked, and to admins
 * watching the whole house. In memory; a reconnecting app lists `/requests` to catch up.
 */
import type { HubEvent } from '@renaissance/core';

export type Listener = (event: HubEvent) => void;

export function createEventBus() {
  const mine = new Map<string, Set<Listener>>();
  const house = new Set<Listener>();
  return {
    subscribe(profile: string, listener: Listener, scope: 'mine' | 'house' = 'mine'): () => void {
      if (scope === 'house') {
        house.add(listener);
        return () => house.delete(listener);
      }
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
      for (const l of house) l(event);
    },
    /** Keepalives for every open stream. */
    ping(now = new Date()): void {
      const event: HubEvent = { type: 'ping', at: now.toISOString() };
      for (const set of mine.values()) for (const l of set) l(event);
      for (const l of house) l(event);
    },
    size(): number {
      let n = house.size;
      for (const set of mine.values()) n += set.size;
      return n;
    },
  };
}
export type EventBus = ReturnType<typeof createEventBus>;
