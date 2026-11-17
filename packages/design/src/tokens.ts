/**
 * Design tokens, taken from docs/design/mockup-2026-11-17.html and the T3 Code look:
 * flat cards, hairline borders, muted neutrals, one blue primary, segmented controls, compact type.
 * Dark is the reference theme; light mirrors it. Both apps consume these, nothing else defines a colour.
 *
 * Every `*Foreground` token is the text colour for its surface. `test/contrast.test.ts` computes the
 * WCAG ratio of every pair in `textPairs` (see contrast.ts) and fails the build under 4.5:1.
 */

export const colors = {
  dark: {
    background: '#0f0f14',
    foreground: '#e8e8ee',
    card: '#17171e',
    border: '#2a2a35',
    /** Form inputs: 3:1 or better against `background` and `card`, so the control's edge is visible. */
    inputBorder: '#6a6a80',
    muted: '#22222c',
    mutedForeground: '#9a9aae',
    primary: '#2f6fe0',
    primaryForeground: '#ffffff',
    secondary: '#1f1f28',
    secondaryForeground: '#e8e8ee',
    ring: '#2f6fe0',
    success: '#22c55e',
    successForeground: '#0f0f14',
    info: '#2f6fe0',
    infoForeground: '#ffffff',
    danger: '#f87171',
    dangerForeground: '#0f0f14',
  },
  light: {
    background: '#ffffff',
    foreground: '#111118',
    card: '#f7f7f9',
    border: '#e3e3e9',
    inputBorder: '#8a8a9c',
    muted: '#eeeef2',
    mutedForeground: '#6b6b7e',
    primary: '#2563eb',
    primaryForeground: '#ffffff',
    secondary: '#f1f1f5',
    secondaryForeground: '#111118',
    ring: '#2563eb',
    success: '#15803d',
    successForeground: '#ffffff',
    info: '#2563eb',
    infoForeground: '#ffffff',
    danger: '#dc2626',
    dangerForeground: '#ffffff',
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

/** Spacing scale in px; 4-point grid. Tailwind's `p-4` is `space[4]`, and so on. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

export const font = {
  sans: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
} as const;

/**
 * Type scale in px at the 16 px root. The CSS build emits every size in rem so the browser's font
 * setting and simple mode (`simpleModeScale` on the root) scale all of them together.
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

/** Simple mode: the root font size is multiplied by this, so every rem value grows with it. */
export const simpleModeScale = 1.25;

/** The root size that `type` and `space` are expressed against; rem = px / rootFontSize. */
export const rootFontSize = 16;

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
export type TypeToken = keyof typeof type;
export type SpaceToken = keyof typeof space;

export const tokens = {
  colors,
  chart,
  radius,
  space,
  font,
  type,
  simpleModeScale,
  rootFontSize,
  border,
  shadow,
  motion,
  breakpoints,
};
export type Tokens = typeof tokens;
