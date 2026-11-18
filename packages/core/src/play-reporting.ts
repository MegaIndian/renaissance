/**
 * Play reporting (F26): started once, progress every ten seconds (and at once on pause and resume),
 * stopped once, so play counts and continue-listening work on every Jellyfin client. Errors never
 * reach playback: a failed report is handed to `onError` and playback goes on.
 */
import type { Track } from './models';
import type { PlaybackReport, PlayMethod } from './server-adapter';

export const PROGRESS_INTERVAL_MS = 10_000;

export interface ReporterDeps {
  send: (report: PlaybackReport) => Promise<void>;
  now?: () => number;
  /** A fresh play session id per track start. */
  newId?: () => string;
  onError?: (error: unknown) => void;
}

export class PlaybackReporter {
  private readonly deps: Required<ReporterDeps>;
  private active: { track: Track; method: PlayMethod; playSessionId: string } | null = null;
  private lastSentAt = 0;

  constructor(deps: ReporterDeps) {
    this.deps = {
      send: deps.send,
      now: deps.now ?? (() => Date.now()),
      newId:
        deps.newId ??
        (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
      onError: deps.onError ?? (() => undefined),
    };
  }

  get playSessionId(): string | undefined {
    return this.active?.playSessionId;
  }

  get activeTrackId(): string | undefined {
    return this.active?.track.id;
  }

  /** A track began. Any earlier track still open is stopped at its last known position first. */
  started(track: Track, method: PlayMethod, position = 0, lastPosition = 0): string {
    if (this.active) this.stopped(lastPosition);
    const playSessionId = this.deps.newId();
    this.active = { track, method, playSessionId };
    this.lastSentAt = this.deps.now();
    this.dispatch({ trackId: track.id, position, state: 'started', method, playSessionId });
    return playSessionId;
  }

  /** Called on every time update; sends when the interval has passed, or at once when forced. */
  progress(position: number, paused = false, force = false): void {
    if (!this.active) return;
    const now = this.deps.now();
    if (!force && now - this.lastSentAt < PROGRESS_INTERVAL_MS) return;
    this.lastSentAt = now;
    this.dispatch({
      trackId: this.active.track.id,
      position,
      state: 'progress',
      paused,
      method: this.active.method,
      playSessionId: this.active.playSessionId,
    });
  }

  stopped(position: number): void {
    if (!this.active) return;
    const { track, method, playSessionId } = this.active;
    this.active = null;
    this.dispatch({ trackId: track.id, position, state: 'stopped', method, playSessionId });
  }

  private dispatch(report: PlaybackReport): void {
    this.deps.send(report).catch((error: unknown) => this.deps.onError(error));
  }
}
