import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** Cards two to a row (a phone's grid), with a hairline-free gap; web's grid view in simple mode. */
export function Grid({ children }: { children: ReactNode[] }) {
  const { space } = useTheme();
  const rows: ReactNode[][] = [];
  for (let i = 0; i < children.length; i += 2) rows.push(children.slice(i, i + 2));
  return (
    <View style={{ gap: space[4] }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space[4] }}>
          {row}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}
