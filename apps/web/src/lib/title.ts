import { useEffect } from 'react';

import { i18n } from './i18n';

/**
 * The document title (design AH): the screen's name first, the app's after it, so every tab and
 * history entry says where it is ("Library · Renaissance", "લાઇબ્રેરી · Renaissance"). The shell
 * sets the route's name from the catalogs on every navigation; a screen with a name of its own (an
 * album, an artist, a playlist, the not-found page) sets it once the name is known.
 */
export function setTitle(part: string): void {
  document.title = `${part} · ${i18n.t('app.name')}`;
}

/** The screens whose title key is not `nav.<first path segment>`; the id screens set their own. */
const OTHER_TITLE_KEYS: Record<string, string> = {
  'now-playing': 'nav.nowPlaying',
  'sign-in': 'signIn.submit',
};

/** The catalog key for a route's title; null for a screen that names itself or an unknown address. */
export function routeTitleKey(pathname: string): string | null {
  const first = pathname.split('/')[1] || 'home';
  const key = OTHER_TITLE_KEYS[first] ?? `nav.${first}`;
  return i18n.exists(key) ? key : null;
}

/** A screen's own name for the title, set when it is known and again when the language changes. */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (title) setTitle(title);
  }, [title]);
}
