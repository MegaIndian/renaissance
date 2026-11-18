import type Anthropic from '@anthropic-ai/sdk';
import type { CatalogueSearch, InstantResults } from '@renaissance/core';
import { describe, expect, it, vi } from 'vitest';

import { createBudget } from '../src/ask/budget.js';
import { MAX_TOKENS, createEngine, detectLanguage, exactTrack, ground } from '../src/ask/engine.js';
import type { ModelClient } from '../src/ask/engine.js';
import { SYSTEM_PROMPT, renderContext } from '../src/ask/prompt.js';
import { toolDefinitions } from '../src/ask/tools.js';
import { createEventBus } from '../src/events/bus.js';
import type { JellyfinLibrary } from '../src/jellyfin/library.js';
import { recordingLogger } from '../src/log.js';
import { createRequestService } from '../src/requests/service.js';
import { carterAlbum, fakeCatalogue, firemanSong } from './fakes.js';
import { memoryStores, mom, sahil } from './helpers.js';

const instant: InstantResults = {
  tracks: [
    {
      id: 'jf-t1',
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
      album: 'Tha Carter II',
      duration: 183,
    },
    { id: 'jf-t2', kind: 'track', title: 'Hustler Musik', artist: 'Lil Wayne', duration: 250 },
  ],
  albums: [{ id: 'jf-a1', kind: 'album', title: 'Tha Carter II', artist: 'Lil Wayne' }],
  artists: [{ id: 'jf-ar1', kind: 'artist', title: 'Lil Wayne' }],
};

function message(
  content: Anthropic.ContentBlock[],
  extra: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2000,
      output_tokens: 150,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 0,
    } as Anthropic.Usage,
    ...extra,
  } as Anthropic.Message;
}

const text = (t: string): Anthropic.ContentBlock =>
  ({ type: 'text', text: t, citations: null }) as Anthropic.ContentBlock;
const tool = (name: string, input: unknown): Anthropic.ContentBlock =>
  ({ type: 'tool_use', id: `tu_${name}`, name, input }) as Anthropic.ContentBlock;

function setup(
  options: {
    reply?: Anthropic.Message | Error;
    client?: boolean;
    cap?: number;
    instant?: InstantResults;
    libraryFails?: boolean;
  } = {},
) {
  const stores = memoryStores();
  const bus = createEventBus();
  const create = vi.fn(async (_params?: Anthropic.MessageCreateParamsNonStreaming) => {
    if (options.reply instanceof Error) throw options.reply;
    return options.reply ?? message([text('Done.')]);
  });
  const client: ModelClient | undefined =
    options.client === false ? undefined : { messages: { create } };
  const library = {
    configured: true,
    find: async () => undefined,
    search: async (_token: string, q: string) => {
      if (options.libraryFails) throw new Error('jellyfin down');
      return q === 'nothing here'
        ? { tracks: [], albums: [], artists: [] }
        : (options.instant ?? instant);
    },
    refresh: async () => true,
  } as unknown as JellyfinLibrary;
  const catalogue = fakeCatalogue();
  const enqueued: string[] = [];
  const requests = createRequestService({
    stores,
    library,
    bus,
    enqueue: (id) => enqueued.push(id),
  });
  const budget = createBudget({
    usage: stores.usage,
    capUsd: options.cap ?? 10,
    model: 'claude-opus-5-5',
  });
  const log = recordingLogger();
  const engine = createEngine({
    client,
    model: 'claude-opus-5-5',
    budget,
    stores,
    library,
    catalogue,
    requests,
    log,
  });
  return { engine, create, stores, enqueued, log, budget };
}

const ask = (
  t: ReturnType<typeof setup>,
  textIn: string,
  language?: 'en' | 'gu',
  profile = sahil,
) => t.engine.ask({ profile, token: 'tok', text: textIn, ...(language ? { language } : {}) });

