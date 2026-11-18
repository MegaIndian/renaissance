import type { IconName } from '@renaissance/design';

/** Simple mode's three destinations, the same three (and the same glyphs) as web's Sidebar and TabBar. */
export const primaryNav = [
  { name: 'index', key: 'nav.home', icon: 'home' },
  { name: 'library', key: 'nav.library', icon: 'library' },
  { name: 'requests', key: 'nav.requests', icon: 'requests' },
] as const satisfies readonly { name: string; key: string; icon: IconName }[];
