/**
 * The fetch pipeline (F61, ADR 0006): requested → finding → downloading → importing → ready, or
 * failed with a reason. Singles go through slskd and an explicit ManualImport; albums are handed
 * to Lidarr (and soularr) and watched until every track has a file. Every step is a row in
 * `requests.steps` and an event on the bus, so the Requests tab can show what happened.
 */
import { posix } from 'node:path';

import type { MusicRequest, RequestStatus } from '@renaissance/core';

import type { CatalogueService } from '../catalogue/service.js';
import type { Stores } from '../db/index.js';
import type { RequestUpdate } from '../db/requests.js';
import type { EventBus } from '../events/bus.js';
import { sleep as realSleep } from '../http.js';
import type { JellyfinLibrary } from '../jellyfin/library.js';
import type { Logger } from '../log.js';
import { normalize, tokenOverlap } from '../text.js';
import { buildQueries } from './clean.js';
import { ensureSinglesProfile, waitForCommand } from './lidarr.js';
import type {
  LidarrAlbum,
  LidarrArtist,
  LidarrClient,
  LidarrRelease,
  LidarrTrack,
} from './lidarr.js';
import type { NavidromeClient } from './navidrome.js';
import { baseName, parentName, rank } from './rank.js';
import type { Scored } from './rank.js';
import { parseRules } from './rules.js';
import { toCandidates } from './slskd.js';
import type { SlskdClient } from './slskd.js';

export class PipelineError extends Error {
  readonly reason: string;
  constructor(reason: string, detail: string) {
    super(detail);
    this.name = 'PipelineError';
    this.reason = reason;
  }
}

export interface PipelineDeps {
  stores: Stores;
  bus: EventBus;
  catalogue: CatalogueService;
  library: JellyfinLibrary;
  slskd?: SlskdClient;
  lidarr?: LidarrClient;
  navidrome?: NavidromeClient;
  /** The slskd completed folder as Lidarr sees it. */
  lidarrDownloadsDir: string;
  rootFolder?: string;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
  downloadTimeoutMs?: number;
  tracksTimeoutMs?: number;
  /** How many ranked files to try before giving up on a download. */
  maxAttempts?: number;
  /** Writes are logged, not sent (the clients do that); the mapping step uses MusicBrainz tracks. */
  dryRun?: boolean;
}

export const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
export const TRACKS_TIMEOUT_MS = 90_000;

/** The Lidarr track a downloaded file stands for: by MusicBrainz recording id, then by title. */
export function mapTrack(
  tracks: readonly LidarrTrack[],
  want: { title: string; recordingId?: string; duration?: number },
): LidarrTrack | undefined {
  if (want.recordingId) {
    const byId = tracks.find((t) => t.foreignRecordingId === want.recordingId);
    if (byId) return byId;
  }
  const exact = tracks.filter((t) => normalize(t.title) === normalize(want.title));
  const pool =
    exact.length > 0 ? exact : tracks.filter((t) => tokenOverlap(want.title, t.title) >= 0.6);
  if (pool.length === 0) return undefined;
  if (want.duration === undefined) return pool[0];
  const target = want.duration * 1000;
  return [...pool].sort((a, b) => Math.abs(a.duration - target) - Math.abs(b.duration - target))[0];
}

/** Our MusicBrainz release when Lidarr knows it, else the monitored one, else the first. */
export function pickRelease(album: LidarrAlbum, releaseId?: string): LidarrRelease | undefined {
  const releases = album.releases ?? [];
  return (
    (releaseId ? releases.find((r) => r.foreignReleaseId === releaseId) : undefined) ??
    releases.find((r) => r.monitored) ??
    releases[0]
  );
}

export function lidarrPathFor(downloadsDir: string, remoteFilename: string): string {
  return posix.join(downloadsDir, parentName(remoteFilename), baseName(remoteFilename));
}

export function describePick(s: Scored): string {
  return `${baseName(s.candidate.filename)} from ${s.candidate.username} (score ${s.score}: ${s.reasons.join(', ')})`;
}

