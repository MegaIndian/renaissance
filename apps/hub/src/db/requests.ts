import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  MusicRequest,
  NewRequest,
  RequestProgress,
  RequestStatus,
  RequestStep,
} from '@renaissance/core';

/**
 * How many steps a request keeps: the first (requested) and the most recent ones. Progress writes
 * never add a step, so a request that polls for days stays a few kilobytes.
 */
export const MAX_STEPS = 50;

export function capSteps(steps: RequestStep[]): RequestStep[] {
  if (steps.length <= MAX_STEPS) return steps;
  return [steps[0]!, ...steps.slice(steps.length - (MAX_STEPS - 1))];
}

interface Row {
  id: string;
  kind: 'track' | 'album';
  title: string;
  artist: string;
  album: string | null;
  recording_id: string | null;
  release_group_id: string | null;
  release_id: string | null;
  artist_id: string | null;
  duration: number | null;
  requested_by: string;
  requested_by_name: string;
  status: RequestStatus;
  reason: string | null;
  detail: string | null;
  progress_done: number | null;
  progress_total: number | null;
  progress_unit: 'songs' | 'percent' | null;
  progress_eta: number | null;
  source_file: string | null;
  steps: string;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT r.*, p.name AS requested_by_name FROM requests r JOIN profiles p ON p.id = r.requested_by`;

function toRequest(r: Row): MusicRequest {
  const out: MusicRequest = {
    id: r.id,
    kind: r.kind,
    title: r.title,
    artist: r.artist,
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    steps: JSON.parse(r.steps) as RequestStep[],
  };
  if (r.album !== null) out.album = r.album;
  if (r.recording_id !== null) out.recordingId = r.recording_id;
  if (r.release_group_id !== null) out.releaseGroupId = r.release_group_id;
  if (r.release_id !== null) out.releaseId = r.release_id;
  if (r.artist_id !== null) out.artistId = r.artist_id;
  if (r.duration !== null) out.duration = r.duration;
  if (r.reason !== null) out.reason = r.reason;
  if (r.detail !== null) out.detail = r.detail;
  if (r.source_file !== null) out.sourceFile = r.source_file;
  if (r.progress_done !== null && r.progress_total !== null) {
    out.progress = {
      unit: r.progress_unit ?? 'percent',
      done: r.progress_done,
      total: r.progress_total,
    };
    if (r.progress_eta !== null) out.progress.etaSeconds = r.progress_eta;
  }
  return out;
}

export interface RequestUpdate {
  status: RequestStatus;
  reason?: string;
  detail?: string;
  progress?: RequestProgress;
  /** Catalogue ids learnt while finding, and the downloaded file once there is one. */
  ids?: Partial<
    Pick<
      NewRequest,
      'recordingId' | 'releaseGroupId' | 'releaseId' | 'artistId' | 'duration' | 'album'
    >
  > & { sourceFile?: string };
}

export function requestStore(db: DatabaseSync) {
  const insert = db.prepare(`
    INSERT INTO requests (id, seq, kind, title, artist, album, recording_id, release_group_id, release_id,
      artist_id, duration, requested_by, status, steps, created_at, updated_at)
    VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM requests), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)
  `);
  const byId = db.prepare(`${SELECT} WHERE r.id = ?`);
  const mine = db.prepare(`${SELECT} WHERE r.requested_by = ? ORDER BY r.seq DESC LIMIT ?`);
  const house = db.prepare(`${SELECT} ORDER BY r.seq DESC LIMIT ?`);
  const byStatus = db.prepare(`${SELECT} WHERE r.status = ? ORDER BY r.seq ASC`);
  const update = db.prepare(`
    UPDATE requests SET status = ?, reason = ?, detail = ?, progress_done = ?, progress_total = ?,
      progress_unit = ?, progress_eta = ?, steps = ?,
      recording_id = COALESCE(?, recording_id), release_group_id = COALESCE(?, release_group_id),
      release_id = COALESCE(?, release_id), artist_id = COALESCE(?, artist_id),
      duration = COALESCE(?, duration), album = COALESCE(?, album), source_file = COALESCE(?, source_file),
      updated_at = ?
    WHERE id = ?
  `);
  const setProgress = db.prepare(`
    UPDATE requests SET progress_done = ?, progress_total = ?, progress_unit = ?, progress_eta = ?, updated_at = ?
    WHERE id = ?
  `);
  const remove = db.prepare('DELETE FROM requests WHERE id = ? RETURNING id');

  return {
    create(input: NewRequest, requestedBy: string, now = new Date()): MusicRequest {
      const id = randomUUID();
      const iso = now.toISOString();
      const steps: RequestStep[] = [{ at: iso, status: 'requested' }];
      insert.run(
        id,
        input.kind,
        input.title,
        input.artist,
        input.album ?? null,
        input.recordingId ?? null,
        input.releaseGroupId ?? null,
        input.releaseId ?? null,
        input.artistId ?? null,
        input.duration ?? null,
        requestedBy,
        JSON.stringify(steps),
        iso,
        iso,
      );
      return toRequest(byId.get(id) as unknown as Row);
    },
    get(id: string): MusicRequest | undefined {
      const row = byId.get(id) as unknown as Row | undefined;
      return row ? toRequest(row) : undefined;
    },
    listMine(profile: string, limit = 200): MusicRequest[] {
      return (mine.all(profile, limit) as unknown as Row[]).map(toRequest);
    },
    listHouse(limit = 500): MusicRequest[] {
      return (house.all(limit) as unknown as Row[]).map(toRequest);
    },
    listByStatus(status: RequestStatus): MusicRequest[] {
      return (byStatus.all(status) as unknown as Row[]).map(toRequest);
    },
    /**
     * Appends a step (capped at MAX_STEPS, first and last kept) and sets the status; returns the
     * new row or undefined when the id is gone.
     */
    update(id: string, patch: RequestUpdate, now = new Date()): MusicRequest | undefined {
      const current = byId.get(id) as unknown as Row | undefined;
      if (!current) return undefined;
      const iso = now.toISOString();
      const steps = JSON.parse(current.steps) as RequestStep[];
      const step: RequestStep = { at: iso, status: patch.status };
      if (patch.reason) step.reason = patch.reason;
      if (patch.detail) step.detail = patch.detail;
      steps.push(step);
      const ids = patch.ids ?? {};
      update.run(
        patch.status,
        patch.reason ?? null,
        patch.detail ?? null,
        patch.progress?.done ?? null,
        patch.progress?.total ?? null,
        patch.progress?.unit ?? null,
        patch.progress?.etaSeconds ?? null,
        JSON.stringify(capSteps(steps)),
        ids.recordingId ?? null,
        ids.releaseGroupId ?? null,
        ids.releaseId ?? null,
        ids.artistId ?? null,
        ids.duration ?? null,
        ids.album ?? null,
        ids.sourceFile ?? null,
        iso,
        id,
      );
      return toRequest(byId.get(id) as unknown as Row);
    },
    /** Progress only: no step, no status change. Undefined when the id is gone. */
    progress(id: string, value: RequestProgress, now = new Date()): MusicRequest | undefined {
      const current = byId.get(id) as unknown as Row | undefined;
      if (!current) return undefined;
      setProgress.run(
        value.done,
        value.total,
        value.unit,
        value.etaSeconds ?? null,
        now.toISOString(),
        id,
      );
      return toRequest(byId.get(id) as unknown as Row);
    },
    remove(id: string): boolean {
      return remove.get(id) !== undefined;
    },
  };
}
export type RequestStore = ReturnType<typeof requestStore>;
