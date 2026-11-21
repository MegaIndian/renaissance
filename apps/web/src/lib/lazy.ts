/**
 * Routes other than Home are their own chunks. When a chunk cannot load because the browser is
 * offline, the route's error is this one, so the error page can say so and try again when the
 * connection returns, instead of the generic "something went wrong".
 */
export class OfflineError extends Error {
  constructor(cause: unknown) {
    super('offline', { cause });
    this.name = 'OfflineError';
  }
}

/** True for the error a route raises when its chunk could not load offline. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof OfflineError || (error instanceof Error && error.name === 'OfflineError');
}

/** A route module loader that names an offline failure. Any other failure passes through. */
export function lazyRoute<M, C>(
  load: () => Promise<M>,
  pick: (module: M) => C,
): () => Promise<{ Component: C }> {
  return () =>
    load().then(
      (module) => ({ Component: pick(module) }),
      (error: unknown) => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          throw new OfflineError(error);
        }
        throw error;
      },
    );
}
