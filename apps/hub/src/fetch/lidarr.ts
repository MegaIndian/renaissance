/**
 * Lidarr client for the import side of a request (ADR 0006 point 4): the artist and album are
 * added explicitly, the file is mapped to a MusicBrainz track by the hub, and `ManualImport` is
 * sent with `albumReleaseId` and `disableReleaseSwitching`, so Lidarr's edition matching never
 * refuses a good file. Writes are logged instead of sent when `dryRun` is on.
 */
import { HttpError, httpJson, sleep } from '../http.js';
import type { Fetch } from '../http.js';
import type { Logger } from '../log.js';

export interface LidarrArtist {
  id: number;
  artistName: string;
  foreignArtistId: string;
  metadataProfileId: number;
  qualityProfileId: number;
  rootFolderPath?: string;
  path?: string;
  monitored: boolean;
  [key: string]: unknown;
}

export interface LidarrRelease {
  id: number;
  foreignReleaseId: string;
  title: string;
  trackCount: number;
  monitored: boolean;
  [key: string]: unknown;
}

export interface LidarrAlbum {
  id: number;
  title: string;
  foreignAlbumId: string;
  monitored: boolean;
  albumType?: string;
  artistId?: number;
  artist?: Partial<LidarrArtist>;
  releases?: LidarrRelease[];
  statistics?: { trackCount?: number; trackFileCount?: number; percentOfTracks?: number };
  [key: string]: unknown;
}

export interface LidarrTrack {
  id: number;
  title: string;
  trackNumber: string;
  absoluteTrackNumber: number;
  duration: number;
  hasFile: boolean;
  foreignRecordingId?: string;
  albumReleaseId?: number | null;
}

export interface LidarrMetadataProfile {
  id: number;
  name: string;
  primaryAlbumTypes: { albumType: { id: number; name: string }; allowed: boolean }[];
  secondaryAlbumTypes: { albumType: { id: number; name: string }; allowed: boolean }[];
  releaseStatuses: { releaseStatus: { id: number; name: string }; allowed: boolean }[];
}

export interface LidarrRootFolder {
  id: number;
  path: string;
  defaultMetadataProfileId?: number;
  defaultQualityProfileId?: number;
}

export interface LidarrQuality {
  quality: { id: number; name: string };
  revision?: { version: number; real: number; isRepack: boolean };
}

export interface LidarrImportCandidate {
  id?: number;
  path: string;
  name?: string;
  size?: number;
  quality: LidarrQuality;
  artist?: { id: number };
  album?: { id: number };
  albumReleaseId?: number;
  tracks?: { id: number }[];
  rejections?: { reason: string }[];
}

export interface LidarrCommand {
  id: number;
  name: string;
  status: string;
  message?: string;
  exception?: string;
}

export interface ManualImportFile {
  path: string;
  artistId: number;
  albumId: number;
  albumReleaseId: number;
  trackIds: number[];
  quality: LidarrQuality;
  disableReleaseSwitching: boolean;
}

export const SINGLES_PROFILE_NAME = 'Albums, EPs and singles (Renaissance)';

export interface LidarrClient {
  rootFolders(): Promise<LidarrRootFolder[]>;
  metadataProfiles(): Promise<LidarrMetadataProfile[]>;
  createMetadataProfile(profile: Omit<LidarrMetadataProfile, 'id'>): Promise<LidarrMetadataProfile>;
  artists(): Promise<LidarrArtist[]>;
  lookupArtist(mbid: string): Promise<LidarrArtist | undefined>;
  addArtist(artist: Record<string, unknown>): Promise<LidarrArtist>;
  updateArtist(artist: LidarrArtist): Promise<LidarrArtist>;
  albumByForeignId(mbid: string): Promise<LidarrAlbum | undefined>;
  album(id: number): Promise<LidarrAlbum>;
  lookupAlbum(mbid: string): Promise<LidarrAlbum | undefined>;
  addAlbum(album: Record<string, unknown>): Promise<LidarrAlbum>;
  updateAlbum(album: LidarrAlbum): Promise<LidarrAlbum>;
  tracks(albumId: number, albumReleaseId?: number): Promise<LidarrTrack[]>;
  importCandidates(folder: string): Promise<LidarrImportCandidate[]>;
  manualImport(files: ManualImportFile[]): Promise<LidarrCommand>;
  command(name: string, body: Record<string, unknown>): Promise<LidarrCommand>;
  commandStatus(id: number): Promise<LidarrCommand>;
}

