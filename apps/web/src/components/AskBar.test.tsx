import { screen } from '@testing-library/react';
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
    expect(screen.getByText('Nothing in your library matches yet')).toBeInTheDocument();
  });

  it('compact mode hides the hint until there is text', async () => {
    setLanguage('en');
    renderWithI18n(<AskBar compact />);
    expect(screen.queryByText(/Try "play/)).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('searchbox'), 'x');
    expect(screen.getByText('Nothing in your library matches yet')).toBeInTheDocument();
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
          summary: 'Added 1 songs to the queue',
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
    renderWithI18n(<AskBar />, hub);
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'get me fireman{Enter}');
    expect(hub.askStreaming).toHaveBeenCalledWith(
      { text: 'get me fireman', language: 'en' },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(await screen.findByText('Library results')).toBeInTheDocument();
    expect(screen.getAllByText(/Lil Wayne/).length).toBeGreaterThan(0);
    expect(await screen.findByText('Requested Fireman by Lil Wayne')).toBeInTheDocument();
    expect(screen.getByText('Fireman is on its way.')).toBeInTheDocument();
    expect(screen.getByText(/1 suggestion was left out/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(hub.undo).toHaveBeenCalledWith(answer.actions[0]);
    expect(await screen.findByText('Undone')).toBeInTheDocument();
  });

  it('says the model is off and asks to sign in without a hub', async () => {
    setLanguage('en');
    const { fakeHub } = await import('../test/hub');
    renderWithI18n(<AskBar />, fakeHub());
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Ask for anything' });
    await user.type(input, 'anything{Enter}');
    expect(
      await screen.findByText('The model is off. These are library results only'),
    ).toBeInTheDocument();
    const { HubClientError } = await import('@renaissance/core');
    renderWithI18n(
      <AskBar />,
      fakeHub({ me: vi.fn(async () => Promise.reject(new HubClientError(401, 'unauthorized'))) }),
    );
    expect(await screen.findByText('Sign in to search your library')).toBeInTheDocument();
  });
});
