import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useMode } from '../lib/mode';
import { useLyrics } from '../lib/queries';
import { useCurrentTrack } from '../lib/usePlayer';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PlainLyrics, SyncedLyrics } from '../components/LyricsView';
import { focusRing } from '../components/focus';

/**
 * Lyrics for the song in the player (F39, F40), opened from the now-playing screen. Synced lyrics
 * follow the song and seek on a tap; lyrics without timings are plain text; a song without lyrics
 * says so in one sentence (advanced mode adds where Jellyfin looks for them). The player bar stays
 * on this screen at every width, so play, pause and the scrubber are at hand.
 */
export function LyricsPage() {
  const { t } = useTranslation();
  const mode = useMode();
  const track = useCurrentTrack();
  const query = useLyrics(track?.id);
  // `titleOf`'s fallback, written out: importing lib/names here splits it into a chunk of its own
  // in the app shell, which is at its 200 kB budget.
  const title = track ? track.title || t('library.untitled') : '';
  const heading = useId();

  let body;
  if (!track) {
    body = <EmptyState title={t('player.nothingPlaying')} quiet />;
  } else if (query.isPending) {
    body = (
      <p role="status" className="text-body text-muted-foreground">
        {t('player.loading')}
      </p>
    );
  } else if (query.isError) {
    body = (
      <EmptyState
        title={t('lyrics.failed')}
        action={<Button onClick={() => void query.refetch()}>{t('actions.retry')}</Button>}
      />
    );
  } else if (!query.data) {
    body = (
      <EmptyState
        title={t('lyrics.none')}
        {...(mode === 'advanced' ? { description: t('lyrics.source') } : {})}
      />
    );
  } else if (query.data.synced) {
    body = <SyncedLyrics key={track.id} lyrics={query.data} labelledBy={heading} />;
  } else {
    body = <PlainLyrics lyrics={query.data} labelledBy={heading} />;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link
          to="/now-playing"
          aria-label={t('lyrics.backToNowPlaying')}
          className={`grid size-8 min-h-6 min-w-6 shrink-0 place-items-center rounded-pill text-muted-foreground hover:text-foreground ${focusRing}`}
        >
          <Icon name="chevronLeft" className="size-4" />
        </Link>
        <div className="flex min-w-0 flex-col">
          <h1 id={heading} className="text-heading font-semibold">
            {t('player.lyrics')}
          </h1>
          {track ? (
            <p className="truncate text-caption text-muted-foreground">
              {[title, track.artistName].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
      {body}
    </div>
  );
}
