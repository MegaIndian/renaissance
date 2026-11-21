import { focusRing } from './focus';

/**
 * Pill group on a `muted` track; the active segment sits on `card` with the low shadow (DESIGN.md
 * rule 4). Each segment is at least 24 px tall (30 px in simple mode), the target minimum.
 */
export function SegmentedControl<T extends string>({
  label,
  labelledBy,
  value,
  options,
  onChange,
}: {
  label: string;
  /** The id of a visible caption that names the group; `label` is then for sighted readers only. */
  labelledBy?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="inline-flex rounded-md bg-muted p-0.5"
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`min-h-6 min-w-6 rounded-sm px-2 py-1.5 text-caption ${focusRing} ${
              active
                ? 'bg-card text-foreground shadow-low'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
