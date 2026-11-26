import { sortItems } from '@renaissance/core';
import { useMemo } from 'react';
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

/** Favourite songs (F12), synced with Jellyfin: a heart on any device shows here. */
function FavoritesContent() {
  const { t } = useTranslation();
  const { colors, space, type, scale } = useTheme();
  const snapshot = useSnapshot();
  const tracks = useMemo(
    () =>
      sortItems(
        snapshot.tracks.filter((x) => x.isFavorite),
        'name',
      ),
    [snapshot.tracks],
  );
  const header = (
    <View style={{ padding: space[4], gap: space[3] }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.foreground, fontSize: type.display.size * scale, fontWeight: '600' }}
      >
        {t('favorites.title')}
      </Text>
      {tracks.length ? (
        <Button
          tone="primary"
          title={t('home.playAll')}
          icon={<Icon name="play" color={colors.primaryForeground} />}
          onPress={() => playNow(tracks, 0)}
        />
      ) : (
        <EmptyState title={t('favorites.empty')} description={t('favorites.emptyBody')} />
      )}
    </View>
  );
  return <TrackList tracks={tracks} header={header} />;
}

export default function Favorites() {
  return (
    <PageShell>
      <FavoritesContent />
    </PageShell>
  );
}
