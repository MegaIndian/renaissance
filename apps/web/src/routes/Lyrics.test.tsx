import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServerError, toLyrics } from '@renaissance/core';
import type { Lyrics } from '@renaissance/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { updateSettings } from '../lib/settings';
import { signInFake, tracks } from '../test/fakes';
import { renderApp } from '../test/render';
import { setViewport } from '../test/setup';

const synced = toLyrics('t2', true, [
  { start: 5000, text: 'Morning on the window' },
  { start: 10_000, text: 'Kettle on the stove' },
  { start: 15_000, text: '' },
  { start: 20_000, text: 'Out the door we go' },
]) as Lyrics;

const plain = toLyrics('t2', false, [
  { text: 'First line' },
  { text: 'Second line' },
  { text: '' },
  { text: 'Next verse' },
]) as Lyrics;

const scrolls = vi.fn();

function reducedMotion(reduce: boolean): void {
  const base = window.matchMedia;
  window.matchMedia = (query: string) =>
    /reduced-motion/.test(query) ? { ...base(query), matches: reduce } : base(query);
}

async function openLyrics(lyrics: (id: string) => Promise<Lyrics | null>) {
  const fake = signInFake({ lyrics });
  fake.player.playTracks(tracks, 1);
  renderApp('/lyrics');
  const main = within(await screen.findByRole('main'));
  await main.findByRole('heading', { level: 1, name: 'Lyrics' });
  return { ...fake, main };
}

const time = (position: number) => ({ type: 'time' as const, position, duration: 120 });

