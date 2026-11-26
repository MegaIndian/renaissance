/**
 * Shapes shared between the hub and the apps for the one search box (F61; ADR 0006, 0007 and 0009). The hub validates with these on
 * the way in and the apps validate with them on the way out, so one change here changes both.
 */
import { z } from 'zod';

/** Longest title, artist, album, rule or name the hub accepts. */
export const HUB_MAX_TEXT = 200;

const text = z.string().trim().min(1).max(HUB_MAX_TEXT);

// Profiles: who the hub answers for a Jellyfin token

export const ProfileRole = z.enum(['admin', 'member']);
export type ProfileRole = z.infer<typeof ProfileRole>;

export const Profile = z.object({
  /** The Jellyfin user id. */
  id: z.string().min(1),
  name: z.string().min(1),
  role: ProfileRole,
  mode: z.enum(['simple', 'advanced']),
  language: z.enum(['en', 'gu']),
});
export type Profile = z.infer<typeof Profile>;

// Catalogue (F61)

export const CatalogueSong = z.object({
  /**
   * `mb:recording:<mbid>` for a MusicBrainz row, `dz:track:<id>` for a Deezer row the typeahead
   * answered before MusicBrainz could; stable across searches so the apps can key on it.
   */
  id: z.string().min(1),
  /** Absent on a Deezer row: the hub resolves it from the title and artist when the song is requested. */
  recordingId: z.uuid().optional(),
  title: z.string().min(1),
  artist: z.string().min(1),
  artistId: z.uuid().optional(),
  album: z.string().optional(),
  releaseGroupId: z.uuid().optional(),
  releaseId: z.uuid().optional(),
  /** Seconds, from MusicBrainz. */
  duration: z.number().nonnegative().optional(),
  year: z.number().int().optional(),
  art: z.url().optional(),
  /** Deezer's 30-second MP3 preview. */
  preview: z.url().optional(),
  /** Set when the hub found the same song in Jellyfin's library. */
  libraryId: z.string().optional(),
});
export type CatalogueSong = z.infer<typeof CatalogueSong>;

export const CatalogueArtist = z.object({
  id: z.string().min(1),
  artistId: z.uuid().optional(),
  name: z.string().min(1),
  disambiguation: z.string().optional(),
  art: z.url().optional(),
});
export type CatalogueArtist = z.infer<typeof CatalogueArtist>;

export const CatalogueAlbum = z.object({
  id: z.string().min(1),
  releaseGroupId: z.uuid().optional(),
  title: z.string().min(1),
  artist: z.string().min(1),
  artistId: z.uuid().optional(),
  type: z.string().optional(),
  year: z.number().int().optional(),
  art: z.url().optional(),
  libraryId: z.string().optional(),
});
export type CatalogueAlbum = z.infer<typeof CatalogueAlbum>;

export const CatalogueSearch = z.object({
  query: z.string(),
  songs: z.array(CatalogueSong),
  artists: z.array(CatalogueArtist),
  albums: z.array(CatalogueAlbum),
  /** True when the whole answer came from the hub's cache. */
  cached: z.boolean(),
  /**
   * True when MusicBrainz was not asked (the typeahead never waits for its one request a second):
   * the rows come from Deezer and the cache, and their ids are resolved when something is added.
   */
  partial: z.boolean().optional(),
  /**
   * True when a song row is the title and artist typed with no version word added. False means
   * every row is some other take, a cover or another song: the apps then offer no primary Add.
   * Absent on answers cached before the flag existed.
   */
  exact: z.boolean().optional(),
  /**
   * True when the full search (MusicBrainz) is still running for these words and the owner's
   * event stream will carry its answer as a `catalogue` event: the rows shown are provisional.
   */
  pending: z.boolean().optional(),
  /**
   * True when MusicBrainz was busy or down and the rows are Deezer's alone, none of them the song
   * typed: "the catalogue is busy, these are other versions".
   */
  busy: z.boolean().optional(),
});
export type CatalogueSearch = z.infer<typeof CatalogueSearch>;

// Requests (F61)

export const RequestKind = z.enum(['track', 'album']);
export type RequestKind = z.infer<typeof RequestKind>;

