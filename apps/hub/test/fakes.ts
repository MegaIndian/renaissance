/** In-memory slskd and Lidarr for the pipeline tests: record every write, answer like the real ones. */
import type { CatalogueAlbum, CatalogueSong } from '@renaissance/core';

import type { CatalogueService } from '../src/catalogue/service.js';
import type {
  LidarrAlbum,
  LidarrArtist,
  LidarrClient,
  LidarrMetadataProfile,
  LidarrTrack,
  ManualImportFile,
} from '../src/fetch/lidarr.js';
import type { NavidromeClient } from '../src/fetch/navidrome.js';
import type { SlskdClient, SlskdResponse, SlskdTransfer } from '../src/fetch/slskd.js';
import type { JellyfinLibrary, LibraryMatch } from '../src/jellyfin/library.js';

export const ids = {
  recording: '3f3d2a1e-5c5e-4a1a-9b1e-7f0c4a6d2b10',
  releaseGroup: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
  release: 'c0ffee00-0000-4000-8000-000000000003',
  artist: 'ac9a487a-d9d2-4f27-bb23-0f4686488345',
};

export const firemanSong: CatalogueSong = {
  id: `mb:recording:${ids.recording}`,
  recordingId: ids.recording,
  title: 'Fireman',
  artist: 'Lil Wayne',
  artistId: ids.artist,
  album: 'Tha Carter II',
  releaseGroupId: ids.releaseGroup,
  releaseId: ids.release,
  duration: 183,
  year: 2005,
};

export const carterAlbum: CatalogueAlbum = {
  id: `mb:release-group:${ids.releaseGroup}`,
  releaseGroupId: ids.releaseGroup,
  title: 'Tha Carter II',
  artist: 'Lil Wayne',
  artistId: ids.artist,
  year: 2005,
};

export const FLAC = '@@abc\\Music\\Lil Wayne\\Tha Carter II\\03 - Fireman.flac';
export const MP3 = '@@def\\Hip Hop\\Lil Wayne - Fireman.mp3';

export function response(
  username: string,
  files: Partial<SlskdResponse['files'][number]>[],
  extra: Partial<SlskdResponse> = {},
): SlskdResponse {
  return {
    username,
    hasFreeUploadSlot: true,
    uploadSpeed: 2_000_000,
    queueLength: 0,
    files: files.map((f) => ({
      filename: FLAC,
      size: 30_000_000,
      extension: 'flac',
      length: 183,
      ...f,
    })),
    ...extra,
  };
}

export function fakeSlskd(options: {
  results: Record<string, SlskdResponse[]>;
  /** Transfer states per filename, consumed one per poll; the last one repeats. */
  transfers?: Record<string, Partial<SlskdTransfer>[]>;
}) {
  const searches: string[] = [];
  const enqueued: { username: string; files: { filename: string; size: number }[] }[] = [];
  const polls = new Map<string, number>();
  const client: SlskdClient = {
    async search(text) {
      searches.push(text);
      return options.results[text] ?? [];
    },
    async enqueue(username, files) {
      enqueued.push({ username, files });
    },
    async transfers(username) {
      const mine = enqueued.filter((e) => e.username === username).flatMap((e) => e.files);
      return mine.map((f) => {
        const states = options.transfers?.[f.filename] ?? [{ state: 'Completed, Succeeded' }];
        const n = polls.get(f.filename) ?? 0;
        polls.set(f.filename, n + 1);
        const s = states[Math.min(n, states.length - 1)]!;
        return { filename: f.filename, size: f.size, state: 'InProgress', ...s };
      });
    },
  };
  return { client, searches, enqueued };
}