describe('Lyrics', () => {
  beforeEach(() => {
    setLanguage('en');
    setViewport(390);
    scrolls.mockClear();
    Element.prototype.scrollIntoView = scrolls;
  });
  afterEach(() => {
    vi.useRealTimers();
    updateSettings({ mode: 'simple' });
  });

  it('highlights the sung line, keeps it in the middle, and plays from a tapped line', async () => {
    reducedMotion(false);
    const { main, audio, player } = await openLyrics((id) =>
      Promise.resolve(id === 't2' ? synced : null),
    );
    expect(main.getByText('Carefree · Kevin MacLeod')).toBeInTheDocument();
    const list = main.getByRole('list', { name: 'Lyrics' });
    const lines = within(list).getAllByRole('button');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toHaveAccessibleName('Instrumental');
    expect(lines[3]).toHaveAccessibleDescription('Play from 0:20');
    // Before the first line nothing is current and nothing scrolls.
    expect(list.querySelector('[aria-current]')).toBeNull();
    expect(scrolls).not.toHaveBeenCalled();

    act(() => audio.emit(time(11)));
    expect(lines[1]).toHaveAttribute('aria-current', 'true');
    // The first scroll jumps; the next ones glide.
    expect(scrolls).toHaveBeenLastCalledWith({ block: 'center', behavior: 'auto' });
    act(() => audio.emit(time(16)));
    expect(lines[2]).toHaveAttribute('aria-current', 'true');
    expect(lines[1]).not.toHaveAttribute('aria-current');
    expect(scrolls).toHaveBeenLastCalledWith({ block: 'center', behavior: 'smooth' });

    // A tap seeks to the line's start; when paused it plays from there.
    player.pause();
    const user = userEvent.setup();
    await user.click(lines[3] as HTMLElement);
    expect(audio.log).toContain('seek 20');
    expect(player.snapshot.position).toBe(20);
    expect(player.snapshot.status).toBe('playing');
    expect(lines[3]).toHaveAttribute('aria-current', 'true');
  });

  it('is one tab stop; arrows, Home and End move through the lines and Enter seeks', async () => {
    const { main, audio } = await openLyrics(() => Promise.resolve(synced));
    act(() => audio.emit(time(10)));
    const lines = within(main.getByRole('list')).getAllByRole('button');
    expect(lines.map((l) => l.tabIndex)).toEqual([-1, 0, -1, -1]);
    const user = userEvent.setup();
    act(() => (lines[1] as HTMLElement).focus());
    await user.keyboard('{ArrowDown}');
    expect(lines[2]).toHaveFocus();
    await user.keyboard('{End}');
    expect(lines[3]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(lines[3]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(lines[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(lines[0]).toHaveFocus();
    expect(lines.map((l) => l.tabIndex)).toEqual([0, -1, -1, -1]);
    await user.keyboard('{Enter}');
    expect(audio.log).toContain('seek 5');
  });

  it('stops following while the listener scrolls and comes back a few seconds after', async () => {
    reducedMotion(true);
    const { main, audio } = await openLyrics(() => Promise.resolve(synced));
    act(() => audio.emit(time(6)));
    expect(scrolls).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const scroller = screen.getByRole('main');

    fireEvent.wheel(scroller);
    const back = main.getByRole('button', { name: 'Back to the current line' });
    act(() => audio.emit(time(11)));
    expect(scrolls).toHaveBeenCalledTimes(1);

    // Another scroll (here a key) restarts the wait.
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.keyDown(scroller, { key: 'PageDown' });
    act(() => vi.advanceTimersByTime(3000));
    expect(back).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(main.queryByRole('button', { name: 'Back to the current line' })).toBeNull();
    // Reduced motion: it jumps back instead of gliding.
    expect(scrolls).toHaveBeenLastCalledWith({ block: 'center', behavior: 'auto' });
    expect(scrolls).toHaveBeenCalledTimes(2);

    // A scroll the view did not make (the scrollbar) pauses too; the button resumes at once.
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.scroll(scroller);
    fireEvent.click(main.getByRole('button', { name: 'Back to the current line' }));
    expect(main.queryByRole('button', { name: 'Back to the current line' })).toBeNull();
    expect(scrolls).toHaveBeenCalledTimes(3);
    // Its own scroll events and a Space on a button do not pause it; a finger on the screen does.
    fireEvent.scroll(scroller);
    fireEvent.keyDown(within(main.getByRole('list')).getAllByRole('button')[0] as HTMLElement, {
      key: ' ',
    });
    expect(main.queryByRole('button', { name: 'Back to the current line' })).toBeNull();
    fireEvent.touchMove(scroller);
    expect(main.getByRole('button', { name: 'Back to the current line' })).toBeInTheDocument();
  });

  it('shows lyrics without timings as verses that do not move', async () => {
    const { main, audio } = await openLyrics(() => Promise.resolve(plain));
    expect(
      main.getByText('These lyrics have no timings, so they do not follow the song.'),
    ).toBeInTheDocument();
    const verses = main.getAllByTestId('lyric-verse');
    expect(verses.map((v) => v.textContent)).toEqual(['First lineSecond line', 'Next verse']);
    expect(main.getByRole('region', { name: 'Lyrics' })).toBeInTheDocument();
    act(() => audio.emit(time(30)));
    expect(main.queryAllByTestId('lyric-line')).toHaveLength(0);
    expect(scrolls).not.toHaveBeenCalled();
  });

  it('says when a song has no lyrics, and where Jellyfin looks in advanced mode', async () => {
    const { main } = await openLyrics(() => Promise.resolve(null));
    expect(await main.findByText('No lyrics for this song')).toBeInTheDocument();
    expect(main.queryByText(/LrcLib/)).toBeNull();
    updateSettings({ mode: 'advanced' });
    expect(await main.findByText(/beside the song, or from its LrcLib plugin/)).toBeInTheDocument();
  });

  it('says the lyrics could not be loaded and tries again', async () => {
    let fail = true;
    const { main } = await openLyrics(() =>
      fail ? Promise.reject(new ServerError(404, '/Audio/t2/Lyrics')) : Promise.resolve(plain),
    );
    expect(await main.findByText('The lyrics could not be loaded')).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(main.getByRole('button', { name: 'Try again' }));
    expect(await main.findByText('Next verse')).toBeInTheDocument();
  });

  it('links back to now playing, says nothing is playing without a song, and speaks Gujarati', async () => {
    signInFake();
    setLanguage('gu');
    renderApp('/lyrics');
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { level: 1, name: 'ગીતના શબ્દો' })).toBeInTheDocument();
    expect(main.getByText('કંઈ વાગતું નથી')).toBeInTheDocument();
    expect(main.getByRole('link', { name: 'હમણાં વાગે છે પર પાછા જાઓ' })).toHaveAttribute(
      'href',
      '/now-playing',
    );
    await waitFor(() => expect(document.title).toBe('ગીતના શબ્દો · Renaissance'));
  });
});
