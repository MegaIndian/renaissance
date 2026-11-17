import { colors, motion, radius, simpleModeScale, space, type } from '@renaissance/design';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

/** True when the system asks for reduced motion (DESIGN.md rule 12). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * Tokens for the current scheme and mode. Durations are zero under reduced motion so every
 * animation that reads `motion` from here is already off.
 */
export function useTheme() {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const reducedMotion = useReducedMotion();
  const durations = reducedMotion
    ? { fast: 0, normal: 0, slow: 0, easing: motion.easing }
    : { fast: motion.fast, normal: motion.normal, slow: motion.slow, easing: motion.easing };
  return {
    colors: colors[scheme],
    radius,
    type,
    space,
    scale: simpleModeScale,
    scheme,
    motion: durations,
    reducedMotion,
  };
}

export type ThemeValues = ReturnType<typeof useTheme>;
