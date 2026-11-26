import { sortItems } from '@renaissance/core';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { TrackRow } from '@/components/TrackRow';
import { PageShell } from '@/components/Shell';
import { addToQueue, playNext, playNow, toggleFavorite } from '@/lib/actions';
import { openDialog } from '@/lib/dialogs';
import { openTrackMenu } from '@/lib/menu';
import { playlistNameOf } from '@/lib/names';
import { useLibrary, usePlaylistTracks } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

/**
 * Playlist page (F13): play, shuffle, rename, delete; each song's menu moves it up or down or takes
 * it out, every change synced with Jellyfin and read back, each with an undo.
 */
function PlaylistPageContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, space } = useTheme();
  const { snapshot, ready } = useLibrary();
  const playlist = snapshot.playlists.find((p) => p.id === id);
  const entries = usePlaylistTracks(id);
  const tracks = entries.data ?? [];
  const name = playlist ? playlistNameOf(playlist, t) : '';
  useLayoutEffect(() => {
    if (name) navigation.setOptions({ title: name });
  }, [navigation, name]);
  if (!playlist) {
    return ready ? (
      <View style={{ padding: space[4] }}>
        <EmptyState title={t('playlist.notFound')} quiet />
      </View>
    ) : null;
  }
  const header = (
    <PageHeader
      item={playlist}
      title={name}
      lines={[
        [
          t('library.tracksCount', { count: tracks.length || playlist.trackCount }),
          t('playlist.synced'),
        ].join(' · '),
      ]}
    >
      <Button
        tone="primary"
        title={t('album.play')}
        icon={<Icon name="play" color={colors.primaryForeground} />}
        disabled={!tracks.length}
        onPress={() => playNow(tracks, 0)}
      />
      <Button
        tone="secondary"
        title={t('album.shuffle')}
        icon={<Icon name="shuffle" />}
        disabled={!tracks.length}
        onPress={() => playNow(sortItems(tracks, 'random', 'asc', Date.now()), 0)}
      />
      <Button
        tone="ghost"
        title={t('queue.playNext')}
        disabled={!tracks.length}
        onPress={() => playNext(tracks, t)}
      />
      <Button
        tone="ghost"
        title={t('queue.addToQueue')}
        disabled={!tracks.length}
        onPress={() => addToQueue(tracks, t)}
      />
      <Button
        tone="ghost"
        title={t('playlist.rename')}
        onPress={() => openDialog({ kind: 'renamePlaylist', playlist })}
      />
      <Button
        tone="ghost"
        title={t('playlist.delete')}
        onPress={() =>
          openDialog({
            kind: 'deletePlaylist',
            playlist,
            entries: tracks,
            onDeleted: () => (router.canGoBack() ? router.back() : router.replace('/library')),
          })
        }
      />
    </PageHeader>
  );
  return (
    <FlatList
      data={tracks}
      keyExtractor={(entry) => entry.entryId}
      ListHeaderComponent={header}
      ListEmptyComponent={
        entries.isLoading ? undefined : (
          <View style={{ paddingHorizontal: space[4] }}>
            <EmptyState title={t('playlist.noTracks')} description={t('playlist.noTracksBody')} />
          </View>
        )
      }
      renderItem={({ item, index }) => (
        <TrackRow
          track={item}
          index={index}
          onPlay={() => playNow(tracks, index)}
          onToggleFavorite={() => void toggleFavorite('track', item, t)}
          onMenu={() =>
            openTrackMenu({
              track: item,
              playlist: { playlist, entry: item, index, count: tracks.length },
            })
          }
        />
      )}
    />
  );
}

export default function PlaylistPage() {
  return (
    <PageShell>
      <PlaylistPageContent />
    </PageShell>
  );
}
