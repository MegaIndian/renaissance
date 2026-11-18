import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { LanguageSwitch } from './LanguageSwitch';
import { focusRing } from './focus';
import { primaryNav } from './navigation';

/** Desktop navigation (768 px and up). The phone equivalent is TabBar. */
export function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className="flex w-50 shrink-0 flex-col gap-1 border-r border-border bg-card p-3 text-body">
      <div className="mb-3 flex items-center gap-2 px-2 pt-1 font-semibold">
        <span aria-hidden className="inline-block size-3.5 rounded-sm bg-primary" />
        {t('app.name')}
      </div>
      <nav aria-label={t('nav.primary')} className="flex flex-col gap-1">
        {primaryNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex min-h-6 items-center gap-2 rounded-sm px-2 py-1.5 ${focusRing} ${
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`
            }
          >
            <Icon name={item.icon} />
            {t(item.key)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3 px-2">
        <LanguageSwitch />
        <NavLink
          to="/sign-in"
          className={`flex min-h-6 items-center gap-2 rounded-sm py-1.5 text-caption text-muted-foreground hover:text-foreground ${focusRing}`}
        >
          <Icon name="person" />
          {t('signIn.submit')}
        </NavLink>
      </div>
    </aside>
  );
}
