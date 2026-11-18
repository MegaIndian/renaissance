/**
 * Shapes shared between the hub and the apps (ADR 0006, 0007, 0009 and 0010). The hub validates with these on
 * the way in and the apps validate with them on the way out, so one change here changes both.
 */
import { z } from 'zod';

/** Longest title, artist, album, rule or name the hub accepts. */
export const HUB_MAX_TEXT = 200;

const text = z.string().trim().min(1).max(HUB_MAX_TEXT);

// Profiles (F86, F87)

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
});
export type CatalogueSearch = z.infer<typeof CatalogueSearch>;

// Requests (F61 to F63, F87)

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
  steps: z.array(RequestStep),
});
export type MusicRequest = z.infer<typeof MusicRequest>;

// Collection (F86)

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

// Rules (F80)

export const Rule = z.object({
  id: z.number().int(),
  profile: z.string().min(1),
  text: text,
  createdAt: z.iso.datetime(),
});
export type Rule = z.infer<typeof Rule>;

// Ask (F75, F76)

export const askTools = [
  'search_library',
  'lookup_catalogue',
  'play',
  'queue',
  'make_playlist',
  'request',
  'set_rule',
  'explain',
] as const;
export const AskTool = z.enum(askTools);
export type AskTool = z.infer<typeof AskTool>;

export const AskRequest = z.object({
  text: z.string().trim().min(1).max(2000),
  language: z.enum(['en', 'gu']).optional(),
});
export type AskRequest = z.infer<typeof AskRequest>;

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

export const AskAction = z.object({
  tool: AskTool,
  /** Arguments as validated by the hub; every id comes from a tool result in the same call. */
  input: z.record(z.string(), z.unknown()),
  /**
   * One line in the question's language: what the hub did (`ranBy: hub`, past tense) or what the
   * app should do (`ranBy: app`, imperative: "Play Carefree").
   */
  summary: z.string(),
  /** For app actions: the past-tense line the app shows once it has performed the action. */
  doneSummary: z.string().optional(),
  /** Where the action ran: `hub` (done, with `result`) or `app` (the app performs it). */
  ranBy: z.enum(['hub', 'app']),
  result: z.unknown().optional(),
  undoable: z.boolean(),
  /** How to undo a hub action: the route to call. Absent for app actions. */
  undo: z.object({ method: z.literal('DELETE'), path: z.string() }).optional(),
});
export type AskAction = z.infer<typeof AskAction>;

export const AskResponse = z.object({
  /** The model id that answered, or `off` (no key, over budget, or deterministic only). */
  model: z.string(),
  language: z.enum(['en', 'gu']),
  instant: InstantResults,
  /**
   * The catalogue rows for the words typed (songs, albums, artists with art, duration and
   * `libraryId` when already on the server): the deterministic add path, present with or without
   * the model. Absent when the instant layer had an exact hit or the catalogue did not answer.
   */
  catalogue: CatalogueSearch.optional(),
  actions: z.array(AskAction),
  /** One line saying why, in the question's language. Empty when the model was off. */
  why: z.string(),
  /** Why the model was not called: `no_key`, `budget`, `deterministic`, `refusal`, `error`. */
  reason: z.string().optional(),
  /** Tool calls the hub refused: an unknown tool, bad input or an id no tool returned. */
  rejected: z.array(z.object({ tool: z.string(), reason: z.string() })),
  usage: z
    .object({
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      cacheReadTokens: z.number().int(),
      costUsd: z.number(),
    })
    .optional(),
  tools: z.array(AskTool),
});
export type AskResponse = z.infer<typeof AskResponse>;

// Budget (ADR 0007 point 6)

export const BudgetDay = z.object({
  day: z.iso.date(),
  calls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
});

export const Budget = z.object({
  model: z.string(),
  month: z.string(),
  capUsd: z.number(),
  spentUsd: z.number(),
  remainingUsd: z.number(),
  /** True when the cap is reached and the model is off until next month. */
  off: z.boolean(),
  days: z.array(BudgetDay),
});
export type Budget = z.infer<typeof Budget>;

// Events (SSE)

export const HubEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('request'), request: MusicRequest }),
  z.object({ type: z.literal('ready'), request: MusicRequest }),
  z.object({ type: z.literal('ping'), at: z.iso.datetime() }),
]);
export type HubEvent = z.infer<typeof HubEvent>;

export const HubError = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(z.unknown()).optional(),
});
export type HubError = z.infer<typeof HubError>;
