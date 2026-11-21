import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HubEvent as HubEventT } from '@renaissance/core';
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
    // Enter with the model off: the catalogue rows stay the answer, and since they answer the
    // words the hub sends no line about the model and none is shown (functionality V).
    await user.type(input, '{Enter}');
    await waitFor(() => expect(hub.askStreaming).toHaveBeenCalled());
    expect(await screen.findByText('Tha Carter II')).toBeInTheDocument();
    expect(screen.queryByText(/Smart answers are off/)).not.toBeInTheDocument();
  });

  it('shows the model-off line only when the hub sends it, and the version in the subtitle (functionality V, design AJ)', async () => {
    setLanguage('en');
    const { fakeHub, emptyAnswer } = await import('../test/hub');
    const song = (id: string, title: string, album: string) => ({
      id: `dz:track:${id}`,
      title,
      artist: 'Lil Wayne',
      album,
      duration: 263,
    });
    const catalogue = {
      query: 'fireman lil wayne',
      songs: [
        song('1', 'Fireman', 'Tha Carter II'),
        song('2', 'Fireman (Chopped & Screwed)', 'Tha Carter II (Chopped)'),
        song('3', 'Fireman (a cappella)', 'Fireman (promo)'),
      ],
      albums: [],
      artists: [],
      cached: false,
    };
    const hub = fakeHub({
      catalogueSearch: vi.fn(async () => catalogue),
      askStreaming: vi.fn(
        async (_input: unknown, onInstant: (i: typeof emptyAnswer.instant) => void) => {
          onInstant(emptyAnswer.instant);
          return {
            ...emptyAnswer,
            catalogue,
            why: 'Smart answers are off right now. Type a song or artist name',
          };
        },
      ),
    });
    renderWithI18n(<AskBar />, hub);
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'fireman lil wayne');
    // Three rows titled "Fireman", told apart by the version that leads each subtitle.
    expect(await screen.findAllByText('Fireman')).toHaveLength(3);
    expect(screen.queryByText('Fireman (Chopped & Screwed)')).not.toBeInTheDocument();
    expect(
      screen.getByText('Chopped & Screwed · Lil Wayne · Tha Carter II (Chopped) · 4:23'),
    ).toBeInTheDocument();
    expect(screen.getByText('a cappella · Lil Wayne · Fireman (promo) · 4:23')).toBeInTheDocument();
    expect(screen.getByText('Lil Wayne · Tha Carter II · 4:23')).toBeInTheDocument();
    // The hub's own line is shown as it is when it sends one.
    await user.type(input, '{Enter}');
    expect(
      await screen.findByText('Smart answers are off right now. Type a song or artist name'),
    ).toBeInTheDocument();
  });

  it('replaces the typed rows with the full answer the hub pushes for the same words (design AH)', async () => {
    setLanguage('en');
    const { fakeHub } = await import('../test/hub');
    const { HubEvent } = await import('@renaissance/core');
    type Listener = (event: HubEventT) => void;
    let listener: Listener | undefined;
    const tribute = {
      query: 'rolling in the deep adele',
      songs: [
        {
          id: 'dz:track:1',
          title: 'Rolling In The Deep',
          artist: 'Adele Pop Hits',
          album: 'Adele Pop Hits',
        },
      ],
      albums: [],
      artists: [],
      cached: false,
      partial: true,
    };
    const original = {
      ...tribute,
      partial: undefined,
      songs: [
        { id: 'mb:recording:ad1', title: 'Rolling in the Deep', artist: 'Adele', album: '21' },
        ...tribute.songs,
      ],
    };
    const hub = fakeHub({
      catalogueSearch: vi.fn(async () => tribute),
      events: vi.fn((onEvent: Listener) => {
        listener = onEvent;
        return () => undefined;
      }),
    });
    renderWithI18n(<AskBar />, hub);
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'Rolling in the Deep Adele');
    expect(await screen.findByText('Adele Pop Hits · Adele Pop Hits')).toBeInTheDocument();
    await waitFor(() => expect(listener).toBeDefined());
    // Another query's late answer changes nothing.
    listener!(
      HubEvent.parse({ type: 'catalogue', result: { ...original, query: 'halo beyonce' } }),
    );
    expect(screen.queryByText('Adele · 21')).not.toBeInTheDocument();
    listener!(HubEvent.parse({ type: 'catalogue', result: original }));
    expect(await screen.findByText('Adele · 21')).toBeInTheDocument();
    const adds = screen.getAllByRole('button', { name: 'Add' });
    expect(adds[0]!.className).toContain('bg-primary');
    const panel = screen.getByLabelText('Results');
    expect(panel.textContent?.indexOf('Adele · 21')).toBeLessThan(
      panel.textContent?.indexOf('Adele Pop Hits · Adele Pop Hits') ?? -1,
    );
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

describe('AskBar, round 2', () => {
  it('puts the answer above the rows, clears the typeahead on a deterministic answer, and shows one primary Add', async () => {
    setLanguage('en');
    const { fakeHub, emptyAnswer } = await import('../test/hub');
    const song = (id: string, title: string, artist: string) => ({
      id: `dz:track:${id}`,
      title,
      artist,
      album: 'Album',
      duration: 200,
      art: 'https://art.test/broken.jpg',
    });
    const catalogue = {
      query: 'carefree',
      songs: [song('1', 'Carefree Spa Days', 'Spa'), song('2', 'Big Guy', 'SpongeBob')],
      albums: [],
      artists: [],
      cached: false,
    };
    const hub = fakeHub({
      catalogueSearch: vi.fn(async () => catalogue),
      askStreaming: vi.fn(
        async (_input: unknown, onInstant: (i: typeof emptyAnswer.instant) => void) => {
          onInstant(emptyAnswer.instant);
          return {
            ...emptyAnswer,
            reason: 'deterministic',
            why: 'Carefree is in your library',
            actions: [
              {
                tool: 'play' as const,
                input: { itemId: 'jf-c', kind: 'track' },
                summary: 'Play Carefree',
                doneSummary: 'Playing Carefree',
                ranBy: 'app' as const,
                undoable: true,
              },
            ],
          };
        },
      ),
    });
    const view = renderWithI18n(<AskBar />, hub);
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'play carefree');
    expect(await screen.findByText('Carefree Spa Days')).toBeInTheDocument();
    // One blue Add (the first row); the second is secondary.
    const adds = screen.getAllByRole('button', { name: 'Add' });
    expect(adds).toHaveLength(2);
    expect(adds[0]!.className).toContain('bg-primary');
    expect(adds[1]!.className).not.toContain('bg-primary');
    // The placeholder square sits under every picture until it has loaded (design AF); broken art
    // falls back to it, never the browser's broken-image glyph (design U).
    const img = view.container.querySelector('img')!;
    expect(img.className).toContain('opacity-0');
    expect(img.parentElement?.children).toHaveLength(2);
    const second = view.container.querySelectorAll('img')[1]!;
    second.dispatchEvent(new Event('load'));
    await waitFor(() => expect(second.className).toContain('opacity-100'));
    img.dispatchEvent(new Event('error'));
    await waitFor(() => expect(view.container.querySelectorAll('img')).toHaveLength(1));
    // Enter aborts the typeahead still waiting for these letters (design R): on a cold cache it
    // would otherwise land after the answer and refill the rows under the card.
    const signals = (hub.catalogueSearch as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[1] as AbortSignal,
    );
    await user.type(input, '{Enter}');
    await waitFor(() => expect(signals.every((s) => s.aborted)).toBe(true));
    expect(await screen.findByText('Play Carefree')).toBeInTheDocument();
    // The leftover rows are gone, and the card is the first thing in the panel.
    expect(screen.queryByText('Carefree Spa Days')).not.toBeInTheDocument();
    const panel = screen.getByLabelText('Results');
    expect(panel.textContent?.indexOf('Play Carefree')).toBeLessThan(
      panel.textContent?.indexOf('Carefree is in your library') ?? -1,
    );
  });

  it('words a duplicate as already on its way with no undo, and a failed undo truthfully', async () => {
    setLanguage('en');
    const { fakeHub, request } = await import('../test/hub');
    const { HubClientError } = await import('@renaissance/core');
    const catalogue = {
      query: 'fireman',
      songs: [
        {
          id: 'dz:track:1',
          title: 'Fireman',
          artist: 'Lil Wayne',
          album: 'Tha Carter II',
          duration: 263,
        },
        { id: 'dz:track:2', title: 'Fireman', artist: 'Elliphant', album: 'Living', duration: 200 },
      ],
      albums: [],
      artists: [],
      cached: false,
    };
    let calls = 0;
    const hub = fakeHub({
      catalogueSearch: vi.fn(async () => catalogue),
      createRequest: vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? {
              alreadyRequested: true as const,
              request: request({ requestedBy: 'u-mom', requestedByName: 'Mom' }),
            }
          : request({ id: '77777777-7777-4777-8777-777777777777' });
      }),
      cancelRequest: vi.fn(async () => {
        throw new HubClientError(409, 'too_late');
      }),
    });
    renderWithI18n(<AskBar />, hub);
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'fireman');
    const adds = await screen.findAllByRole('button', { name: 'Add' });
    await user.click(adds[0]!);
    expect(
      await screen.findByText('Already on its way, asked by Mom. You will see it in Requests too'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    // The second row: requested, then an undo the hub refuses because it is downloading. While
    // the hub is asked the caption says so (design AE), never "Undo" as a status.
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Requested. Progress is in Requests')).toBeInTheDocument();
    let refuse: () => void = () => {};
    (hub.cancelRequest as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuse = () => reject(new HubClientError(409, 'too_late'));
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Undoing…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    refuse();
    expect(
      await screen.findByText('Too late, it is already downloading. It stays in Requests'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Could not add that. Try again')).not.toBeInTheDocument();
    // Both titles are still on screen: the outcome took its own line, not the title's.
    expect(screen.getAllByText('Fireman')).toHaveLength(2);
  });
});
