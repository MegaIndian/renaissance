import { useTranslation } from 'react-i18next';

import { QueueList } from '../components/QueueList';

/** The queue screen (F22). */
export function Queue() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-heading font-semibold">{t('queue.title')}</h1>
      <QueueList />
    </div>
  );
}
