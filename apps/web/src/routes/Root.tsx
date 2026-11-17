import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';

import { AskBar } from '../components/AskBar';
import { Icon } from '../components/Icon';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { NowPlayingBar } from '../components/NowPlayingBar';
import { Sidebar } from '../components/Sidebar';
import { TabBar } from '../components/TabBar';
import { useIsDesktop } from '../lib/media';

/**
 * The shell. Desktop (768 px and up): Sidebar, the Ask bar as a top bar, content, player.
 * Phone: header with the language switch and sign-in, content, the Ask bar above the player, TabBar.
 * The Ask bar is rendered once, here, so it is on every screen (DESIGN.md rule 7).
 */
export function Root() {
  const { t } = useTranslation();
  const desktop = useIsDesktop();
  return (
    <div className="flex h-full flex-row">
      {desktop ? <Sidebar /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {desktop ? (
          <div className="border-b border-border px-6 py-3">
            <AskBar autoFocus />
          </div>
        ) : (
          <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
            <span aria-hidden className="inline-block size-3.5 rounded-sm bg-primary" />
            <span className="min-w-0 flex-1 truncate text-body font-semibold">{t('app.name')}</span>
            <LanguageSwitch />
            <NavLink
              to="/sign-in"
              aria-label={t('signIn.submit')}
              className={({ isActive }) =>
                `grid size-8 place-items-center rounded-pill border border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/25 ${
                  isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'
                }`
              }
            >
              <Icon name="person" />
            </NavLink>
          </header>
        )}
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
        {desktop ? null : (
          <div className="border-t border-border px-4 py-2">
            <AskBar compact />
          </div>
        )}
        <NowPlayingBar />
        {desktop ? null : <TabBar />}
      </div>
    </div>
  );
}
