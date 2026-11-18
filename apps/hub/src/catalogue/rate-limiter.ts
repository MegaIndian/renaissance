/** Spaces calls at least `intervalMs` apart, in order. MusicBrainz asks for one request a second. */
export function createRateLimiter(intervalMs: number, now: () => number = Date.now) {
  let nextAt = 0;
  let chain: Promise<void> = Promise.resolve();
  return {
    schedule<T>(fn: () => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const wait = nextAt - now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        nextAt = now() + intervalMs;
        return fn();
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;
