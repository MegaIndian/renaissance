import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** A card with a full sentence instead of fake content. `quiet` is the one-line form. Mirrors web. */
export function EmptyState({
  title,
  description,
  action,
  art,
  quiet = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  art?: ReactNode;
  quiet?: boolean;
}) {
  const { colors, radius, space, type, scale } = useTheme();
  const card = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
  };
  if (quiet) {
    return (
      <View style={[styles.card, card, { paddingHorizontal: space[4], paddingVertical: space[3] }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: type.body.size * scale }}>
          {title}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.card, card, { padding: space[4], gap: space[4] }]}>
      {art}
      <View style={{ gap: space[1] }}>
        <Text
          accessibilityRole="header"
          style={{ color: colors.foreground, fontSize: type.title.size * scale, fontWeight: '600' }}
        >
          {title}
        </Text>
        {description ? (
          <Text style={{ color: colors.mutedForeground, fontSize: type.body.size * scale }}>
            {description}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({ card: { borderWidth: 1 } });
