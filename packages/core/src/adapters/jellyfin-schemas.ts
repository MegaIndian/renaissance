/**
 * The slice of Jellyfin's API (10.10 and later) Renaissance reads, as Zod schemas. Only the fields
 * the mappers use are declared; unknown fields pass through untouched. Every response goes through
 * these before it becomes a model, so a server quirk fails loudly at the boundary.
 */
import { z } from 'zod';

const nullable = <T extends z.ZodType>(schema: T) => schema.nullish();

export const JfNamedId = z.object({ Id: z.string(), Name: nullable(z.string()) });

export const JfUserData = z.object({
  IsFavorite: nullable(z.boolean()),
  PlayCount: nullable(z.number()),
  LastPlayedDate: nullable(z.string()),
  PlaybackPositionTicks: nullable(z.number()),
  Played: nullable(z.boolean()),
});

export const JfMediaStream = z.object({
  Type: nullable(z.string()),
  Codec: nullable(z.string()),
  BitRate: nullable(z.number()),
  SampleRate: nullable(z.number()),
});

export const JfItem = z.object({
  Id: z.string(),
  Name: nullable(z.string()),
  Type: nullable(z.string()),
  Container: nullable(z.string()),
  RunTimeTicks: nullable(z.number()),
  IndexNumber: nullable(z.number()),
  ParentIndexNumber: nullable(z.number()),
  ProductionYear: nullable(z.number()),
  Genres: nullable(z.array(z.string())),
  DateCreated: nullable(z.string()),
  DateLastSaved: nullable(z.string()),
  Overview: nullable(z.string()),
  ChildCount: nullable(z.number()),
  AlbumId: nullable(z.string()),
  Album: nullable(z.string()),
  AlbumArtist: nullable(z.string()),
  AlbumArtists: nullable(z.array(JfNamedId)),
  Artists: nullable(z.array(z.string())),
  ArtistItems: nullable(z.array(JfNamedId)),
  AlbumPrimaryImageTag: nullable(z.string()),
  ImageTags: nullable(z.record(z.string(), z.string())),
  MediaStreams: nullable(z.array(JfMediaStream)),
  UserData: nullable(JfUserData),
  PlaylistItemId: nullable(z.string()),
});
export type JfItem = z.infer<typeof JfItem>;

export const JfItemsResult = z.object({
  Items: z.array(JfItem).default([]),
  TotalRecordCount: z.number().default(0),
});

export const JfAuthResult = z.object({
  User: z.object({ Id: z.string(), Name: z.string() }),
  AccessToken: z.string().min(1),
});

export const JfQuickConnectResult = z.object({
  Code: z.string(),
  Secret: z.string(),
  Authenticated: z.boolean().default(false),
});

export const JfPlaylistCreated = z.object({ Id: z.string() });

export const JfSocketMessage = z.object({
  MessageType: z.string(),
  Data: z.unknown().optional(),
});

/** One entry of a `UserDataChanged` push: the item and what changed for this user. */
export const JfUserDataEntry = z.object({
  ItemId: z.string(),
  IsFavorite: nullable(z.boolean()),
  PlayCount: nullable(z.number()),
  LastPlayedDate: nullable(z.string()),
});

/**
 * `UserDataChanged`'s `Data`, as 10.10.7 sends it when any device changes a favourite or plays. The
 * entries are left unparsed here and checked one by one, so one odd entry does not void the batch.
 */
export const JfUserDataChanged = z.object({
  UserDataList: z.array(z.unknown()).default([]),
});
