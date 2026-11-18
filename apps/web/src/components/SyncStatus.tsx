import { useTranslation } from 'react-i18next';

import { refreshLibrary } from '../lib/library';
import { useLibrary } from '../lib/queries';
import { relativeTime } from '../lib/time';
import { Icon } from './Icon';
import { focusRing } from './focus';

/** One quiet line: what the library sync is doing, when it last finished, and a refresh button. */
export function SyncStatus() {
  const { t } = useTranslation();
  const { sync, snapshot } = useLibrary();
  let text: string | null = null;
  if (sync.status === 'syncing' && sync.progress) {
    text = t('library.syncing', {
      done: sync.progress.done,
      total: sync.progress.total,
      kind: t(`library.kind${sync.progress.kind[0]?.toUpperCase()}${sync.progress.kind.slice(1)}`),
    });
  } else if (sync.status === 'syncing' || sync.status === 'loading') {
    text = snapshot.syncedAt ? t('player.loading') : t('library.syncingFirst');
  } else if (sync.status === 'error') {
    text = t('library.syncFailed');
  } else if (snapshot.syncedAt) {
    text = t('library.syncedAt', { when: relativeTime(snapshot.syncedAt, t) });
  }
  return (
    <div className="flex items-center gap-2 text-caption text-muted-foreground" aria-live="polite">
      {text ? <span className="truncate">{text}</span> : null}
      <button
        type="button"
        aria-label={t('library.refresh')}
        disabled={sync.status === 'syncing'}
        onClick={() => void refreshLibrary()}
        className={`grid size-6 min-h-6 min-w-6 place-items-center rounded-pill hover:text-foreground disabled:cursor-wait ${focusRing}`}
      >
        <Icon
          name="refresh"
          className={`size-3.5 ${sync.status === 'syncing' ? 'animate-spin' : ''}`}
        />
      </button>
    </div>
  );
}
