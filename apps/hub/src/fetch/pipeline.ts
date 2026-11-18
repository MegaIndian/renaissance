/**
 * The fetch pipeline (F61, ADR 0006): requested → finding → downloading → importing → ready, or
 * failed with a reason, or cancelled by the person who asked. Singles go through slskd and an
 * explicit ManualImport; albums are handed to Lidarr (and soularr) and watched until every track
 * has a file or the deadline passes. Every status change is a row in `requests.steps` and an event
 * on the bus; progress writes change only the progress columns, so a request that polls for days
 * stays small. Every write goes through `update()` or `progress()`, which refuse a cancelled or
 * removed row, and `run()` never throws.
 */
import { posix } from 'node:path';

import type { MusicRequest, RequestProgress, RequestStatus } from '@renaissance/core';

import type { CatalogueService } from '../catalogue/service.js';
import type { Stores } from '../db/index.js';
import { lastRequestedAt } from '../db/requests.js';
import type { RequestUpdate } from '../db/requests.js';
import type { EventBus } from '../events/bus.js';
import { sleep as realSleep } from '../http.js';
import type { JellyfinLibrary } from '../jellyfin/library.js';
import type { Logger } from '../log.js';
import { normalize, tokenOverlap, tokens } from '../text.js';
import { buildQueries } from './clean.js';
import { ensureSinglesProfile, waitForCommand } from './lidarr.js';
import type {
  LidarrAlbum,
  LidarrArtist,
  LidarrClient,
  LidarrQuality,
  LidarrRelease,
  LidarrTrack,
  ManualImportFile,
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
  /** Where soularr parks files Lidarr refused, as Lidarr sees it; album polls file them from there. */
  lidarrFailedImportsDir?: string;
  rootFolder?: string;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  downloadTimeoutMs?: number;
  tracksTimeoutMs?: number;
  /** How long an album request waits on Lidarr before it fails with `not_found_in_time`. */
  albumDeadlineMs?: number;
  /** How many ranked files to try before giving up on a download. */
  maxAttempts?: number;
  /** Polls without a transfer record for the enqueued file before the attempt counts as failed. */
  missingTransferPolls?: number;
  /** How often an album poll looks in the download folders for files Lidarr refused to import. */
  arrivalCheckMs?: number;
  /** Writes are logged, not sent (the clients do that); the mapping step uses MusicBrainz tracks. */
  dryRun?: boolean;
}

export const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
export const TRACKS_TIMEOUT_MS = 90_000;
export const ALBUM_DEADLINE_MS = 7 * 24 * 60 * 60_000;
export const MISSING_TRANSFER_POLLS = 5;
export const POLL_MS = 3_000;
export const ARRIVAL_CHECK_MS = 10 * 60_000;

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

/** "0111 Look Back at It", "A Boogie Wit da Hoodie - Look Back at It.flac": the title in a file name. */
export function fileTitle(filename: string, artist: string): string {
  const base = baseName(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/^[\d\s.\-_]+/, '');
  const artistTokens = new Set(tokens(artist));
  return tokens(base)
    .filter((t) => !artistTokens.has(t))
    .join(' ');
}

export function describePick(s: Scored): string {
  return `${baseName(s.candidate.filename)} from ${s.candidate.username} (score ${s.score}: ${s.reasons.join(', ')})`;
}

/** Seconds left at the rate so far; undefined until something has arrived. */
export function etaSeconds(bytes: number, size: number, elapsedMs: number): number | undefined {
  if (bytes <= 0 || elapsedMs <= 0 || size <= bytes) return undefined;
  const rate = bytes / elapsedMs;
  return Math.max(1, Math.round((size - bytes) / rate / 1000));
}

