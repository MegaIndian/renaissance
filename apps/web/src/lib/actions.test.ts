import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { signInFake, tracks } from '../test/fakes';
import { addToQueue, playNext, toggleFavorite } from './actions';
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  removeFromPlaylist,
  renamePlaylist,
} from './playlist-actions';
import { i18n } from './i18n';
import { libraryStore, startLibrary, stopLibrary } from './library';
import { sessionStore } from './session';
import { toastStore } from './toast';

/** Start the library module for the fake session so it owns a BroadcastChannel to post on. */
async function startLibraryForTests(): Promise<void> {
  stopLibrary();
  const { adapter, session } = sessionStore.get();
  await startLibrary(adapter as never, session as never);
}

const t = i18n.t.bind(i18n);
const find = (id: string) => libraryStore.get().snapshot.tracks.find((x) => x.id === id);

describe('favourites', () => {
  it('toggles at once, tells the server, offers an undo that toggles back', async () => {
    const { calls } = signInFake();
    await i18n.changeLanguage('en');
    await toggleFavorite('track', tracks[0]!, t);
    expect(find('t1')?.isFavorite).toBe(true);
    expect(calls.favorites).toEqual([{ id: 't1', favorite: true }]);
    const toast = toastStore.get();
    expect(toast?.message).toBe(
      'Added Track t1 to favourites'.replace('Track t1', 'Sneaky Snitch'),
    );
    toast?.undo?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(find('t1')?.isFavorite).toBe(false);
    expect(calls.favorites).toHaveLength(2);
  });

  it('rolls back and says so when the server refuses', async () => {
    signInFake({ fail: { favorites: true } });
    await toggleFavorite('track', tracks[0]!, t);
    expect(find('t1')?.isFavorite).toBe(false);
    expect(toastStore.get()?.tone).toBe('danger');
  });

  it('tells the other tabs after the server agrees, not before; and again on a rollback', async () => {
    const heard: unknown[] = [];
    const listener = new BroadcastChannel('renaissance-library');
    listener.onmessage = (event: MessageEvent<unknown>) => heard.push(event.data);
    const settle = () => new Promise((r) => setTimeout(r, 20));
    try {
      let release: (() => void) | undefined;
      const { calls } = signInFake({
        favoritesGate: () => new Promise<void>((r) => (release = r)),
      });
      await startLibraryForTests();
      const pending = toggleFavorite('track', tracks[0]!, t);
      await settle();
      expect(find('t1')?.isFavorite).toBe(true);
      expect(heard).toEqual([]);
      release?.();
      await pending;
      await settle();
      expect(calls.favorites).toEqual([{ id: 't1', favorite: true }]);
      expect(heard).toHaveLength(1);

      signInFake({ fail: { favorites: true } });
      await startLibraryForTests();
      await toggleFavorite('track', tracks[0]!, t);
      await settle();
      expect(heard).toHaveLength(2);
    } finally {
      listener.close();
      stopLibrary();
    }
  });
});

describe('queue actions', () => {
  it('play next and add to queue report what they did and can be undone', () => {
    const { player } = signInFake();
    player.playTracks([tracks[0]!, tracks[1]!]);
    playNext([tracks[2]!], t);
    expect(player.snapshot.queue.items.map((x) => x.id)).toEqual(['t1', 't3', 't2']);
    expect(toastStore.get()?.message).toBe('Fluffing a Duck plays next');
    toastStore.get()?.undo?.();
    expect(player.snapshot.queue.items.map((x) => x.id)).toEqual(['t1', 't2']);
    addToQueue([tracks[2]!, tracks[3]!], t);
    expect(player.snapshot.queue.items).toHaveLength(4);
    expect(toastStore.get()?.message).toBe('Added 2 songs to the queue');
    toastStore.get()?.undo?.();
    expect(player.snapshot.queue.items).toHaveLength(2);
    playNext([], t);
    expect(player.snapshot.queue.items).toHaveLength(2);
  });

  it('adding to an empty queue starts playback, and the toast says so (design AD)', () => {
    const { player } = signInFake();
    addToQueue([tracks[2]!], t);
    expect(player.snapshot.status).toBe('playing');
    expect(toastStore.get()?.message).toBe('Playing Fluffing a Duck');
    toastStore.get()?.undo?.();
    expect(player.snapshot.queue.items).toHaveLength(0);
    playNext([tracks[0]!, tracks[1]!], t);
    expect(player.snapshot.status).toBe('playing');
    expect(toastStore.get()?.message).toBe('Playing 2 songs');
  });
});

