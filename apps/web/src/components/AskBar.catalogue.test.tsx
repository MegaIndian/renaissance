import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setHubForTests } from '../lib/hub';
import { setLanguage } from '../lib/i18n';
import * as library from '../lib/library';
import { toastStore } from '../lib/toast';
import { signInFake } from '../test/fakes';
import { answer, busy, fireman, request, useFakeHub } from '../test/hub';
import { renderWithI18n } from '../test/render';
import { AskBar } from './AskBar';

afterEach(() => setHubForTests(null));

const duckCover = {
  id: 'dz:track:7',
  title: 'Fluffing a Duck',
  artist: 'Kevin MacLeod',
};
const duckSong = {
  id: 'dz:track:8',
  title: 'Duck Song',
  artist: 'Bryant Oden',
  preview: 'https://cdn.test/duck.mp3',
};

describe('AskBar: the catalogue under the library hits (F61)', () => {
  it('lists catalogue rows after the library hits and leaves out what the library already shows', async () => {
    setLanguage('en');
    signInFake();
    const hub = useFakeHub({ search: (q) => answer(q, { songs: [duckCover, duckSong] }) });
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    expect(screen.getByText(/then the catalogue to add from/)).toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), 'duck');
    const add = await screen.findByRole('option', { name: 'Add Duck Song by Bryant Oden' });
    const options = screen.getAllByRole('option');
    // The library hit first, the catalogue row after it, "See all" last.
    expect(options[0]).toHaveTextContent('Fluffing a Duck');
    expect(options.indexOf(add)).toBeGreaterThan(0);
    expect(options.at(-1)).toHaveTextContent('See all results');
    expect(screen.getByText('Add from the catalogue')).toBeInTheDocument();
    // The catalogue's own Fluffing a Duck is the library's: no second row offers to add it.
    expect(screen.queryByRole('option', { name: /Add Fluffing a Duck/ })).toBeNull();
    expect(within(add).getByRole('button', { name: 'Preview Duck Song' })).toBeInTheDocument();
    expect(hub.searched.at(-1)).toEqual({ q: 'duck', full: false });
  });

  it('adds a song with a tap; the row says on its way, then Ready from the stream', async () => {
    setLanguage('en');
    signInFake();
    const refresh = vi.spyOn(library, 'refreshLibrary').mockResolvedValue();
    const hub = useFakeHub({
      search: (q) => answer(q, { songs: [fireman] }),
      create: (input) => request({ title: input.title, artist: input.artist }),
    });
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');
    await user.type(input, 'fireman');
    await user.click(await screen.findByRole('option', { name: 'Add Fireman by Lil Wayne' }));
    expect(hub.created).toEqual([
      expect.objectContaining({
        kind: 'track',
        title: 'Fireman',
        recordingId: fireman.recordingId,
      }),
    ]);
    const row = await screen.findByRole('option', { name: /On its way · Waiting its turn/ });
    expect(row).toHaveTextContent('Lil Wayne · Tha Carter II · 4:23');
    expect(toastStore.get()?.message).toBe('Fireman is on its way');
    // The panel stayed open and the box kept the words.
    expect(input).toHaveValue('fireman');
    // A second tap while it is on its way asks for nothing.
    await user.click(row);
    expect(hub.created).toHaveLength(1);
    hub.emit({
      type: 'request',
      request: request({
        status: 'downloading',
        progress: { unit: 'percent', done: 40, total: 100 },
      }),
    });
    expect(await screen.findByRole('option', { name: /Downloading 40%/ })).toBeInTheDocument();
    hub.emit({ type: 'ready', request: request({ status: 'ready' }) });
    expect(await screen.findByRole('option', { name: /Fireman.*Ready/ })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    refresh.mockRestore();
  });

  it('keeps the rows shown when the hub is busy, and says when it is not answering', async () => {
    setLanguage('en');
    signInFake();
    let calls = 0;
    useFakeHub({
      search: (q) => {
        calls += 1;
        return calls === 1 ? answer(q, { songs: [fireman] }) : busy();
      },
    });
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'firem');
    expect(
      await screen.findByRole('option', { name: 'Add Fireman by Lil Wayne' }),
    ).toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), 'an');
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByRole('option', { name: 'Add Fireman by Lil Wayne' })).toBeInTheDocument();
    setHubForTests(null);
    useFakeHub({ search: () => new TypeError('Failed to fetch') });
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'zzqq');
    expect(
      await screen.findByText('Library only: the hub that adds new music is not answering'),
    ).toBeInTheDocument();
  });

  it('says nothing matches anywhere when neither the library nor the catalogue has the words', async () => {
    setLanguage('en');
    signInFake();
    useFakeHub();
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'zzqq');
    expect(
      await screen.findByText('Nothing in your library or the catalogue matches yet'),
    ).toBeInTheDocument();
  });

  it('adds an album and plays a song the hub found on the server once the library has it', async () => {
    setLanguage('en');
    const { player } = signInFake();
    const hub = useFakeHub({
      search: (q) =>
        answer(q, {
          songs: [
            { id: 'mb:recording:x', title: 'Carefree', artist: 'Kevin MacLeod', libraryId: 't2' },
          ],
          albums: [
            {
              id: 'mb:release-group:y',
              releaseGroupId: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
              title: 'Tha Carter II',
              artist: 'Lil Wayne',
              year: 2005,
            },
          ],
        }),
    });
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'tha carter');
    await user.click(
      await screen.findByRole('option', { name: 'Add the album Tha Carter II by Lil Wayne' }),
    );
    expect(hub.created[0]).toMatchObject({ kind: 'album', title: 'Tha Carter II' });
    // A song the hub marked as on the server, not among the library hits for these words: a tap plays it.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'zz carefree');
    const here = await screen.findByRole('option', { name: /Carefree.*In your library/ });
    await user.click(here);
    expect(player.snapshot.queue.items[0]?.id).toBe('t2');
    expect(hub.created).toHaveLength(1);
  });

  it('reads in Gujarati', async () => {
    await setLanguage('gu');
    signInFake();
    useFakeHub({ search: (q) => answer(q, { songs: [fireman] }) });
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'fireman');
    expect(await screen.findByText('કેટલોગમાંથી ઉમેરો')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Lil Wayneનું Fireman ઉમેરો' })).toBeInTheDocument();
    await setLanguage('en');
  });
});