export function fakeLidarr(
  options: {
    singlesProfile?: boolean;
    existingArtist?: boolean;
    tracksAfterPolls?: number;
    candidateVisible?: boolean;
    commandStatus?: string;
    tracks?: Partial<LidarrTrack>[];
    releaseMonitored?: boolean;
  } = {},
) {
  const profiles: LidarrMetadataProfile[] = [
    {
      id: 1,
      name: 'Standard',
      primaryAlbumTypes: [
        { albumType: { id: 1, name: 'Album' }, allowed: true },
        { albumType: { id: 2, name: 'EP' }, allowed: false },
        { albumType: { id: 3, name: 'Single' }, allowed: false },
      ],
      secondaryAlbumTypes: [
        { albumType: { id: 1, name: 'Studio' }, allowed: true },
        { albumType: { id: 2, name: 'Live' }, allowed: true },
      ],
      releaseStatuses: [
        { releaseStatus: { id: 1, name: 'Official' }, allowed: true },
        { releaseStatus: { id: 2, name: 'Bootleg' }, allowed: true },
      ],
    },
  ];
  if (options.singlesProfile) {
    profiles.push({
      ...profiles[0]!,
      id: 3,
      name: 'Albums, EPs and singles',
      primaryAlbumTypes: profiles[0]!.primaryAlbumTypes.map((t) => ({ ...t, allowed: true })),
    });
  }
  const artists: LidarrArtist[] = options.existingArtist
    ? [
        {
          id: 7,
          artistName: 'Lil Wayne',
          foreignArtistId: ids.artist,
          metadataProfileId: 1,
          qualityProfileId: 2,
          monitored: true,
          path: '/files/media/music/Lil Wayne',
        },
      ]
    : [];
  const albums: LidarrAlbum[] = [];
  const writes: { method: string; path: string; body: unknown }[] = [];
  let nextId = 100;
  let trackPolls = 0;
  const trackList: LidarrTrack[] = (
    options.tracks ?? [
      {
        id: 3001,
        title: 'Tha Mobb',
        trackNumber: '1',
        absoluteTrackNumber: 1,
        duration: 300_000,
        hasFile: false,
        foreignRecordingId: 'other',
      },
      {
        id: 3003,
        title: 'Fireman',
        trackNumber: '3',
        absoluteTrackNumber: 3,
        duration: 183_000,
        hasFile: false,
        foreignRecordingId: ids.recording,
      },
    ]
  ).map((t) => ({
    id: 1,
    title: '',
    trackNumber: '1',
    absoluteTrackNumber: 1,
    duration: 0,
    hasFile: false,
    ...t,
  }));

  const client: LidarrClient = {
    rootFolders: async () => [
      {
        id: 1,
        path: '/files/media/music',
        defaultMetadataProfileId: 1,
        defaultQualityProfileId: 2,
      },
    ],
    metadataProfiles: async () => profiles,
    createMetadataProfile: async (p) => {
      const created = { ...p, id: nextId++ };
      profiles.push(created);
      writes.push({ method: 'POST', path: 'metadataprofile', body: p });
      return created;
    },
    artists: async () => artists,
    lookupArtist: async (mbid) => ({
      id: 0,
      artistName: 'Lil Wayne',
      foreignArtistId: mbid,
      metadataProfileId: 0,
      qualityProfileId: 0,
      monitored: false,
    }),
    addArtist: async (a) => {
      const created = { ...(a as LidarrArtist), id: nextId++ };
      artists.push(created);
      writes.push({ method: 'POST', path: 'artist', body: a });
      return created;
    },
    updateArtist: async (a) => {
      writes.push({ method: 'PUT', path: `artist/${a.id}`, body: a });
      const i = artists.findIndex((x) => x.id === a.id);
      if (i >= 0) artists[i] = a;
      return a;
    },
    albumByForeignId: async (mbid) => albums.find((a) => a.foreignAlbumId === mbid),
    album: async (id) => albums.find((a) => a.id === id)!,
    lookupAlbum: async (mbid) =>
      mbid === ids.releaseGroup
        ? {
            id: 0,
            title: 'Tha Carter II',
            foreignAlbumId: mbid,
            monitored: false,
            albumType: 'Album',
            artist: { foreignArtistId: ids.artist },
            releases: [
              {
                id: 0,
                foreignReleaseId: 'c0ffee00-0000-4000-8000-000000000099',
                title: 'Tha Carter II (UK)',
                trackCount: 22,
                monitored: !(options.releaseMonitored ?? false),
              },
              {
                id: 0,
                foreignReleaseId: ids.release,
                title: 'Tha Carter II',
                trackCount: 22,
                monitored: options.releaseMonitored ?? false,
              },
            ],
          }
        : undefined,
    addAlbum: async (a) => {
      const album = a as LidarrAlbum;
      const created: LidarrAlbum = {
        ...album,
        id: nextId++,
        releases: (album.releases ?? []).map((r) => ({ ...r, id: nextId++ })),
        artistId: album.artistId ?? 0,
      };
      albums.push(created);
      writes.push({ method: 'POST', path: 'album', body: a });
      return created;
    },
    updateAlbum: async (a) => {
      writes.push({ method: 'PUT', path: `album/${a.id}`, body: a });
      const i = albums.findIndex((x) => x.id === a.id);
      if (i >= 0) albums[i] = a;
      return a;
    },
    tracks: async () => {
      trackPolls += 1;
      return trackPolls > (options.tracksAfterPolls ?? 1) ? trackList : [];
    },
    importCandidates: async (folder) =>
      options.candidateVisible === false
        ? []
        : [
            {
              path: `${folder}/03 - Fireman.flac`,
              name: '03 - Fireman',
              size: 30_000_000,
              quality: { quality: { id: 6, name: 'FLAC' } },
              rejections: [],
            },
            {
              path: `${folder}/Lil Wayne - Fireman.mp3`,
              name: 'Lil Wayne - Fireman',
              size: 9_000_000,
              quality: { quality: { id: 3, name: 'MP3-320' } },
              rejections: [],
            },
          ],
    manualImport: async (files: ManualImportFile[]) => {
      writes.push({ method: 'POST', path: 'command', body: { name: 'ManualImport', files } });
      return { id: nextId++, name: 'ManualImport', status: 'queued' };
    },
    command: async (name, body) => {
      writes.push({ method: 'POST', path: 'command', body: { name, ...body } });
      return { id: nextId++, name, status: 'queued' };
    },
    commandStatus: async (id) => ({
      id,
      name: 'ManualImport',
      status: options.commandStatus ?? 'completed',
      ...(options.commandStatus === 'failed'
        ? { message: 'Import rejected: Has unmatched tracks' }
        : {}),
    }),
  };
  return {
    client,
    writes,
    albums,
    artists,
    profiles,
    setAlbumStats: (stats: NonNullable<LidarrAlbum['statistics']>) =>
      albums.forEach((a) => (a.statistics = stats)),
  };
}

