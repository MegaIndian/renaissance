/**
 * Runs requests one at a time in the hub process and recovers after a restart: `requested` rows
 * start again, in-flight singles are marked failed (`interrupted`) since a half-done download
 * cannot be resumed safely, album rows waiting on Lidarr keep waiting.
 */
import type { Stores } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import type { Logger } from '../log.js';
import type { Pipeline } from './pipeline.js';

export const ALBUM_POLL_MS = 60_000;

export function createRunner(options: {
  pipeline: Pipeline;
  stores: Stores;
  bus: EventBus;
  log: Logger;
  albumPollMs?: number;
}) {
  const { pipeline, stores, bus, log } = options;
  const queue: string[] = [];
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  async function drain(): Promise<void> {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      await pipeline.run(id);
    }
    running = undefined;
  }

  return {
    enqueue(id: string): void {
      queue.push(id);
      if (!running) running = drain();
    },
    pending(): number {
      return queue.length + (running ? 1 : 0);
    },
    /** Awaits everything queued so far; tests use it. */
    idle(): Promise<void> {
      return running ?? Promise.resolve();
    },
    recover(): void {
      for (const status of ['finding', 'downloading', 'importing'] as const) {
        for (const req of stores.requests.listByStatus(status)) {
          if (req.kind === 'album' && status === 'finding') continue;
          const failed = stores.requests.update(req.id, {
            status: 'failed',
            reason: 'interrupted',
            detail: 'The hub restarted while this was in progress',
          });
          if (failed) bus.publish(failed.requestedBy, { type: 'request', request: failed });
        }
      }
      const pending = stores.requests.listByStatus('requested');
      for (const req of pending) this.enqueue(req.id);
      if (pending.length > 0) log.info({ count: pending.length }, 'requests resumed after restart');
    },
    start(): void {
      this.recover();
      timer = setInterval(() => void pipeline.pollAlbums(), options.albumPollMs ?? ALBUM_POLL_MS);
      timer.unref();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
export type Runner = ReturnType<typeof createRunner>;