export function createPipeline(deps: PipelineDeps) {
  const { stores, bus, log } = deps;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;

  /** The row as it is now; throws `gone` when it was removed or the asker cancelled it. */
  function live(id: string): MusicRequest {
    const current = stores.requests.get(id);
    if (!current) throw new PipelineError('gone', 'The request was removed');
    if (current.status === 'cancelled')
      throw new PipelineError('gone', 'The request was cancelled');
    return current;
  }

  /** The asker and everyone who asked for the same thing while it was on its way. */
  const parties = (req: MusicRequest): string[] => [req.requestedBy, ...(req.watchers ?? [])];

  /** Every status write: refuses cancelled rows, appends a step, tells the apps. */
  function update(id: string, patch: RequestUpdate): MusicRequest {
    live(id);
    const next = stores.requests.update(id, patch);
    if (!next) throw new PipelineError('gone', 'The request was removed');
    for (const who of parties(next)) {
      bus.publish(who, { type: 'request', request: next });
      if (next.status === 'ready') bus.publish(who, { type: 'ready', request: next });
    }
    return next;
  }

  /** Every progress write: refuses cancelled rows, appends no step, tells the apps. */
  function progress(id: string, value: RequestProgress): MusicRequest {
    live(id);
    const next = stores.requests.progress(id, value);
    if (!next) throw new PipelineError('gone', 'The request was removed');
    for (const who of parties(next)) bus.publish(who, { type: 'request', request: next });
    return next;
  }

  /** The catalogue's match, when it is not the words that were typed (shown on the card). */
  function matchedFor(
    req: MusicRequest,
    found: { title: string; artist: string },
  ): { title: string; artist: string } | undefined {
    const same =
      normalize(found.title) === normalize(req.title) &&
      normalize(found.artist) === normalize(req.artist);
    return same ? undefined : { title: found.title, artist: found.artist };
  }

  async function resolveIds(req: MusicRequest): Promise<MusicRequest> {
    if (req.kind === 'track' && req.recordingId && req.releaseGroupId && req.artistId) return req;
    if (req.kind === 'album' && req.releaseGroupId && req.artistId) return req;
    if (req.kind === 'track') {
      // The caller's duration (from the typeahead row) picks the version meant and is kept: the
      // recording's own length never replaces it.
      const song = await deps.catalogue.findSong(
        req.title,
        req.artist,
        req.duration !== undefined ? { duration: req.duration } : {},
      );
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
      if (song.duration !== undefined && req.duration === undefined) ids.duration = song.duration;
      if (song.album) ids.album = song.album;
      const matched = matchedFor(req, song);
      if (matched) ids.matched = matched;
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
    const ids: NonNullable<RequestUpdate['ids']> = {
      releaseGroupId: album.releaseGroupId,
      artistId: album.artistId,
    };
    const matched = matchedFor(req, album);
    if (matched) ids.matched = matched;
    return update(req.id, {
      status: 'finding',
      detail: `Matched ${album.title} by ${album.artist}`,
      ids,
    });
  }

  /**
   * The Lidarr artist for a MusicBrainz id. An artist that already exists is used as it is: its
   * metadata profile and monitoring are never changed (a profile switch would make Lidarr monitor
   * and soularr fetch every single and EP). The album is added explicitly instead, which Lidarr
   * accepts outside the profile. A new artist is added unmonitored with the singles profile.
   */
  async function ensureArtist(
    lidarr: LidarrClient,
    mbid: string,
  ): Promise<{ artist: LidarrArtist; note?: string }> {
    const existing = (await lidarr.artists()).find((a) => a.foreignArtistId === mbid);
    if (existing) {
      return {
        artist: existing,
        note: `Using the Lidarr artist ${existing.artistName} as it is (profile and monitoring unchanged; the album is added explicitly)`,
      };
    }
    const singles = await ensureSinglesProfile(lidarr);
    const roots = await lidarr.rootFolders();
    const root = deps.rootFolder
      ? (roots.find((r) => r.path === deps.rootFolder) ?? roots[0])
      : roots[0];
    if (!root) throw new PipelineError('lidarr_artist', 'Lidarr has no root folder');
    const looked = await lidarr.lookupArtist(mbid);
    if (!looked)
      throw new PipelineError('lidarr_artist', `Lidarr cannot find artist ${mbid} on MusicBrainz`);
    const artist = await lidarr.addArtist({
      ...looked,
      rootFolderPath: root.path,
      qualityProfileId: root.defaultQualityProfileId ?? 1,
      metadataProfileId: singles.id,
      monitored: true,
      monitorNewItems: 'none',
      addOptions: { monitor: 'none', searchForMissingAlbums: false },
    });
    return { artist };
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
    const deadline = now() + (deps.tracksTimeoutMs ?? TRACKS_TIMEOUT_MS);
    let full = album;
    while ((full.releases ?? []).length === 0 && now() < deadline) {
      await sleep(POLL_MS);
      full = await lidarr.album(album.id);
    }
    return full;
  }

  async function waitForTracks(
    lidarr: LidarrClient,
    albumId: number,
    releaseId: number,
  ): Promise<LidarrTrack[]> {
    const deadline = now() + (deps.tracksTimeoutMs ?? TRACKS_TIMEOUT_MS);
    let tracks = await lidarr.tracks(albumId, releaseId);
    while (tracks.length === 0 && now() < deadline) {
      await sleep(POLL_MS);
      tracks = await lidarr.tracks(albumId, releaseId);
    }
    return tracks;
  }

  /** Tries the ranked files in order; returns the pick whose download succeeded. */
  async function download(
    req: MusicRequest,
    slskd: SlskdClient,
    ranked: Scored[],
  ): Promise<Scored> {
    const attempts = ranked.slice(0, deps.maxAttempts ?? 3);
    const timeoutMs = deps.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
    const graceMisses = deps.missingTransferPolls ?? MISSING_TRANSFER_POLLS;
    let lastFailure = 'no file was tried';
    for (const pick of attempts) {
      const { username, filename, size } = pick.candidate;
      // A cancel that landed while the files were being ranked stops here, before any download.
      live(req.id);
      update(req.id, {
        status: 'downloading',
        detail: describePick(pick),
        progress: { unit: 'percent', done: 0, total: 100 },
      });
      await slskd.enqueue(username, [{ filename, size }]);
      if (deps.dryRun) {
        // Nothing was enqueued: the file is treated as downloaded so the mapping step can be shown.
        update(req.id, {
          status: 'downloading',
          detail: `Dry run: ${baseName(filename)} counted as downloaded`,
          ids: { sourceFile: filename },
        });
        return pick;
      }
      const started = now();
      const deadline = started + timeoutMs;
      let lastPercent = -1;
      let misses = 0;
      for (;;) {
        const transfers = await slskd.transfers(username);
        const t = transfers.find((x) => x.filename === filename);
        if (!t) {
          // slskd has no record of the file: the enqueue was dropped or the record was purged.
          misses += 1;
          if (misses > graceMisses) {
            lastFailure = `${baseName(filename)} from ${username}: slskd has no transfer for it`;
            break;
          }
          await sleep(POLL_MS);
          continue;
        }
        if (t.state.includes('Succeeded')) {
          update(req.id, {
            status: 'downloading',
            detail: `Downloaded ${baseName(filename)}`,
            ids: { sourceFile: filename },
          });
          return pick;
        }
        if (t.state.startsWith('Completed')) {
          lastFailure = `${baseName(filename)} from ${username}: ${t.state}${t.exception ? ` (${t.exception})` : ''}`;
          break;
        }
        if (now() > deadline) {
          lastFailure = `${baseName(filename)} from ${username}: not finished after ${Math.round(timeoutMs / 60_000)} minutes`;
          break;
        }
        const bytes = t.bytesTransferred ?? 0;
        const percent = size > 0 && bytes > 0 ? Math.min(99, Math.floor((bytes / size) * 100)) : 0;
        if (percent !== lastPercent) {
          lastPercent = percent;
          const value: RequestProgress = { unit: 'percent', done: percent, total: 100 };
          const eta = etaSeconds(bytes, size, now() - started);
          if (eta !== undefined) value.etaSeconds = eta;
          progress(req.id, value);
        }
        await sleep(POLL_MS);
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
    // A cancel cannot land past `finding`, but the import is the costly write: check once more.
    live(req.id);
    const { artist, note } = await ensureArtist(lidarr, req.artistId);
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
    const want: { title: string; recordingId?: string; duration?: number } = {
      title: req.matched?.title ?? req.title,
    };
    if (req.recordingId) want.recordingId = req.recordingId;
    if (req.duration !== undefined) want.duration = req.duration;
    const track = mapTrack(tracks, want);
    if (!track) {
      throw new PipelineError(
        'track_unmapped',
        `None of the ${tracks.length} tracks on ${full.title} (release ${release.foreignReleaseId}) is "${want.title}"`,
      );
    }
    const path = lidarrPathFor(deps.lidarrDownloadsDir, remoteFilename);
    const folder = posix.dirname(path);
    let candidate = (await lidarr.importCandidates(folder)).find(
      (c) => baseName(c.path) === baseName(path),
    );
    for (let i = 0; !candidate && i < 5; i++) {
      await sleep(POLL_MS);
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
      detail: `${note ? `${note}. ` : ''}Mapped to track ${track.trackNumber} "${track.title}" on ${full.title}; importing as ${candidate.quality.quality.name}`,
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
    update(requestId, { status: 'importing', detail });
  }

  /** Ready: the item lands in the asker's collection and in every watcher's; all of them hear it. */
  function finish(req: MusicRequest, detail: string): MusicRequest {
    const itemId =
      req.kind === 'track'
        ? `mb:recording:${req.recordingId}`
        : `mb:release-group:${req.releaseGroupId}`;
    for (const profile of parties(req)) {
      const item: Parameters<Stores['collection']['add']>[0] = {
        profile,
        item: itemId,
        kind: req.kind,
        title: req.title,
        artist: req.artist,
        addedBy: profile,
        source: 'request',
      };
      if (req.album) item.album = req.album;
      stores.collection.add(item);
    }
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
      return finish(live(resolved.id), `Imported ${baseName(resolved.sourceFile)}`);
    }
    const policy = parseRules(stores.rules.list(resolved.requestedBy).map((r) => r.text));
    // The song the catalogue matched is the one searched for and mapped, when it corrected the words.
    const name = resolved.matched ?? { title: resolved.title, artist: resolved.artist };
    const want: Parameters<typeof rank>[1] = {
      title: name.title,
      artist: name.artist,
      policy,
    };
    if (resolved.duration !== undefined) want.duration = resolved.duration;
    const queryInput: Parameters<typeof buildQueries>[0] = {
      title: name.title,
      artist: name.artist,
    };
    if (resolved.album) queryInput.album = resolved.album;
    const queries = buildQueries(queryInput);
    let ranked: Scored[] = [];
    let excludedCount = 0;
    const tried: string[] = [];
    for (const query of queries) {
      live(resolved.id);
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
      update(resolved.id, { status: 'finding', detail: summary });
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
    const current = live(resolved.id);
    update(current.id, {
      status: 'importing',
      detail: `Importing ${baseName(pick.candidate.filename)}`,
    });
    await importTrack(current, lidarr, pick.candidate.filename);
    return finish(live(current.id), `Imported ${baseName(pick.candidate.filename)}`);
  }

  async function runAlbum(req: MusicRequest): Promise<MusicRequest> {
    const { lidarr } = deps;
    if (!lidarr) throw new PipelineError('not_configured', 'LIDARR_URL is needed to fetch albums');
    const resolved = await resolveIds(req);
    const { artist, note } = await ensureArtist(lidarr, resolved.artistId!);
    const album = await ensureAlbum(lidarr, artist, resolved.releaseGroupId!, true);
    // A cancel that landed while the album was being added found nothing to unmonitor: check now,
    // before anything is monitored or searched (run()'s `gone` branch unmonitors as well).
    live(resolved.id);
    if (!album.monitored) await lidarr.updateAlbum({ ...album, monitored: true });
    live(resolved.id);
    await lidarr.command('AlbumSearch', { albumIds: [album.id] });
    const days = Math.round((deps.albumDeadlineMs ?? ALBUM_DEADLINE_MS) / (24 * 60 * 60_000));
    return update(resolved.id, {
      status: 'finding',
      detail: `${note ? `${note}. ` : ''}Lidarr is looking for ${album.title} (album ${album.id}); the hub checks every minute for up to ${days} days`,
      progress: {
        unit: 'songs',
        done: album.statistics?.trackFileCount ?? 0,
        total: album.statistics?.trackCount ?? 0,
      },
    });
  }

  /** Lidarr's import candidates in a folder; a folder Lidarr cannot read counts as empty. */
  async function candidatesIn(lidarr: LidarrClient, folder: string) {
    try {
      return await lidarr.importCandidates(folder);
    } catch (error) {
      log.warn(
        { folder, error: error instanceof Error ? error.message : String(error) },
        'could not list import candidates',
      );
      return [];
    }
  }

  const lastArrivalCheck = new Map<string, number>();

  /**
   * soularr fetched the album (or some of it) but Lidarr's automatic import refused the files
   * ("Has missing tracks" against another edition) and they sit in the download or failed-imports
   * folder. Lidarr lists them in `manualimport`; the hub maps each to a track on the release it
   * monitors and files them with the same explicit `ManualImport` the single path uses.
   */
  async function fileArrivals(
    lidarr: LidarrClient,
    req: MusicRequest,
    album: LidarrAlbum,
  ): Promise<{ outcome: 'nothing' | 'filed' | 'unmapped'; detail?: string }> {
    const folders = [deps.lidarrDownloadsDir, deps.lidarrFailedImportsDir].filter(
      (f): f is string => !!f,
    );
    const artistName = album.artist?.artistName ?? req.artist;
    const mine: { path: string; quality: LidarrQuality; trackId?: number }[] = [];
    for (const folder of folders) {
      for (const c of await candidatesIn(lidarr, folder)) {
        const lidarrSaysOurs = c.album?.id === album.id;
        const folderSaysOurs =
          tokenOverlap(album.title, parentName(c.path)) >= 0.6 &&
          tokenOverlap(artistName, c.path) >= 0.5;
        if (!lidarrSaysOurs && !folderSaysOurs) continue;
        const entry: (typeof mine)[number] = { path: c.path, quality: c.quality };
        if (lidarrSaysOurs && c.tracks?.length === 1) entry.trackId = c.tracks[0]!.id;
        mine.push(entry);
      }
    }
    if (mine.length === 0) return { outcome: 'nothing' };
    const full = await waitForReleases(lidarr, album);
    const release = pickRelease(full);
    if (!release)
      return { outcome: 'unmapped', detail: `Lidarr album ${full.title} has no releases` };
    const tracks = await waitForTracks(lidarr, full.id, release.id);
    const files: ManualImportFile[] = [];
    const used = new Set<number>();
    for (const file of mine) {
      const track =
        tracks.find((t) => t.id === file.trackId) ??
        mapTrack(tracks, { title: fileTitle(file.path, artistName) });
      if (!track || used.has(track.id)) continue;
      used.add(track.id);
      files.push({
        path: file.path,
        artistId: full.artistId ?? album.artistId ?? 0,
        albumId: full.id,
        albumReleaseId: release.id,
        trackIds: [track.id],
        quality: file.quality,
        disableReleaseSwitching: true,
      });
    }
    if (files.length === 0) {
      return {
        outcome: 'unmapped',
        detail: `${mine.length} file(s) for ${full.title} arrived (${mine.map((m) => baseName(m.path)).join(', ')}) but none matched a track on release ${release.foreignReleaseId}`,
      };
    }
    const command = await lidarr.manualImport(files);
    try {
      await waitForCommand(lidarr, command.id, sleep);
    } catch (error) {
      return {
        outcome: 'unmapped',
        detail: `Lidarr refused the ${files.length} file(s) that arrived for ${full.title}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return {
      outcome: 'filed',
      detail: `Filed ${files.length} file(s) that had arrived for ${full.title}: ${files.map((f) => baseName(f.path)).join(', ')}`,
    };
  }

  /** Best effort: stop Lidarr (and soularr) looking for an album nobody wants any more. */
  async function unmonitorAlbum(req: MusicRequest): Promise<string | undefined> {
    const { lidarr } = deps;
    if (!lidarr || req.kind !== 'album' || !req.releaseGroupId) return undefined;
    try {
      const album = await lidarr.albumByForeignId(req.releaseGroupId);
      if (!album) return undefined;
      if (album.monitored) await lidarr.updateAlbum({ ...album, monitored: false });
      return `Lidarr no longer monitors ${album.title}`;
    } catch (error) {
      log.warn(
        { request: req.id, error: error instanceof Error ? error.message : String(error) },
        'could not unmonitor the album',
      );
      return undefined;
    }
  }

  return {
    /**
     * Runs one request to ready, failed or (albums) finding. Never throws: a failure is written to
     * the request, and a request cancelled or removed underneath the run is left alone.
     */
    async run(id: string): Promise<MusicRequest | undefined> {
      const req = stores.requests.get(id);
      if (!req) return undefined;
      try {
        update(id, { status: 'finding' });
        return req.kind === 'track' ? await runTrack(req) : await runAlbum(req);
      } catch (error) {
        const reason = error instanceof PipelineError ? error.reason : 'error';
        const detail = error instanceof Error ? error.message : String(error);
        if (reason === 'gone') {
          log.info({ request: id, detail }, 'request stopped');
          // An album cancelled while it was being added to Lidarr: the cancel found nothing to
          // unmonitor, so the album the pipeline just added would stay monitored and soularr
          // would fetch it. Unmonitor it now that it exists.
          const stopped = stores.requests.get(id);
          if (stopped?.kind === 'album') {
            const note = await unmonitorAlbum(stopped);
            if (note) log.info({ request: id, note }, 'album unmonitored after a late cancel');
          }
          return undefined;
        }
        log.error({ request: id, reason, detail }, 'request failed');
        try {
          return update(id, { status: 'failed', reason, detail });
        } catch (second) {
          const why = second instanceof Error ? second.message : String(second);
          if (!(second instanceof PipelineError && second.reason === 'gone')) {
            log.error({ request: id, error: why }, 'could not record the failure');
          }
          return undefined;
        }
      }
    },

    /** Album requests waiting on Lidarr: ready once every track has a file, failed past the deadline. */
    async pollAlbums(): Promise<void> {
      const { lidarr } = deps;
      if (!lidarr) return;
      const waiting = stores.requests
        .listByStatus('finding')
        .filter((r) => r.kind === 'album' && r.releaseGroupId);
      const deadlineMs = deps.albumDeadlineMs ?? ALBUM_DEADLINE_MS;
      const arrivalEvery = deps.arrivalCheckMs ?? ARRIVAL_CHECK_MS;
      for (const req of waiting) {
        try {
          let album = await lidarr.albumByForeignId(req.releaseGroupId!);
          if (!album) continue;
          let total = album.statistics?.trackCount ?? 0;
          let done = album.statistics?.trackFileCount ?? 0;
          const incomplete = !(total > 0 && done >= total);
          const checked = lastArrivalCheck.get(req.id) ?? 0;
          if (incomplete && now() - checked >= arrivalEvery) {
            lastArrivalCheck.set(req.id, now());
            const arrived = await fileArrivals(lidarr, req, album);
            if (arrived.outcome === 'unmapped') {
              const note = await unmonitorAlbum(req);
              update(req.id, {
                status: 'failed',
                reason: 'import_failed',
                detail: `${arrived.detail}${note ? `; ${note}` : ''}`,
              });
              lastArrivalCheck.delete(req.id);
              continue;
            }
            if (arrived.outcome === 'filed') {
              update(req.id, { status: 'finding', detail: arrived.detail! });
              album = (await lidarr.albumByForeignId(req.releaseGroupId!)) ?? album;
              total = album.statistics?.trackCount ?? total;
              done = album.statistics?.trackFileCount ?? done;
            }
          }
          if (total > 0 && done >= total) {
            lastArrivalCheck.delete(req.id);
            await scans(req.id, lidarr, album.artistId);
            finish(req, `Lidarr imported ${done} of ${total} tracks`);
          } else if (now() - lastRequestedAt(req) > deadlineMs) {
            // Measured from the last time it was requested: a retry a week later gets a full week.
            const days = Math.round(deadlineMs / (24 * 60 * 60_000));
            const note = await unmonitorAlbum(req);
            lastArrivalCheck.delete(req.id);
            update(req.id, {
              status: 'failed',
              reason: 'not_found_in_time',
              detail: `Lidarr found ${done} of ${total} tracks in ${days} days${note ? `; ${note}` : ''}`,
            });
          } else {
            progress(req.id, { unit: 'songs', done, total });
          }
        } catch (error) {
          if (error instanceof PipelineError && error.reason === 'gone') continue;
          log.warn(
            { request: req.id, error: error instanceof Error ? error.message : String(error) },
            'album poll failed',
          );
        }
      }
    },

    /** Called when an album request is cancelled: Lidarr stops looking. Returns a detail line. */
    abandon(req: MusicRequest): Promise<string | undefined> {
      return unmonitorAlbum(req);
    },
  };
}
export type Pipeline = ReturnType<typeof createPipeline>;

export const ACTIVE_STATUSES: readonly RequestStatus[] = [
  'requested',
  'finding',
  'downloading',
  'importing',
];
