/**
 * The library on a phone (F14): core's `LibraryController` over a SQLite store per server and user.
 * "Resumed" is the app coming back to the foreground or the network coming back. When SQLite cannot
 * open, core's `MemoryLibraryStore` holds the library for the run and it is synced in full next time.
 */
import { MemoryLibraryStore, createLibraryController, libraryKey } from '@renaissance/core';
import type { CacheItem, CacheKind, Session, UserDataChange } from '@renaissance/core';
import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';
import { AppState } from 'react-native';

import { debug, swallow } from './log';
import { SqliteLibraryStore } from './sqlite-store';
import type { SqlDatabase } from './sqlite-store';

export type { LibraryState, SyncState } from '@renaissance/core';

function fileName(key: string): string {
  return `${key}.db`;
}

export async function openLibraryStore(key: string) {
  try {
    const store = new SqliteLibraryStore(
      () => SQLite.openDatabaseAsync(fileName(key)) as unknown as Promise<SqlDatabase>,
    );
    await store.opened();
    return { store, persisted: true };
  } catch (error) {
    debug('sqlite open failed', error);
    return { store: new MemoryLibraryStore(), persisted: false };
  }
}

/** Remove a user's database from this device (sign-out, F86). Safe when it does not exist. */
export async function deleteLibrary(session: Session): Promise<void> {
  await SQLite.deleteDatabaseAsync(fileName(libraryKey(session))).catch(
    swallow('sqlite delete failed'),
  );
}

const controller = createLibraryController({
  openStore: openLibraryStore,
  onResume: (listener) => {
    let last = AppState.currentState;
    const app = AppState.addEventListener('change', (next) => {
      if (last !== 'active' && next === 'active') listener();
      last = next;
    });
    let online: boolean | null = null;
    const net = Network.addNetworkStateListener((state) => {
      const now = state.isInternetReachable ?? state.isConnected ?? null;
      if (online === false && now) listener();
      online = now;
    });
    return () => {
      app.remove();
      net.remove();
    };
  },
  log: debug,
});

export const libraryStore = controller.state;

export function refreshLibrary(options: { full?: boolean } = {}): Promise<void> {
  return controller.refresh(options);
}

export const startLibrary = controller.start.bind(controller);
export const stopLibrary = controller.stop.bind(controller);

export function patchItems(
  kind: CacheKind,
  update: (item: CacheItem) => CacheItem | null,
  options: { broadcast?: boolean } = {},
): void {
  controller.patchItems(kind, update, options);
}

export function addItems(kind: CacheKind, items: CacheItem[]): void {
  controller.addItems(kind, items);
}

export function applyUserDataChanges(changes: UserDataChange[]): Promise<void> {
  return controller.applyUserDataChanges(changes);
}
