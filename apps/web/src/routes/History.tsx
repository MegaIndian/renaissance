import { filterListens, groupByDay } from '@renaissance/core';
import type { ListenEvent, ListenFilter, Track } from '@renaissance/core';
import { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { playNow } from '../lib/actions';
import { useHistory, useListens } from '../lib/history';
import { useMode, useSettings } from '../lib/mode';
import { useSession, useSnapshot } from '../lib/queries';
import { usePlayer } from '../lib/usePlayer';
import { Button, LinkButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { SignedOut } from '../components/SignedOut';
import { TrackRow } from '../components/TrackRow';

/** How many plays one page of the screen reads. */
export const HISTORY_PAGE = 200;

const HISTORY = { kind: 'history' } as const;

/** The language's locale with Latin digits, which Gujarati keeps for figures (AGENTS.md "Strings"). */
function locale(language: string): string {
  return `${language === 'gu' ? 'gu' : 'en'}-u-nu-latn`;
}

/** A local day (`YYYY-MM-DD`) as a heading: "Today", "Yesterday", else "Thursday 20 November" in the language. */
function dayLabel(day: string, t: TFunction, language: string, now: Date = new Date()): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (days === 0) return t('history.today');
  if (days === 1) return t('history.yesterday');
  return new Intl.DateTimeFormat(locale(language), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}

/** The local time of an instant ("9:41 AM"), in the language. */
function clockTime(iso: string, language: string): string {
  return new Intl.DateTimeFormat(locale(language), { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** The song behind a play: the library's copy when it still has one, else the one the log kept. */
function trackOf(event: ListenEvent, byId: Map<string, Track>): Track {
  return (
    byId.get(event.trackId) ?? {
      id: event.trackId,
      title: event.title,
      artistIds: event.artistIds,
      artistName: event.artistName,
      duration: event.trackDuration,
      genres: [],
      isFavorite: false,
      playCount: 0,
      ...(event.albumId ? { albumId: event.albumId } : {}),
      ...(event.albumTitle ? { albumTitle: event.albumTitle } : {}),
      ...(event.imageId ? { imageId: event.imageId } : {}),
    }
  );
}

/**
 * History (F47): this device's listening log, newest first and grouped by day, with All, Skipped and
 * Completed. Tapping a play plays that song again. The log is local; Settings turns it off and
 * clears it.
 */
export function History() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const settings = useSettings();
  const mode = useMode();
  const { tracks } = useSnapshot();
  const history = useHistory();
  const [filter, setFilter] = useState<ListenFilter>('all');
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const { data: events = [], isSuccess } = useListens(limit);
  const player = usePlayer();
  const byId = useMemo(() => new Map(tracks.map((x) => [x.id, x])), [tracks]);
  const days = useMemo(() => groupByDay(filterListens(events, filter)), [events, filter]);
  const currentId = player.queue.items[player.queue.index]?.id;
  // The song playing now is marked once, on its newest row.
  const markedId = useMemo(
    () => days.flatMap((d) => d.events).find((e) => e.trackId === currentId)?.id,
    [days, currentId],
  );

  if (session.status === 'signedOut') return <SignedOut title={t('history.title')} />;

  const paused = player.status !== 'playing' && player.status !== 'loading';
  const status = (e: ListenEvent) =>
    e.skipped ? t('history.skipped') : e.completed ? t('history.completed') : '';
  // The status comes before the artist so a phone's truncated line still says it.
  const subtitle = (e: ListenEvent) =>
    [
      clockTime(e.at, i18n.language),
      status(e),
      e.artistName || t('library.unknownArtist'),
      mode === 'advanced' ? e.device : '',
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold">{t('history.title')}</h1>
        {history.ready ? (
          <span className="text-caption text-muted-foreground">
            {t('history.playsCount', { count: history.count })}
          </span>
        ) : null}
      </div>

      {!settings.listeningLog ? (
        <EmptyState
          title={t('history.off')}
          description={t('history.offBody')}
          action={
            <LinkButton to="/settings" tone="secondary" className="shrink-0">
              {t('history.openSettings')}
            </LinkButton>
          }
        />
      ) : null}
      {history.ready && !history.persisted ? (
        <p className="text-caption text-muted-foreground">{t('history.notSaved')}</p>
      ) : null}

      {events.length ? (
        <div>
          <SegmentedControl
            label={t('history.filter')}
            value={filter}
            options={[
              { value: 'all', label: t('history.filterAll') },
              { value: 'skipped', label: t('history.filterSkipped') },
              { value: 'completed', label: t('history.filterCompleted') },
            ]}
            onChange={setFilter}
          />
        </div>
      ) : null}

      {isSuccess && !events.length ? (
        <EmptyState title={t('history.empty')} description={t('history.emptyBody')} />
      ) : null}
      {events.length && !days.length ? (
        <EmptyState quiet title={t('history.emptyFiltered')} />
      ) : null}

      {days.map(({ day, events: plays }) => {
        const label = dayLabel(day, t, i18n.language);
        return (
          <section key={day} className="flex flex-col gap-2" aria-label={label}>
            <h2 className="text-title font-semibold">{label}</h2>
            <div className="flex flex-col">
              {plays.map((e, i) => {
                const track = trackOf(e, byId);
                const again = () => playNow([track], 0, HISTORY);
                return (
                  <TrackRow
                    key={e.id}
                    track={track}
                    index={i}
                    subtitle={subtitle(e)}
                    playing={e.id === markedId}
                    paused={paused}
                    onPlay={again}
                    menuExtra={[
                      {
                        key: 'again',
                        label: t('history.playAgain'),
                        icon: 'play',
                        onSelect: again,
                      },
                    ]}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {events.length >= limit ? (
        <Button
          tone="secondary"
          className="self-start"
          onClick={() => setLimit(limit + HISTORY_PAGE)}
        >
          {t('history.showMore')}
        </Button>
      ) : null}
    </div>
  );
}
