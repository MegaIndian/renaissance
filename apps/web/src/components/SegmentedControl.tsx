/** Pill group on a `muted` track; the active segment sits on `card` with the low shadow (DESIGN.md rule 4). */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-muted p-0.5" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-sm px-2 py-0.5 text-caption outline-none focus-visible:ring-3 focus-visible:ring-ring/25 ${
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
