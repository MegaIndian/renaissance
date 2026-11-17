import type { IconName } from './Icon';

/** Simple mode's three destinations, shared by Sidebar and TabBar. No Search tab: the Ask bar is the search. */
export const primaryNav = [
  { to: '/', key: 'nav.home', icon: 'home' },
  { to: '/library', key: 'nav.library', icon: 'library' },
  { to: '/requests', key: 'nav.requests', icon: 'requests' },
] as const satisfies readonly { to: string; key: string; icon: IconName }[];
