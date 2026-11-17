import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { primaryNav } from './navigation';

/** Phone navigation (under 768 px): three tabs, as the DESIGN.md wireframe. Mirrored on mobile. */
export function TabBar() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('nav.primary')}
      className="flex justify-around border-t border-border bg-card px-2 pt-2 pb-3"
    >
      {primaryNav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `flex min-w-16 flex-col items-center gap-1 rounded-sm px-2 py-1 text-caption outline-none focus-visible:ring-3 focus-visible:ring-ring/25 ${
              isActive ? 'text-foreground' : 'text-muted-foreground'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={`grid size-6 place-items-center rounded-sm ${
                  isActive ? 'bg-primary text-primary-foreground' : ''
                }`}
              >
                <Icon name={item.icon} />
              </span>
              <span className="max-w-full truncate">{t(item.key)}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
