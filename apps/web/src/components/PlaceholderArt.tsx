import { chart } from '@renaissance/design';

/** Square placeholder art in the six chart colours, as in the mockup. */
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
  const cls = size === 'sm' ? 'size-9 rounded-sm' : 'aspect-square w-full rounded-sm';
  return (
    <div aria-hidden className={`relative overflow-hidden ${cls}`} style={{ background: color }}>
      {label ? (
        <span className="absolute bottom-1.5 left-2 text-[11px] font-semibold text-white/85">
          {label}
        </span>
      ) : null}
    </div>
  );
}
