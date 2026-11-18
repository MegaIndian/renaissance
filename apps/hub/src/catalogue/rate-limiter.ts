/**
 * Spaces calls at least `intervalMs` apart, in order (MusicBrainz asks for one request a second),
 * and keeps the one search box feeling live when four people type at once:
 *
 * - identical in-flight keys share one call (two phones typing "fireman" cost one request), and
 *   every sharer holds its own promise, so one of them moving on never fails the others;
 * - a queued call is dropped for an owner when a newer one from the same owner and a different
 *   batch arrives (the letters already replaced are never looked up); the call itself is removed
 *   from the queue only once every owner waiting on it has moved on, and a call nobody owns (the
 *   pipeline's, the model's context) is never dropped;
 * - the queue is capped: past `maxQueue` a call fails at once with `busy`, so the apps can retry
 *   instead of waiting behind everyone else; a `vital` call (the pipeline resolving a request) is
 *   never refused and goes to the front of the queue.
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
  /**
   * The pipeline's lane: a call that fetches a song somebody already asked for is never refused as
   * `busy` and takes the next slot ahead of the typing, so a burst of asks cannot fail a request.
   */
  vital?: boolean;
}

/** One caller waiting on an entry: its own promise, and who it is. */
interface Waiter {
  owner: string | undefined;
  batch: string | undefined;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface Entry {
  key: string | undefined;
  fn: () => Promise<unknown>;
  waiters: Waiter[];
  /** True once a caller without an owner joined: the entry then outlives every typist. */
  anonymous: boolean;
  /** Left the queue and is running (or done): nothing to drop any more. */
  started: boolean;
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
  const inFlight = new Map<string, Entry>();
  let pumping = false;

  function settle(entry: Entry, outcome: { value: unknown } | { error: unknown }): void {
    if (entry.key !== undefined && inFlight.get(entry.key) === entry) inFlight.delete(entry.key);
    for (const w of entry.waiters) {
      if ('error' in outcome) w.reject(outcome.error);
      else w.resolve(outcome.value);
    }
    entry.waiters = [];
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
        entry.started = true;
        const wait = nextAt - now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        nextAt = now() + intervalMs;
        try {
          settle(entry, { value: await entry.fn() });
        } catch (error) {
          settle(entry, { error });
        }
      }
    } finally {
      pumping = false;
    }
  }

  /** A promise of this caller's own, attached to the entry. */
  function join<T>(entry: Entry, opts: ScheduleOptions): Promise<T> {
    if (opts.owner === undefined) entry.anonymous = true;
    const promise = new Promise<T>((resolve, reject) => {
      entry.waiters.push({
        owner: opts.owner,
        batch: opts.batch,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
    // A dropped or failed call is reported to its caller; it is never an unhandled rejection
    // for the process when the caller looks only later.
    promise.catch(() => undefined);
    return promise;
  }

  /** The owner typed on: its waiters on older batches leave; an entry nobody waits on leaves too. */
  function supersede(owner: string, batch: string | undefined): void {
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i]!;
      const leaving = entry.waiters.filter((w) => w.owner === owner && w.batch !== batch);
      if (leaving.length === 0) continue;
      entry.waiters = entry.waiters.filter((w) => !leaving.includes(w));
      for (const w of leaving) w.reject(new LimiterBusyError('superseded'));
      if (entry.waiters.length === 0 && !entry.anonymous) {
        queue.splice(i, 1);
        if (entry.key !== undefined && inFlight.get(entry.key) === entry)
          inFlight.delete(entry.key);
      }
    }
  }

  return {
    schedule<T>(fn: () => Promise<T>, opts: ScheduleOptions = {}): Promise<T> {
      if (opts.owner !== undefined) supersede(opts.owner, opts.batch);
      if (opts.key !== undefined) {
        const shared = inFlight.get(opts.key);
        if (shared) return join<T>(shared, opts);
      }
      if (!opts.vital && queue.length >= maxQueue)
        return Promise.reject(new LimiterBusyError('busy'));
      const entry: Entry = {
        key: opts.key,
        fn,
        waiters: [],
        anonymous: false,
        started: false,
      };
      const promise = join<T>(entry, opts);
      if (opts.vital) queue.unshift(entry);
      else queue.push(entry);
      if (opts.key !== undefined) inFlight.set(opts.key, entry);
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
