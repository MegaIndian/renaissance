/**
 * Core models. One place; every app imports these.
 * Zod schemas validate anything that crosses a boundary (server responses, storage, the hub).
 */
import { z } from 'zod';

export const ServerKind = z.enum(['jellyfin', 'subsonic']);
export type ServerKind = z.infer<typeof ServerKind>;

export const Server = z.object({
  id: z.string().min(1),
  kind: ServerKind,
  name: z.string().min(1),
  /** Base URL including scheme. Trailing slashes are removed so paths can be appended. */
  url: z.url().transform((u) => u.replace(/\/+$/, '')),
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

export const Artist = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  imageId: z.string().optional(),
});
export type Artist = z.infer<typeof Artist>;

export const Album = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artistIds: z.array(z.string()),
  artistName: z.string(),
  year: z.number().int().optional(),
  genres: z.array(z.string()).default([]),
  trackCount: z.number().int().nonnegative().optional(),
  imageId: z.string().optional(),
});
export type Album = z.infer<typeof Album>;

export const Track = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  albumId: z.string().optional(),
  albumTitle: z.string().optional(),
  artistIds: z.array(z.string()),
  artistName: z.string(),
  /** Duration in seconds. */
  duration: z.number().nonnegative(),
  trackNumber: z.number().int().optional(),
  discNumber: z.number().int().optional(),
  /** Container or codec as the server reports it, for example "flac" or "mp3". */
  codec: z.string().optional(),
  bitrate: z.number().int().nonnegative().optional(),
  isFavorite: z.boolean().default(false),
  imageId: z.string().optional(),
});
export type Track = z.infer<typeof Track>;

export const Playlist = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  trackCount: z.number().int().nonnegative(),
  imageId: z.string().optional(),
});
export type Playlist = z.infer<typeof Playlist>;

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

export const ListenEvent = z.object({
  trackId: z.string().min(1),
  serverId: z.string().min(1),
  at: z.iso.datetime(),
  completed: z.boolean(),
  skipped: z.boolean(),
  device: z.string(),
});
export type ListenEvent = z.infer<typeof ListenEvent>;
