import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

/** A bottom sheet over a dimmed screen; a tap outside closes it. The menu and the dialogs use it. */
export function Sheet({
  title,
  visible,
  onClose,
  closeLabel,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  const { colors, radius, space, type, scale, reducedMotion } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={styles.fill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, opacity: 0.6 }]}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderTopWidth: 1,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingHorizontal: space[4],
            paddingTop: space[4],
            paddingBottom: Math.max(insets.bottom, space[4]),
            gap: space[2],
          }}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={{
              color: colors.foreground,
              fontSize: type.title.size * scale,
              fontWeight: '600',
            }}
          >
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** One line in a sheet: a glyph and a label, the whole row a target. */
export function SheetItem({
  label,
  onPress,
  tone = 'default',
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  testID?: string;
  children?: ReactNode;
}) {
  const { colors, radius, space, type, scale } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        {
          gap: space[3],
          paddingVertical: space[3],
          paddingHorizontal: space[2],
          borderRadius: radius.sm,
          backgroundColor: pressed ? colors.muted : 'transparent',
        },
      ]}
    >
      {children}
      <Text
        style={{
          color: tone === 'danger' ? colors.danger : colors.foreground,
          fontSize: type.body.size * scale,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  item: { flexDirection: 'row', alignItems: 'center' },
});
