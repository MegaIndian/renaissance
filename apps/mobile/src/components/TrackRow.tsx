import { formatDuration } from '@renaissance/core';
import type { Track } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { Icon } from './Icon';
import { PlaceholderArt } from './PlaceholderArt';

/**
 * One song, mirroring web's TrackRow (DESIGN.md rule 8): art or number, title, subtitle, duration,
 * heart, menu, hairline below. Phase 3 wires it to the mobile player; the shape and names ship now so
 * the two apps stay in step.
 */
export function TrackRow({
  track,
  index,
  onPlay,
  onToggleFavorite,
  onMenu,
  playing = false,
  showNumber = false,
}: {
  track: Track;
  index: number;
  onPlay: () => void;
  onToggleFavorite?: () => void;
  onMenu?: () => void;
  playing?: boolean;
  showNumber?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  const subtitle = [track.artistName || t('library.unknownArtist'), track.albumTitle]
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
          backgroundColor: playing ? colors.muted : 'transparent',
        },
      ]}
    >
      {showNumber ? (
        <Text
          accessibilityElementsHidden
          style={{
            width: space[6],
            textAlign: 'center',
            color: playing ? colors.foreground : colors.mutedForeground,
            fontSize: type.caption.size * scale,
          }}
        >
          {track.trackNumber ?? index + 1}
        </Text>
      ) : (
        <PlaceholderArt index={index} size="sm" />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('actions.play', { title: track.title })}
        onPress={onPlay}
        style={[styles.title, { borderRadius: radius.sm, paddingVertical: space[1] }]}
      >
        <Text
          numberOfLines={1}
          style={{
            color: playing ? colors.primary : colors.foreground,
            fontSize: type.body.size * scale,
            fontWeight: '500',
          }}
        >
          {track.title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}
        >
          {subtitle}
        </Text>
      </Pressable>
      <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
        {formatDuration(track.duration)}
      </Text>
      {onToggleFavorite ? (
        <Pressable
          accessibilityRole="togglebutton"
          accessibilityState={{ checked: track.isFavorite }}
          accessibilityLabel={track.isFavorite ? t('favorites.remove') : t('favorites.add')}
          onPress={onToggleFavorite}
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
          accessibilityRole="button"
          accessibilityLabel={t('track.menu', { title: track.title })}
          onPress={onMenu}
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
  title: { flex: 1, minWidth: 0 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
