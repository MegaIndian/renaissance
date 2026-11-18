import type { MusicRequest } from '@renaissance/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { StatusPill } from '../components/StatusPill';
import { useHub } from '../lib/hub';

type Scope = 'mine' | 'house';

/**
 * The Requests tab (F61, F63, F87): the caller's own requests from the hub, live through the hub's
 * event stream, with cancel while nothing has been downloaded and retry after a failure. An admin
 * can switch to the whole house and sees who asked.
 */
export function Requests() {
  const { t } = useTranslation();
  const { client, profile, status } = useHub();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>('mine');
  const [notice, setNotice] = useState('');
  const ready = status === 'ready' && client !== null;
  const admin = profile?.role === 'admin';
  const effectiveScope: Scope = admin ? scope : 'mine';

  const requests = useQuery({
    queryKey: ['requests', effectiveScope],
    queryFn: () => client!.requests(effectiveScope),
    enabled: ready,
  });

  useEffect(() => {
    if (!ready) return;
    return client.events((event) => {
      if (event.type === 'ping') return;
      queryClient.setQueryData<MusicRequest[]>(['requests', effectiveScope], (current) => {
        const list = current ?? [];
        const index = list.findIndex((r) => r.id === event.request.id);
        if (index === -1) return [event.request, ...list];
        return list.map((r) => (r.id === event.request.id ? event.request : r));
      });
      if (event.type === 'ready') {
        setNotice(t('requests.readyNotice', { title: event.request.title }));
      }
    }, effectiveScope);
  }, [client, ready, effectiveScope, queryClient, t]);

  async function cancel(request: MusicRequest): Promise<void> {
    if (!client) return;
    try {
      const updated = await client.cancelRequest(request.id);
      queryClient.setQueryData<MusicRequest[]>(['requests', effectiveScope], (current) =>
        (current ?? []).map((r) => (r.id === updated.id ? updated : r)),
      );
      setNotice(t('requests.cancelledNotice', { title: request.title }));
    } catch {
      setNotice(t('requests.tooLate', { title: request.title }));
    }
  }

  async function retry(request: MusicRequest): Promise<void> {
    if (!client) return;
    try {
      const updated = await client.retryRequest(request.id);
      queryClient.setQueryData<MusicRequest[]>(['requests', effectiveScope], (current) =>
        (current ?? []).map((r) => (r.id === updated.id ? updated : r)),
      );
      setNotice(t('requests.retriedNotice', { title: request.title }));
    } catch {
      setNotice(t('requests.retryFailed', { title: request.title }));
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-heading font-semibold">{t('nav.requests')}</h1>
        {admin ? (
          <SegmentedControl<Scope>
            label={t('requests.scope')}
            value={scope}
            options={[
              { value: 'mine', label: t('requests.mine') },
              { value: 'house', label: t('requests.house') },
            ]}
            onChange={setScope}
          />
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
      {status === 'off' || status === 'unauthorized' ? (
        <EmptyState title={t('requests.signIn')} description={t('requests.signInBody')} />
      ) : status === 'unreachable' ? (
        <EmptyState title={t('requests.hubOff')} description={t('requests.hubOffBody')} />
      ) : requests.data && requests.data.length === 0 ? (
        <EmptyState title={t('requests.empty')} description={t('requests.emptyBody')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(requests.data ?? []).map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              showWho={effectiveScope === 'house'}
              onCancel={() => void cancel(request)}
              onRetry={() => void retry(request)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0;
}

function RequestRow({
  request,
  showWho,
  onCancel,
  onRetry,
}: {
  request: MusicRequest;
  showWho: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const last = request.steps[request.steps.length - 1];
  const canCancel = request.status === 'requested' || request.status === 'finding';
  const canRetry = request.status === 'failed' && request.reason !== 'cancelled';
  const reason =
    request.status === 'failed' && request.reason
      ? t(`requests.reason.${request.reason}`, { defaultValue: request.reason })
      : null;
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-body font-medium">{request.title}</span>
          <span className="text-caption text-muted-foreground">
            {request.artist}
            {request.album ? ` · ${request.album}` : ''}
            {showWho ? ` · ${t('requests.requestedBy', { name: request.requestedByName })}` : ''}
          </span>
        </div>
        <StatusPill status={request.status} />
      </div>
      {request.status === 'downloading' && request.progress ? (
        <div
          role="progressbar"
          aria-label={t('requests.status.downloading')}
          aria-valuenow={request.progress.done}
          aria-valuemin={0}
          aria-valuemax={request.progress.total}
          className="h-1 w-full overflow-hidden rounded-pill bg-muted"
        >
          <div
            className="h-full rounded-pill bg-primary"
            style={{ width: `${percent(request.progress.done, request.progress.total)}%` }}
          />
        </div>
      ) : null}
      {reason ? <p className="text-caption text-danger">{reason}</p> : null}
      {last?.detail ? <p className="text-caption text-muted-foreground">{last.detail}</p> : null}
      {canCancel || canRetry ? (
        <div className="flex gap-2">
          {canCancel ? <Button onClick={onCancel}>{t('requests.cancel')}</Button> : null}
          {canRetry ? <Button onClick={onRetry}>{t('requests.retry')}</Button> : null}
        </div>
      ) : null}
    </li>
  );
}
