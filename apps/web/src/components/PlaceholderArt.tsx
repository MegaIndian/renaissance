import { chart } from '@renaissance/design';

/**
 * Square placeholder art in the six chart colours, as in the mockup. Stands in for art that exists
 * (an album without a cover); an empty row shows an EmptyState instead (DESIGN.md rule 3).
 */
export function PlaceholderArt({
  index,
  label,
  size = 'md',
}: {
  index: number;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const color = chart[index % chart.length];
  const cls = size === 'sm' ? 'size-12 rounded-sm' : 'aspect-square w-full rounded-sm';
  return (
    <div
      aria-hidden
      data-testid="placeholder-art"
      className={`relative shrink-0 overflow-hidden ${cls}`}
      style={{ background: color }}
    >
      {label ? (
        <span className="absolute bottom-1.5 left-2 text-caption font-semibold text-background">
          {label}
        </span>
      ) : null}
    </div>
  );
}
