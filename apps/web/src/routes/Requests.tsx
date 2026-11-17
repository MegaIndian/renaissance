import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';

export function Requests() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-heading font-semibold">{t('nav.requests')}</h1>
      <EmptyState title={t('requests.empty')} description={t('requests.emptyBody')} />
    </div>
  );
}
