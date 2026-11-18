import { isRouteErrorResponse, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';

import { LinkButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Root } from './Root';

/**
 * The root route's error element: an unknown URL (or a render error) still gets the shell, the Ask
 * bar and the tab bar, with one translated sentence and a link home instead of the router's
 * English stack page.
 */
export function NotFound() {
  const { t } = useTranslation();
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <Root>
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <EmptyState
          title={missing ? t('notFound.title') : t('error.title')}
          description={missing ? t('notFound.body') : t('error.body')}
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
