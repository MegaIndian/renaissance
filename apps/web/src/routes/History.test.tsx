import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { historyDbName, recordListen, resetHistoryForTests, startHistory } from '../lib/history';
import { setLanguage } from '../lib/i18n';
import { updateSettings } from '../lib/settings';
import { listen, session, signInFake } from '../test/fakes';
import { renderApp } from '../test/render';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

/** Noon today, yesterday and four days back, local time, so the day groups do not depend on the clock. */
function noon(daysBack: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.toISOString();
}

async function seed() {
  await startHistory(session);
  await recordListen(
    listen({
      id: 'a',
      trackId: 't2',
      title: 'Carefree',
      at: noon(0),
      skipped: true,
      completed: false,
      endReason: 'next',
      listened: 8,
    }),
  );
  await recordListen(listen({ id: 'b', trackId: 't1', title: 'Sneaky Snitch', at: noon(0) }));
  await recordListen(listen({ id: 'c', trackId: 't3', title: 'Fluffing a Duck', at: noon(1) }));
  await recordListen(
    listen({
      id: 'd',
      trackId: 'gone',
      title: 'Left the library',
      at: noon(4),
      completed: false,
      endReason: 'stopped',
      listened: 40,
    }),
  );
}

describe('History', () => {
  afterEach(async () => {
    resetHistoryForTests();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(historyDbName(session.server.id, session.userId));
      request.onsuccess = request.onerror = request.onblocked = resolve;
    });
    updateSettings({ listeningLog: true, mode: 'simple' });
    setLanguage('en');
  });

  it('groups plays by day, newest first, and says which were skipped or completed', async () => {
    setLanguage('en');
    signInFake();
    await seed();
    renderApp('/history');
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
    const today = await screen.findByRole('region', { name: 'Today' });
    const rows = within(today).getAllByRole('button', { name: /^Play / });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Play Sneaky Snitch',
      'Play Carefree',
    ]);
    expect(within(today).getByText(/· Skipped · Kevin MacLeod/)).toBeInTheDocument();
    expect(within(today).getByText(/· Completed · Kevin MacLeod/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Yesterday' })).toBeInTheDocument();
    // An older day is named by its date; a song the library lost still shows from the log.
    expect(screen.getByRole('button', { name: 'Play Left the library' })).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByText('4 plays')).toBeInTheDocument();
  });

  it('filters to skipped and to completed plays', async () => {
    setLanguage('en');
    signInFake();
    await seed();
    renderApp('/history');
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Today' });
    await user.click(screen.getByRole('radio', { name: 'Skipped' }));
    expect(screen.getAllByRole('button', { name: /^Play / }).map((b) => b.textContent)).toEqual([
      expect.stringContaining('Carefree'),
    ]);
    expect(screen.queryByRole('region', { name: 'Yesterday' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Completed' }));
    expect(screen.getAllByRole('button', { name: /^Play / })).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getAllByRole('button', { name: /^Play / })).toHaveLength(4);
  });

  it('a tap plays the song again from the history, and the menu offers Play again', async () => {
    setLanguage('en');
    const { player } = signInFake();
    const playTracks = vi.spyOn(player, 'playTracks');
    await seed();
    renderApp('/history');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Play Fluffing a Duck' }));
    expect(playTracks).toHaveBeenLastCalledWith([expect.objectContaining({ id: 't3' })], 0, {
      kind: 'history',
    });
    expect(player.snapshot.queue.items[player.snapshot.queue.index]?.id).toBe('t3');
    // The current song is marked on its row.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Pause Fluffing a Duck' }).getAttribute('aria-current'),
      ).toBe('true'),
    );

    const yesterday = screen.getByRole('region', { name: 'Yesterday' });
    await user.click(within(yesterday).getByRole('button', { name: /More/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Play again' }));
    expect(playTracks).toHaveBeenCalledTimes(2);
  });

  it('shows the device in advanced mode', async () => {
    setLanguage('en');
    updateSettings({ mode: 'advanced' });
    signInFake();
    await seed();
    renderApp('/history');
    expect((await screen.findAllByText(/Chrome on Mac/)).length).toBeGreaterThan(0);
  });

  it('says when nothing has played, and when the log is off', async () => {
    setLanguage('en');
    signInFake();
    await startHistory(session);
    updateSettings({ listeningLog: false });
    renderApp('/history');
    expect(await screen.findByRole('heading', { name: 'Nothing played yet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'History is off' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.queryByRole('radiogroup', { name: 'Show' })).not.toBeInTheDocument();
  });

  it('a filter with nothing in it says so', async () => {
    setLanguage('en');
    signInFake();
    await startHistory(session);
    await recordListen(listen({ at: hoursAgo(1).toISOString() }));
    renderApp('/history');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: 'Skipped' }));
    expect(screen.getByText('No plays match this filter.')).toBeInTheDocument();
  });

  it('pages: Show more reads the next plays', async () => {
    setLanguage('en');
    signInFake();
    await startHistory(session);
    const { HISTORY_PAGE } = await import('./History');
    for (let i = 0; i <= HISTORY_PAGE; i++) {
      await recordListen(listen({ at: new Date(Date.now() - i * 1000).toISOString() }));
    }
    renderApp('/history');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^Play / })).toHaveLength(HISTORY_PAGE + 1),
    );
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  }, 20_000);

  it('signed out, it offers Sign in', async () => {
    setLanguage('en');
    renderApp('/history');
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
  });

  it('reads in Gujarati', async () => {
    await setLanguage('gu');
    signInFake();
    await seed();
    renderApp('/history');
    expect(await screen.findByRole('region', { name: 'આજે' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'ગઈકાલે' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'છોડેલાં' })).toBeInTheDocument();
  });
});
