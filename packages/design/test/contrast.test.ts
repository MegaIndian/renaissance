import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  contrastTable,
  controlPairs,
  measureChartContrast,
  measureContrast,
  textPairs,
} from '../src/contrast';
import { colors } from '../src/tokens';

describe('contrast', () => {
  it('computes the WCAG ratio', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#ffffff', '#3b82f6')).toBe(3.68);
    expect(() => contrastRatio('#fff', '#000')).toThrow();
  });

  it('every text pair passes AA (4.5:1) in both themes', () => {
    const failing = measureContrast().filter((m) => m.minimum === 4.5 && !m.passes);
    expect(
      failing,
      failing.map((f) => `${f.theme} ${f.foreground}/${f.background} ${f.ratio}`).join(', '),
    ).toEqual([]);
  });

  it('every control boundary passes 3:1 in both themes', () => {
    const failing = measureContrast().filter((m) => m.minimum === 3 && !m.passes);
    expect(
      failing,
      failing.map((f) => `${f.theme} ${f.foreground}/${f.background} ${f.ratio}`).join(', '),
    ).toEqual([]);
  });

  it('the chart ink passes AA on all six swatches, so placeholder labels and genre cards read in both themes', () => {
    const measured = measureChartContrast();
    expect(measured).toHaveLength(6);
    expect(measured.filter((m) => !m.passes).map((m) => `${m.swatch} ${m.ratio}`)).toEqual([]);
    expect(Math.min(...measured.map((m) => m.ratio))).toBeGreaterThanOrEqual(4.5);
  });

  it('the pairs cover every foreground token', () => {
    const covered = new Set([...textPairs, ...controlPairs].map((p) => p.foreground));
    for (const token of Object.keys(colors.dark)) {
      if (token.endsWith('Foreground') || token === 'foreground')
        expect(covered.has(token as never)).toBe(true);
    }
  });

  it('renders the table DESIGN.md carries', () => {
    const table = contrastTable();
    expect(table).toContain('| dark | `primaryForeground` on `primary` | 4.5:1 |');
    expect(table).not.toContain('FAIL');
  });
});

describe('DESIGN.md', () => {
  it('carries the measured table', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
    // prettier pads table cells; compare with runs of spaces and dashes collapsed.
    const flat = (text: string): string => text.replace(/ +/g, ' ').replace(/-{3,}/g, '---');
    expect(flat(doc)).toContain(flat(contrastTable()));
  });
});
