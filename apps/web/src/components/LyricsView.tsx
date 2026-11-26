import { LyricsFollow, activeLyricIndex, formatDuration } from '@renaissance/core';
import type { Lyrics } from '@renaissance/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { getPlayer } from '../lib/player';
import { usePlayer } from '../lib/usePlayer';
import { Button } from './Button';
import { Icon } from './Icon';
import { useScrollContainer } from './ScrollContainer';
import { focusRing } from './focus';

/** Scroll events this long after the view scrolled itself are its own, not the listener's. */
const OWN_SCROLL_MS = 1000;
/** Keys that scroll the page when the focus is not in a text field. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Synced lyrics (F39): the sung line in the foreground, the rest muted, the view scrolled so the
 * sung line sits in the middle. Scrolling (wheel, touch, keys, the scrollbar) or moving through the
 * lines with the arrow keys stops the scroll; it comes back `LYRICS_RESUME_MS` after the last one,
 * or at once with the "back to the current line" button or a tap on a line. Every line is a button
 * that plays from its start; the list is one tab stop and the arrow keys, Home and End move in it.
 * With reduced motion the view jumps instead of gliding.
 */
export function SyncedLyrics({ lyrics, labelledBy }: { lyrics: Lyrics; labelledBy: string }) {
  const { t } = useTranslation();
  const { position, status } = usePlayer();
  const scroller = useScrollContainer();
  const active = activeLyricIndex(lyrics, position * 1000);
  const lines = useRef<(HTMLButtonElement | null)[]>([]);
  const follow = useRef(new LyricsFollow());
  const ownScrollUntil = useRef(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstScroll = useRef(true);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState<number | null>(null);

  const scrollToLine = useCallback((index: number) => {
    const line = lines.current[index];
    if (!line) return;
    ownScrollUntil.current = Date.now() + OWN_SCROLL_MS;
    const smooth = !firstScroll.current && !prefersReducedMotion();
    firstScroll.current = false;
    line.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const resume = useCallback(() => {
    clearTimeout(resumeTimer.current);
    follow.current.resume();
    setPaused(false);
  }, []);

  const pause = useCallback(() => {
    follow.current.pause(Date.now());
    setPaused(true);
    clearTimeout(resumeTimer.current);
    const check = (): void => {
      if (follow.current.following(Date.now())) setPaused(false);
      else resumeTimer.current = setTimeout(check, follow.current.resumesIn(Date.now()));
    };
    resumeTimer.current = setTimeout(check, follow.current.resumesIn(Date.now()));
  }, []);

  useEffect(() => () => clearTimeout(resumeTimer.current), []);

  // Follow the song: on every new line, and once more when following resumes.
  useEffect(() => {
    if (!paused && active >= 0) scrollToLine(active);
  }, [active, paused, scrollToLine]);

  // The listener's own scrolling pauses the follow; the view's own scroll events are ignored.
  useEffect(() => {
    const main = scroller?.current;
    if (!main) return;
    const onScroll = (): void => {
      if (Date.now() > ownScrollUntil.current) pause();
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (!SCROLL_KEYS.has(event.key) || isTextField(event.target)) return;
      if (event.key === ' ' && event.target instanceof HTMLButtonElement) return;
      pause();
    };
    main.addEventListener('wheel', pause, { passive: true });
    main.addEventListener('touchmove', pause, { passive: true });
    main.addEventListener('scroll', onScroll, { passive: true });
    main.addEventListener('keydown', onKey);
    return () => {
      main.removeEventListener('wheel', pause);
      main.removeEventListener('touchmove', pause);
      main.removeEventListener('scroll', onScroll);
      main.removeEventListener('keydown', onKey);
    };
  }, [scroller, pause]);

  const seekTo = (index: number): void => {
    const start = lyrics.lines[index]?.start ?? 0;
    const player = getPlayer();
    player.seek(start / 1000);
    if (status === 'paused') void player.play();
    resume();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>): void => {
    const from = focused ?? Math.max(0, active);
    const last = lyrics.lines.length - 1;
    const to = {
      ArrowDown: Math.min(last, from + 1),
      ArrowUp: Math.max(0, from - 1),
      Home: 0,
      End: last,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    pause();
    setFocused(to);
    lines.current[to]?.focus();
  };

  const tabStop = focused ?? Math.max(0, active);
  return (
    <div className="flex flex-col gap-3">
      <ol
        aria-labelledby={labelledBy}
        // Room under the last lines so they too can sit in the middle of the screen.
        className="flex flex-col gap-1 pb-64"
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
        }}
      >
        {lyrics.lines.map((line, index) => {
          const current = index === active;
          return (
            <li key={`${index}-${line.start ?? 0}`}>
              <button
                ref={(el) => {
                  lines.current[index] = el;
                }}
                type="button"
                tabIndex={index === tabStop ? 0 : -1}
                aria-current={current ? 'true' : undefined}
                aria-label={line.text ? undefined : t('lyrics.instrumental')}
                aria-description={t('lyrics.playFrom', {
                  time: formatDuration((line.start ?? 0) / 1000),
                })}
                data-testid="lyric-line"
                onFocus={() => setFocused(index)}
                onClick={() => seekTo(index)}
                className={`flex min-h-6 w-full items-center rounded-sm px-2 py-1 text-start text-heading transition-colors hover:text-foreground ${
                  current ? 'font-semibold text-foreground' : 'text-muted-foreground'
                } ${focusRing}`}
              >
                {line.text || <Icon name="music" className="size-4" />}
              </button>
            </li>
          );
        })}
      </ol>
      {paused && active >= 0 ? (
        <div className="sticky bottom-2 flex justify-center">
          <Button onClick={resume}>
            <Icon name="arrowDown" className="size-4" />
            {t('lyrics.current')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Lyrics without timings (F40): the text as verses, nothing highlighted, nothing scrolled. */
export function PlainLyrics({ lyrics, labelledBy }: { lyrics: Lyrics; labelledBy: string }) {
  const { t } = useTranslation();
  const verses: string[][] = [[]];
  for (const line of lyrics.lines) {
    if (line.text) verses[verses.length - 1]?.push(line.text);
    else verses.push([]);
  }
  return (
    <section aria-labelledby={labelledBy} className="flex flex-col gap-4">
      <p className="text-caption text-muted-foreground">{t('lyrics.unsynced')}</p>
      {verses
        .filter((verse) => verse.length)
        .map((verse, index) => (
          <p key={index} className="text-heading text-foreground" data-testid="lyric-verse">
            {verse.map((text, i) => (
              <span key={i} className="block">
                {text}
              </span>
            ))}
          </p>
        ))}
    </section>
  );
}
