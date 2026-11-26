import { HubClientError } from '@renaissance/core';
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeHub, fireman, request } from '../test/hub';
import { session } from '../test/fakes';
import {
  addRow,
  addsStore,
  applyEvent,
  cancelRow,
  hubStore,
  hubUrl,
  lateCatalogueStore,
  newRequestFor,
  requestForRow,
  requestsStore,
  rowStatus,
  rowStatusText,
  setHubForTests,
  startHub,
} from './hub';
import type { CatalogueRow } from './hub';
import { i18n } from './i18n';
import * as library from './library';
import { sessionStore } from './session';
import { toastStore } from './toast';

const t = i18n.t.bind(i18n) as TFunction;
const song: CatalogueRow = { kind: 'song', item: fireman };
const album: CatalogueRow = {
  kind: 'album',
  item: {
    id: 'mb:release-group:8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
    releaseGroupId: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
    title: 'Tha Carter II',
    artist: 'Lil Wayne',
    artistId: 'ac9a487a-d9d2-4f27-bb23-0f4686488345',
    year: 2005,
  },
};

afterEach(() => setHubForTests(null));

describe('the request a row makes', () => {
  it('carries every id the catalogue gave', () => {
    expect(newRequestFor(song)).toEqual({
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
      album: 'Tha Carter II',
      recordingId: fireman.recordingId,
      duration: 263,
    });
    expect(newRequestFor(album)).toEqual({
      kind: 'album',
      title: 'Tha Carter II',
      artist: 'Lil Wayne',
      releaseGroupId: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
      artistId: 'ac9a487a-d9d2-4f27-bb23-0f4686488345',
    });
    const deezer: CatalogueRow = {
      kind: 'song',
      item: {
        id: 'dz:track:1',
        title: 'Fireman',
        artist: 'Lil Wayne',
        releaseGroupId: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
        releaseId: 'c0ffee00-0000-4000-8000-000000000003',
        artistId: 'ac9a487a-d9d2-4f27-bb23-0f4686488345',
      },
    };
    expect(newRequestFor(deezer)).toMatchObject({
      releaseGroupId: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
      releaseId: 'c0ffee00-0000-4000-8000-000000000003',
      artistId: 'ac9a487a-d9d2-4f27-bb23-0f4686488345',
    });
  });
});

