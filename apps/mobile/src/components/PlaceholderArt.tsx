import { chart } from '@renaissance/design';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/**
 * Square placeholder art in the six chart colours, as in the mockup. Stands in for art that exists;
 * an empty row shows an EmptyState instead (DESIGN.md rule 3). Mirrors web's PlaceholderArt.
 */
export function PlaceholderArt({
  index,
  label,
  size = 'md',
}: {
  index: number;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const { colors, radius, space, type, scale } = useTheme();
  const color = chart[index % chart.length];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        size === 'sm' ? { width: space[12], height: space[12] } : styles.full,
        { backgroundColor: color, borderRadius: radius.sm },
      ]}
    >
      {label ? (
        <Text
          style={{
            position: 'absolute',
            bottom: space[1],
            left: space[2],
            color: colors.background,
            fontSize: type.caption.size * scale,
            fontWeight: '600',
          }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ full: { aspectRatio: 1, width: '100%' } });