describe('playlists', () => {
  it('creates, renames, adds, removes and deletes through the adapter and patches the snapshot', async () => {
    const { calls } = signInFake();
    const queryClient = new QueryClient();
    const created = await createPlaylist('Gym', ['t1'], t);
    expect(created?.name).toBe('Gym');
    expect(libraryStore.get().snapshot.playlists.map((p) => p.name)).toEqual(['Drive', 'Gym']);
    await renamePlaylist(created!, 'Gym mix', t);
    expect(libraryStore.get().snapshot.playlists.find((p) => p.id === created!.id)?.name).toBe(
      'Gym mix',
    );
    toastStore.get()?.undo?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(libraryStore.get().snapshot.playlists.find((p) => p.id === created!.id)?.name).toBe(
      'Gym',
    );
    await addToPlaylist(created!, [tracks[1]!, tracks[2]!], t, queryClient);
    expect(
      libraryStore.get().snapshot.playlists.find((p) => p.id === created!.id)?.trackCount,
    ).toBe(3);
    await removeFromPlaylist(created!, ['e1'], 'Carefree', t, queryClient);
    expect(
      libraryStore.get().snapshot.playlists.find((p) => p.id === created!.id)?.trackCount,
    ).toBe(2);
    expect(await deletePlaylist(created!, t)).toBe(true);
    expect(libraryStore.get().snapshot.playlists.map((p) => p.name)).toEqual(['Drive']);
    expect(calls.playlists).toEqual([
      'create Gym t1',
      'rename p-Gym Gym mix',
      'rename p-Gym Gym',
      'add p-Gym t2,t3',
      'remove p-Gym e1',
      'delete p-Gym',
    ]);
  });
});

describe('playlist reorder', () => {
  it('shows the server order after the read-back, toasts with an undo that moves back, and an error toast when the order differs', async () => {
    const { adapter, calls } = signInFake();
    await i18n.changeLanguage('en');
    const queryClient = new QueryClient();
    const { movePlaylistEntry } = await import('./playlist-actions');
    const { queryKeys } = await import('./queries');
    const playlist = { id: 'p1', name: 'Drive', trackCount: 3, isFavorite: false, playCount: 0 };
    const entries = [tracks[0]!, tracks[1]!, tracks[2]!].map((x, i) => ({
      ...x,
      entryId: `e${i}`,
    }));
    queryClient.setQueryData(queryKeys.playlistTracks('p1'), entries);
    let order = [...entries];
    const playlists = adapter.playlists as unknown as {
      move: (...args: unknown[]) => Promise<unknown>;
    };
    playlists.move = (_s, _p, entryId, toIndex) => {
      calls.playlists.push(`move ${String(entryId)} ${String(toIndex)}`);
      const from = order.findIndex((e) => e.entryId === entryId);
      const [moved] = order.splice(from, 1);
      order.splice(Number(toIndex), 0, moved!);
      order = [...order];
      return Promise.resolve({ entries: order, ok: true, calls: 3 });
    };
    expect(await movePlaylistEntry(playlist, 'e2', 0, 'Fluffing a Duck', t, queryClient)).toBe(
      true,
    );
    expect(
      queryClient
        .getQueryData<{ entryId: string }[]>(queryKeys.playlistTracks('p1'))
        ?.map((e) => e.entryId),
    ).toEqual(['e2', 'e0', 'e1']);
    expect(toastStore.get()?.message).toBe('Moved Fluffing a Duck to position 1');
    expect(toastStore.get()?.tone).toBe('info');
    toastStore.get()?.undo?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.playlists.at(-1)).toBe('move e2 2');
    expect(order.map((e) => e.entryId)).toEqual(['e0', 'e1', 'e2']);

    // The server put it somewhere else: the list shows the server's order and the toast is an error.
    playlists.move = () =>
      Promise.resolve({ entries: [entries[1], entries[0], entries[2]], ok: false, calls: 3 });
    expect(entries.map((e) => e.entryId)).toEqual(['e0', 'e1', 'e2']);
    expect(await movePlaylistEntry(playlist, 'e2', 0, 'Fluffing a Duck', t, queryClient)).toBe(
      false,
    );
    expect(toastStore.get()?.tone).toBe('danger');
    expect(toastStore.get()?.message).toContain('somewhere else');
    expect(
      queryClient
        .getQueryData<{ entryId: string }[]>(queryKeys.playlistTracks('p1'))
        ?.map((e) => e.entryId),
    ).toEqual(['e1', 'e0', 'e2']);
  });
});
