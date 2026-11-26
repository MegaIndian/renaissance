import { sortItems } from '@renaissance/core';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FavoriteButton } from '@/components/FavoriteButton';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { TrackList } from '@/components/TrackList';
import { PageShell } from '@/components/Shell';
import { addToQueue, playNext, playNow } from '@/lib/actions';
import { openDialog } from '@/lib/dialogs';
import { titleOf } from '@/lib/names';
import { isNotFound, useAlbum, useAlbumTracks } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

/** Album page (F9): art, title, artist, year, genre, duration; play and shuffle; the tracks in order. */
function AlbumPageContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, space, type, scale } = useTheme();
  const { album, isLoading, error } = useAlbum(id);
  const { tracks } = useAlbumTracks(id);
  const title = album ? titleOf(album, t) : '';
  useLayoutEffect(() => {
    if (title) navigation.setOptions({ title });
  }, [navigation, title]);
  if (!album) {
    return (
      <View style={{ padding: space[4] }}>
        {isLoading ? (
          <Text style={{ color: colors.mutedForeground }}>{t('player.loading')}</Text>
        ) : (
          <EmptyState
            title={t(error && !isNotFound(error) ? 'error.unreachable' : 'album.notFound')}
            quiet
          />
        )}
      </View>
    );
  }
  const total = album.duration ?? tracks.reduce((sum, x) => sum + x.duration, 0);
  const meta = [
    album.year,
    album.genres[0],
    t('album.tracks', { count: album.trackCount ?? tracks.length }),
    total ? t('library.minutes', { count: Math.round(total / 60) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const artistId = album.artistIds[0];
  const header = (
    <PageHeader
      item={album}
      title={title}
      lines={[
        artistId ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/artist/[id]', params: { id: artistId } })}
          >
            <Text
              style={{
                color: colors.foreground,
                fontSize: type.body.size * scale,
                fontWeight: '500',
              }}
            >
              {album.artistName || t('library.unknownArtist')}
            </Text>
          </Pressable>
        ) : (
          album.artistName || t('library.unknownArtist')
        ),
        meta,
      ]}
    >
      <Button
        testID="album-play"
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
      <FavoriteButton kind="album" item={album} />
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
        title={t('playlist.addTo')}
        disabled={!tracks.length}
        onPress={() => openDialog({ kind: 'addToPlaylist', tracks })}
      />
    </PageHeader>
  );
  return tracks.length ? (
    <TrackList testID="album-tracks" tracks={tracks} header={header} showNumber showAlbum={false} />
  ) : (
    <View>
      {header}
      <View style={{ paddingHorizontal: space[4] }}>
        <EmptyState title={t('library.nothingHere')} quiet />
      </View>
    </View>
  );
}

export default function AlbumPage() {
  return (
    <PageShell>
      <AlbumPageContent />
    </PageShell>
  );
}
