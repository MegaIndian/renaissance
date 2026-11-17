import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';

import { setLanguage } from '../lib/i18n';

const nav = [
  { to: '/', key: 'nav.home' },
  { to: '/library', key: 'nav.library' },
  { to: '/requests', key: 'nav.requests' },
] as const;

export function Root() {
  const { t, i18n } = useTranslation();
  return (
    <div className="grid h-full grid-cols-1 grid-rows-[1fr_auto] md:grid-cols-[200px_1fr]">
      <aside className="hidden flex-col gap-1 border-r border-border bg-card p-3 text-[13px] md:flex">
        <div className="mb-3 flex items-center gap-2 px-2 pt-1 font-semibold">
          <span aria-hidden className="inline-block size-3.5 rounded-sm bg-primary" />
          {t('app.name')}
        </div>
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `rounded-sm px-2 py-1.5 ${isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`
            }
          >
            {t(item.key)}
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col gap-2 px-2">
          <div
            className="inline-flex self-start rounded-md bg-muted p-0.5"
            role="group"
            aria-label="Language"
          >
            {(['en', 'gu'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => setLanguage(lng)}
                className={`rounded-sm px-2 py-0.5 text-[11px] ${i18n.language === lng ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.15)]' : 'text-muted-foreground'}`}
              >
                {lng === 'en' ? 'English' : 'ગુજરાતી'}
              </button>
            ))}
          </div>
          <NavLink
            to="/sign-in"
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {t('signIn.title')}
          </NavLink>
        </div>
      </aside>
      <main className="min-w-0 overflow-y-auto p-4 md:p-6">
        <Outlet />
      </main>
      <footer className="flex items-center gap-3 border-t border-border bg-card px-4 py-3 text-[13px] md:col-span-2">
        <span aria-hidden className="size-9 rounded-sm bg-muted" />
        <span className="text-muted-foreground">{t('player.nothingPlaying')}</span>
        <button
          type="button"
          aria-label={t('player.play')}
          disabled
          className="ml-auto grid size-7 place-items-center rounded-full bg-primary text-primary-foreground opacity-50"
        >
          <span
            aria-hidden
            className="ml-0.5 border-y-[5px] border-l-[8px] border-y-transparent border-l-primary-foreground"
          />
        </button>
      </footer>
    </div>
  );
}
