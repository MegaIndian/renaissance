/**
 * The focus indicator every control shares (DESIGN.md rule 7): a 2 px solid `ring` outline drawn
 * 2 px outside the control, so it sits on the surrounding surface and is the colour the contrast
 * test measures, plus a 3 px 25 % primary halo as decoration. No `outline-none` on the control:
 * Tailwind 4 implements it as a `none` outline style that would win over the focus-visible width,
 * and the browser's own ring only appears on focus-visible, where this one replaces it.
 */
export const focusRing =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-3 focus-visible:ring-primary/25';

/** The same indicator on a box whose input is inside it (the Ask bar). */
export const focusWithin =
  'focus-within:outline-solid focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring focus-within:ring-3 focus-within:ring-primary/25';
