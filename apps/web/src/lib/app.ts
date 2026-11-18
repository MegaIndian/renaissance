/**
 * Startup wiring: restore the session from the vault, then follow it. Signed in: open this user's
 * library cache, refresh it, restore the saved queue, follow the chosen language. Signed out: stop
 * the library, clear the player and the per-user queries so nothing of one person shows for the
 * next; a sign-out the user asked for also deletes that user's library database and saved queue from
 * this browser (F86). An expired token keeps them for the same person's next sign-in.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Session } from '@renaissance/core';

import { setLanguage } from './i18n';
import { deleteLibrary, startLibrary, stopLibrary } from './library';
import { forgetQueue, getPlayer, restoreQueue } from './player';
import { restoreSession, sessionStore } from './session';
import { settingsStore } from './settings';

export function startApp(queryClient: QueryClient): void {
  let lastUserKey: string | null = null;
  let lastSession: Session | null = null;
  sessionStore.subscribe((state) => {
    const key = state.session ? `${state.session.server.id}:${state.session.userId}` : null;
    if (key === lastUserKey) return;
    lastUserKey = key;
    if (state.status === 'signedIn' && state.session && state.adapter) {
      lastSession = state.session;
      void startLibrary(state.adapter, state.session);
      restoreQueue(state.session.userId);
    } else if (state.status === 'signedOut') {
      stopLibrary();
      getPlayer().clear();
      queryClient.clear();
      if (lastSession && state.reason !== 'expired') {
        void deleteLibrary(lastSession);
        forgetQueue(lastSession.userId);
      }
      lastSession = null;
    }
  });
  const language = settingsStore.get().language;
  if (language) setLanguage(language);
  void restoreSession();
}
