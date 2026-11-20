import { useEffect } from 'react';
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';

import { LinkButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { isOfflineError } from '../lib/lazy';
import { Root } from './Root';

/**
 * The root route's error element: an unknown URL (or a render error) still gets the shell, the Ask
 * bar and the tab bar, with one translated sentence and a link home instead of the router's
 * English stack page. A screen whose chunk could not load offline says so and loads itself when
 * the connection returns.
 */
export function NotFound() {
  const { t } = useTranslation();
  const error = useRouteError();
  const location = useLocation();
  const navigate = useNavigate();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  const offline = isOfflineError(error);
  useEffect(() => {
    if (!offline) return;
    const retry = (): void => {
      void navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true });
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offline, location, navigate]);
  return (
    <Root>
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <EmptyState
          title={missing ? t('notFound.title') : offline ? t('error.offline') : t('error.title')}
          {...(missing
            ? { description: t('notFound.body') }
            : offline
              ? {}
              : { description: t('error.body') })}
          action={
            <LinkButton to="/" tone="primary" className="shrink-0">
              {t('notFound.home')}
            </LinkButton>
          }
        />
      </div>
    </Root>
  );
}
