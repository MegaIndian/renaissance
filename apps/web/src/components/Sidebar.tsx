import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

import { useMode } from '../lib/mode';
import { useSession, useSnapshot } from '../lib/queries';
import { Icon } from './Icon';
import { LanguageSwitch } from './LanguageSwitch';
import { focusRing } from './focus';
import { navFor } from './navigation';

const item = (active: boolean) =>
  `flex min-h-6 items-center gap-2 rounded-sm px-2 py-1.5 ${focusRing} ${
    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
  }`;

/** Desktop navigation (768 px and up). The phone equivalent is TabBar. */
export function Sidebar() {
  const { t } = useTranslation();
  const mode = useMode();
  const session = useSession();
  const { playlists } = useSnapshot();
  const signedIn = session.status === 'signedIn';
  return (
    <aside className="flex w-50 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card p-3 text-body">
      <div className="mb-3 flex items-center gap-2 px-2 pt-1 font-semibold">
        <span aria-hidden className="inline-block size-3.5 rounded-sm bg-primary" />
        {t('app.name')}
      </div>
      <nav aria-label={t('nav.primary')} className="flex flex-col gap-1">
        {navFor(mode).map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.to === '/'}
            className={({ isActive }) => item(isActive)}
          >
            <Icon name={entry.icon} />
            {t(entry.key)}
          </NavLink>
        ))}
      </nav>
      {signedIn ? (
        <nav aria-label={t('library.playlists')} className="mt-4 flex flex-col gap-1">
          <h2 className="px-2 pb-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t('library.playlists')}
          </h2>
          <NavLink to="/favorites" className={({ isActive }) => item(isActive)}>
            <Icon name="heart" />
            {t('nav.favorites')}
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => item(isActive)}>
            <Icon name="history" />
            {t('nav.history')}
          </NavLink>
          {playlists.slice(0, 8).map((playlist) => (
            <NavLink
              key={playlist.id}
              to={`/playlist/${encodeURIComponent(playlist.id)}`}
              className={({ isActive }) => item(isActive)}
            >
              <Icon name="playlist" />
              <span className="truncate">{playlist.name}</span>
            </NavLink>
          ))}
          {playlists.length > 8 ? (
            <NavLink to="/library?section=playlists" className={({ isActive }) => item(isActive)}>
              <Icon name="more" />
              {t('library.playlists')}
            </NavLink>
          ) : null}
        </nav>
      ) : null}
      <div className="mt-auto flex flex-col gap-3 px-2 pt-4">
        {/* Simple mode keeps Language in Settings and on the sign-in screen (DESIGN.md), as the phone header does. */}
        {!signedIn || mode === 'advanced' ? <LanguageSwitch /> : null}
        <NavLink
          to={signedIn ? '/settings' : '/sign-in'}
          className={({ isActive }) =>
            `flex min-h-6 items-center gap-2 rounded-sm py-1.5 text-caption ${focusRing} ${
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`
          }
        >
          <Icon name={signedIn ? 'settings' : 'person'} />
          <span className="truncate">{signedIn ? t('nav.settings') : t('signIn.submit')}</span>
        </NavLink>
      </div>
    </aside>
  );
}
