import type { MusicRequest, RequestProgress, RequestStep } from '@renaissance/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HubClientError } from '@renaissance/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { StatusPill } from '../components/StatusPill';
import { useDetailLevel, useHub } from '../lib/hub';

type Scope = 'mine' | 'house';

/**
 * The Requests tab (F61, F63, F87): the caller's own requests from the hub, live through the hub's
 * event stream, with cancel while nothing has been downloaded and retry after a failure. An admin
 * can switch to the whole house and sees who asked. Every card speaks plainly (DESIGN.md rule 9):
 * the pill, a sentence for a failure everyone can act on, progress in words, and the song that will
 * actually arrive when the catalogue matched something other than the words typed. The pipeline's
 * own words sit behind a collapsed "What happened" in advanced mode only (design B, W); those
 * detail lines are the hub's English and the panel says so in Gujarati. A request someone else
 * made and this person watches says who asked, in every scope, and offers no Cancel or Retry: the
 * hub answers 404 to anyone but the asker (design AB). While the first list is on its way three
 * placeholders hold the room; when the list itself fails the unreachable words and a Retry
 * replace it (design AN, AQ).
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
      if (event.type !== 'request' && event.type !== 'ready') return;
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
    } catch (error) {
      // `too_late`: it is downloading. Anything else (finished meanwhile, hub away): say it plainly.
      const tooLate = error instanceof HubClientError && error.code === 'too_late';
      setNotice(
        tooLate
          ? t('requests.tooLate', { title: request.title })
          : t('requests.cancelFailed', { title: request.title }),
      );
      void queryClient.invalidateQueries({ queryKey: ['requests', effectiveScope] });
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
      ) : requests.isError ? (
        // The list itself failed (a 500, the hub gone between the profile call and this one):
        // the same words as the unreachable state, with a Retry that asks again (design AN).
        <EmptyState
          title={t('requests.hubOff')}
          description={t('requests.hubOffBody')}
          action={
            <Button className="shrink-0" onClick={() => void requests.refetch()}>
              {t('requests.retry')}
            </Button>
          }
        />
      ) : requests.data === undefined ? (
        // The first list is on its way: three card-shaped placeholders, not a blank page (design AQ).
        <ul className="flex flex-col gap-2" aria-busy="true" aria-label={t('requests.loading')}>
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-18 animate-pulse rounded-md border border-border bg-muted"
              aria-hidden
            />
          ))}
        </ul>
      ) : requests.data.length === 0 ? (
        <EmptyState title={t('requests.empty')} description={t('requests.emptyBody')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(requests.data ?? []).map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              showWho={effectiveScope === 'house' || request.requestedBy !== profile?.id}
              owner={request.requestedBy === profile?.id || (admin && effectiveScope === 'house')}
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

/** "42% downloaded · about a minute left" or "14 of 18 songs": the shape, in words (rule 9). */
export function progressWords(progress: RequestProgress, t: TFunction): string {
  const parts: string[] = [];
  if (progress.unit === 'songs') {
    if (progress.total > 0)
      parts.push(t('requests.progress.songs', { done: progress.done, total: progress.total }));
  } else {
    parts.push(t('requests.progress.percent', { percent: percent(progress.done, progress.total) }));
  }
  if (progress.etaSeconds !== undefined) {
    const minutes = Math.round(progress.etaSeconds / 60);
    parts.push(
      minutes < 1
        ? t('requests.progress.etaSoon')
        : t('requests.progress.etaMinutes', { count: minutes }),
    );
  }
  return parts.join(' · ');
}

function RequestRow({
  request,
  showWho,
  owner,
  onCancel,
  onRetry,
}: {
  request: MusicRequest;
  showWho: boolean;
  /** The viewer asked for it (or is the admin looking at the house): Cancel and Retry are theirs. */
  owner: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { showDetail } = useDetailLevel();
  const canCancel = owner && (request.status === 'requested' || request.status === 'finding');
  const canRetry = owner && request.status === 'failed';
  const reason =
    request.status === 'failed'
      ? t(`requests.reason.${request.reason ?? 'error'}`, {
          defaultValue: t('requests.reason.error'),
        })
      : null;
  const progress =
    request.progress &&
    (request.status === 'downloading' ||
      (request.status === 'finding' && request.progress.unit === 'songs'))
      ? request.progress
      : null;
  const words = progress ? progressWords(progress, t) : '';
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium">{request.title}</span>
          <span className="truncate text-caption text-muted-foreground">
            {request.artist}
            {request.album ? ` · ${request.album}` : ''}
            {showWho ? ` · ${t('requests.requestedBy', { name: request.requestedByName })}` : ''}
          </span>
        </div>
        <StatusPill status={request.status} />
      </div>
      {progress && words ? (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label={t(`requests.status.${request.status}`)}
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuetext={words}
            className="h-1 w-full overflow-hidden rounded-pill bg-muted"
          >
            <div
              className="h-full rounded-pill bg-info"
              style={{ width: `${percent(progress.done, progress.total)}%` }}
            />
          </div>
          <p className="text-caption text-muted-foreground">{words}</p>
        </div>
      ) : null}
      {reason ? <p className="text-caption text-danger">{reason}</p> : null}
      {request.matched ? (
        // Future tense while it is on its way, past tense once it has arrived (design AL).
        <p className="line-clamp-2 break-words text-caption text-muted-foreground">
          {t(
            request.status === 'ready'
              ? request.matched.album
                ? 'requests.arrivedOn'
                : 'requests.arrived'
              : request.matched.album
                ? 'requests.matchedOn'
                : 'requests.matched',
            {
              title: request.matched.title,
              artist: request.matched.artist,
              album: request.matched.album ?? '',
            },
          )}
        </p>
      ) : null}
      {showDetail && request.steps.length > 0 ? (
        <WhatHappened steps={request.steps} reason={request.reason} />
      ) : null}
      {canCancel || canRetry ? (
        <div className="flex gap-2">
          {canCancel ? <Button onClick={onCancel}>{t('requests.cancel')}</Button> : null}
          {canRetry ? <Button onClick={onRetry}>{t('requests.retry')}</Button> : null}
        </div>
      ) : null}
    </li>
  );
}

/** The pipeline's own step log, collapsed: advanced mode only (design B, W). */
function WhatHappened({ steps, reason }: { steps: RequestStep[]; reason: string | undefined }) {
  const { t, i18n } = useTranslation();
  const withDetail = steps.filter((s) => s.detail || s.reason);
  if (withDetail.length === 0 && !reason) return null;
  return (
    <details className="text-caption text-muted-foreground">
      <summary className="cursor-pointer">{t('requests.whatHappened')}</summary>
      {i18n.language === 'gu' ? <p className="mt-1">{t('requests.detailEnglish')}</p> : null}
      {reason ? <p className="mt-1 font-mono">{t('requests.code', { reason })}</p> : null}
      <ol className="mt-1 flex flex-col gap-1">
        {withDetail.map((step, index) => (
          <li key={`${step.at}-${index}`} className="flex gap-2">
            <time dateTime={step.at} className="shrink-0 font-mono">
              {step.at.slice(11, 16)}
            </time>
            <span className="min-w-0 break-words">
              {t(`requests.status.${step.status}`)}
              {step.detail ? ` · ${step.detail}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