export const RequestStatus = z.enum([
  'requested',
  'finding',
  'downloading',
  'importing',
  'ready',
  'failed',
  /** Stopped by the person who asked (or an admin): no reason, no retry. */
  'cancelled',
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

/**
 * What is happening, in a shape the apps can word (DESIGN.md rule 9): a single reports a
 * percentage with an estimate from its transfer rate, an album reports songs with files.
 */
export const RequestProgress = z.object({
  unit: z.enum(['songs', 'percent']),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  etaSeconds: z.number().int().nonnegative().optional(),
});
export type RequestProgress = z.infer<typeof RequestProgress>;

export const NewRequest = z.object({
  kind: RequestKind,
  title: text,
  artist: text,
  album: text.optional(),
  recordingId: z.uuid().optional(),
  releaseGroupId: z.uuid().optional(),
  releaseId: z.uuid().optional(),
  artistId: z.uuid().optional(),
  /** Seconds, from the catalogue; the ranking step wants the file within 3 s of it. */
  duration: z.number().nonnegative().optional(),
});
export type NewRequest = z.infer<typeof NewRequest>;

/** One line per pipeline step, so a failed request can say what happened. */
export const RequestStep = z.object({
  at: z.iso.datetime(),
  status: RequestStatus,
  /** Machine-readable reason (`no_results`, `download_failed`, ...); absent on plain progress. */
  reason: z.string().optional(),
  detail: z.string().optional(),
});
export type RequestStep = z.infer<typeof RequestStep>;

export const MusicRequest = NewRequest.extend({
  id: z.uuid(),
  requestedBy: z.string().min(1),
  requestedByName: z.string().min(1),
  status: RequestStatus,
  reason: z.string().optional(),
  detail: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  progress: RequestProgress.optional(),
  /** The Soulseek path of the file that was downloaded; a retry imports it without a new download. */
  sourceFile: z.string().optional(),
  /**
   * What the catalogue matched when it differs from what was typed (a Deezer row resolved to a
   * MusicBrainz recording with another spelling or credit): the song that will actually arrive.
   */
  matched: z
    .object({
      title: z.string().min(1),
      artist: z.string().min(1),
      /** The release the file will be filed under, when it is not the album that was asked for. */
      album: z.string().min(1).optional(),
    })
    .optional(),
  /** When the request last entered `requested`: a retry sets it again, and the album deadline runs from it. */
  requestedAt: z.iso.datetime().optional(),
  /** Profiles who asked for the same thing while it was on its way; they get Ready and the item too. */
  watchers: z.array(z.string().min(1)).optional(),
  steps: z.array(RequestStep),
});
export type MusicRequest = z.infer<typeof MusicRequest>;

/**
 * What `POST /requests` answers when someone in the house is already fetching the same song or
 * album: the running request, and the caller is now one of its watchers.
 */
export const AlreadyRequested = z.object({
  alreadyRequested: z.literal(true),
  request: MusicRequest,
});
export type AlreadyRequested = z.infer<typeof AlreadyRequested>;

// Collection entries (F61 answers one; the collection itself is F86)

export const CollectionSource = z.enum(['request', 'add', 'import', 'favourite']);
export type CollectionSource = z.infer<typeof CollectionSource>;

export const CollectionItem = z.object({
  id: z.number().int(),
  profile: z.string().min(1),
  /** Jellyfin item id when the item is on the server, otherwise the catalogue id. */
  item: z.string().min(1),
  kind: RequestKind,
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  addedBy: z.string().min(1),
  addedAt: z.iso.datetime(),
  source: CollectionSource,
});
export type CollectionItem = z.infer<typeof CollectionItem>;

/** What `POST /requests` answers when the song is already on the server (F86). */
export const AlreadyHere = z.object({
  alreadyHere: z.literal(true),
  item: CollectionItem,
});
export type AlreadyHere = z.infer<typeof AlreadyHere>;

// Library hits (the hub's Jellyfin search)

export const LibraryHit = z.object({
  id: z.string().min(1),
  kind: z.enum(['track', 'album', 'artist']),
  title: z.string().min(1),
  artist: z.string().optional(),
  album: z.string().optional(),
  /** Seconds. */
  duration: z.number().nonnegative().optional(),
  imageId: z.string().optional(),
});
export type LibraryHit = z.infer<typeof LibraryHit>;

/** The deterministic layer: library hits for the words typed, before any model call. */
export const InstantResults = z.object({
  tracks: z.array(LibraryHit),
  albums: z.array(LibraryHit),
  artists: z.array(LibraryHit),
});
export type InstantResults = z.infer<typeof InstantResults>;

// Events (SSE)

export const HubEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('request'), request: MusicRequest }),
  z.object({ type: z.literal('ready'), request: MusicRequest }),
  /**
   * A full catalogue answer that arrived after the typeahead had to answer without the song by
   * the artist typed: the app shows it when `result.query` is still what the box holds.
   */
  z.object({ type: z.literal('catalogue'), result: CatalogueSearch }),
  z.object({ type: z.literal('ping'), at: z.iso.datetime() }),
]);
export type HubEvent = z.infer<typeof HubEvent>;

export const HubError = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(z.unknown()).optional(),
});
export type HubError = z.infer<typeof HubError>;

/**
 * A song title split into the song and the version named in brackets after it, so a narrow row
 * can show "Fireman" with "Chopped & Screwed" beside the artist instead of "Fireman (Chopp…":
 * `splitTitleVersion('Fireman (Chopped & Screwed)')` is `{ title: 'Fireman', version: 'Chopped &
 * Screwed' }`; a title with no such bracket, or nothing before it, has no `version`.
 */
export function splitTitleVersion(title: string): { title: string; version?: string } {
  const match = /^(.*\S)\s*[([]([^()[\]]+)[)\]]\s*$/.exec(title.trim());
  if (!match) return { title };
  return { title: match[1]!, version: match[2]!.trim() };
}
