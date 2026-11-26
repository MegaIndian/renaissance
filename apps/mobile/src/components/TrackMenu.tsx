import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { addToQueue, playNext, toggleFavorite } from '@/lib/actions';
import { openDialog } from '@/lib/dialogs';
import { closeTrackMenu, trackMenuStore } from '@/lib/menu';
import { titleOf } from '@/lib/names';
import { movePlaylistEntry, removeFromPlaylist } from '@/lib/playlist-actions';
import { useStoreValue } from '@/lib/useStore';

import { Icon } from './Icon';
import { Sheet, SheetItem } from './Sheet';

/** The song menu (web's TrackMenu): queue, playlist, favourite and the way to its album and artist. */
export function TrackMenu() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const state = useStoreValue(trackMenuStore);
  const track = state?.track;
  const close = closeTrackMenu;
  const then = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <Sheet
      visible={!!track}
      title={track ? titleOf(track, t) : ''}
      onClose={close}
      closeLabel={t('actions.close')}
    >
      {track ? (
        <>
          <SheetItem label={t('queue.playNext')} onPress={then(() => playNext([track], t))}>
            <Icon name="next" />
          </SheetItem>
          <SheetItem
            testID="menu-add-to-queue"
            label={t('queue.addToQueue')}
            onPress={then(() => addToQueue([track], t))}
          >
            <Icon name="queue" />
          </SheetItem>
          <SheetItem
            label={t('playlist.addTo')}
            onPress={then(() => openDialog({ kind: 'addToPlaylist', tracks: [track] }))}
          >
            <Icon name="plus" />
          </SheetItem>
          {state.playlist && state.playlist.index > 0 ? (
            <SheetItem
              label={t('queue.moveUp')}
              onPress={then(() => {
                const at = state.playlist;
                if (!at) return;
                void movePlaylistEntry(
                  at.playlist,
                  at.entry.entryId,
                  at.index - 1,
                  titleOf(track, t),
                  t,
                  queryClient,
                );
              })}
            >
              <Icon name="chevronUp" />
            </SheetItem>
          ) : null}
          {state.playlist && state.playlist.index < state.playlist.count - 1 ? (
            <SheetItem
              label={t('queue.moveDown')}
              onPress={then(() => {
                const at = state.playlist;
                if (!at) return;
                void movePlaylistEntry(
                  at.playlist,
                  at.entry.entryId,
                  at.index + 1,
                  titleOf(track, t),
                  t,
                  queryClient,
                );
              })}
            >
              <Icon name="chevronDown" />
            </SheetItem>
          ) : null}
          {state.playlist ? (
            <SheetItem
              label={t('playlist.removeFrom')}
              tone="danger"
              onPress={then(() => {
                const { playlist, entry } = state.playlist ?? {};
                if (!playlist || !entry) return;
                void removeFromPlaylist(
                  playlist,
                  [entry.entryId],
                  titleOf(track, t),
                  t,
                  queryClient,
                  {
                    tracks: [track],
                  },
                );
              })}
            >
              <Icon name="trash" />
            </SheetItem>
          ) : null}
          <SheetItem
            label={track.isFavorite ? t('favorites.remove') : t('favorites.add')}
            onPress={then(() => void toggleFavorite('track', track, t))}
          >
            <Icon name={track.isFavorite ? 'heartFilled' : 'heart'} />
          </SheetItem>
          {track.albumId ? (
            <SheetItem
              label={t('track.goToAlbum')}
              onPress={then(() =>
                router.push({ pathname: '/album/[id]', params: { id: track.albumId ?? '' } }),
              )}
            >
              <Icon name="library" />
            </SheetItem>
          ) : null}
          {track.artistIds[0] ? (
            <SheetItem
              label={t('track.goToArtist')}
              onPress={then(() =>
                router.push({ pathname: '/artist/[id]', params: { id: track.artistIds[0] ?? '' } }),
              )}
            >
              <Icon name="person" />
            </SheetItem>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
