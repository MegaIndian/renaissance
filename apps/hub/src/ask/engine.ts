/**
 * The intent engine (F76, ADR 0010). One model call per utterance, strict tools, and a grounding
 * check the model cannot talk its way past: every id, title and artist in an action must be in the
 * context the hub built (library search, catalogue lookup) or in the user's words. Deterministic
 * paths first: an exact library title match plays without the model and skips the catalogue; the
 * catalogue rows (the add path) are in every other answer; no key or no budget means the instant
 * layer and the catalogue alone, with `model: "off"`.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { i18n as I18n } from 'i18next';

import type {
  AskAction,
  AskResponse,
  CatalogueSearch,
  InstantResults,
  NewRequest,
  Profile,
} from '@renaissance/core';
import { askTools } from '@renaissance/core';
import { createI18n } from '@renaissance/core/i18n';

import { LimiterBusyError } from '../catalogue/rate-limiter.js';
import { isSongTyped, relevantRows } from '../catalogue/relevance.js';
import { limitRows } from '../catalogue/service.js';
import type { CatalogueService } from '../catalogue/service.js';
import type { Stores } from '../db/index.js';
import type { JellyfinLibrary } from '../jellyfin/library.js';
import type { Logger } from '../log.js';
import type { RequestService } from '../requests/service.js';
import { COMMAND, COMMAND_END, hasGujarati, looksLikeSentence, normalize } from '../text.js';
import type { BudgetMeter } from './budget.js';
import { SYSTEM_PROMPT, userMessage } from './prompt.js';
import type { GroundingContext } from './prompt.js';
import { isToolName, toolDefinitions, toolInputs } from './tools.js';
import type { ToolInput, ToolName } from './tools.js';

/** The slice of the Anthropic client the engine uses; tests pass a fake. */
export interface ModelClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface EngineDeps {
  client: ModelClient | undefined;
  model: string;
  budget: BudgetMeter;
  stores: Stores;
  library: JellyfinLibrary;
  catalogue: CatalogueService;
  requests: RequestService;
  log: Logger;
  /** Called with the instant results before the model runs (the streaming route sends them). */
  onInstant?: (instant: InstantResults) => void;
}

export interface AskInput {
  profile: Profile;
  token: string;
  text: string;
  language?: 'en' | 'gu';
}

export const MAX_TOKENS = 1024;

export function detectLanguage(
  text: string,
  asked: 'en' | 'gu' | undefined,
  profile: Profile,
): 'en' | 'gu' {
  if (asked) return asked;
  if (hasGujarati(text)) return 'gu';
  return profile.language;
}

/** "play X" / "X vagad" → "x": the title the words ask for, without the command around it. */
export function stripCommand(text: string): string {
  let words = normalize(text);
  // "can you please get me …": every leading command phrase goes, one after another.
  for (let m = COMMAND.exec(words); m && m[0].length < words.length; m = COMMAND.exec(words)) {
    words = words.slice(m[0].length).trim();
  }
  return words
    .replace(COMMAND_END, '')
    .replace(/\s+please$/, '')
    .trim();
}

/** "play X" / "X vagad" with X exactly a library track title: no model needed. */
export function exactTrack(text: string, instant: InstantResults) {
  const stripped = stripCommand(text);
  return instant.tracks.find((t) => normalize(t.title) === stripped);
}

/** Library hits for the raw words and for the stripped title, in one list, no duplicates. */
export function unionInstant(a: InstantResults, b: InstantResults): InstantResults {
  const merge = (x: InstantResults['tracks'], y: InstantResults['tracks']) => {
    const seen = new Set(x.map((h) => h.id));
    return [...x, ...y.filter((h) => !seen.has(h.id) && seen.add(h.id))];
  };
  return {
    tracks: merge(a.tracks, b.tracks),
    albums: merge(a.albums, b.albums),
    artists: merge(a.artists, b.artists),
  };
}

