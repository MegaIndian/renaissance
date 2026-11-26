/**
 * Startup wiring, as on web: restore the session from the Keychain, then follow it. Signed in: open
 * this user's library cache, refresh it, restore the saved queue. Signed out: stop the library, clear
 * the player and the per-user queries; a sign-out the user asked for also deletes that user's
 * library database and saved queue from this device (F86). An expired token keeps them for the same
 * person's next sign-in.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Session } from '@renaissance/core';

import { deleteLibrary, startLibrary, stopLibrary } from './library';
import { watchNetwork } from './network';
import { forgetQueue, getPlayer, restoreQueue } from './player';
import { sessionStore, sessions } from './session';

let started = false;

export function startApp(queryClient: QueryClient): void {
  if (started) return;
  started = true;
  watchNetwork();
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
  void sessions.restore();
}
