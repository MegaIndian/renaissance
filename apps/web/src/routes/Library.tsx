import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { useHub } from '../lib/hub';

type View = 'mine' | 'everything';

/**
 * Library (F86 rule 3): "Mine" (default) is the caller's collection from the hub, what they asked
 * for, added or imported; "Everything on the server" is the whole Jellyfin library (phase 1 fills
 * it; here the empty state stays).
 */
export function Library() {
  const { t } = useTranslation();
  const { client, status } = useHub();
  const [view, setView] = useState<View>('mine');
  const ready = status === 'ready' && client !== null;
  const collection = useQuery({
    queryKey: ['collection'],
    queryFn: () => client!.collection(),
    enabled: ready && view === 'mine',
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-heading font-semibold">{t('nav.library')}</h1>
        <SegmentedControl<View>
          label={t('library.scope')}
          value={view}
          options={[
            { value: 'mine', label: t('library.mine') },
            { value: 'everything', label: t('library.everythingOnServer') },
          ]}
          onChange={setView}
        />
      </div>
      {view === 'everything' ? (
        <EmptyState title={t('library.empty')} quiet />
      ) : !ready ? (
        <EmptyState title={t('library.mineSignIn')} quiet />
      ) : collection.data && collection.data.length === 0 ? (
        <EmptyState title={t('library.mineEmpty')} description={t('library.mineEmptyBody')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(collection.data ?? []).map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-body font-medium">{item.title}</span>
                <span className="text-caption text-muted-foreground">
                  {item.artist}
                  {item.album ? ` · ${item.album}` : ''}
                </span>
              </div>
              <span className="text-caption text-muted-foreground">
                {t(`library.source.${item.source}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
