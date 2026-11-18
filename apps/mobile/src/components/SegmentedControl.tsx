import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/**
 * Pill group on a `muted` track; the active segment sits on `card` (DESIGN.md rule 4). Mirrors web,
 * including the target size: every segment is at least 24 pt tall and wide, 30 in simple mode.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const { colors, radius, space, type, scale } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[
        styles.track,
        { backgroundColor: colors.muted, borderRadius: radius.md, padding: space[1] / 2 },
      ]}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              {
                borderRadius: radius.sm,
                paddingHorizontal: space[2],
                paddingVertical: space[1] + space[1] / 2,
                minHeight: space[6],
                minWidth: space[6],
              },
              active ? [styles.active, { backgroundColor: colors.card }] : null,
            ]}
          >
            <Text
              style={{
                color: active ? colors.foreground : colors.mutedForeground,
                fontSize: type.caption.size * scale,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignSelf: 'flex-start' },
  segment: { alignItems: 'center', justifyContent: 'center' },
  active: {
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