describe('what a row says', () => {
  it('finds its request by the tap, else by id or words, a live one over an old failure', () => {
    const live = request({ id: '22222222-2222-4222-8222-222222222222', status: 'finding' });
    const old = request({ status: 'failed' });
    const requests = new Map([
      [old.id, old],
      [live.id, live],
    ]);
    expect(requestForRow(song, new Map(), requests)?.id).toBe(live.id);
    expect(
      requestForRow(
        song,
        new Map([[song.item.id, { kind: 'requested', requestId: old.id }]]),
        requests,
      )?.id,
    ).toBe(old.id);
    const byWords: CatalogueRow = {
      kind: 'song',
      item: { id: 'dz:track:9', title: 'FIREMAN', artist: 'lil wayne' },
    };
    expect(requestForRow(byWords, new Map(), requests)?.id).toBe(live.id);
    expect(requestForRow(album, new Map(), requests)).toBeUndefined();
    const albumRequest = request({
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'album',
      title: 'Tha Carter II',
      releaseGroupId: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
    });
    expect(requestForRow(album, new Map(), new Map([[albumRequest.id, albumRequest]]))?.id).toBe(
      albumRequest.id,
    );
    const cancelled = request({ status: 'cancelled' });
    expect(requestForRow(song, new Map(), new Map([[cancelled.id, cancelled]]))).toBeUndefined();
    expect(
      requestForRow(song, new Map([[song.item.id, { kind: 'already' }]]), requests),
    ).toBeUndefined();
  });

  it('words each state in one short phrase', () => {
    const none = new Map();
    expect(rowStatusText(rowStatus(song, none, none), t)).toBe('');
    expect(rowStatus({ kind: 'song', item: { ...fireman, libraryId: 'jf1' } }, none, none)).toEqual(
      {
        kind: 'already',
      },
    );
    const adds = (state: Parameters<typeof addsStore.set>[0]) => state as never;
    expect(
      rowStatusText(rowStatus(song, adds(new Map([[song.item.id, { kind: 'adding' }]])), none), t),
    ).toBe('Adding…');
    expect(
      rowStatusText(rowStatus(song, adds(new Map([[song.item.id, { kind: 'already' }]])), none), t),
    ).toBe('In your library');
    expect(
      rowStatusText(
        rowStatus(song, adds(new Map([[song.item.id, { kind: 'failed', code: 'offline' }]])), none),
        t,
      ),
    ).toBe('The hub is not answering; tap to try again');
    expect(
      rowStatusText(rowStatus(song, adds(new Map([[song.item.id, { kind: 'failed' }]])), none), t),
    ).toBe('Not found; tap to try again');
    const status = (over: Partial<ReturnType<typeof request>>) => {
      const r = request(over);
      return rowStatusText(rowStatus(song, none, new Map([[r.id, r]])), t);
    };
    expect(status({})).toBe('On its way · Waiting its turn');
    expect(status({ status: 'finding' })).toBe('On its way · Finding it');
    expect(status({ status: 'downloading' })).toBe('On its way · Downloading');
    expect(
      status({ status: 'downloading', progress: { unit: 'percent', done: 45, total: 100 } }),
    ).toBe('On its way · Downloading 45%');
    expect(status({ status: 'downloading', progress: { unit: 'songs', done: 3, total: 12 } })).toBe(
      'On its way · 3 of 12 songs',
    );
    expect(status({ status: 'importing' })).toBe('On its way · Adding to the library');
    expect(status({ status: 'ready' })).toBe('Ready');
    expect(status({ status: 'failed', reason: 'no_results' })).toBe('Not found; tap to try again');
    expect(status({ status: 'failed', reason: 'not_configured' })).toBe(
      'The hub is not set up to fetch music yet',
    );
    const r = request();
    const watching = (mine: boolean) =>
      rowStatusText(
        rowStatus(
          song,
          adds(new Map([[song.item.id, { kind: 'watching', requestId: r.id, name: 'Mom', mine }]])),
          new Map([[r.id, r]]),
        ),
        t,
      );
    expect(watching(false)).toBe('On its way · Waiting its turn · Mom asked first');
    expect(watching(true)).toBe('On its way · Waiting its turn · You asked earlier');
  });
});

describe('adding and undoing', () => {
  it('adds a row, says so with an Undo, and the Undo stops the request', async () => {
    const hub = fakeHub();
    setHubForTests(hub.client);
    const state = await addRow(song, t);
    expect(state).toMatchObject({ kind: 'requested' });
    expect(hub.created[0]).toMatchObject({ title: 'Fireman', recordingId: fireman.recordingId });
    expect(toastStore.get()?.message).toBe('Fireman is on its way');
    expect(rowStatus(song, addsStore.get(), requestsStore.get()).kind).toBe('onItsWay');
    toastStore.get()?.undo?.();
    await vi.waitFor(() => expect(toastStore.get()?.message).toBe('Stopped Fireman'));
    expect(addsStore.get().has(song.item.id)).toBe(false);
    expect(rowStatus(song, addsStore.get(), requestsStore.get()).kind).toBe('none');
  });

  it('adds at once what is already on the server, and watches what someone else asked for', async () => {
    const here = fakeHub({
      create: () => ({
        alreadyHere: true,
        item: {
          id: 0,
          profile: 'u1',
          item: 'jf1',
          kind: 'track',
          title: 'Fireman',
          artist: 'Lil Wayne',
          addedBy: 'u1',
          addedAt: '2026-11-26T00:00:00.000Z',
          source: 'add',
        },
      }),
    });
    setHubForTests(here.client);
    expect(await addRow(song, t)).toEqual({ kind: 'already' });
    expect(toastStore.get()?.message).toBe('Fireman is already in your library');
    const theirs = request({ requestedBy: 'u-mom', requestedByName: 'Mom' });
    const dup = fakeHub({ create: () => ({ alreadyRequested: true, request: theirs }) });
    setHubForTests(dup.client);
    expect(await addRow(song, t)).toEqual({
      kind: 'watching',
      requestId: theirs.id,
      name: 'Mom',
      mine: false,
    });
    expect(toastStore.get()?.message).toBe('Fireman is already on its way');
    expect(toastStore.get()?.undo).toBeUndefined();
  });

  it('says why an add or an undo did not take', async () => {
    setHubForTests(null);
    expect(await addRow(song, t)).toEqual({ kind: 'failed', code: 'offline' });
    const down = fakeHub({ create: () => new TypeError('Failed to fetch') });
    setHubForTests(down.client);
    expect(await addRow(song, t)).toEqual({ kind: 'failed', code: 'offline' });
    expect(toastStore.get()).toMatchObject({ message: 'Could not add Fireman', tone: 'danger' });
    const refused = fakeHub({ create: () => new HubClientError(400, 'invalid_request') });
    setHubForTests(refused.client);
    expect(await addRow(song, t)).toEqual({ kind: 'failed', code: 'invalid_request' });
    const late = fakeHub({ cancel: () => new HubClientError(409, 'too_late') });
    setHubForTests(late.client);
    await cancelRow(song, request().id, t);
    expect(toastStore.get()?.message).toBe('Fireman is already downloading and will arrive');
    const broken = fakeHub({ cancel: () => new HubClientError(500, 'http_error') });
    setHubForTests(broken.client);
    await cancelRow(song, request().id, t);
    expect(toastStore.get()).toMatchObject({ message: 'Could not undo that', tone: 'danger' });
    setHubForTests(null);
    await cancelRow(song, request().id, t);
  });
});

