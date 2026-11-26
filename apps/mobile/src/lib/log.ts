/**
 * Errors the app can live with (a cache write refused, a push it could not apply) are swallowed;
 * in a development build they are logged with where they happened.
 */
export function debug(where: string, error?: unknown): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`[renaissance] ${where}`, error);
}

export function swallow(where: string): (error: unknown) => void {
  return (error) => debug(where, error);
}
