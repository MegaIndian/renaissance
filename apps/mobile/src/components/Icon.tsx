import { iconIsFilled, iconPaths } from '@renaissance/design';
import type { IconName } from '@renaissance/design';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/lib/theme';

export type { IconName };

/** The shell's glyphs, the same six paths as web's Icon (shared through the design package). */
export function Icon({
  name,
  size,
  color,
}: {
  name: IconName;
  /** In points; defaults to the 16 px grid step. */
  size?: number;
  /** Defaults to the muted foreground; pass the active colour for the selected tab. */
  color?: string;
}) {
  const { colors, space } = useTheme();
  const stroke = color ?? colors.mutedForeground;
  const filled = iconIsFilled(name);
  return (
    <Svg
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      width={size ?? space[4]}
      height={size ?? space[4]}
      viewBox="0 0 24 24"
      fill={filled ? stroke : 'none'}
    >
      <Path
        d={iconPaths[name]}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
