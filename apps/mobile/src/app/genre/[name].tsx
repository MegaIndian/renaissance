import { filterTracks, sortItems } from '@renaissance/core';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { TrackList } from '@/components/TrackList';
import { PageShell } from '@/components/Shell';
import { playNow } from '@/lib/actions';
import { useSnapshot } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

/** The songs of one genre, from the cache (F8): play all or shuffle. */
function GenrePageContent() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const { colors, space, type, scale } = useTheme();
  const snapshot = useSnapshot();
  const tracks = useMemo(
    () => sortItems(filterTracks(snapshot.tracks, { genre: name }), 'name'),
    [snapshot.tracks, name],
  );
  useLayoutEffect(() => {
    navigation.setOptions({ title: name });
  }, [navigation, name]);
  const header = (
    <View style={{ padding: space[4], gap: space[3] }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.foreground, fontSize: type.display.size * scale, fontWeight: '600' }}
      >
        {t('library.genreTracks', { genre: name })}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
        {t('library.tracksCount', { count: tracks.length })}
      </Text>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
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
      </View>
    </View>
  );
  return tracks.length ? (
    <TrackList tracks={tracks} header={header} />
  ) : (
    <View>
      {header}
      <View style={{ paddingHorizontal: space[4] }}>
        <EmptyState title={t('library.nothingHere')} quiet />
      </View>
    </View>
  );
}

export default function GenrePage() {
  return (
    <PageShell>
      <GenrePageContent />
    </PageShell>
  );
}
