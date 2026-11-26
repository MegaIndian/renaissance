/**
 * A clean stop on SIGTERM or SIGINT that can be read in the log afterwards (production AK): one
 * line when the signal arrives, one when the server has closed, and a bound on the wait, so a
 * container stop never hangs on an open event stream until Docker's SIGKILL leaves no trace.
 */
import type { EventEmitter } from 'node:events';

import type { Logger } from './log.js';

export const STOP_TIMEOUT_MS = 10_000;

export function installStop(
  app: { close(): Promise<unknown>; log: Logger },
  options: {
    signals?: Pick<EventEmitter, 'on'>;
    exit?: (code: number) => void;
    timeoutMs?: number;
  } = {},
): (signal: string) => void {
  const signals = options.signals ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.timeoutMs ?? STOP_TIMEOUT_MS;
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'renaissance-hub stopping');
    const timer = setTimeout(() => {
      app.log.error({ timeoutMs }, 'renaissance-hub did not close in time; exiting');
      exit(1);
    }, timeoutMs);
    timer.unref();
    app.close().then(
      () => {
        clearTimeout(timer);
        app.log.info({ signal }, 'renaissance-hub stopped');
        exit(0);
      },
      (error: unknown) => {
        clearTimeout(timer);
        app.log.error(
          { error: error instanceof Error ? error.message : String(error) },
          'renaissance-hub close failed; exiting',
        );
        exit(1);
      },
    );
  };
  signals.on('SIGTERM', () => stop('SIGTERM'));
  signals.on('SIGINT', () => stop('SIGINT'));
  return stop;
}
