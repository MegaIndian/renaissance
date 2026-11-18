import type { IconName } from './Icon';

export interface NavItem {
  to: string;
  key: string;
  icon: IconName;
}

/** Simple mode's three destinations, shared by Sidebar and TabBar. No Search tab: the Ask bar is the search. */
export const primaryNav: readonly NavItem[] = [
  { to: '/', key: 'nav.home', icon: 'home' },
  { to: '/library', key: 'nav.library', icon: 'library' },
  { to: '/requests', key: 'nav.requests', icon: 'requests' },
];

/** Advanced mode adds Search as its own destination (DESIGN.md "Simple versus advanced"). */
export const advancedNav: readonly NavItem[] = [
  primaryNav[0] as NavItem,
  { to: '/search', key: 'nav.search', icon: 'search' },
  primaryNav[1] as NavItem,
  primaryNav[2] as NavItem,
];

export function navFor(mode: 'simple' | 'advanced'): readonly NavItem[] {
  return mode === 'advanced' ? advancedNav : primaryNav;
}
