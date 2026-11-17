import type { ComponentProps } from 'react';
import { Link } from 'react-router';

const base =
  'inline-flex items-center justify-center gap-2 rounded-sm px-3 py-2 text-body font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/25';
const tones = {
  /** The one blue on a screen (DESIGN.md rule 1). */
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-muted',
  ghost: 'text-muted-foreground hover:text-foreground',
} as const;
const disabled = 'bg-muted text-muted-foreground cursor-not-allowed hover:opacity-100';

export type ButtonTone = keyof typeof tones;

export function Button({
  tone = 'secondary',
  className = '',
  ...props
}: ComponentProps<'button'> & { tone?: ButtonTone }) {
  return (
    <button
      type="button"
      {...props}
      className={`${base} ${props.disabled ? disabled : tones[tone]} ${className}`}
    />
  );
}

export function LinkButton({
  tone = 'secondary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { tone?: ButtonTone }) {
  return <Link {...props} className={`${base} ${tones[tone]} ${className}`} />;
}
