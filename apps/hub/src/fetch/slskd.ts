/**
 * slskd (Soulseek) client: search, enqueue a download, read transfer state. Every write is skipped
 * and logged when `dryRun` is on; searches always run (they change nothing).
 */
import { httpJson, sleep } from '../http.js';
import type { Fetch } from '../http.js';
import type { Logger } from '../log.js';
import type { Candidate } from './rank.js';

export interface SlskdFile {
  filename: string;
  size: number;
  extension?: string;
  bitRate?: number;
  length?: number;
  isLocked?: boolean;
}

export interface SlskdResponse {
  username: string;
  hasFreeUploadSlot: boolean;
  uploadSpeed: number;
  queueLength: number;
  files: SlskdFile[];
  lockedFiles?: SlskdFile[];
}

export interface SlskdSearch {
  id: string;
  state: string;
  isComplete?: boolean;
  fileCount?: number;
  responseCount?: number;
}

export interface SlskdTransfer {
  id?: string;
  filename: string;
  size: number;
  state: string;
  bytesTransferred?: number;
  exception?: string;
}

export interface SlskdClient {
  /** Runs a search to completion (or the timeout) and returns every response. */
  search(text: string, options?: { timeoutMs?: number }): Promise<SlskdResponse[]>;
  enqueue(username: string, files: { filename: string; size: number }[]): Promise<void>;
  transfers(username: string): Promise<SlskdTransfer[]>;
}

export function toCandidates(responses: readonly SlskdResponse[]): Candidate[] {
  const out: Candidate[] = [];
  for (const r of responses) {
    for (const f of r.files ?? []) {
      const c: Candidate = {
        username: r.username,
        filename: f.filename,
        size: f.size,
        hasFreeUploadSlot: r.hasFreeUploadSlot,
        queueLength: r.queueLength,
        uploadSpeed: r.uploadSpeed,
      };
      if (f.extension !== undefined) c.extension = f.extension;
      if (f.bitRate !== undefined) c.bitRate = f.bitRate;
      if (f.length !== undefined) c.length = f.length;
      if (f.isLocked !== undefined) c.isLocked = f.isLocked;
      out.push(c);
    }
  }
  return out;
}

export const SEARCH_TIMEOUT_MS = 12_000;

export function slskdClient(options: {
  url: string;
  apiKey: string;
  dryRun?: boolean;
  log: Logger;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
}): SlskdClient {
  const doFetch = options.fetch ?? fetch;
  const wait = options.sleep ?? sleep;
  const headers = { 'x-api-key': options.apiKey };
  const api = `${options.url}/api/v0`;

  return {
    async search(text, opts = {}) {
      const timeout = opts.timeoutMs ?? SEARCH_TIMEOUT_MS;
      const started = await httpJson<SlskdSearch>(
        'slskd',
        `${api}/searches`,
        {
          method: 'POST',
          headers,
          body: {
            searchText: text,
            searchTimeout: timeout,
            filterResponses: true,
            responseLimit: 250,
            fileLimit: 10_000,
          },
        },
        doFetch,
      );
      const id = started.body.id;
      const deadline = Date.now() + timeout + 8_000;
      let state = started.body.state;
      while (!state.startsWith('Completed') && Date.now() < deadline) {
        await wait(1_000);
        const current = await httpJson<SlskdSearch>(
          'slskd',
          `${api}/searches/${id}`,
          { headers },
          doFetch,
        );
        state = current.body.state;
      }
      const responses = await httpJson<SlskdResponse[]>(
        'slskd',
        `${api}/searches/${id}/responses`,
        { headers },
        doFetch,
      );
      options.log.info(
        { query: text, state, responses: responses.body.length },
        'slskd search finished',
      );
      // The search list in slskd would otherwise grow by every query ever tried; best effort.
      try {
        await httpJson(
          'slskd',
          `${api}/searches/${id}`,
          {
            method: 'DELETE',
            headers,
            okStatuses: [404],
          },
          doFetch,
        );
      } catch (error) {
        options.log.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'slskd search not deleted',
        );
      }
      return responses.body;
    },

    async enqueue(username, files) {
      if (options.dryRun) {
        options.log.info(
          { dryRun: true, username, files: files.map((f) => f.filename) },
          'would POST slskd transfers/downloads',
        );
        return;
      }
      await httpJson(
        'slskd',
        `${api}/transfers/downloads/${encodeURIComponent(username)}`,
        { method: 'POST', headers, body: files, okStatuses: [201] },
        doFetch,
      );
      options.log.info({ username, files: files.length }, 'slskd download enqueued');
    },

    async transfers(username) {
      if (options.dryRun) return [];
      const res = await httpJson<{ directories?: { files: SlskdTransfer[] }[] }>(
        'slskd',
        `${api}/transfers/downloads/${encodeURIComponent(username)}`,
        { headers, okStatuses: [404] },
        doFetch,
      );
      return (res.body?.directories ?? []).flatMap((d) => d.files ?? []);
    },
  };
}
