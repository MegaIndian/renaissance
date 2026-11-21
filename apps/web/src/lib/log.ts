/**
 * The one diagnostic channel. Off by default so the console stays empty for everyone; a browser with
 * `localStorage['renaissance.debug'] = '1'` sees what the app otherwise survives in silence: a
 * cache write that failed, a push whose songs could not be fetched, a queue that did not fit.
 */
const FLAG = 'renaissance.debug';

function enabled(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

export function debug(message: string, detail?: unknown): void {
  if (!enabled()) return;
  console.debug(`[renaissance] ${message}`, detail);
}

/** For a promise whose failure the caller has decided to survive: it is logged, then dropped. */
export function swallow(what: string): (error: unknown) => undefined {
  return (error) => {
    debug(what, error);
    return undefined;
  };
}
