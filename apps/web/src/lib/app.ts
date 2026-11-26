/**
 * Startup wiring: restore the session from the vault, then follow it. Signed in: open this user's
 * library cache and listening log, refresh the library, restore the saved queue, follow the chosen
 * language. Signed out: stop the library, clear the player, close the listening log (which stays on
 * the device, ADR 0014) and the per-user queries so nothing of one person shows for the next; a
 * sign-out the user asked for also deletes that user's library database and saved queue from this
 * browser (F86). An expired token keeps them for the same person's next sign-in. A sign-out in
 * another tab is followed here, with the same reason, so no tab keeps a dead token alive.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { PlayEvent, Session } from '@renaissance/core';

import type * as History from './history';
import { setLanguage } from './i18n';
import { deleteLibrary, startLibrary, stopLibrary } from './library';
import { forgetQueue, getPlayer, restoreQueue } from './player';
import { swallow } from './log';
import { deviceName, followOtherTabs, restoreSession, sessionStore } from './session';
import { settingsStore } from './settings';

/**
 * The listening log (F47) is its own chunk, loaded right after start, so the shell stays inside the
 * bundle budget. Calls made before it arrives run in order once it has.
 */
type HistoryModule = typeof History;
let historyModule: Promise<HistoryModule> | null = null;
function withHistory(run: (history: HistoryModule) => unknown): void {
  historyModule ??= import('./history');
  void historyModule.then(run).catch(() => undefined);
}

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
      const session = state.session;
      withHistory((history) => history.startHistory(session));
      restoreQueue(state.session.userId);
    } else if (state.status === 'signedOut') {
      stopLibrary();
      // The play that sign-out stops is still logged for the user who started it (history.ts).
      getPlayer().clear();
      withHistory((history) => history.stopHistory());
      queryClient.clear();
      if (lastSession && state.reason !== 'expired') {
        void deleteLibrary(lastSession);
        forgetQueue(lastSession.userId);
      }
      lastSession = null;
    }
  });
  // Every play from here on goes to the listening log (F47), beside the server's play reporting.
  // Plays that start or end before its chunk is in are held and handed over.
  const early: PlayEvent[] = [];
  const holdEarly = getPlayer().onPlay((event) => early.push(event));
  withHistory((history) => {
    holdEarly();
    history.attachHistory(getPlayer(), {
      context: () => {
        const session = sessionStore.get().session;
        return session
          ? { serverId: session.server.id, userId: session.userId, device: deviceName() }
          : null;
      },
      enabled: () => settingsStore.get().listeningLog,
      onError: swallow('history write failed'),
      earlier: early.splice(0),
    });
  });
  // A sign-out in another tab of this browser ends the session here too (shared vault, revoked token).
  followOtherTabs();
  const language = settingsStore.get().language;
  if (language) void setLanguage(language);
  void restoreSession();
}