export function lidarrClient(options: {
  url: string;
  apiKey: string;
  dryRun?: boolean;
  log: Logger;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
}): LidarrClient {
  const doFetch = options.fetch ?? fetch;
  const headers = { 'x-api-key': options.apiKey };
  const api = `${options.url}/api/v1`;
  let dryIds = 90_000;

  const wait = options.sleep ?? sleep;
  // Lidarr's own metadata service (api.lidarr.audio) answers 503 now and then on a first lookup;
  // a read is retried twice before the request fails.
  const get = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
    const url = new URL(`${api}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      try {
        return (
          await httpJson<T>('lidarr', url.toString(), { headers, timeoutMs: 60_000 }, doFetch)
        ).body;
      } catch (error) {
        const retry =
          error instanceof HttpError && (error.status >= 500 || error.status === 0) && attempt < 2;
        if (!retry) throw error;
        options.log.warn({ path, status: error.status, attempt }, 'lidarr read failed, retrying');
        await wait(3_000);
      }
    }
  };
  const write = async <T>(
    method: 'POST' | 'PUT',
    path: string,
    body: unknown,
    dryResult: () => T,
  ): Promise<T> => {
    if (options.dryRun) {
      options.log.info(
        { dryRun: true, method, path, body: summarize(body) },
        `would ${method} lidarr ${path}`,
      );
      return dryResult();
    }
    const res = await httpJson<T>(
      'lidarr',
      `${api}/${path}`,
      { method, headers, body, timeoutMs: 60_000, okStatuses: [201, 202] },
      doFetch,
    );
    options.log.info({ method, path }, `lidarr ${method} ${path} ok`);
    return res.body;
  };

  return {
    rootFolders: () => get<LidarrRootFolder[]>('rootfolder'),
    metadataProfiles: () => get<LidarrMetadataProfile[]>('metadataprofile'),
    createMetadataProfile: (profile) =>
      write('POST', 'metadataprofile', profile, () => ({ ...profile, id: dryIds++ })),
    artists: () => get<LidarrArtist[]>('artist'),
    lookupArtist: async (mbid) =>
      (await get<LidarrArtist[]>('artist/lookup', { term: `lidarr:${mbid}` }))[0],
    addArtist: (artist) =>
      write('POST', 'artist', artist, () => ({ ...(artist as LidarrArtist), id: dryIds++ })),
    updateArtist: (artist) => write('PUT', `artist/${artist.id}`, artist, () => artist),
    albumByForeignId: async (mbid) =>
      (await get<LidarrAlbum[]>('album', { foreignAlbumId: mbid }))[0],
    album: (id) => get<LidarrAlbum>(`album/${id}`),
    lookupAlbum: async (mbid) =>
      (await get<LidarrAlbum[]>('album/lookup', { term: `lidarr:${mbid}` }))[0],
    addAlbum: (album) =>
      write('POST', 'album', album, () => {
        const a = album as LidarrAlbum;
        const releases = (a.releases ?? []).map((r, i) => ({ ...r, id: r.id || dryIds + i }));
        dryIds += releases.length;
        return { ...a, id: dryIds++, releases };
      }),
    updateAlbum: (album) => write('PUT', `album/${album.id}`, album, () => album),
    tracks: (albumId, albumReleaseId) =>
      get<LidarrTrack[]>('track', {
        albumId: String(albumId),
        ...(albumReleaseId === undefined ? {} : { albumReleaseId: String(albumReleaseId) }),
      }),
    importCandidates: (folder) =>
      get<LidarrImportCandidate[]>('manualimport', { folder, filterExistingFiles: 'true' }),
    manualImport: (files) =>
      write(
        'POST',
        'command',
        { name: 'ManualImport', files, importMode: 'Move', replaceExistingFiles: false },
        () => ({ id: dryIds++, name: 'ManualImport', status: 'completed' }),
      ),
    command: (name, body) =>
      write('POST', 'command', { name, ...body }, () => ({
        id: dryIds++,
        name,
        status: 'completed',
      })),
    commandStatus: (id) =>
      options.dryRun
        ? Promise.resolve({ id, name: '', status: 'completed' })
        : get<LidarrCommand>(`command/${id}`),
  };
}

/** Log-safe view of a write body: ids and names, no nested blobs. */
function summarize(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(summarize);
  if (body && typeof body === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v === null || typeof v !== 'object') out[k] = v;
      else if (Array.isArray(v))
        out[k] = k === 'files' || k === 'trackIds' ? v.map(summarize) : `[${v.length}]`;
      else if (k === 'quality' || k === 'addOptions') out[k] = summarize(v);
      else out[k] = '{…}';
    }
    return out;
  }
  return body;
}

/** Waits for a command to finish; throws with Lidarr's message when it fails. */
export async function waitForCommand(
  lidarr: LidarrClient,
  id: number,
  wait: (ms: number) => Promise<void> = sleep,
  timeoutMs = 120_000,
): Promise<LidarrCommand> {
  const deadline = Date.now() + timeoutMs;
  let last = await lidarr.commandStatus(id);
  while (
    !['completed', 'failed', 'aborted', 'cancelled'].includes(last.status) &&
    Date.now() < deadline
  ) {
    await wait(2_000);
    last = await lidarr.commandStatus(id);
  }
  if (last.status !== 'completed') {
    throw new Error(
      `Lidarr command ${last.name || id} ${last.status}: ${last.message ?? last.exception ?? 'no message'}`,
    );
  }
  return last;
}

/** The metadata profile that lets singles in, created from the first existing one when missing. */
export async function ensureSinglesProfile(lidarr: LidarrClient): Promise<LidarrMetadataProfile> {
  const profiles = await lidarr.metadataProfiles();
  const allowsSingles = (p: LidarrMetadataProfile): boolean =>
    p.primaryAlbumTypes.some((t) => t.albumType.name === 'Single' && t.allowed) &&
    p.primaryAlbumTypes.some((t) => t.albumType.name === 'Album' && t.allowed);
  const found = profiles.find(allowsSingles);
  if (found) return found;
  const template = profiles[0];
  if (!template) throw new Error('Lidarr has no metadata profile to copy');
  return lidarr.createMetadataProfile({
    name: SINGLES_PROFILE_NAME,
    primaryAlbumTypes: template.primaryAlbumTypes.map((t) => ({
      ...t,
      allowed: ['Album', 'EP', 'Single'].includes(t.albumType.name),
    })),
    secondaryAlbumTypes: template.secondaryAlbumTypes.map((t) => ({
      ...t,
      allowed: t.albumType.name === 'Studio',
    })),
    releaseStatuses: template.releaseStatuses.map((t) => ({
      ...t,
      allowed: t.releaseStatus.name === 'Official',
    })),
  });
}
