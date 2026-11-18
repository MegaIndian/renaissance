import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { renderWithI18n } from '../test/render';
import { AskBar } from './AskBar';

function setPlatform(value: string): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
}

describe('AskBar', () => {
  afterEach(() => setPlatform(''));

  it('focuses on ⌘K and Ctrl K and reports no results while typing', async () => {
    setLanguage('en');
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    const input = screen.getByRole('searchbox', { name: 'Ask for anything' });
    expect(input).toHaveAttribute('placeholder', 'Ask for anything');
    expect(input).not.toHaveFocus();
    await user.keyboard('{Meta>}k{/Meta}');
    expect(input).toHaveFocus();
    (input as HTMLInputElement).blur();
    await user.keyboard('{Control>}k{/Control}');
    expect(input).toHaveFocus();
    expect(screen.getByText(/A song, a mood, a chore, a request/)).toBeInTheDocument();
    await user.type(input, 'kishore');
    expect(
      screen.getByText("Nothing matches yet. Try the song or artist's name"),
    ).toBeInTheDocument();
  });

  it('compact mode hides the hint until there is text', async () => {
    setLanguage('en');
    renderWithI18n(<AskBar compact />);
    expect(screen.queryByText(/Try "play/)).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('searchbox'), 'x');
    expect(
      screen.getByText("Nothing matches yet. Try the song or artist's name"),
    ).toBeInTheDocument();
  });

  it('spells the shortcut for the platform', () => {
    setLanguage('en');
    setPlatform('MacIntel');
    const mac = renderWithI18n(<AskBar />);
    expect(mac.container.querySelector('kbd')).toHaveTextContent('⌘K');
    mac.unmount();
    setPlatform('Win32');
    renderWithI18n(<AskBar />);
    expect(document.querySelector('kbd')).toHaveTextContent('Ctrl K');
  });
});

describe('AskBar with the hub', () => {
  it('sends Enter to the hub, shows the instant hits, then the answer cards with undo', async () => {
    setLanguage('en');
    const { fakeHub } = await import('../test/hub');
    const answer = {
      model: 'claude-opus-5-5',
      language: 'en' as const,
      instant: {
        tracks: [{ id: 't1', kind: 'track' as const, title: 'Fireman', artist: 'Lil Wayne' }],
        albums: [],
        artists: [],
      },
      actions: [
        {
          tool: 'request' as const,
          input: {},
          summary: 'Requested Fireman by Lil Wayne',
          ranBy: 'hub' as const,
          undoable: true,
          undo: { method: 'DELETE' as const, path: '/requests/1' },
        },
        {
          tool: 'queue' as const,
          input: {},
          summary: 'Queue 1 song',
          doneSummary: 'Added 1 song to the queue',
          ranBy: 'app' as const,
          undoable: true,
        },
      ],
      why: 'Fireman is on its way.',
      rejected: [{ tool: 'play', reason: 'ungrounded_id' }],
      tools: [] as never[],
    };
    const hub = fakeHub({
      askStreaming: vi.fn(
        async (_input: unknown, onInstant: (i: typeof answer.instant) => void) => {
          onInstant(answer.instant);
          return answer;
        },
      ),
    });
    const perform = vi.fn(async () => undefined);
    renderWithI18n(<AskBar />, hub, perform);
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'get me fireman{Enter}');
    expect(hub.askStreaming).toHaveBeenCalledWith(
      { text: 'get me fireman', language: 'en' },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(await screen.findByText('Fireman')).toBeInTheDocument();
    expect(screen.getByText(/Lil Wayne · In your library/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(await screen.findByText('Requested Fireman by Lil Wayne')).toBeInTheDocument();
    expect(screen.getByText('Fireman is on its way.')).toBeInTheDocument();
    expect(screen.getByText(/One suggestion was left out/)).toBeInTheDocument();
    // The tool name is not a caption any more; the app action is worded before it runs.
    expect(screen.queryByText('Request')).not.toBeInTheDocument();
    expect(screen.getByText('Queue 1 song')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(hub.undo).toHaveBeenCalledWith(answer.actions[0]);
    expect(await screen.findByText('Undone')).toBeInTheDocument();
    // Tapping Queue performs it through the app, rewrites the card in the past tense, offers undo.
    await user.click(screen.getByRole('button', { name: 'Queue' }));
    expect(perform).toHaveBeenCalledWith(answer.actions[1], 'do');
    expect(await screen.findByText('Added 1 song to the queue')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(perform).toHaveBeenCalledWith(answer.actions[1], 'undo');
    expect(await screen.findAllByText('Undone')).toHaveLength(2);
    // Escape (from the box) closes the panel, typing reopens it.
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Fireman is on its way.')).not.toBeInTheDocument();
    await user.type(input, '!');
    expect(screen.getByText('Fireman is on its way.')).toBeInTheDocument();
  });

  it('shows catalogue rows as the user types, adds on tap, undoes, and works with the model off', async () => {
    setLanguage('en');
    const { fakeHub, request, emptyAnswer } = await import('../test/hub');
    const song = {
      id: 'mb:recording:3f3d2a1e-5c5e-4a1a-9b1e-7f0c4a6d2b10',
      recordingId: '3f3d2a1e-5c5e-4a1a-9b1e-7f0c4a6d2b10',
      title: 'Fireman',
      artist: 'Lil Wayne',
      album: 'Tha Carter II',
      duration: 263,
      art: 'https://art.test/carter.jpg',
      preview: 'https://cdn.test/fireman.mp3',
    };
    const catalogue = {
      query: 'firem',
      songs: [
        song,
        {
          ...song,
          id: 'mb:recording:here',
          title: 'Drowning',
          artist: 'A Boogie',
          libraryId: 'jf-9',
        },
      ],
      albums: [
        {
          id: 'mb:release-group:8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
          releaseGroupId: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
          title: 'Tha Carter II',
          artist: 'Lil Wayne',
          year: 2005,
        },
      ],
      artists: [
        { id: 'mb:artist:x', artistId: 'ac9a487a-d9d2-4f27-bb23-0f4686488345', name: 'Lil Wayne' },
      ],
      cached: false,
    };
    const hub = fakeHub({
      catalogueSearch: vi.fn(async () => catalogue),
      createRequest: vi.fn(async () => request({ id: '55555555-5555-4555-8555-555555555555' })),
      askStreaming: vi.fn(
        async (_input: unknown, onInstant: (i: typeof emptyAnswer.instant) => void) => {
          onInstant(emptyAnswer.instant);
          return { ...emptyAnswer, catalogue };
        },
      ),
    });
    const view = renderWithI18n(<AskBar />, hub);
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'firem');
    await waitFor(() => expect(hub.catalogueSearch).toHaveBeenCalled());
    expect(hub.catalogueSearch).toHaveBeenCalledWith('firem', expect.any(AbortSignal));
    expect(await screen.findByText('Fireman')).toBeInTheDocument();
    expect(screen.getByText('Lil Wayne · Tha Carter II · 4:23')).toBeInTheDocument();
    expect(
      screen.getByText(/A Boogie · Tha Carter II · 4:23 · In your library/),
    ).toBeInTheDocument();
    expect(view.container.querySelector('img')).toHaveAttribute('src', song.art);
    expect(
      screen.getByRole('button', { name: 'Play a 30-second preview of Fireman' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add album' })).toBeInTheDocument();
    expect(screen.getByText('Artist')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(hub.createRequest).toHaveBeenCalledWith({
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
      album: 'Tha Carter II',
      recordingId: song.recordingId,
      duration: 263,
    });
    expect(await screen.findByText('Requested. Progress is in Requests')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(hub.cancelRequest).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555');
    expect(await screen.findByText('Undone')).toBeInTheDocument();
    // Enter with the model off: the catalogue rows stay the answer, and the line says what works.
    await user.type(input, '{Enter}');
    expect(
      await screen.findByText('Smart answers are off right now. Type a song or artist name'),
    ).toBeInTheDocument();
    expect(screen.getByText('Tha Carter II')).toBeInTheDocument();
  });

  it('says what still works when the model is off with no rows, and asks to sign in without a hub', async () => {
    setLanguage('en');
    const { fakeHub } = await import('../test/hub');
    renderWithI18n(<AskBar />, fakeHub());
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'anything{Enter}');
    // Zero hits fall through to the plain "nothing matches" sentence, not a line about the model.
    expect(
      await screen.findByText("Nothing matches yet. Try the song or artist's name"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Smart answers are off/)).not.toBeInTheDocument();
    const { HubClientError } = await import('@renaissance/core');
    renderWithI18n(
      <AskBar />,
      fakeHub({ me: vi.fn(async () => Promise.reject(new HubClientError(401, 'unauthorized'))) }),
    );
    expect(await screen.findByText('Sign in to search your library')).toBeInTheDocument();
  });
});
