import { chart, chartInk } from '@renaissance/design';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { session, track, tracks } from '../test/fakes';
import { sessionStore } from '../lib/session';
import { Artwork } from './Artwork';
import { ART_SIZES, PLACEHOLDER_COLORS, PlaceholderArt } from './PlaceholderArt';
import { TrackRow } from './TrackRow';
import { renderWithI18n } from '../test/render';

function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe('PlaceholderArt', () => {
  it('cycles five chart colours (never the blue beside primary), labels in the chart ink, and hides from the tree', () => {
    expect(PLACEHOLDER_COLORS).toEqual(chart.slice(1));
    expect(PLACEHOLDER_COLORS).not.toContain(chart[0]);
    render(<PlaceholderArt index={7} label="A" />);
    const art = screen.getByTestId('placeholder-art');
    expect(art).toHaveAttribute('aria-hidden');
    expect(art.style.background).toBe(hexToRgb(PLACEHOLDER_COLORS[7 % 5] as string));
    expect(screen.getByText('A')).toHaveClass('text-chart-ink');
    expect(chartInk).toBe('#111118');
  });

  it('a placeholder box has exactly the image box classes at every size, so rows stay in their geometry', () => {
    sessionStore.set({
      status: 'signedIn',
      session,
      adapter: { imageUrl: () => 'http://demo.local/img' } as never,
      vault: 'encrypted',
      reason: null,
    });
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      const withImage = render(<Artwork imageId="img" label="A" index={1} size={size} />);
      const img = withImage.container.querySelector('img') as HTMLImageElement;
      const without = render(<Artwork imageId={undefined} label="A" index={1} size={size} />);
      const placeholder = without.getByTestId('placeholder-art');
      const sizeClasses = ART_SIZES[size].split(' ');
      for (const cls of sizeClasses) {
        expect(img, `${size} image`).toHaveClass(cls);
        expect(placeholder, `${size} placeholder`).toHaveClass(cls);
      }
      // No second size class is appended after the shared one.
      const extra = [...placeholder.classList].filter(
        (c) => /^size-\d/.test(c) && !sizeClasses.includes(c),
      );
      expect(extra, `${size} placeholder extra size classes`).toEqual([]);
      withImage.unmount();
      without.unmount();
    }
    // The small placeholder carries no label; it would not fit in 36 px.
    render(<Artwork imageId={undefined} label="A" index={1} size="xs" />);
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('a track row is 3.5 rem tall and its art is the xs box whether or not the cover exists', () => {
    sessionStore.set({
      status: 'signedIn',
      session,
      adapter: { imageUrl: () => 'http://demo.local/img' } as never,
      vault: 'encrypted',
      reason: null,
    });
    const { container, unmount } = renderWithI18n(
      <TrackRow track={tracks[0] as (typeof tracks)[number]} index={0} onPlay={() => undefined} />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.height).toBe('3.5rem');
    expect(screen.getByTestId('placeholder-art')).toHaveClass('size-9');
    unmount();
    const withImage = renderWithI18n(
      <TrackRow track={track('img', { imageId: 'img' })} index={0} onPlay={() => undefined} />,
    );
    expect(withImage.container.querySelector('img')).toHaveClass('size-9');
  });
});