describe('language and the deterministic layer', () => {
  it('detects Gujarati script, honours the asked language, else the profile', () => {
    expect(detectLanguage('ગીત વગાડ', undefined, sahil)).toBe('gu');
    expect(detectLanguage('play', 'gu', sahil)).toBe('gu');
    expect(detectLanguage('play', undefined, mom)).toBe('gu');
    expect(detectLanguage('play', undefined, sahil)).toBe('en');
  });

  it('plays an exact library title without the model', async () => {
    const t = setup();
    for (const phrase of ['Fireman', 'play fireman', 'fireman vagad']) {
      const out = await ask(t, phrase);
      expect(out.model).toBe('off');
      expect(out.reason).toBe('deterministic');
      expect(out.actions).toEqual([
        {
          tool: 'play',
          input: { itemId: 'jf-t1', kind: 'track' },
          ranBy: 'app',
          undoable: true,
          summary: 'Playing Fireman',
        },
      ]);
      expect(out.why).toBe('Fireman is in your library');
    }
    expect(t.create).not.toHaveBeenCalled();
    expect(exactTrack('nope', instant)).toBeUndefined();
    const gu = await ask(t, 'fireman', 'gu');
    expect(gu.why).toBe('Fireman તમારી લાઇબ્રેરીમાં છે');
  });

  it('degrades to the instant layer without a key or past the budget', async () => {
    const noKey = setup({ client: false });
    const out = await ask(noKey, 'something calm for cooking');
    expect(out).toMatchObject({ model: 'off', reason: 'no_key', actions: [], why: '' });
    expect(out.instant.tracks).toHaveLength(2);
    expect(out.tools).toHaveLength(8);
    const broke = setup({ cap: 0 });
    const out2 = await ask(broke, 'something calm for cooking');
    expect(out2).toMatchObject({ model: 'off', reason: 'budget' });
    expect(out2.why).toContain('budget');
    expect(broke.create).not.toHaveBeenCalled();
  });

  it('keeps answering when the library is down', async () => {
    const t = setup({ libraryFails: true, reply: message([text('Nothing I can play.')]) });
    const out = await ask(t, 'anything');
    expect(out.instant).toEqual({ tracks: [], albums: [], artists: [] });
    expect(out.why).toBe('Nothing I can play.');
  });
});

