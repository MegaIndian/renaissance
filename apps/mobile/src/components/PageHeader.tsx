import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { Artwork } from './Artwork';

/** The top of an album, artist or playlist page: art, title, lines under it, then the actions. */
export function PageHeader({
  item,
  title,
  lines,
  round = false,
  children,
}: {
  item: { id: string; imageId?: string | undefined };
  title: string;
  lines: ReactNode[];
  round?: boolean;
  children?: ReactNode;
}) {
  const { colors, space, type, scale } = useTheme();
  return (
    <View style={{ padding: space[4], gap: space[3] }}>
      <View style={{ width: space[12] * 4, alignSelf: 'center' }}>
        <Artwork item={item} round={round} />
      </View>
      <Text
        accessibilityRole="header"
        style={{ color: colors.foreground, fontSize: type.display.size * scale, fontWeight: '600' }}
      >
        {title}
      </Text>
      {lines.map((line, i) =>
        typeof line === 'string' ? (
          <Text
            key={i}
            style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}
          >
            {line}
          </Text>
        ) : (
          <View key={i}>{line}</View>
        ),
      )}
      {children ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