/** Two catalogue answers as one: the first's rows lead, the second's follow, each row once. */
export function mergeCatalogue(first: CatalogueSearch, second: CatalogueSearch): CatalogueSearch {
  const merge = <T extends { id: string }>(x: T[], y: T[]): T[] => {
    const seen = new Set(x.map((r) => r.id));
    return [...x, ...y.filter((r) => !seen.has(r.id) && seen.add(r.id))];
  };
  const merged: CatalogueSearch = {
    ...first,
    songs: merge(first.songs, second.songs),
    albums: merge(first.albums, second.albums),
    artists: merge(first.artists, second.artists),
    cached: first.cached && second.cached,
  };
  if (first.partial || second.partial) merged.partial = true;
  return merged;
}

const i18nByLanguage = new Map<'en' | 'gu', I18n>();
function t(language: 'en' | 'gu', key: string, values?: Record<string, unknown>): string {
  let instance = i18nByLanguage.get(language);
  if (!instance) {
    instance = createI18n(language);
    i18nByLanguage.set(language, instance);
  }
  return instance.t(key, values ?? {});
}

/** The ids the model may use, from the context of this call only. */
export function groundingIds(ctx: GroundingContext) {
  const tracks = new Set(ctx.instant.tracks.map((x) => x.id));
  const albums = new Set(ctx.instant.albums.map((x) => x.id));
  const artists = new Set(ctx.instant.artists.map((x) => x.id));
  const catalogue = new Map<string, { title: string; artist: string }>();
  for (const s of ctx.catalogue?.songs ?? [])
    catalogue.set(s.id, { title: s.title, artist: s.artist });
  for (const a of ctx.catalogue?.albums ?? [])
    catalogue.set(a.id, { title: a.title, artist: a.artist });
  for (const a of ctx.catalogue?.artists ?? [])
    catalogue.set(a.id, { title: a.name, artist: a.name });
  return { tracks, albums, artists, catalogue };
}

export type Grounded =
  | { ok: true; tool: ToolName; input: ToolInput<ToolName> }
  | { ok: false; tool: string; reason: string };

/** Zod check, then the never-invent check. Pure, so the fixtures can hit every branch. */
export function ground(
  block: { name: string; input: unknown },
  ctx: GroundingContext,
  text: string,
): Grounded {
  if (!isToolName(block.name)) return { ok: false, tool: block.name, reason: 'unknown_tool' };
  const parsed = toolInputs[block.name].safeParse(block.input);
  if (!parsed.success) return { ok: false, tool: block.name, reason: 'invalid_input' };
  const ids = groundingIds(ctx);
  const words = normalize(text);
  const input = parsed.data;
  switch (block.name) {
    case 'play': {
      const p = input as ToolInput<'play'>;
      const set = p.kind === 'track' ? ids.tracks : p.kind === 'album' ? ids.albums : ids.artists;
      if (!set.has(p.itemId)) return { ok: false, tool: block.name, reason: 'ungrounded_id' };
      break;
    }
    case 'queue':
    case 'make_playlist': {
      const q = input as ToolInput<'queue'>;
      if (!q.trackIds.every((id) => ids.tracks.has(id)))
        return { ok: false, tool: block.name, reason: 'ungrounded_id' };
      break;
    }
    case 'request': {
      const r = input as ToolInput<'request'>;
      if (r.catalogueId) {
        const entry = ids.catalogue.get(r.catalogueId);
        if (!entry) return { ok: false, tool: block.name, reason: 'ungrounded_id' };
        break;
      }
      const inWords = words.includes(normalize(r.title)) && words.includes(normalize(r.artist));
      const inCatalogue = [...ids.catalogue.values()].some(
        (e) =>
          normalize(e.title) === normalize(r.title) && normalize(e.artist) === normalize(r.artist),
      );
      if (!inWords && !inCatalogue)
        return { ok: false, tool: block.name, reason: 'ungrounded_name' };
      break;
    }
    case 'explain': {
      const e = input as ToolInput<'explain'>;
      const known =
        ids.tracks.has(e.subjectId) ||
        ids.albums.has(e.subjectId) ||
        ids.artists.has(e.subjectId) ||
        ids.catalogue.has(e.subjectId);
      if (!known) return { ok: false, tool: block.name, reason: 'ungrounded_id' };
      break;
    }
    case 'set_rule': {
      // The rule is stored in the user's words: the model may only shorten them.
      const s = input as ToolInput<'set_rule'>;
      if (!words.includes(normalize(s.text)))
        (input as { text: string }).text = text.trim().slice(0, 200);
      break;
    }
    default:
      break;
  }
  return { ok: true, tool: block.name, input };
}

