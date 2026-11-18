/**
 * The glyphs the shells draw, as SVG path data on a 24 × 24 grid, stroked in `currentColor` at 1.5.
 * One list for web (`apps/web/src/components/Icon.tsx`) and mobile (`apps/mobile/src/components/Icon.tsx`)
 * so the mirrored components show the same six shapes.
 */
export const iconPaths = {
  search: 'M10.5 3.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm0 0 M15.5 15.5 21 21',
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10',
  /** A list of songs: three rows with a leading dot each. */
  library: 'M8.5 6H20M8.5 12H20M8.5 18H20M4 6h.01M4 12h.01M4 18h.01',
  requests: 'M12 4v16M4 12h16',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  play: 'M7 5v14l11-7Z',
} as const;

export type IconName = keyof typeof iconPaths;

/** `play` is the one filled glyph; the rest are strokes. */
export function iconIsFilled(name: IconName): boolean {
  return name === 'play';
}
