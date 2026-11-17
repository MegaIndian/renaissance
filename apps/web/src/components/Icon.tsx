/** The few glyphs the shell needs, as inline SVG on currentColor so they take token colours. */
const paths = {
  search: 'M10.5 3.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm0 0 M15.5 15.5 21 21',
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10',
  library: 'M4 5v14M9 5v14M14 6l5 13',
  requests: 'M12 4v16M4 12h16',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  play: 'M7 5v14l11-7Z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  className = 'size-4',
}: {
  name: IconName;
  /** Size utilities from the token grid (size-4, size-5, size-6). */
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill={name === 'play' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d={paths[name]} />
    </svg>
  );
}