describe('the model call', () => {
  it('sends the cached system prompt, strict tools, low effort and the context once', async () => {
    const t = setup({
      reply: message([
        text('Playing Hustler Musik.'),
        tool('play', { itemId: 'jf-t2', kind: 'track' }),
      ]),
    });
    t.stores.rules.add(sahil.id, 'no live versions');
    const out = await ask(t, 'play that hustler song');
    expect(t.create).toHaveBeenCalledTimes(1);
    const params = t.create.mock
      .calls[0]![0] as unknown as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBe(MAX_TOKENS);
    expect(params.system).toEqual([
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ]);
    expect(params.tools).toBe(toolDefinitions);
    expect(params.tools!.every((tl) => (tl as Anthropic.Tool).strict === true)).toBe(true);
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(params.thinking).toBeUndefined();
    const content = params.messages[0]!.content as string;
    expect(content).toContain('<context>');
    expect(content).toContain('"no live versions"');
    expect(content).toContain('jf-t2');
    expect(content).toContain(`"catalogueId":"${firemanSong.id}"`);
    expect(content.endsWith('<request>play that hustler song</request>')).toBe(true);
    expect(out.model).toBe('claude-opus-5-5');
    expect(out.actions).toEqual([
      {
        tool: 'play',
        input: { itemId: 'jf-t2', kind: 'track' },
        ranBy: 'app',
        undoable: true,
        summary: 'Playing Hustler Musik',
      },
    ]);
    expect(out.why).toBe('Playing Hustler Musik.');
    expect(out.usage).toEqual({
      inputTokens: 2000,
      outputTokens: 150,
      cacheReadTokens: 1500,
      costUsd: (2000 * 4 + 150 * 20 + 1500 * 0.2) / 1_000_000,
    });
    expect(t.budget.report(sahil.id).days[0]?.calls).toBe(1);
  });

  it('runs every hub-side tool and hands app-side tools back', async () => {
    const t = setup({
      reply: message([
        tool('search_library', { query: 'nothing here' }),
        tool('lookup_catalogue', { query: 'lil wayne', kind: 'album' }),
        tool('queue', { trackIds: ['jf-t1', 'jf-t2'] }),
        tool('make_playlist', { name: 'Drive', trackIds: ['jf-t2'] }),
        tool('request', {
          kind: 'track',
          title: 'Fireman',
          artist: 'Lil Wayne',
          catalogueId: firemanSong.id,
        }),
        tool('set_rule', { text: 'no live versions' }),
        tool('explain', { subjectId: carterAlbum.id }),
        tool('play', { itemId: 'jf-a1', kind: 'album' }),
        text('Queued two, made Drive, requested Fireman, saved the rule.\nSecond line ignored'),
      ]),
    });
    const out = await ask(
      t,
      'queue it all, make a drive playlist, get fireman, no live versions please, about tha carter ii',
    );
    expect(out.rejected).toEqual([]);
    expect(out.actions.map((a) => a.tool)).toEqual([
      'search_library',
      'lookup_catalogue',
      'queue',
      'make_playlist',
      'request',
      'set_rule',
      'explain',
      'play',
    ]);
    const [search, lookup, queue, playlist, request, rule, explain, play] = out.actions;
    expect(search).toMatchObject({
      ranBy: 'hub',
      summary: 'Searched the library for "nothing here": 0 results',
    });
    expect((lookup!.result as CatalogueSearch).songs).toEqual([]);
    expect((lookup!.result as CatalogueSearch).albums).toHaveLength(1);
    expect(lookup!.summary).toBe('Looked up "lil wayne" in the catalogue: 1 results');
    expect(queue).toMatchObject({
      ranBy: 'app',
      undoable: true,
      summary: 'Added 2 songs to the queue',
    });
    expect(playlist!.summary).toBe('Made the playlist Drive with 1 songs');
    expect(request).toMatchObject({
      ranBy: 'hub',
      undoable: true,
      summary: 'Requested Fireman by Lil Wayne',
    });
    expect(request!.undo?.path).toMatch(/^\/requests\//);
    const stored = t.stores.requests.listMine(sahil.id)[0]!;
    expect(stored).toMatchObject({
      recordingId: firemanSong.recordingId,
      releaseGroupId: firemanSong.releaseGroupId,
      duration: 183,
    });
    expect(t.enqueued).toEqual([stored.id]);
    expect(rule).toMatchObject({
      undo: { method: 'DELETE', path: `/rules/${t.stores.rules.list(sahil.id)[0]!.id}` },
      summary: 'Rule saved: "no live versions"',
    });
    expect(explain!.result).toEqual({
      subject: { title: 'Tha Carter II', artist: 'Lil Wayne' },
      source: `https://musicbrainz.org/release-group/${carterAlbum.releaseGroupId}`,
    });
    expect(play!.summary).toBe('Playing Tha Carter II');
    expect(out.why).toBe('Queued two, made Drive, requested Fireman, saved the rule.');
  });

  it('answers in Gujarati when asked in Gujarati', async () => {
    const t = setup({
      reply: message([tool('queue', { trackIds: ['jf-t1'] }), text('કતારમાં ઉમેર્યું.')]),
    });
    const out = await ask(t, 'fireman kataar ma umero', undefined, mom);
    expect(out.language).toBe('gu');
    expect(out.actions[0]?.summary).toBe('કતારમાં 1 ગીત ઉમેર્યાં');
    expect(out.why).toBe('કતારમાં ઉમેર્યું.');
    const params = t.create.mock
      .calls[0]![0] as unknown as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.messages[0]!.content as string).toContain('"language":"gu"');
  });

  it('rejects an unknown tool, a malformed input and an id no tool returned, and keeps the rest', async () => {
    const t = setup({
      reply: message([
        tool('delete_library', {}),
        tool('play', { itemId: 42 }),
        tool('play', { itemId: 'jf-made-up', kind: 'track' }),
        tool('queue', { trackIds: ['jf-t1', 'jf-made-up'] }),
        tool('request', {
          kind: 'track',
          title: 'Invented Song',
          artist: 'Nobody',
          catalogueId: null,
        }),
        tool('request', {
          kind: 'track',
          title: 'Invented Song',
          artist: 'Nobody',
          catalogueId: 'mb:recording:nope',
        }),
        tool('explain', { subjectId: 'who' }),
        tool('play', { itemId: 'jf-t1', kind: 'track' }),
        text('Here you go.'),
      ]),
    });
    const out = await ask(t, 'play something');
    expect(out.actions.map((a) => a.tool)).toEqual(['play']);
    expect(out.rejected).toEqual([
      { tool: 'delete_library', reason: 'unknown_tool' },
      { tool: 'play', reason: 'invalid_input' },
      { tool: 'play', reason: 'ungrounded_id' },
      { tool: 'queue', reason: 'ungrounded_id' },
      { tool: 'request', reason: 'ungrounded_name' },
      { tool: 'request', reason: 'ungrounded_id' },
      { tool: 'explain', reason: 'ungrounded_id' },
    ]);
    expect(t.stores.requests.listHouse()).toEqual([]);
    expect(t.log.lines.filter((l) => l.includes('tool call rejected'))).toHaveLength(7);
  });

  it("accepts a request named in the user's own words, and stores a rule in the user's words", async () => {
    const t = setup({
      reply: message([
        tool('request', {
          kind: 'album',
          title: 'Tha Carter II',
          artist: 'Lil Wayne',
          catalogueId: null,
        }),
        tool('set_rule', { text: 'Dad prefers slow songs invented by the model' }),
        text('ok'),
      ]),
    });
    const out = await ask(t, 'add tha carter ii by lil wayne and remember Dad likes the 80s ones');
    expect(out.actions[0]).toMatchObject({ tool: 'request' });
    expect(t.stores.requests.listHouse()[0]).toMatchObject({
      kind: 'album',
      title: 'Tha Carter II',
      artist: 'Lil Wayne',
    });
    expect(t.stores.rules.list(sahil.id)[0]?.text).toBe(
      'add tha carter ii by lil wayne and remember Dad likes the 80s ones',
    );
  });

  it('says already here when the song is on the server', async () => {
    const t = setup({
      reply: message([
        tool('request', {
          kind: 'track',
          title: 'Fireman',
          artist: 'Lil Wayne',
          catalogueId: firemanSong.id,
        }),
      ]),
    });
    const found = {
      item: {
        Id: 'jf-t1',
        Name: 'Fireman',
        Type: 'Audio',
        Artists: ['Lil Wayne'],
        Album: 'Tha Carter II',
      },
      hit: {
        id: 'jf-t1',
        kind: 'track',
        title: 'Fireman',
        artist: 'Lil Wayne',
        album: 'Tha Carter II',
      },
    };
    const stores = t.stores;
    const library = {
      configured: true,
      find: async () => found,
      search: async () => instant,
      refresh: async () => true,
    } as unknown as JellyfinLibrary;
    const requests = createRequestService({
      stores,
      library,
      bus: createEventBus(),
      enqueue: () => {},
    });
    const engine = createEngine({
      client: { messages: { create: t.create } },
      model: 'claude-opus-5-5',
      budget: t.budget,
      stores,
      library,
      catalogue: fakeCatalogue(),
      requests,
      log: t.log,
    });
    const out = await engine.ask({
      profile: sahil,
      token: 't',
      text: 'get me fireman by lil wayne please',
    });
    expect(out.actions[0]).toMatchObject({
      tool: 'request',
      summary: 'Fireman by Lil Wayne is already on the server. Added to your music',
    });
    expect(out.actions[0]!.undo?.path).toMatch(/^\/collection\//);
    expect(stores.collection.list(sahil.id)[0]).toMatchObject({ item: 'jf-t1', source: 'add' });
    expect(stores.requests.listHouse()).toEqual([]);
  });

  it('handles a refusal, an API error, an action that throws, and an empty answer', async () => {
    const refused = setup({ reply: message([], { stop_reason: 'refusal' }) });
    const out1 = await ask(refused, 'something odd');
    expect(out1).toMatchObject({ model: 'claude-opus-5-5', reason: 'refusal', actions: [] });
    expect(out1.why).toBe('The model declined that one');
    expect(refused.budget.report(sahil.id).days[0]?.calls).toBe(1);
    const down = setup({ reply: new Error('503 overloaded') });
    const out2 = await ask(down, 'anything');
    expect(out2).toMatchObject({ model: 'claude-opus-5-5', reason: 'error', actions: [] });
    expect(out2.why).toContain('did not answer');
    const throwing = setup({ reply: message([tool('search_library', { query: 'boom' })]) });
    const broken = createEngine({
      client: { messages: { create: throwing.create } },
      model: 'claude-opus-5-5',
      budget: throwing.budget,
      stores: throwing.stores,
      library: {
        configured: true,
        find: async () => undefined,
        search: async (_t: string, q: string) => {
          if (q === 'boom') throw new Error('x');
          return instant;
        },
        refresh: async () => true,
      } as unknown as JellyfinLibrary,
      catalogue: fakeCatalogue(),
      requests: createRequestService({
        stores: throwing.stores,
        library: { find: async () => undefined } as unknown as JellyfinLibrary,
        bus: createEventBus(),
        enqueue: () => {},
      }),
      log: throwing.log,
    });
    const out3 = await broken.ask({ profile: sahil, token: 't', text: 'find boom' });
    expect(out3.rejected).toEqual([{ tool: 'search_library', reason: 'failed' }]);
    expect(out3.why).toBe('Nothing in your library or the catalogue matches that');
    const empty = setup({ reply: message([text('   ')]) });
    expect((await ask(empty, 'hmm')).why).toBe(
      'Nothing in your library or the catalogue matches that',
    );
  });

  it('calls onInstant before the model runs', async () => {
    const stores = memoryStores();
    const seen: InstantResults[] = [];
    const t = setup();
    const engine = createEngine({
      client: { messages: { create: t.create } },
      model: 'claude-opus-5-5',
      budget: t.budget,
      stores,
      library: {
        configured: true,
        find: async () => undefined,
        search: async () => instant,
        refresh: async () => true,
      } as unknown as JellyfinLibrary,
      catalogue: fakeCatalogue(),
      requests: createRequestService({
        stores,
        library: { find: async () => undefined } as unknown as JellyfinLibrary,
        bus: createEventBus(),
        enqueue: () => {},
      }),
      log: recordingLogger(),
      onInstant: (i) => seen.push(i),
    });
    await engine.ask({ profile: sahil, token: 't', text: 'calm songs' });
    expect(seen).toEqual([instant]);
  });
});

describe('ground and renderContext', () => {
  const ctx = { profile: sahil, language: 'en' as const, instant, catalogue: undefined, rules: [] };
  it('grounds each tool shape', () => {
    expect(ground({ name: 'play', input: { itemId: 'jf-ar1', kind: 'artist' } }, ctx, 'x').ok).toBe(
      true,
    );
    expect(ground({ name: 'play', input: { itemId: 'jf-a1', kind: 'artist' } }, ctx, 'x').ok).toBe(
      false,
    );
    expect(
      ground({ name: 'make_playlist', input: { name: 'n', trackIds: ['jf-t1'] } }, ctx, 'x').ok,
    ).toBe(true);
    expect(ground({ name: 'explain', input: { subjectId: 'jf-ar1' } }, ctx, 'x').ok).toBe(true);
    expect(
      ground({ name: 'lookup_catalogue', input: { query: 'q', kind: 'any' } }, ctx, 'x').ok,
    ).toBe(true);
    const shortened = ground(
      { name: 'set_rule', input: { text: 'no live' } },
      ctx,
      'please, no live versions',
    );
    expect(shortened).toMatchObject({ ok: true, input: { text: 'no live' } });
    expect(renderContext(ctx)).toContain('"catalogue":{"songs":[],"albums":[],"artists":[]}');
  });
});
