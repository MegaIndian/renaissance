import { iconPaths } from '@renaissance/design';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { signInFake, tracks } from '../test/fakes';
import { renderWithI18n } from '../test/render';
import { TrackRow } from './TrackRow';

/** The glyph drawn in the row's number or art slot (the only `aria-hidden` SVG before the title). */
function glyph(container: HTMLElement): string | null {
  const title = screen.getByRole('button', { name: /^(Play|Pause) / });
  const svg = container.querySelector('svg path');
  return svg && title ? svg.getAttribute('d') : null;
}

describe('TrackRow', () => {
  it('the current row shows the pause glyph while playing and the play glyph while paused, matching the button name', () => {
    setLanguage('en');
    signInFake();
    const track = tracks[0]!;
    for (const showNumber of [false, true]) {
      const playingView = renderWithI18n(
        <TrackRow
          track={track}
          index={0}
          onPlay={() => undefined}
          playing
          showNumber={showNumber}
        />,
      );
      expect(screen.getByRole('button', { name: `Pause ${track.title}` })).toBeInTheDocument();
      expect(glyph(playingView.container)).toBe(iconPaths.pause);
      playingView.unmount();

      const pausedView = renderWithI18n(
        <TrackRow
          track={track}
          index={0}
          onPlay={() => undefined}
          playing
          paused
          showNumber={showNumber}
        />,
      );
      expect(screen.getByRole('button', { name: `Play ${track.title}` })).toBeInTheDocument();
      expect(glyph(pausedView.container)).toBe(iconPaths.play);
      pausedView.unmount();
    }
  });

  it('a row that is not current shows its number or art, no transport glyph', () => {
    setLanguage('en');
    signInFake();
    const track = tracks[0]!;
    const { container } = renderWithI18n(
      <TrackRow track={track} index={4} onPlay={() => undefined} showNumber />,
    );
    expect(screen.getByRole('button', { name: `Play ${track.title}` })).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden]')?.textContent).toBe(
      String(track.trackNumber ?? 5),
    );
  });
});
