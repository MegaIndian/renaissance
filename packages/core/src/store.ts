/**
 * A minimal observable value, framework-free, so core state (player, settings, library) binds to
 * React through `useSyncExternalStore` on web and the same hook on mobile.
 */
export interface Store<T> {
  get(): T;
  set(next: T | ((current: T) => T)): void;
  subscribe(listener: (value: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of listeners) listener(value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
