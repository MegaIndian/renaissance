import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { setViewport } from '../test/setup';
import { signInFake, tracks } from '../test/fakes';
import { renderWithI18n } from '../test/render';
import { NowPlayingBar } from './NowPlayingBar';
import { TrackRow } from './TrackRow';

describe('NowPlayingBar placeholder colour', () => {
  it('hashes the track id, so the bar and the row show the same song in the same colour', () => {
    setLanguage('en');
    setViewport(1280);
    const { player } = signInFake();
    // A track with an album: the bar used to hash the album id and disagree with its own row.
    const track = tracks.find((t) => t.albumId)!;
    player.playTracks([track], 0);
    renderWithI18n(
      <>
        <div data-testid="row">
          <TrackRow track={track} index={0} onPlay={() => undefined} />
        </div>
        <NowPlayingBar />
      </>,
    );
    const row = within(screen.getByTestId('row')).getByTestId('placeholder-art');
    const bar = within(screen.getByRole('contentinfo')).getByTestId('placeholder-art');
    expect(bar.style.background).toBe(row.style.background);
    expect(bar.style.background).not.toBe('');
  });
});
