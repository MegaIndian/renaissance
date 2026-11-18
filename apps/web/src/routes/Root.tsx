import { Suspense, useRef } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';

import { AskBar } from '../components/AskBar';
import { Dialogs } from '../components/Dialogs';
import { Icon } from '../components/Icon';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { NowPlayingBar } from '../components/NowPlayingBar';
import { ScrollContainerContext } from '../components/ScrollContainer';
import { Sidebar } from '../components/Sidebar';
import { TabBar } from '../components/TabBar';
import { Toast } from '../components/Toast';
import { focusRing } from '../components/focus';
import { useIsDesktop } from '../lib/media';
import { useSession } from '../lib/queries';

/**
 * The shell. Desktop (768 px and up): Sidebar, the Ask bar as a top bar, content, player.
 * Phone: header with the language switch and the avatar (Settings when signed in, Sign in when not),
 * content, the Ask bar above the player, TabBar. The Ask bar is rendered once, here, so it is on
 * every screen (DESIGN.md rule 7). The router's error element passes its own content as `children`.
 */
export function Root({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const desktop = useIsDesktop();
  const session = useSession();
  const main = useRef<HTMLElement>(null);
  const signedIn = session.status === 'signedIn';
  return (
    <div className="flex h-full flex-row">
      {desktop ? <Sidebar /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {desktop ? (
          <div className="relative z-10 border-b border-border px-6 py-3">
            <AskBar />
          </div>
        ) : (
          <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
            <span aria-hidden className="inline-block size-3.5 rounded-sm bg-primary" />
            <span className="brand-name min-w-0 flex-1 truncate text-body font-semibold">
              {t('app.name')}
            </span>
            <LanguageSwitch />
            <NavLink
              to={signedIn ? '/settings' : '/sign-in'}
              aria-label={signedIn ? t('nav.settings') : t('signIn.submit')}
              className={({ isActive }) =>
                `grid size-8 place-items-center rounded-pill border border-border ${focusRing} ${
                  isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'
                }`
              }
            >
              <Icon name={signedIn ? 'settings' : 'person'} />
            </NavLink>
          </header>
        )}
        <ScrollContainerContext.Provider value={main}>
          <main ref={main} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
            <Suspense fallback={<p className="sr-only">{t('player.loading')}</p>}>
              {children ?? <Outlet />}
            </Suspense>
          </main>
        </ScrollContainerContext.Provider>
        <Toast />
        {desktop ? null : (
          <div className="relative z-10 border-t border-border px-4 py-2">
            <AskBar compact />
          </div>
        )}
        <NowPlayingBar />
        {desktop ? null : <TabBar />}
      </div>
      <Dialogs />
    </div>
  );
}
