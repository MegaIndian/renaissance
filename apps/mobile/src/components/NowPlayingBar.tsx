import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** Bottom player (phase 0: nothing plays, so the Play button is muted, never a second blue). Mirrors web. */
export function NowPlayingBar() {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          paddingHorizontal: space[4],
          paddingVertical: space[3],
          gap: space[3],
        },
      ]}
    >
      <View
        accessibilityElementsHidden
        style={{
          width: space[8] + space[1],
          height: space[8] + space[1],
          backgroundColor: colors.muted,
          borderRadius: radius.sm,
        }}
      />
      <Text
        numberOfLines={1}
        style={[styles.title, { color: colors.mutedForeground, fontSize: type.body.size * scale }]}
      >
        {t('player.nothingPlaying')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('player.play')}
        accessibilityState={{ disabled: true }}
        disabled
        style={[
          styles.play,
          {
            backgroundColor: colors.muted,
            width: space[8],
            height: space[8],
            borderRadius: radius.pill,
          },
        ]}
      >
        <View
          style={[
            styles.triangle,
            {
              borderLeftColor: colors.mutedForeground,
              borderTopWidth: space[1] + 1,
              borderBottomWidth: space[1] + 1,
              borderLeftWidth: space[2],
            },
          ]}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  title: { flex: 1 },
  play: { alignItems: 'center', justifyContent: 'center' },
  triangle: {
    width: 0,
    height: 0,
    marginLeft: 2,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
});
