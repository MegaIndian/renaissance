import type { ComponentProps } from 'react';
import { Link } from 'react-router';

import { focusRing } from './focus';

const base = `inline-flex min-h-6 items-center justify-center gap-2 rounded-sm px-3 py-2 text-body font-medium ${focusRing}`;
const tones = {
  /** The one blue on a screen (DESIGN.md rule 1). */
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-muted',
  ghost: 'text-muted-foreground hover:text-foreground',
} as const;
/** Disabled: never blue (rule 1); a filled button drops to the muted fill, a ghost stays text-only. */
const disabled = 'bg-muted text-muted-foreground cursor-not-allowed hover:opacity-100';
const disabledGhost = 'text-muted-foreground cursor-not-allowed';

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
      className={`${base} ${props.disabled ? (tone === 'ghost' ? disabledGhost : disabled) : tones[tone]} ${className}`}
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
