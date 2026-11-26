import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { EmptyState } from './EmptyState';

/**
 * One Home row (web's Row): a heading over cards that scroll sideways, or a quiet sentence when the
 * row is empty. While the cache loads (`pending`) nothing says "empty" yet.
 */
export function Row({
  title,
  empty,
  emptyBody,
  count,
  pending = false,
  children,
}: {
  title: string;
  empty: string;
  emptyBody?: string;
  count: number;
  pending?: boolean;
  children: ReactNode;
}) {
  const { colors, space, type, scale } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.foreground, fontSize: type.heading.size * scale, fontWeight: '600' }}
      >
        {title}
      </Text>
      {pending ? (
        <View style={{ height: space[12] * 3 }} />
      ) : count === 0 ? (
        <EmptyState
          title={empty}
          {...(emptyBody ? { description: emptyBody } : {})}
          quiet={!emptyBody}
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space[3] }}
        >
          {children}
        </ScrollView>
      )}
    </View>
  );
}

/** A fixed-width slot for one card in a Row. */
export function RowItem({ children }: { children: ReactNode }) {
  const { space } = useTheme();
  return <View style={{ width: space[12] * 2.5 }}>{children}</View>;
}
