import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';

export function Library() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-heading font-semibold">{t('nav.library')}</h1>
      <EmptyState title={t('library.empty')} quiet />
    </div>
  );
}