export function createPipeline(deps: PipelineDeps) {
  const { stores, bus, log } = deps;
  const sleep = deps.sleep ?? realSleep;

  function update(id: string, patch: RequestUpdate): MusicRequest {
    const current = stores.requests.get(id);
    if (current?.status === 'failed' && current.reason === 'cancelled') {
      throw new PipelineError('gone', 'The request was cancelled');
    }
    const next = stores.requests.update(id, patch);
    if (!next) throw new PipelineError('gone', 'The request was removed');
    bus.publish(next.requestedBy, { type: 'request', request: next });
    if (next.status === 'ready') bus.publish(next.requestedBy, { type: 'ready', request: next });
    return next;
  }

  async function resolveIds(req: MusicRequest): Promise<MusicRequest> {
    if (req.kind === 'track' && req.recordingId && req.releaseGroupId && req.artistId) return req;
    if (req.kind === 'album' && req.releaseGroupId && req.artistId) return req;
    if (req.kind === 'track') {
      const song = await deps.catalogue.findSong(req.title, req.artist);
      if (!song?.releaseGroupId || !song.artistId) {
        throw new PipelineError(
          'catalogue_miss',
          `MusicBrainz has no release for "${req.title}" by ${req.artist}`,
        );
      }
      const ids: NonNullable<RequestUpdate['ids']> = {
        recordingId: song.recordingId,
        releaseGroupId: song.releaseGroupId,
        artistId: song.artistId,
      };
      if (song.releaseId) ids.releaseId = song.releaseId;
      if (song.duration !== undefined) ids.duration = song.duration;
      if (song.album) ids.album = song.album;
      return update(req.id, {
        status: 'finding',
        detail: `Matched ${song.title} by ${song.artist}`,
        ids,
      });
    }
    const album = await deps.catalogue.findAlbum(req.title, req.artist);
    if (!album?.artistId) {
      throw new PipelineError(
        'catalogue_miss',
        `MusicBrainz has no album "${req.title}" by ${req.artist}`,
      );
    }
    return update(req.id, {
      status: 'finding',
      detail: `Matched ${album.title} by ${album.artist}`,
      ids: { releaseGroupId: album.releaseGroupId, artistId: album.artistId },
    });
  }

  async function ensureArtist(lidarr: LidarrClient, mbid: string): Promise<LidarrArtist> {
    const singles = await ensureSinglesProfile(lidarr);
    const existing = (await lidarr.artists()).find((a) => a.foreignArtistId === mbid);
    if (existing) {
      if (existing.metadataProfileId !== singles.id) {
        // Lidarr hides singles under the Standard profile; switching the artist makes them appear.
        return lidarr.updateArtist({ ...existing, metadataProfileId: singles.id });
      }
      return existing;
    }
    const roots = await lidarr.rootFolders();
    const root = deps.rootFolder
      ? (roots.find((r) => r.path === deps.rootFolder) ?? roots[0])
      : roots[0];
    if (!root) throw new PipelineError('lidarr_artist', 'Lidarr has no root folder');
    const looked = await lidarr.lookupArtist(mbid);
    if (!looked)
      throw new PipelineError('lidarr_artist', `Lidarr cannot find artist ${mbid} on MusicBrainz`);
    return lidarr.addArtist({
      ...looked,
      rootFolderPath: root.path,
      qualityProfileId: root.defaultQualityProfileId ?? 1,
      metadataProfileId: singles.id,
      monitored: true,
      monitorNewItems: 'none',
      addOptions: { monitor: 'none', searchForMissingAlbums: false },
    });
  }

  async function ensureAlbum(
    lidarr: LidarrClient,
    artist: LidarrArtist,
    releaseGroupId: string,
    monitored: boolean,
  ): Promise<LidarrAlbum> {
    const existing = await lidarr.albumByForeignId(releaseGroupId);
    if (existing) return existing;
    const looked = await lidarr.lookupAlbum(releaseGroupId);
    if (!looked)
      throw new PipelineError('lidarr_album', `Lidarr cannot find release group ${releaseGroupId}`);
    try {
      return await lidarr.addAlbum({
        ...looked,
        monitored,
        artistId: artist.id,
        artist: { ...looked.artist, ...artist },
        addOptions: { searchForNewAlbum: false },
      });
    } catch (error) {
      // Lidarr may have added it itself while refreshing the artist: read it back once.
      const again = await lidarr.albumByForeignId(releaseGroupId);
      if (again) return again;
      throw error;
    }
  }

  async function musicBrainzTracks(releaseId: string): Promise<LidarrTrack[]> {
    const release = await deps.catalogue.release(releaseId);
    return (release.media ?? []).flatMap((m) =>
      (m.tracks ?? []).map((t, i) => ({
        id: -1 - i,
        title: t.title,
        trackNumber: t.number,
        absoluteTrackNumber: i + 1,
        duration: t.length ?? 0,
        hasFile: false,
        foreignRecordingId: t.recording?.id ?? '',
      })),
    );
  }

  /** Lidarr fills an album's releases in its own refresh, which may still be running. */
  async function waitForReleases(lidarr: LidarrClient, album: LidarrAlbum): Promise<LidarrAlbum> {
    const deadline = Date.now() + (deps.tracksTimeoutMs ?? TRACKS_TIMEOUT_MS);
    let full = album;
    while ((full.releases ?? []).length === 0 && Date.now() < deadline) {
      await sleep(3_000);
      full = await lidarr.album(album.id);
    }
    return full;
  }

  async function waitForTracks(
    lidarr: LidarrClient,
    albumId: number,
    releaseId: number,
  ): Promise<LidarrTrack[]> {
    const deadline = Date.now() + (deps.tracksTimeoutMs ?? TRACKS_TIMEOUT_MS);
    let tracks = await lidarr.tracks(albumId, releaseId);
    while (tracks.length === 0 && Date.now() < deadline) {
      await sleep(3_000);
      tracks = await lidarr.tracks(albumId, releaseId);
    }
    return tracks;
  }

  async function download(
    req: MusicRequest,
    slskd: SlskdClient,
    ranked: Scored[],
  ): Promise<Scored> {
    const attempts = ranked.slice(0, deps.maxAttempts ?? 3);
    let lastFailure = 'no file was tried';
    for (const pick of attempts) {
      const { username, filename, size } = pick.candidate;
      update(req.id, {
        status: 'downloading',
        detail: describePick(pick),
        progress: { done: 0, total: 100 },
      });
      await slskd.enqueue(username, [{ filename, size }]);
      const deadline = Date.now() + (deps.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS);
      let lastPercent = -1;
      for (;;) {
        const transfers = await slskd.transfers(username);
        const t = transfers.find((x) => x.filename === filename);
        const state = t?.state ?? (transfers.length === 0 ? 'Completed, Succeeded' : 'Requested');
        if (state.includes('Succeeded')) {
          stores.requests.update(req.id, { status: 'downloading', ids: { sourceFile: filename } });
          return pick;
        }
        if (state.startsWith('Completed')) {
          lastFailure = `${baseName(filename)} from ${username}: ${state}${t?.exception ? ` (${t.exception})` : ''}`;
          break;
        }
        if (Date.now() > deadline) {
          lastFailure = `${baseName(filename)} from ${username}: no progress in ${Math.round((deps.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS) / 60_000)} minutes`;
          break;
        }
        const percent =
          size > 0 && t?.bytesTransferred
            ? Math.min(99, Math.floor((t.bytesTransferred / size) * 100))
            : 0;
        if (percent !== lastPercent) {
          lastPercent = percent;
          stores.requests.update(req.id, {
            status: 'downloading',
            progress: { done: percent, total: 100 },
          });
        }
        await sleep(3_000);
      }
      log.warn({ request: req.id, failure: lastFailure }, 'download attempt failed');
    }
    throw new PipelineError('download_failed', lastFailure);
  }

  async function importTrack(
    req: MusicRequest,
    lidarr: LidarrClient,
    remoteFilename: string,
  ): Promise<void> {
    if (!req.artistId || !req.releaseGroupId)
      throw new PipelineError('catalogue_miss', 'No MusicBrainz ids');
    const artist = await ensureArtist(lidarr, req.artistId);
    const album = await ensureAlbum(lidarr, artist, req.releaseGroupId, false);
    const full = await waitForReleases(lidarr, album);
    const release = pickRelease(full, req.releaseId);
    if (!release)
      throw new PipelineError('lidarr_album', `Lidarr album ${full.title} has no releases`);
    if (!release.monitored) {
      await lidarr.updateAlbum({
        ...full,
        releases: (full.releases ?? []).map((r) => ({ ...r, monitored: r.id === release.id })),
      });
    }
    let tracks = await waitForTracks(lidarr, full.id, release.id);
    if (tracks.length === 0 && deps.dryRun) {
      // Nothing was added to Lidarr, so map against MusicBrainz's own track list to show the pick.
      tracks = await musicBrainzTracks(release.foreignReleaseId);
    }
    const want: { title: string; recordingId?: string; duration?: number } = { title: req.title };
    if (req.recordingId) want.recordingId = req.recordingId;
    if (req.duration !== undefined) want.duration = req.duration;
    const track = mapTrack(tracks, want);
    if (!track) {
      throw new PipelineError(
        'track_unmapped',
        `None of the ${tracks.length} tracks on ${full.title} (release ${release.foreignReleaseId}) is "${req.title}"`,
      );
    }
    const path = lidarrPathFor(deps.lidarrDownloadsDir, remoteFilename);
    const folder = posix.dirname(path);
    let candidate = (await lidarr.importCandidates(folder)).find(
      (c) => baseName(c.path) === baseName(path),
    );
    for (let i = 0; !candidate && i < 5; i++) {
      await sleep(3_000);
      candidate = (await lidarr.importCandidates(folder)).find(
        (c) => baseName(c.path) === baseName(path),
      );
    }
    if (!candidate && deps.dryRun) {
      log.info({ dryRun: true, path }, 'would import this file once downloaded');
      candidate = { path, quality: { quality: { id: 0, name: 'Unknown' } } };
    }
    if (!candidate)
      throw new PipelineError('import_failed', `Lidarr cannot see the file at ${path}`);
    update(req.id, {
      status: 'importing',
      detail: `Mapped to track ${track.trackNumber} "${track.title}" on ${full.title}; importing as ${candidate.quality.quality.name}`,
    });
    const command = await lidarr.manualImport([
      {
        path: candidate.path,
        artistId: artist.id,
        albumId: full.id,
        albumReleaseId: release.id,
        trackIds: [track.id],
        quality: candidate.quality,
        disableReleaseSwitching: true,
      },
    ]);
    try {
      await waitForCommand(lidarr, command.id, sleep);
    } catch (error) {
      throw new PipelineError(
        'import_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
    await scans(req.id, lidarr, artist.id);
  }

  async function scans(
    requestId: string,
    lidarr: LidarrClient | undefined,
    artistId: number | undefined,
  ): Promise<void> {
    const done: string[] = [];
    const failed: string[] = [];
    const attempt = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn();
        done.push(name);
      } catch (error) {
        failed.push(name);
        log.warn(
          {
            request: requestId,
            scan: name,
            error: error instanceof Error ? error.message : String(error),
          },
          'scan failed',
        );
      }
    };
    if (lidarr && artistId !== undefined)
      await attempt('lidarr', () => lidarr.command('RefreshArtist', { artistId }));
    if (deps.navidrome) await attempt('navidrome', () => deps.navidrome!.startScan());
    if (deps.library.configured) await attempt('jellyfin', () => deps.library.refresh());
    const detail = `Scans: ${done.join(', ') || 'none'}${failed.length > 0 ? `; failed: ${failed.join(', ')}` : ''}`;
    stores.requests.update(requestId, { status: 'importing', detail });
  }

  function finish(req: MusicRequest, detail: string): MusicRequest {
    const itemId =
      req.kind === 'track'
        ? `mb:recording:${req.recordingId}`
        : `mb:release-group:${req.releaseGroupId}`;
    const item: Parameters<Stores['collection']['add']>[0] = {
      profile: req.requestedBy,
      item: itemId,
      kind: req.kind,
      title: req.title,
      artist: req.artist,
      addedBy: req.requestedBy,
      source: 'request',
    };
    if (req.album) item.album = req.album;
    stores.collection.add(item);
    return update(req.id, { status: 'ready', detail });
  }

  async function runTrack(req: MusicRequest): Promise<MusicRequest> {
    const { slskd, lidarr } = deps;
    if (!slskd || !lidarr)
      throw new PipelineError(
        'not_configured',
        'SLSKD_URL and LIDARR_URL are needed to fetch songs',
      );
    const resolved = await resolveIds(req);
    if (resolved.sourceFile) {
      // A retry after a failed import: the file is already in the downloads folder.
      update(resolved.id, {
        status: 'importing',
        detail: `Importing the file downloaded earlier: ${baseName(resolved.sourceFile)}`,
      });
      await importTrack(resolved, lidarr, resolved.sourceFile);
      return finish(
        stores.requests.get(resolved.id) ?? resolved,
        `Imported ${baseName(resolved.sourceFile)}`,
      );
    }
    const policy = parseRules(stores.rules.list(resolved.requestedBy).map((r) => r.text));
    const want: Parameters<typeof rank>[1] = {
      title: resolved.title,
      artist: resolved.artist,
      policy,
    };
    if (resolved.duration !== undefined) want.duration = resolved.duration;
    const queryInput: Parameters<typeof buildQueries>[0] = {
      title: resolved.title,
      artist: resolved.artist,
    };
    if (resolved.album) queryInput.album = resolved.album;
    const queries = buildQueries(queryInput);
    let ranked: Scored[] = [];
    let excludedCount = 0;
    const tried: string[] = [];
    for (const query of queries) {
      const responses = await slskd.search(query);
      const candidates = toCandidates(responses);
      const result = rank(candidates, want);
      const summary = `"${query}": ${candidates.length} files, ${result.ranked.length} usable`;
      tried.push(summary);
      excludedCount += result.excluded.length;
      if (result.ranked.length > 0) {
        ranked = result.ranked;
        break;
      }
      stores.requests.update(resolved.id, { status: 'finding', detail: summary });
    }
    if (ranked.length === 0) {
      const reason = excludedCount > 0 ? 'no_candidates' : 'no_results';
      throw new PipelineError(reason, `Soulseek: ${tried.join('; ')}`);
    }
    update(resolved.id, {
      status: 'finding',
      detail: `${tried[tried.length - 1]}; best: ${describePick(ranked[0]!)}`,
    });
    const pick = await download(resolved, slskd, ranked);
    const current = stores.requests.get(resolved.id) ?? resolved;
    update(current.id, {
      status: 'importing',
      detail: `Downloaded ${baseName(pick.candidate.filename)}`,
    });
    await importTrack(current, lidarr, pick.candidate.filename);
    return finish(
      stores.requests.get(current.id) ?? current,
      `Imported ${baseName(pick.candidate.filename)}`,
    );
  }

  async function runAlbum(req: MusicRequest): Promise<MusicRequest> {
    const { lidarr } = deps;
    if (!lidarr) throw new PipelineError('not_configured', 'LIDARR_URL is needed to fetch albums');
    const resolved = await resolveIds(req);
    const artist = await ensureArtist(lidarr, resolved.artistId!);
    const album = await ensureAlbum(lidarr, artist, resolved.releaseGroupId!, true);
    if (!album.monitored) await lidarr.updateAlbum({ ...album, monitored: true });
    await lidarr.command('AlbumSearch', { albumIds: [album.id] });
    return update(resolved.id, {
      status: 'finding',
      detail: `Lidarr is looking for ${album.title} (album ${album.id}); the hub checks every minute`,
      progress: {
        done: album.statistics?.trackFileCount ?? 0,
        total: album.statistics?.trackCount ?? 0,
      },
    });
  }

  return {
    /** Runs one request to ready or failed. Never throws: failures are written to the request. */
    async run(id: string): Promise<MusicRequest | undefined> {
      const req = stores.requests.get(id);
      if (!req) return undefined;
      try {
        update(id, { status: 'finding' });
        return req.kind === 'track' ? await runTrack(req) : await runAlbum(req);
      } catch (error) {
        const reason = error instanceof PipelineError ? error.reason : 'error';
        const detail = error instanceof Error ? error.message : String(error);
        log.error({ request: id, reason, detail }, 'request failed');
        if (reason === 'gone') return undefined;
        return update(id, { status: 'failed', reason, detail });
      }
    },

    /** Album requests waiting on Lidarr: ready once every track has a file. */
    async pollAlbums(): Promise<void> {
      const { lidarr } = deps;
      if (!lidarr) return;
      const waiting = stores.requests
        .listByStatus('finding')
        .filter((r) => r.kind === 'album' && r.releaseGroupId);
      for (const req of waiting) {
        try {
          const album = await lidarr.albumByForeignId(req.releaseGroupId!);
          if (!album) continue;
          const total = album.statistics?.trackCount ?? 0;
          const done = album.statistics?.trackFileCount ?? 0;
          if (total > 0 && done >= total) {
            await scans(req.id, lidarr, album.artistId);
            finish(req, `Lidarr imported ${done} of ${total} tracks`);
          } else {
            stores.requests.update(req.id, { status: 'finding', progress: { done, total } });
          }
        } catch (error) {
          log.warn(
            { request: req.id, error: error instanceof Error ? error.message : String(error) },
            'album poll failed',
          );
        }
      }
    },
  };
}
export type Pipeline = ReturnType<typeof createPipeline>;

export const ACTIVE_STATUSES: readonly RequestStatus[] = ['finding', 'downloading', 'importing'];
