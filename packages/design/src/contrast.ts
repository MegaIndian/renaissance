/**
 * WCAG 2.x contrast, computed from the tokens so the numbers in DESIGN.md are measured, not promised.
 * `textPairs` lists every text-on-surface pair the apps may draw; the test fails the build under 4.5:1.
 */
import { colors } from './tokens';
import type { ColorToken, Theme } from './tokens';

export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) throw new Error(`Expected a six-digit hex colour, got ${hex}`);
  const channel = (i: number): number => {
    const v = parseInt(clean.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Contrast ratio between two hex colours, 1 to 21, rounded to two decimals. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

export interface ColorPair {
  /** The text or glyph colour. */
  foreground: ColorToken;
  /** The surface it sits on. */
  background: ColorToken;
  /** 4.5 for text, 3 for control boundaries and large text. */
  minimum: 4.5 | 3;
}

/** Text on the surfaces it is drawn on. Both themes must pass every pair. */
export const textPairs: readonly ColorPair[] = [
  { foreground: 'foreground', background: 'background', minimum: 4.5 },
  { foreground: 'foreground', background: 'card', minimum: 4.5 },
  { foreground: 'foreground', background: 'muted', minimum: 4.5 },
  { foreground: 'mutedForeground', background: 'background', minimum: 4.5 },
  { foreground: 'mutedForeground', background: 'card', minimum: 4.5 },
  { foreground: 'mutedForeground', background: 'muted', minimum: 4.5 },
  { foreground: 'primaryForeground', background: 'primary', minimum: 4.5 },
  { foreground: 'secondaryForeground', background: 'secondary', minimum: 4.5 },
  { foreground: 'successForeground', background: 'success', minimum: 4.5 },
  { foreground: 'infoForeground', background: 'info', minimum: 4.5 },
  { foreground: 'dangerForeground', background: 'danger', minimum: 4.5 },
  { foreground: 'success', background: 'background', minimum: 4.5 },
  { foreground: 'danger', background: 'background', minimum: 4.5 },
];

/** Control boundaries: the focus ring, the primary button's edge and form input borders. */
export const controlPairs: readonly ColorPair[] = [
  { foreground: 'primary', background: 'background', minimum: 3 },
  { foreground: 'primary', background: 'card', minimum: 3 },
  { foreground: 'ring', background: 'background', minimum: 3 },
  { foreground: 'ring', background: 'card', minimum: 3 },
  { foreground: 'inputBorder', background: 'background', minimum: 3 },
  { foreground: 'inputBorder', background: 'card', minimum: 3 },
];

export interface MeasuredPair extends ColorPair {
  theme: Theme;
  ratio: number;
  passes: boolean;
}

/** Every pair measured in both themes; what DESIGN.md's table is generated from. */
export function measureContrast(): MeasuredPair[] {
  const out: MeasuredPair[] = [];
  for (const theme of Object.keys(colors) as Theme[]) {
    for (const pair of [...textPairs, ...controlPairs]) {
      const ratio = contrastRatio(colors[theme][pair.foreground], colors[theme][pair.background]);
      out.push({ ...pair, theme, ratio, passes: ratio >= pair.minimum });
    }
  }
  return out;
}

/** A Markdown table of `measureContrast()` for DESIGN.md. */
export function contrastTable(): string {
  const rows = measureContrast().map(
    (m) =>
      `| ${m.theme} | \`${m.foreground}\` on \`${m.background}\` | ${m.minimum}:1 | ${m.ratio.toFixed(2)}:1 | ${m.passes ? 'pass' : 'FAIL'} |`,
  );
  return ['| Theme | Pair | Needs | Measured | |', '| --- | --- | --- | --- | --- |', ...rows].join(
    '\n',
  );
}
