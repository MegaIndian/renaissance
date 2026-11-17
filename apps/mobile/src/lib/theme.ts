import { colors, radius, simpleModeScale, type } from '@renaissance/design';
import { useColorScheme } from 'react-native';

export function useTheme() {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  return { colors: colors[scheme], radius, type, scale: simpleModeScale, scheme };
}