export function createEngine(deps: EngineDeps) {
  const { stores, library, catalogue, requests, budget, log } = deps;

  function describe(
    ctx: GroundingContext,
    id: string,
  ): { title: string; artist?: string } | undefined {
    const hit = [...ctx.instant.tracks, ...ctx.instant.albums, ...ctx.instant.artists].find(
      (x) => x.id === id,
    );
    if (hit) return hit.artist ? { title: hit.title, artist: hit.artist } : { title: hit.title };
    const song = ctx.catalogue?.songs.find((s) => s.id === id);
    if (song) return { title: song.title, artist: song.artist };
    const album = ctx.catalogue?.albums.find((a) => a.id === id);
    if (album) return { title: album.title, artist: album.artist };
    const artist = ctx.catalogue?.artists.find((a) => a.id === id);
    return artist ? { title: artist.name } : undefined;
  }

  async function execute(
    grounded: Extract<Grounded, { ok: true }>,
    ctx: GroundingContext,
    input: AskInput,
    language: 'en' | 'gu',
  ): Promise<AskAction> {
    const { tool } = grounded;
    switch (tool) {
      case 'search_library': {
        const { query } = grounded.input as ToolInput<'search_library'>;
        const result = await library.search(input.token, query);
        const count = result.tracks.length + result.albums.length + result.artists.length;
        return {
          tool,
          input: grounded.input,
          ranBy: 'hub',
          result,
          undoable: false,
          summary: t(language, 'hub.summary.searchLibrary', { query, count }),
        };
      }
      case 'lookup_catalogue': {
        const { query, kind } = grounded.input as ToolInput<'lookup_catalogue'>;
        const full = await catalogue.search(query);
        const result: CatalogueSearch = {
          ...full,
          songs: kind === 'any' || kind === 'song' ? full.songs : [],
          albums: kind === 'any' || kind === 'album' ? full.albums : [],
          artists: kind === 'any' || kind === 'artist' ? full.artists : [],
        };
        const count = result.songs.length + result.albums.length + result.artists.length;
        return {
          tool,
          input: grounded.input,
          ranBy: 'hub',
          result,
          undoable: false,
          summary: t(language, 'hub.summary.lookupCatalogue', { query, count }),
        };
      }
      case 'request': {
        const r = grounded.input as ToolInput<'request'>;
        const song = ctx.catalogue?.songs.find((s) => s.id === r.catalogueId);
        const album = ctx.catalogue?.albums.find((a) => a.id === r.catalogueId);
        const newRequest: NewRequest = { kind: r.kind, title: r.title, artist: r.artist };
        if (song) {
          newRequest.kind = 'track';
          newRequest.title = song.title;
          newRequest.artist = song.artist;
          if (song.recordingId) newRequest.recordingId = song.recordingId;
          if (song.releaseGroupId) newRequest.releaseGroupId = song.releaseGroupId;
          if (song.releaseId) newRequest.releaseId = song.releaseId;
          if (song.artistId) newRequest.artistId = song.artistId;
          if (song.duration !== undefined) newRequest.duration = song.duration;
          if (song.album) newRequest.album = song.album;
        } else if (album) {
          newRequest.kind = 'album';
          newRequest.title = album.title;
          newRequest.artist = album.artist;
          if (album.releaseGroupId) newRequest.releaseGroupId = album.releaseGroupId;
          if (album.artistId) newRequest.artistId = album.artistId;
        }
        const created = await requests.create(input.profile, newRequest);
        if (created.kind === 'duplicate') {
          // Someone already asked: nothing new to undo. The asker is a watcher now (design W).
          const mine = created.request.requestedBy === input.profile.id;
          return {
            tool,
            input: grounded.input,
            ranBy: 'hub',
            result: { alreadyRequested: true, request: created.request },
            undoable: false,
            summary: t(
              language,
              mine ? 'hub.summary.alreadyRequestedMine' : 'hub.summary.alreadyRequested',
              {
                title: created.request.title,
                artist: created.request.artist,
                name: created.request.requestedByName,
              },
            ),
          };
        }
        if (created.kind === 'already') {
          return {
            tool,
            input: grounded.input,
            ranBy: 'hub',
            result: created.already,
            undoable: true,
            undo: { method: 'DELETE', path: `/collection/${created.already.item.id}` },
            summary: t(language, 'hub.summary.alreadyHere', {
              title: created.already.item.title,
              artist: created.already.item.artist,
            }),
          };
        }
        return {
          tool,
          input: grounded.input,
          ranBy: 'hub',
          result: created.request,
          undoable: true,
          undo: { method: 'DELETE', path: `/requests/${created.request.id}` },
          summary: t(language, 'hub.summary.requested', {
            title: created.request.title,
            artist: created.request.artist,
          }),
        };
      }
      case 'set_rule': {
        const { text } = grounded.input as ToolInput<'set_rule'>;
        const rule = stores.rules.add(input.profile.id, text);
        return {
          tool,
          input: grounded.input,
          ranBy: 'hub',
          result: rule,
          undoable: true,
          undo: { method: 'DELETE', path: `/rules/${rule.id}` },
          summary: t(language, 'hub.summary.ruleSaved', { text }),
        };
      }
      case 'explain': {
        const { subjectId } = grounded.input as ToolInput<'explain'>;
        const subject = describe(ctx, subjectId);
        const source = subjectId.startsWith('mb:')
          ? `https://musicbrainz.org/${subjectId.split(':')[1]}/${subjectId.split(':')[2]}`
          : undefined;
        return {
          tool,
          input: grounded.input,
          ranBy: 'hub',
          result: { subject, source },
          undoable: false,
          summary: t(language, 'hub.summary.explain', { title: subject?.title ?? '' }),
        };
      }
      // App-side actions are worded before they run (imperative) and carry the past-tense line
      // the app shows once it has done them (design G): the hub never claims something played.
      case 'play': {
        const { itemId } = grounded.input as ToolInput<'play'>;
        const subject = describe(ctx, itemId);
        return {
          tool,
          input: grounded.input,
          ranBy: 'app',
          undoable: true,
          summary: t(language, 'hub.summary.play', { title: subject?.title ?? '' }),
          doneSummary: t(language, 'hub.summary.played', { title: subject?.title ?? '' }),
        };
      }
      case 'queue': {
        const { trackIds } = grounded.input as ToolInput<'queue'>;
        return {
          tool,
          input: grounded.input,
          ranBy: 'app',
          undoable: true,
          summary: t(language, 'hub.summary.queue', { count: trackIds.length }),
          doneSummary: t(language, 'hub.summary.queued', { count: trackIds.length }),
        };
      }
      case 'make_playlist': {
        const { name, trackIds } = grounded.input as ToolInput<'make_playlist'>;
        return {
          tool,
          input: grounded.input,
          ranBy: 'app',
          undoable: true,
          summary: t(language, 'hub.summary.playlist', { name, count: trackIds.length }),
          doneSummary: t(language, 'hub.summary.playlistMade', { name, count: trackIds.length }),
        };
      }
    }
  }

  return {
    async ask(input: AskInput): Promise<AskResponse> {
      const language = detectLanguage(input.text, input.language, input.profile);
      const base = { language, rejected: [] as AskResponse['rejected'], tools: [...askTools] };
      // The instant layer: the words as typed and the title inside them ("play carefree",
      // "carefree vagad"), so a command around a library title still finds it.
      const empty: InstantResults = { tracks: [], albums: [], artists: [] };
      const searchLibrary = (words: string): Promise<InstantResults> =>
        library.search(input.token, words).catch((error: unknown) => {
          log.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'instant layer failed',
          );
          return empty;
        });
      const stripped = stripCommand(input.text);
      const [raw, byTitle] = await Promise.all([
        searchLibrary(input.text),
        stripped && stripped !== normalize(input.text) ? searchLibrary(stripped) : empty,
      ]);
      const instant = unionInstant(raw, byTitle);
      deps.onInstant?.(instant);

      // Deterministic first (ADR 0007 point 3): an exact title in the library plays at once, and
      // the catalogue is not asked (one MusicBrainz slot saved per such ask).
      const exact = exactTrack(input.text, instant);
      if (exact) {
        return {
          ...base,
          model: 'off',
          reason: 'deterministic',
          instant,
          actions: [
            {
              tool: 'play',
              input: { itemId: exact.id, kind: 'track' },
              ranBy: 'app',
              undoable: true,
              summary: t(language, 'hub.summary.play', { title: exact.title }),
              doneSummary: t(language, 'hub.summary.played', { title: exact.title }),
            },
          ],
          why: t(language, 'hub.why.exact', { title: exact.title }),
        };
      }
      // The catalogue rows are the add path with or without the model (design A). They are asked
      // about the title inside the words ("get me fireman by lil wayne" asks about "fireman lil
      // wayne"), and the rows that do not answer those words are pruned (design Q). When the
      // MusicBrainz queue is full the Deezer rows stand in rather than nothing.
      // The words as typed too, when a command was stripped: "play that funky music" is a title
      // as well as a command, and the catalogue for the whole phrase finds Wild Cherry where the
      // stripped "that funky music" finds another song first (functionality V). The rows for the
      // whole phrase lead, the rest follow without duplicates.
      const query = stripCommand(input.text) || input.text;
      const who = { owner: input.profile.id };
      const lookup = (words: string): Promise<CatalogueSearch | undefined> =>
        catalogue.search(words, who).catch(async (error: unknown) => {
          // The queue is full, or MusicBrainz is over its share (503 past the client's retries)
          // or down: the Deezer rows stand in, marked partial, rather than an empty panel. When
          // none of them is the song typed they are other versions, and the answer says so
          // (`busy`), so the app offers no primary Add on a radio edit or a live take and shows
          // the "catalogue was busy" line instead (functionality Y, design AM).
          if (!(error instanceof LimiterBusyError)) {
            log.warn(
              { error: error instanceof Error ? error.message : String(error) },
              'catalogue lookup failed; answering from the typeahead rows',
            );
          }
          const fast = await catalogue.search(words, { ...who, fast: true }).catch(() => undefined);
          if (!fast || isSongTyped(words, fast)) return fast;
          const { pending: _pending, ...rows } = fast;
          return { ...rows, busy: true, exact: false };
        });
      // The phrase as typed is looked up when one word was stripped ("play that funky music"):
      // "can you please get me …" is never part of a title, and a whole sentence sent to
      // MusicBrainz costs seconds and lists the rows that merely name the artist first.
      const typed = normalize(input.text);
      const oneWordCommand =
        query !== typed && typed.split(' ').length === query.split(' ').length + 1;
      const [forTitle, forPhrase] = await Promise.all([
        lookup(query),
        oneWordCommand ? lookup(input.text) : Promise.resolve(undefined),
      ]);
      // Merged, the rows are pruned and ordered for the title once more, so a phrase row that only
      // names the artist ("Lil Wayne Fireman" by DJ Symphony) goes when the song by the artist is
      // there; the title lookup's own rows, already pruned for these words, are never taken away.
      // The merge is cut to the row limits like any one answer (functionality AB).
      const merged =
        forPhrase && forTitle
          ? limitRows(
              mergeCatalogue(relevantRows(query, mergeCatalogue(forPhrase, forTitle)), forTitle),
            )
          : (forTitle ?? forPhrase);
      const cat: CatalogueSearch | undefined = merged
        ? { ...merged, exact: !merged.busy && isSongTyped(query, merged) }
        : undefined;
      const withCatalogue = cat ? { catalogue: cat } : {};
      const rows = cat ? cat.songs.length + cat.albums.length + cat.artists.length : 0;
      const hits = instant.tracks.length + instant.albums.length + instant.artists.length;
      // Without a key, a sentence ("play something calm for cooking") gets the one line that says
      // smart answers are off and what still works; a request whose rows answer it already
      // ("can you please get me fireman by lil wayne") gets the rows and no such line; a name that
      // matched nothing gets nothing here, and the app says nothing matches (design Q).
      if (!deps.client)
        return {
          ...base,
          ...withCatalogue,
          model: 'off',
          reason: 'no_key',
          instant,
          actions: [],
          why:
            looksLikeSentence(input.text) && rows + hits === 0 ? t(language, 'ask.modelOff') : '',
        };
      const reservation = budget.reserve();
      if (!reservation)
        return {
          ...base,
          ...withCatalogue,
          model: 'off',
          reason: 'budget',
          instant,
          actions: [],
          why: t(language, 'hub.why.budget'),
        };

      const ctx: GroundingContext = {
        profile: input.profile,
        language,
        instant,
        catalogue: cat,
        rules: stores.rules.list(input.profile.id),
      };
      let message: Anthropic.Message;
      try {
        message = await deps.client.messages.create({
          model: deps.model,
          max_tokens: MAX_TOKENS,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: toolDefinitions,
          tool_choice: { type: 'auto' },
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: userMessage(ctx, input.text) }],
        });
      } catch (error) {
        reservation.release();
        log.error(
          { error: error instanceof Error ? error.message : String(error) },
          'model call failed',
        );
        return {
          ...base,
          ...withCatalogue,
          model: deps.model,
          reason: 'error',
          instant,
          actions: [],
          why: t(language, 'hub.why.error'),
        };
      }
      const usage = budget.record(input.profile.id, message.usage, reservation);
      const usageOut = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        costUsd: usage.costUsd,
      };
      if (message.stop_reason === 'refusal') {
        return {
          ...base,
          ...withCatalogue,
          model: deps.model,
          reason: 'refusal',
          instant,
          actions: [],
          why: t(language, 'hub.why.refusal'),
          usage: usageOut,
        };
      }
      const actions: AskAction[] = [];
      let why = '';
      for (const block of message.content) {
        if (block.type === 'text') {
          const line =
            block.text
              .trim()
              .split('\n')
              .find((l) => l.trim().length > 0) ?? '';
          if (!why) why = line.slice(0, 200);
        } else if (block.type === 'tool_use') {
          const grounded = ground({ name: block.name, input: block.input }, ctx, input.text);
          if (!grounded.ok) {
            base.rejected.push({ tool: grounded.tool, reason: grounded.reason });
            log.warn({ tool: grounded.tool, reason: grounded.reason }, 'tool call rejected');
            continue;
          }
          try {
            actions.push(await execute(grounded, ctx, input, language));
          } catch (error) {
            base.rejected.push({ tool: grounded.tool, reason: 'failed' });
            log.error(
              {
                tool: grounded.tool,
                error: error instanceof Error ? error.message : String(error),
              },
              'action failed',
            );
          }
        }
      }
      if (!why && actions.length === 0) why = t(language, 'hub.why.nothing');
      return {
        ...base,
        ...withCatalogue,
        model: deps.model,
        instant,
        actions,
        why,
        usage: usageOut,
      };
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
