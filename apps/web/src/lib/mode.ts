import type { Settings } from '@renaissance/core';

import { effectiveMode, settingsStore } from './settings';
import { useStoreValue } from './useStore';

/** The mode on this visit: Settings, or the URL override used by screenshots and e2e. */
export function useMode(): Settings['mode'] {
  const settings = useStoreValue(settingsStore);
  return effectiveMode(settings);
}

export function useSettings(): Settings {
  return useStoreValue(settingsStore);
}
