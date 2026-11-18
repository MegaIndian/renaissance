import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { signInFake, tracks } from '../test/fakes';
import {
  addToPlaylist,
  addToQueue,
  createPlaylist,
  deletePlaylist,
  playNext,
  removeFromPlaylist,
  renamePlaylist,
  toggleFavorite,
} from './actions';
import { i18n } from './i18n';
import { libraryStore } from './library';
import { toastStore } from './toast';

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