describe('the event stream', () => {
  it('moves the row along, says Ready once and refreshes the library', () => {
    const refresh = vi.spyOn(library, 'refreshLibrary').mockResolvedValue();
    setHubForTests(fakeHub().client);
    const r = request();
    applyEvent({ type: 'request', request: { ...r, status: 'downloading' } }, t);
    expect(requestsStore.get().get(r.id)?.status).toBe('downloading');
    expect(refresh).not.toHaveBeenCalled();
    applyEvent({ type: 'request', request: { ...r, status: 'ready' } }, t);
    applyEvent({ type: 'ready', request: { ...r, status: 'ready' } }, t);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toastStore.get()?.message).toBe('Fireman is ready');
    applyEvent(
      {
        type: 'ready',
        request: {
          ...r,
          id: '44444444-4444-4444-8444-444444444444',
          status: 'ready',
          matched: { title: 'Fireman (Album Version)', artist: 'Lil Wayne' },
        },
      },
      t,
    );
    expect(toastStore.get()?.message).toBe('Fireman (Album Version) is ready');
    applyEvent(
      {
        type: 'catalogue',
        result: { query: 'halo', songs: [], albums: [], artists: [], cached: false },
      },
      t,
    );
    expect(lateCatalogueStore.get()?.query).toBe('halo');
    applyEvent({ type: 'ping', at: '2026-11-26T00:00:00.000Z' }, t);
    refresh.mockRestore();
  });
});

describe('following the session', () => {
  it('builds the client from the signed-in token, lists requests and opens the stream', async () => {
    expect(hubUrl()).toBe(`${window.location.protocol}//${window.location.hostname}:8787`);
    const stop = startHub(t);
    expect(hubStore.get().status).toBe('off');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/requests'))
        return new Response(JSON.stringify([request()]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      return new Response(null, { status: 404 });
    });
    sessionStore.set({
      status: 'signedIn',
      session,
      adapter: null,
      vault: 'encrypted',
      reason: null,
    });
    expect(hubStore.get()).toMatchObject({ status: 'ready', userId: 'u1' });
    await vi.waitFor(() => expect(requestsStore.get().size).toBe(1));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    sessionStore.set({
      status: 'signedOut',
      session: null,
      adapter: null,
      vault: null,
      reason: null,
    });
    expect(hubStore.get()).toEqual({ client: null, status: 'off', userId: null });
    expect(requestsStore.get().size).toBe(0);
    stop();
    fetchMock.mockRestore();
  });

  it('marks the hub unreachable or refused when the list fails', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    const stop = startHub(t);
    sessionStore.set({
      status: 'signedIn',
      session,
      adapter: null,
      vault: 'encrypted',
      reason: null,
    });
    await vi.waitFor(() => expect(hubStore.get().status).toBe('unauthorized'));
    stop();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const again = startHub(t);
    sessionStore.set({
      status: 'signedIn',
      session: { ...session, token: 'tok2' },
      adapter: null,
      vault: 'encrypted',
      reason: null,
    });
    await vi.waitFor(() => expect(hubStore.get().status).toBe('unreachable'));
    again();
    fetchMock.mockRestore();
  });
});
