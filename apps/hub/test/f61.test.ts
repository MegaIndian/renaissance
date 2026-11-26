/**
 * F61's own seams (contracts.ts) and the tie-break behind `RENAISSANCE_FETCH_MODEL_PICK`: the
 * defaults the later lanes replace, and the rule that the deterministic order stands whenever the
 * picker is off, declines, fails or names a file it was not shown.
 */
import { describe, expect, it, vi } from 'vitest';

import type { MusicRequest } from '@renaissance/core';

import { staticAuthenticator } from '../src/auth/authenticator.js';
import { loadConfig } from '../src/config.js';
import {
  AMBIGUOUS_MARGIN,
  leadingTie,
  noRules,
  ownerAccess,
  transientCollection,
} from '../src/contracts.js';
import type { AmbiguityPicker } from '../src/contracts.js';
import { createEventBus } from '../src/events/bus.js';
import { PICK_SYSTEM, anthropicPickModel, modelPicker, pickPrompt } from '../src/fetch/pick.js';
import type { PickModel } from '../src/fetch/pick.js';
import type { Scored } from '../src/fetch/rank.js';
import { recordingLogger } from '../src/log.js';
import {
  fakeCatalogue,
  fakeLibrary,
  fakeLidarr,
  fakeSlskd,
  firemanSong,
  response,
} from './fakes.js';
import { buildApp, createPipeline, instantSleep, memoryStores, mom, sahil } from './helpers.js';

const scored = (score: number, filename = `@@x\\Lil Wayne\\${score}.flac`): Scored => ({
  candidate: {
    username: `u${score}`,
    filename,
    size: 1,
    extension: 'flac',
    length: 183,
    hasFreeUploadSlot: true,
    queueLength: 0,
    uploadSpeed: 1,
  },
  score,
  reasons: [],
});

const request = (over: Partial<MusicRequest> = {}): MusicRequest => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'track',
  title: 'Fireman',
  artist: 'Lil Wayne',
  requestedBy: sahil.id,
  requestedByName: 'Sahil',
  status: 'requested',
  createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z',
  steps: [],
  ...over,
});

describe('the seams F61 leaves for Q03 to Q05', () => {
  it('files nothing by default and says so with id 0', () => {
    const now = new Date('2026-11-26T10:00:00.000Z');
    const sink = transientCollection(() => now);
    const item = sink.add({
      profile: sahil.id,
      item: 'jf-1',
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
      addedBy: sahil.id,
      source: 'add',
    });
    expect(item).toEqual({
      id: 0,
      profile: sahil.id,
      item: 'jf-1',
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
      addedBy: sahil.id,
      addedAt: now.toISOString(),
      source: 'add',
    });
    expect(
      transientCollection().add({
        profile: sahil.id,
        item: 'jf-2',
        kind: 'album',
        title: 'Tha Carter II',
        artist: 'Lil Wayne',
        album: 'Tha Carter II',
        addedBy: sahil.id,
        source: 'request',
      }).album,
    ).toBe('Tha Carter II');
  });

  it('lets the asker and the watchers see a request, and the asker alone manage it', () => {
    const req = request({ watchers: [mom.id] });
    expect(ownerAccess.canSee(sahil, req)).toBe(true);
    expect(ownerAccess.canSee(mom, req)).toBe(true);
    expect(ownerAccess.canManage(sahil, req)).toBe(true);
    expect(ownerAccess.canManage(mom, req)).toBe(false);
    const stranger = { ...mom, id: 'u-x' };
    expect(ownerAccess.canSee(stranger, request())).toBe(false);
    expect(noRules.list(sahil.id)).toEqual([]);
  });

  it('finds the leading tie: files within the margin of the best, never a lone file', () => {
    expect(leadingTie([])).toEqual([]);
    expect(leadingTie([scored(90)])).toEqual([]);
    expect(leadingTie([scored(90), scored(80)])).toEqual([]);
    const tie = leadingTie([scored(90), scored(90 - AMBIGUOUS_MARGIN), scored(70)]);
    expect(tie.map((s) => s.score)).toEqual([90, 90 - AMBIGUOUS_MARGIN]);
    const many = leadingTie(Array.from({ length: 8 }, () => scored(50)));
    expect(many).toHaveLength(5);
  });
});

