import { formatDuration } from '@renaissance/core';
import type { Track } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { titleOf } from '@/lib/names';
import { useTheme } from '@/lib/theme';
import { useIsPlaying } from '@/lib/usePlayer';

import { Artwork } from './Artwork';
import { Icon } from './Icon';

/**
 * One song, mirroring web's TrackRow (DESIGN.md rule 8): art or number, title, subtitle, duration,
 * heart, menu, hairline below. The current song's title is the primary colour; tapping the row plays.
 */
export function TrackRow({
  track,
  index,
  onPlay,
  onToggleFavorite,
  onMenu,
  showNumber = false,
  showAlbum = true,
}: {
  track: Track;
  index: number;
  onPlay: () => void;
  onToggleFavorite?: () => void;
  onMenu?: () => void;
  showNumber?: boolean;
  showAlbum?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  const { current, playing } = useIsPlaying(track.id);
  const title = titleOf(track, t);
  const subtitle = [
    track.artistName || t('library.unknownArtist'),
    showAlbum ? track.albumTitle : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View
      style={[
        styles.row,
        {
          borderColor: colors.border,
          paddingHorizontal: space[2],
          gap: space[3],
          minHeight: space[12] + space[2],
          backgroundColor: current ? colors.muted : 'transparent',
        },
      ]}
    >
      <Pressable
        testID={`track-${track.id}`}
        accessibilityRole="button"
        accessibilityLabel={t(playing ? 'actions.pause' : 'actions.play', { title })}
        onPress={onPlay}
        style={[styles.main, { gap: space[3], borderRadius: radius.sm, paddingVertical: space[1] }]}
      >
        {showNumber ? (
          <View style={{ width: space[6], alignItems: 'center' }}>
            {current ? (
              <Icon name={playing ? 'pause' : 'play'} color={colors.primary} />
            ) : (
              <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
                {track.trackNumber ?? index + 1}
              </Text>
            )}
          </View>
        ) : (
          <Artwork item={{ id: track.albumId ?? track.id, imageId: track.imageId }} size="sm" />
        )}
        <View style={styles.title}>
          <Text
            numberOfLines={1}
            style={{
              color: current ? colors.primary : colors.foreground,
              fontSize: type.body.size * scale,
              fontWeight: '500',
            }}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}
          >
            {subtitle}
          </Text>
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
          {formatDuration(track.duration)}
        </Text>
      </Pressable>
      {onToggleFavorite ? (
        <Pressable
          accessibilityRole="togglebutton"
          accessibilityState={{ checked: track.isFavorite }}
          accessibilityLabel={track.isFavorite ? t('favorites.remove') : t('favorites.add')}
          onPress={onToggleFavorite}
          hitSlop={space[1]}
          style={[styles.icon, { width: space[8], height: space[8], borderRadius: radius.pill }]}
        >
          <Icon
            name={track.isFavorite ? 'heartFilled' : 'heart'}
            color={track.isFavorite ? colors.foreground : colors.mutedForeground}
          />
        </Pressable>
      ) : null}
      {onMenu ? (
        <Pressable
          testID={`track-menu-${track.id}`}
          accessibilityRole="button"
          accessibilityLabel={t('track.menu', { title })}
          onPress={onMenu}
          hitSlop={space[1]}
          style={[styles.icon, { width: space[8], height: space[8], borderRadius: radius.pill }]}
        >
          <Icon name="more" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, minWidth: 0 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
