import type { Album } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/lib/theme';

import { PlaceholderArt } from './PlaceholderArt';

/** Square art, title, subtitle: web's AlbumCard by name. Phase 3 routes it to the album screen. */
export function AlbumCard({
  album,
  index,
  onPress,
}: {
  album: Album;
  index: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  const subtitle = [album.artistName || t('library.unknownArtist'), album.year]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={album.title}
      onPress={onPress}
      style={[styles.card, { borderRadius: radius.md, padding: space[2], gap: space[2] }]}
    >
      <PlaceholderArt index={index} />
      <Text
        numberOfLines={1}
        style={{ color: colors.foreground, fontSize: type.body.size * scale, fontWeight: '500' }}
      >
        {album.title}
      </Text>
      <Text
        numberOfLines={1}
        style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}
      >
        {subtitle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'column' },
});
