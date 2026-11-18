import { iconIsFilled, iconPaths } from '@renaissance/design';
import type { IconName } from '@renaissance/design';

export type { IconName };

/** The shell's glyphs as inline SVG on currentColor; the paths are shared with mobile through the design package. */
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
      fill={iconIsFilled(name) ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
