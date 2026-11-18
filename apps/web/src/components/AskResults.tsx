import type { AskAction, AskResponse, InstantResults } from '@renaissance/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHub } from '../lib/hub';
import { Button } from './Button';

/**
 * What the Ask bar shows under the box (F75, ADR 0007 point 1): library hits first, as soon as the
 * hub has them, then the model's answer as cards with what each action did, an undo where the hub
 * can undo it, and the one-line "why". A model that is off says so in one line.
 */
export function AskResults({
  instant,
  answer,
  pending,
}: {
  instant: InstantResults | null;
  answer: AskResponse | null;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const hits = instant
    ? [...instant.tracks, ...instant.albums, ...instant.artists].slice(0, 6)
    : [];
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {hits.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-caption font-medium text-muted-foreground">{t('ask.results')}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
            {hits.map((hit) => (
              <li key={hit.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 text-body">
                  {hit.title}
                  {hit.artist ? (
                    <span className="text-muted-foreground">{` · ${hit.artist}`}</span>
                  ) : null}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t(`ask.kind.${hit.kind}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pending ? <p className="text-caption text-muted-foreground">{t('ask.thinking')}</p> : null}
      {answer ? <Answer answer={answer} /> : null}
    </div>
  );
}

function Answer({ answer }: { answer: AskResponse }) {
  const { t } = useTranslation();
  const off = answer.model === 'off';
  const line = off
    ? answer.reason === 'budget'
      ? t('ask.budgetOff')
      : answer.reason === 'deterministic'
        ? answer.why
        : t('ask.modelOff')
    : answer.why;
  return (
    <section className="flex flex-col gap-2">
      {answer.actions.map((action, index) => (
        <ActionCard key={`${action.tool}-${index}`} action={action} />
      ))}
      {line ? <p className="text-caption text-muted-foreground">{line}</p> : null}
      {answer.rejected.length > 0 ? (
        <p className="text-caption text-muted-foreground">
          {t('ask.rejected', { count: answer.rejected.length })}
        </p>
      ) : null}
    </section>
  );
}

function ActionCard({ action }: { action: AskAction }) {
  const { t } = useTranslation();
  const { client } = useHub();
  const [state, setState] = useState<'done' | 'undoing' | 'undone' | 'failed'>('done');
  const canUndo = action.undoable && action.undo !== undefined && client !== null;
  async function undo(): Promise<void> {
    if (!client) return;
    setState('undoing');
    try {
      await client.undo(action);
      setState('undone');
    } catch {
      setState('failed');
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-body">{action.summary}</span>
        <span className="text-caption text-muted-foreground">
          {state === 'undone'
            ? t('ask.undone')
            : state === 'failed'
              ? t('ask.undoFailed')
              : t(`ask.tool.${action.tool}`)}
        </span>
      </div>
      {canUndo && state === 'done' ? (
        <Button onClick={() => void undo()} className="shrink-0">
          {t('ask.undo')}
        </Button>
      ) : null}
    </div>
  );
}
