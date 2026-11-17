import { breakpoints } from '@renaissance/design';
import { useEffect, useState } from 'react';

const query = `(min-width: ${breakpoints.tablet}px)`;

function matches(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** True from the tablet breakpoint up: the sidebar and top bar layout instead of tabs. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const onChange = (): void => setDesktop(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return desktop;
}