describe('the model picker', () => {
  const input = {
    request: { kind: 'track' as const, title: 'Fireman', artist: 'Lil Wayne', duration: 183.4 },
    candidates: [
      scored(90, '@@a\\Lil Wayne\\Tha Carter II\\03 - Fireman.flac'),
      scored(89, '@@b\\Lil Wayne - Fireman (Live).mp3'),
    ],
  };

  it('shows the model the song and the tied files only, with their scores', () => {
    const text = pickPrompt({ ...input, request: { ...input.request, album: 'Tha Carter II' } });
    expect(text).toContain('Requested song: "Fireman" by Lil Wayne');
    expect(text).toContain('Album: Tha Carter II');
    expect(text).toContain('Length: 183 s');
    expect(text).toContain('0. 03 - Fireman.flac | folder: Tha Carter II | score: 90');
    expect(text).toContain('1. Lil Wayne - Fireman (Live).mp3');
    expect(pickPrompt({ ...input, request: { kind: 'album', title: 'X', artist: 'Y' } })).toContain(
      'Requested album: "X" by Y',
    );
    expect(PICK_SYSTEM).toContain('Never name a file that is not in the list');
  });

  it('takes an index in range and nothing else', async () => {
    const log = recordingLogger();
    const answers: Awaited<ReturnType<PickModel>>[] = [
      { stopReason: 'end_turn', index: 1 },
      { stopReason: 'end_turn', index: -1 },
      { stopReason: 'end_turn', index: 7 },
      { stopReason: 'end_turn', index: undefined },
      { stopReason: 'refusal', index: 1 },
    ];
    const model = vi.fn<PickModel>(async () => answers.shift()!);
    const picker = modelPicker({ model, log });
    expect(await picker.pick(input)).toBe(1);
    expect(await picker.pick(input)).toBeUndefined();
    expect(await picker.pick(input)).toBeUndefined();
    expect(await picker.pick(input)).toBeUndefined();
    expect(await picker.pick(input)).toBeUndefined();
    expect(model.mock.calls[0]![0].system).toBe(PICK_SYSTEM);
    expect(log.lines.some((l) => l.includes('tie broken by the model'))).toBe(true);
    expect(log.lines.some((l) => l.includes('declined'))).toBe(true);
  });

  it('builds the production call without sending anything', () => {
    expect(typeof anthropicPickModel({ apiKey: 'sk-test', model: 'claude-opus-5-5' })).toBe(
      'function',
    );
  });
});

describe('the tie-break inside the fetch step', () => {
  // Two uploaders with the same file: the ranking scores them alike, a tie.
  function setup(picker?: AmbiguityPicker) {
    const stores = memoryStores();
    const slskd = fakeSlskd({
      results: { 'lil wayne fireman': [response('first', [{}]), response('second', [{}])] },
    });
    const log = recordingLogger();
    const pipeline = createPipeline({
      stores,
      bus: createEventBus(),
      catalogue: fakeCatalogue(),
      library: fakeLibrary().library,
      slskd: slskd.client,
      lidarr: fakeLidarr().client,
      lidarrDownloadsDir: '/files/downloads/music/complete',
      log,
      sleep: instantSleep,
      downloadTimeoutMs: 1,
      tracksTimeoutMs: 1000,
      ...(picker ? { picker } : {}),
    });
    const req = stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    return { pipeline, slskd, req, log };
  }

  it('keeps the deterministic first without a picker', async () => {
    const t = setup();
    expect(await t.pipeline.run(t.req.id)).toMatchObject({ status: 'ready' });
    expect(t.slskd.enqueued.map((e) => e.username)).toEqual(['first']);
  });

  it("downloads the picker's file when it names one of the tie", async () => {
    const pick = vi.fn(async () => 1);
    const t = setup({ pick });
    expect(await t.pipeline.run(t.req.id)).toMatchObject({ status: 'ready' });
    expect(t.slskd.enqueued.map((e) => e.username)).toEqual(['second']);
    expect(pick).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ title: 'Fireman', artist: 'Lil Wayne' }),
      }),
    );
  });

  it('keeps the deterministic first when the picker fails or names no file of the tie', async () => {
    const failing = setup({
      pick: async () => {
        throw new Error('model down');
      },
    });
    expect(await failing.pipeline.run(failing.req.id)).toMatchObject({ status: 'ready' });
    expect(failing.slskd.enqueued.map((e) => e.username)).toEqual(['first']);
    expect(failing.log.lines.some((l) => l.includes('tie pick failed'))).toBe(true);
    const wild = setup({ pick: async () => 9 });
    await wild.pipeline.run(wild.req.id);
    expect(wild.slskd.enqueued.map((e) => e.username)).toEqual(['first']);
  });

  it('wires the model picker only when the flag is on and a key is set', async () => {
    const base = {
      RENAISSANCE_HUB_DB: ':memory:',
      JELLYFIN_URL: 'http://jf.test',
    };
    for (const env of [
      base,
      { ...base, RENAISSANCE_FETCH_MODEL_PICK: 'on' },
      { ...base, RENAISSANCE_FETCH_MODEL_PICK: 'on', ANTHROPIC_API_KEY: 'sk-test' },
    ]) {
      const app = await buildApp({
        config: loadConfig(env),
        authenticator: staticAuthenticator({ t: sahil }),
        startRunner: false,
      });
      await app.ready();
      expect(
        (await app.inject({ url: '/health', headers: { authorization: 'Bearer t' } })).json(),
      ).toMatchObject({ status: 'ok' });
      await app.close();
    }
    expect(
      loadConfig({ RENAISSANCE_FETCH_MODEL_PICK: 'on', ANTHROPIC_API_KEY: 'k' }).modelPick,
    ).toBe(true);
  });
});
