import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';
import { useMode } from '../lib/mode';

/** Requests (F61 to F63) arrive with the hub in phase 2; the tab stays so the three destinations are stable. */
export function Requests() {
  const { t } = useTranslation();
  const mode = useMode();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-heading font-semibold">{t('nav.requests')}</h1>
      <EmptyState title={t('requests.empty')} description={t('requests.emptyBody')} />
      {mode === 'advanced' ? (
        <p className="text-caption text-muted-foreground">{t('requests.later')}</p>
      ) : null}
    </div>
  );
}
