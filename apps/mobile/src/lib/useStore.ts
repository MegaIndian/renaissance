import type { Store } from '@renaissance/core';
import { useSyncExternalStore } from 'react';

/** Bind a core store to React (the same hook as web's). */
export function useStoreValue<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Read one slice; re-renders only when that slice changes. */
export function useStoreSlice<T, S>(store: Store<T>, select: (value: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}
