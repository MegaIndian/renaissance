import { chart } from '@renaissance/design';

/** The same size vocabulary as `Artwork`, so a placeholder box equals an image box in every row. */
export const ART_SIZES = {
  xs: 'size-9',
  sm: 'size-12',
  md: 'aspect-square w-full',
  lg: 'aspect-square w-full',
} as const;
export type ArtSize = keyof typeof ART_SIZES;

/**
 * Placeholder colours: the chart set without `chart-1`, which sits a hair from `primary`, so a
 * library with missing covers never reads as a wall of the one blue (DESIGN.md rule 3).
 */
export const PLACEHOLDER_COLORS = chart.slice(1);

/**
 * Square placeholder art, as in the mockup. Stands in for art that exists (an album without a
 * cover); an empty row shows an EmptyState instead (DESIGN.md rule 3). The label is drawn in
 * `--chart-ink`, the one ink that passes 4.5:1 on every swatch in both themes.
 */
export function PlaceholderArt({
  index,
  label,
  size = 'md',
  className = '',
}: {
  index: number;
  label?: string | undefined;
  size?: ArtSize;
  className?: string;
}) {
  const color = PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length];
  return (
    <div
      aria-hidden
      data-testid="placeholder-art"
      className={`relative shrink-0 overflow-hidden ${ART_SIZES[size]} ${className}`}
      style={{ background: color }}
    >
      {label ? (
        <span className="absolute bottom-1.5 left-2 right-2 truncate text-caption font-semibold text-chart-ink">
          {label}
        </span>
      ) : null}
    </div>
  );
}