export function fakeCatalogue(
  options: { song?: CatalogueSong | undefined; album?: CatalogueAlbum | undefined } = {
    song: firemanSong,
    album: carterAlbum,
  },
): CatalogueService {
  return {
    search: async (q) => ({
      query: q,
      songs: options.song ? [options.song] : [],
      albums: options.album ? [options.album] : [],
      artists: [],
      cached: false,
    }),
    findSong: async () => options.song,
    findAlbum: async () => options.album,
    release: async () => ({ id: ids.release, title: 'Tha Carter II' }),
  } as CatalogueService;
}

export function fakeLibrary(
  options: { configured?: boolean; found?: LibraryMatch; failRefresh?: boolean } = {},
) {
  const refreshes: number[] = [];
  const searches: string[] = [];
  const library = {
    configured: options.configured ?? true,
    find: async () => options.found,
    search: async (_token: string, text: string) => {
      searches.push(text);
      return { tracks: [], albums: [], artists: [] };
    },
    tracksByArtists: async () => [],
    refresh: async () => {
      if (options.failRefresh) throw new Error('jellyfin down');
      refreshes.push(1);
      return true;
    },
  } as unknown as JellyfinLibrary;
  return { library, refreshes, searches };
}

export function fakeNavidrome(fail = false) {
  const scans: number[] = [];
  const client = {
    startScan: async () => {
      if (fail) throw new Error('navidrome down');
      scans.push(1);
    },
    search: async () => [],
  } as unknown as NavidromeClient;
  return { client, scans };
}
