/**
 * The glyphs the shells draw, as SVG path data on a 24 × 24 grid, stroked in `currentColor` at 1.5.
 * One list for web (`apps/web/src/components/Icon.tsx`) and mobile (`apps/mobile/src/components/Icon.tsx`)
 * so the mirrored components show the same shapes.
 */
export const iconPaths = {
  search: 'M10.5 3.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm0 0 M15.5 15.5 21 21',
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10',
  /** A list of songs: three rows with a leading dot each. */
  library: 'M8.5 6H20M8.5 12H20M8.5 18H20M4 6h.01M4 12h.01M4 18h.01',
  requests: 'M12 4v16M4 12h16',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  play: 'M7 5v14l11-7Z',
  pause: 'M7 5h3v14H7Zm7 0h3v14h-3Z',
  next: 'M5 5v14l9-7Zm12 0v14h2V5Z',
  previous: 'M19 5v14l-9-7Zm-12 0v14H5V5Z',
  shuffle:
    'M4 17h3.5l9-10H20m0 0-2.5-2.5M20 7l-2.5 2.5M4 7h3.5l2 2.2M20 17h-3.5l-2-2.2M20 17l-2.5-2.5M20 17l-2.5 2.5',
  repeat: 'M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1',
  repeatOne:
    'M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1M12 9.5l1.5-1v6',
  heart: 'M12 20.5s-7.5-4.6-7.5-10A4 4 0 0 1 12 8a4 4 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10Z',
  heartFilled: 'M12 20.5s-7.5-4.6-7.5-10A4 4 0 0 1 12 8a4 4 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10Z',
  queue: 'M4 6h12M4 11h12M4 16h7M17 13v7M20.5 15.5 17 13l-3.5 2.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  grid: 'M4 4h6v6H4Zm10 0h6v6h-6ZM4 14h6v6H4Zm10 0h6v6h-6Z',
  list: 'M4 6h16M4 12h16M4 18h16',
  check: 'M5 12.5l4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6 6 18',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.1.9-1.4-.9-1.4-2-.4-.9-1.6.5-2-1.4-.9-1.9.8-1.7-.5L11.3 4H9.7L9 6l-1.7.5-1.9-.8L4 6.6l.5 2-.9 1.6-2 .4L.7 12l.9 1.4 2 .4.9 1.6-.5 2 1.4.9 1.9-.8 1.7.5.7 1.9h1.6l.7-1.9 1.7-.5 1.9.8 1.4-.9-.5-2 .9-1.6 2-.4Z',
  lyrics: 'M4 6h16M4 10h16M4 14h10M4 18h6',
  cast: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M3 10a10 10 0 0 1 10 10M3 14a6 6 0 0 1 6 6M3 18a2 2 0 0 1 2 2',
  volume: 'M5 10v4h3l4 3V7l-4 3H5Zm11-1.5a4 4 0 0 1 0 7M18 6a8 8 0 0 1 0 12',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5m4-5v5',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  plus: 'M12 5v14M5 12h14',
  arrowUp: 'M12 19V5m-6 6 6-6 6 6',
  arrowDown: 'M12 5v14m-6-6 6 6 6-6',
  signOut: 'M10 4H5v16h5M14 8l5 4-5 4m5-4H9',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  music: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  album: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  playlist: 'M4 6h12M4 11h12M4 16h7M19 13v6a2 2 0 1 1-2-2h2V9',
  edit: 'M4 20h4l11-11-4-4L4 16v4ZM13 7l4 4',
  sort: 'M4 6h16M7 12h10M10 18h4',
  filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z',
  wifi: 'M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01',
} as const;

export type IconName = keyof typeof iconPaths;

const filled: readonly IconName[] = ['play', 'pause', 'next', 'previous', 'heartFilled'];

/** Which glyphs are filled shapes; the rest are strokes. */
export function iconIsFilled(name: IconName): boolean {
  return filled.includes(name);
}
