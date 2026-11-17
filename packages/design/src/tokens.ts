/**
 * Design tokens, taken from docs/design/mockup-2026-11-17.html and the T3 Code look:
 * flat cards, hairline borders, muted neutrals, one blue primary, segmented controls, compact type.
 * Dark is the reference theme; light mirrors it. Both apps consume these, nothing else defines a colour.
 */

export const colors = {
  dark: {
    background: '#0f0f14',
    foreground: '#e8e8ee',
    card: '#17171e',
    border: '#2a2a35',
    muted: '#22222c',
    mutedForeground: '#9a9aae',
    primary: '#3b82f6',
    primaryForeground: '#ffffff',
    secondary: '#1f1f28',
    secondaryForeground: '#e8e8ee',
    ring: '#3b82f6',
    success: '#22c55e',
    info: '#3b82f6',
    danger: '#f87171',
  },
  light: {
    background: '#ffffff',
    foreground: '#111118',
    card: '#f7f7f9',
    border: '#e3e3e9',
    muted: '#eeeef2',
    mutedForeground: '#6b6b7e',
    primary: '#2563eb',
    primaryForeground: '#ffffff',
    secondary: '#f1f1f5',
    secondaryForeground: '#111118',
    ring: '#2563eb',
    success: '#16a34a',
    info: '#2563eb',
    danger: '#dc2626',
  },
} as const;

/** Cover-art placeholder and chart colours; six, in the mockup's order. */
export const chart = ['#3b82f6', '#14b8a6', '#f59e0b', '#a78bfa', '#f87171', '#a3e635'] as const;

export const radius = {
  /** Cards, inputs, segmented controls. */
  md: 10,
  /** Inside a card: art, buttons, segment pills. */
  sm: 8,
  /** Phone frame and now-playing art. */
  lg: 16,
  pill: 999,
} as const;

/** Spacing scale in px; 4-point grid. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

export const font = {
  sans: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
} as const;

/**
 * Type scale in px. Compact by default; simple mode multiplies every size by `simpleModeScale`.
 */
export const type = {
  caption: { size: 11, lineHeight: 14, weight: 400 },
  body: { size: 13, lineHeight: 18, weight: 400 },
  bodyStrong: { size: 13, lineHeight: 18, weight: 500 },
  label: { size: 12, lineHeight: 16, weight: 500 },
  title: { size: 15, lineHeight: 20, weight: 600 },
  heading: { size: 18, lineHeight: 24, weight: 600 },
  display: { size: 24, lineHeight: 30, weight: 600 },
} as const;

export const simpleModeScale = 1.25;

export const border = { hairline: 1 } as const;

export const shadow = {
  /** The only shadow in the system: the lifted now-playing art and the segmented control's active pill. */
  low: '0 1px 2px rgba(0,0,0,.15)',
  art: '0 8px 24px rgba(0,0,0,.25)',
} as const;

export const motion = {
  fast: 120,
  normal: 200,
  slow: 320,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export const breakpoints = { phone: 0, tablet: 768, desktop: 1024 } as const;

export type Theme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)['dark'];

export const tokens = {
  colors,
  chart,
  radius,
  space,
  font,
  type,
  simpleModeScale,
  border,
  shadow,
  motion,
  breakpoints,
};
export type Tokens = typeof tokens;
