import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

import { useMode } from '../lib/mode';
import { Icon } from './Icon';
import { focusRing } from './focus';
import { navFor } from './navigation';

/** Phone navigation (under 768 px): three tabs in simple mode, four with Search in advanced. Mirrored on mobile. */
export function TabBar() {
  const { t } = useTranslation();
  const mode = useMode();
  return (
    <nav
      aria-label={t('nav.primary')}
      className="flex justify-around border-t border-border bg-card px-2 pt-2 pb-3"
    >
      {navFor(mode).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `flex min-w-16 flex-col items-center gap-1 rounded-sm px-2 py-1 text-caption ${focusRing} ${
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
