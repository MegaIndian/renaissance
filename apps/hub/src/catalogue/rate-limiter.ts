/**
 * Spaces calls at least `intervalMs` apart, in order (MusicBrainz asks for one request a second),
 * and keeps the one search box feeling live when four people type at once:
 *
 * - identical in-flight keys share one call (two phones typing "fireman" cost one request);
 * - a queued call is dropped when a newer one from the same owner and a different batch arrives
 *   (the letters already replaced are never looked up);
 * - the queue is capped: past `maxQueue` a call fails at once with `busy`, so the apps can retry
 *   instead of waiting behind everyone else.
 */
export class LimiterBusyError extends Error {
  readonly code: 'busy' | 'superseded';
  constructor(code: 'busy' | 'superseded') {
    super(
      code === 'busy'
        ? 'The catalogue is busy; try again in a moment'
        : 'Replaced by a newer search',
    );
    this.name = 'LimiterBusyError';
    this.code = code;
  }
}

export interface ScheduleOptions {
  /** Identical keys in flight share one call. */
  key?: string;
  /** Who asked; a newer batch from the same owner drops this one while it still waits. */
  owner?: string;
  /** Groups the calls of one search so they do not drop each other. */
  batch?: string;
}

interface Entry {
  fn: () => Promise<unknown>;
  options: ScheduleOptions;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export const DEFAULT_MAX_QUEUE = 16;

export function createRateLimiter(
  intervalMs: number,
  options: { now?: () => number; maxQueue?: number } = {},
) {
  const now = options.now ?? Date.now;
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
  let nextAt = 0;
  const queue: Entry[] = [];
  const inFlight = new Map<string, Promise<unknown>>();
  let pumping = false;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
        const wait = nextAt - now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        nextAt = now() + intervalMs;
        try {
          entry.resolve(await entry.fn());
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      pumping = false;
    }
  }

  return {
    schedule<T>(fn: () => Promise<T>, opts: ScheduleOptions = {}): Promise<T> {
      if (opts.key !== undefined) {
        const shared = inFlight.get(opts.key);
        if (shared) return shared as Promise<T>;
      }
      if (opts.owner !== undefined) {
        for (let i = queue.length - 1; i >= 0; i--) {
          const other = queue[i]!;
          if (other.options.owner === opts.owner && other.options.batch !== opts.batch) {
            queue.splice(i, 1);
            if (other.options.key !== undefined) inFlight.delete(other.options.key);
            other.reject(new LimiterBusyError('superseded'));
          }
        }
      }
      if (queue.length >= maxQueue) return Promise.reject(new LimiterBusyError('busy'));
      const promise = new Promise<T>((resolve, reject) => {
        queue.push({
          fn,
          options: opts,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
      });
      // A dropped or failed call is reported to its caller; it is never an unhandled rejection
      // for the process when the caller looks only later.
      promise.catch(() => undefined);
      if (opts.key !== undefined) {
        const key = opts.key;
        inFlight.set(key, promise);
        promise.then(
          () => inFlight.delete(key),
          () => inFlight.delete(key),
        );
      }
      void pump();
      return promise;
    },
    /** Calls waiting for their turn (not the one running). */
    queued(): number {
      return queue.length;
    },
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;
