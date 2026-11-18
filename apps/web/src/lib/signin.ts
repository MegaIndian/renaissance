import { useCallback, useState } from 'react';

export {
  classifySignInError,
  createAdapter,
  serverFromAddress,
  signIn,
  signInWithQuickConnect,
} from './session';

const LAST_SERVER_KEY = 'renaissance.lastServer';

/** The last server address typed, so the family only types it once per browser. */
export function useLastServer(): [string, (url: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(LAST_SERVER_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const remember = useCallback((url: string) => {
    setValue(url);
    try {
      localStorage.setItem(LAST_SERVER_KEY, url);
    } catch {
      /* private window */
    }
  }, []);
  return [value, remember];
}
