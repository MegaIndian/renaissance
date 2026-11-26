/**
 * Core models. One place; every app imports these.
 * Zod schemas validate anything that crosses a boundary (server responses, storage, the hub).
 */
import { z } from 'zod';

import { trimTrailingSlashes } from './url';

export const ServerKind = z.enum(['jellyfin', 'subsonic']);
export type ServerKind = z.infer<typeof ServerKind>;

export const Server = z.object({
  id: z.string().min(1),
  kind: ServerKind,
  name: z.string().min(1),
  /** Base URL including scheme. Trailing slashes are removed so paths can be appended. */
  url: z.url().transform(trimTrailingSlashes),
});
export type Server = z.infer<typeof Server>;

export const Account = z.object({
  serverId: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().min(1),
  /** Simple mode is the default for every profile; advanced is a switch in Settings. */
  mode: z.enum(['simple', 'advanced']).default('simple'),
});
export type Account = z.infer<typeof Account>;

/** Per-user state the server keeps for an item (F86: each household member is their own user). */
const userFields = {
  isFavorite: z.boolean().default(false),
  playCount: z.number().int().nonnegative().default(0),
  /** ISO datetime of the last play on any client, from the server. */
  lastPlayed: z.iso.datetime({ offset: true }).optional(),
};

export const Artist = z.object({
  id: z.string().min(1),
  /** As the server gave it; empty when the file has none, and the screens say so in the user's language. */
  name: z.string(),
  imageId: z.string().optional(),
  /** Biography from the server's metadata, when it has one. */
  bio: z.string().optional(),
  albumCount: z.number().int().nonnegative().optional(),
  /**
   * Every id the server uses for this name, this item's own id included. Jellyfin keeps two
   * MusicArtist items for one artist when a library gains artist folders after the fact (one under
   * the metadata folder, one under the music folder); tracks carry one id and `/Artists` the other.
   * The snapshot merges them by name (`artists.ts`) and lists the ids here.
   */
  ids: z.array(z.string()).optional(),
  dateAdded: z.iso.datetime({ offset: true }).optional(),
  ...userFields,
});
export type Artist = z.infer<typeof Artist>;

/** One credited artist on a track or album: the id the item carries and the name beside it. */
export const ArtistCredit = z.object({ id: z.string().min(1), name: z.string() });
export type ArtistCredit = z.infer<typeof ArtistCredit>;

export const Album = z.object({
  id: z.string().min(1),
  /** As the server gave it; empty when the file has none, and the screens say so in the user's language. */
  title: z.string(),
  artistIds: z.array(z.string()),
  artistName: z.string(),
  /** The credited artists with their ids, so the artist list can be merged by name. */
  artistCredits: z.array(ArtistCredit).optional(),
  year: z.number().int().optional(),
  genres: z.array(z.string()).default([]),
  trackCount: z.number().int().nonnegative().optional(),
  /** Total duration in seconds. */
  duration: z.number().nonnegative().optional(),
  imageId: z.string().optional(),
  dateAdded: z.iso.datetime({ offset: true }).optional(),
  /** When the server last saved this item (Jellyfin `DateLastSaved`); the delta refresh's watermark. */
  lastSaved: z.iso.datetime({ offset: true }).optional(),
  ...userFields,
});
export type Album = z.infer<typeof Album>;

export const Track = z.object({
  id: z.string().min(1),
  /** As the server gave it; empty when the file has none, and the screens say so in the user's language. */
  title: z.string(),
  albumId: z.string().optional(),
  albumTitle: z.string().optional(),
  artistIds: z.array(z.string()),
  artistName: z.string(),
  /** The credited artists with their ids, so the artist list can be merged by name. */
  artistCredits: z.array(ArtistCredit).optional(),
  albumArtistName: z.string().optional(),
  /** Duration in seconds. */
  duration: z.number().nonnegative(),
  trackNumber: z.number().int().optional(),
  discNumber: z.number().int().optional(),
  /** Codec as the server reports it, lower case, for example "flac" or "mp3". */
  codec: z.string().optional(),
  /** File container, lower case, for example "flac", "mp3", "m4a". */
  container: z.string().optional(),
  bitrate: z.number().int().nonnegative().optional(),
  sampleRate: z.number().int().nonnegative().optional(),
  year: z.number().int().optional(),
  genres: z.array(z.string()).default([]),
  imageId: z.string().optional(),
  dateAdded: z.iso.datetime({ offset: true }).optional(),
  /** When the server last saved this item (Jellyfin `DateLastSaved`); the delta refresh's watermark. */
  lastSaved: z.iso.datetime({ offset: true }).optional(),
  ...userFields,
});
export type Track = z.infer<typeof Track>;

export const Playlist = z.object({
  id: z.string().min(1),
  /** As the server gave it; empty when the file has none, and the screens say so in the user's language. */
  name: z.string(),
  trackCount: z.number().int().nonnegative(),
  /** Total duration in seconds. */
  duration: z.number().nonnegative().optional(),
  imageId: z.string().optional(),
  dateAdded: z.iso.datetime({ offset: true }).optional(),
  ...userFields,
});
export type Playlist = z.infer<typeof Playlist>;

/**
 * A track inside a playlist; `entryId` is what reorder and remove address, since a track can be in a
 * playlist twice. On Jellyfin 10.10.7 the controller sets `PlaylistItemId` to the track's own id (and
 * dedupes adds), so there `entryId` equals the track id; 10.11 mints one per entry. Code never relies
 * on either: it addresses entries by whatever the server returned.
 */
export const PlaylistEntry = Track.extend({ entryId: z.string().min(1) });
export type PlaylistEntry = z.infer<typeof PlaylistEntry>;

export const Genre = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type Genre = z.infer<typeof Genre>;

export const LyricLine = z.object({
  /** Start time in milliseconds; absent for unsynced lyrics. */
  start: z.number().nonnegative().optional(),
  text: z.string(),
});

export const Lyrics = z.object({
  trackId: z.string().min(1),
  synced: z.boolean(),
  lines: z.array(LyricLine),
});
export type Lyrics = z.infer<typeof Lyrics>;

export const MixDefinition = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** One line in words saying why these songs, shown under the title. */
  reason: z.string(),
  trackIds: z.array(z.string()),
  seedImageIds: z.array(z.string()).default([]),
  /** ISO date the mix was built for; mixes are cached for the day. */
  builtFor: z.iso.date(),
});
export type MixDefinition = z.infer<typeof MixDefinition>;

export const DownloadQuality = z.enum(['original', 'capped']);

export const DownloadItem = z.object({
  trackId: z.string().min(1),
  serverId: z.string().min(1),
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  codec: z.string(),
  quality: DownloadQuality,
  hash: z.string().optional(),
  downloadedAt: z.iso.datetime(),
  pinned: z.boolean().default(false),
});
export type DownloadItem = z.infer<typeof DownloadItem>;
