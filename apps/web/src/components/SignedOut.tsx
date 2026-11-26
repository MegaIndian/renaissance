import { useTranslation } from 'react-i18next';

import { LinkButton } from './Button';
import { EmptyState } from './EmptyState';

/**
 * What a signed-in screen shows without a session (design AG): its own heading, the one sentence
 * the Library uses, and Sign in as the primary action. Library, Favourites and Search share it.
 */
export function SignedOut({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-heading font-semibold">{title}</h1>
      <EmptyState
        title={t('library.empty')}
        action={
          <LinkButton to="/sign-in" tone="primary" className="shrink-0">
            {t('signIn.submit')}
          </LinkButton>
        }
      />
    </div>
  );
}
