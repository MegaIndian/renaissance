import { chart } from '@renaissance/design';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlaceholderArt } from './PlaceholderArt';

describe('PlaceholderArt', () => {
  it('cycles the six chart colours and hides from the accessibility tree', () => {
    render(<PlaceholderArt index={7} label="A" />);
    const art = screen.getByTestId('placeholder-art');
    expect(art).toHaveAttribute('aria-hidden');
    expect(art.style.background).toBe(hexToRgb(chart[1] as string));
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});

function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
