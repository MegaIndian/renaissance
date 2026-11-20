import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useMode } from '../lib/mode';
import { useCurrentTrack, usePlayer } from '../lib/usePlayer';
import { Artwork, colorIndex } from '../components/Artwork';
import { EmptyState } from '../components/EmptyState';
import { FavoriteButton } from '../components/FavoriteButton';
import { Icon } from '../components/Icon';
import { PlaybackDetails, Scrubber, TransportControls } from '../components/PlayerControls';
import { TrackMenu } from '../components/TrackMenu';
import { focusRing } from '../components/focus';

/**
 * Now playing (F24): lifted art, title, artist, scrubber, transport with shuffle and repeat, the
 * heart and the queue. On a phone it is one column with the art capped so the transport and the
 * lyrics, queue and cast row sit above the fold at 390 x 844. From the tablet breakpoint the bottom
 * bar is on this screen too and owns the transport, so the page shows none; on a desktop the art
 * (capped near 40 vh) sits beside the text and the scrubber, nothing below the fold at 1280 x 800.
 * Lyrics and cast buttons are present but disabled; the hint naming their phase shows in advanced
 * mode only. Advanced also shows direct or transcoded, codec and bitrate.
 */
export function NowPlaying() {
  const { t } = useTranslation();
  const mode = useMode();
  const track = useCurrentTrack();
  const { status, error } = usePlayer();
  if (!track) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-heading font-semibold">{t('nav.nowPlaying')}</h1>
        <EmptyState title={t('player.nothingPlaying')} quiet />
      </div>
    );
  }
  const disabledButton = `flex min-h-6 min-w-6 flex-col items-center gap-1 rounded-sm px-2 py-1 text-caption text-muted-foreground disabled:cursor-not-allowed ${focusRing}`;
  return (
    <div className="mx-auto flex max-w-md flex-col items-stretch gap-3 lg:max-w-4xl lg:flex-row lg:items-center lg:gap-10">
      <div className="now-playing-art lg:w-2/5 lg:shrink-0" data-testid="now-playing-art">
        <Artwork
          imageId={track.imageId}
          label={track.title}
          index={colorIndex(track.id)}
          size="lg"
          className="shadow-art"
          rounded="rounded-lg"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link
            to="/queue"
            aria-label={t('player.queue')}
            className={`grid size-8 min-h-6 min-w-6 place-items-center rounded-pill text-muted-foreground hover:text-foreground ${focusRing}`}
          >
            <Icon name="queue" className="size-4" />
          </Link>
          <h1 className="truncate text-caption text-muted-foreground">
            {track.albumTitle ?? t('nav.nowPlaying')}
          </h1>
          <TrackMenu track={track} />
        </div>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-title font-semibold">{track.title}</p>
            {track.artistIds[0] ? (
              <Link
                to={`/artist/${encodeURIComponent(track.artistIds[0])}`}
                // A 24 px target (rule 12) on an 18 px text line: the extra 3 px above and below
                // are pulled back with negative margins, so the column is no taller than the text
                // and the action row stays above the fold at 390 x 844 in simple mode.
                className={`-my-0.75 inline-flex min-h-6 max-w-full items-center self-start rounded-sm text-body text-muted-foreground hover:text-foreground ${focusRing}`}
              >
                <span className="truncate">{track.artistName}</span>
              </Link>
            ) : (
              <p className="truncate text-body text-muted-foreground">{track.artistName}</p>
            )}
            <PlaybackDetails />
            {status === 'error' ? (
              <p className="text-caption text-danger" role="alert">
                {error === 'signed-out' ? t('player.signedOut') : t('player.error')}
              </p>
            ) : null}
          </div>
          <FavoriteButton kind="track" item={track} />
        </div>
        <Scrubber />
        <div className="md:hidden" data-testid="now-playing-transport">
          <TransportControls size="lg" withModes wrap />
        </div>
        <div className="flex items-start justify-around" data-testid="now-playing-actions">
          <button
            type="button"
            disabled
            className={disabledButton}
            aria-label={t('player.lyrics')}
            aria-description={mode === 'advanced' ? t('player.lyricsLater') : undefined}
          >
            <Icon name="lyrics" className="size-5" />
            <span>{t('player.lyrics')}</span>
            {mode === 'advanced' ? (
              <span className="text-caption">{t('player.lyricsLater')}</span>
            ) : null}
          </button>
          <Link
            to="/queue"
            className={`flex min-h-6 min-w-6 flex-col items-center gap-1 rounded-sm px-2 py-1 text-caption text-foreground ${focusRing}`}
          >
            <Icon name="queue" className="size-5" />
            <span>{t('player.queue')}</span>
          </Link>
          <button
            type="button"
            disabled
            className={disabledButton}
            aria-label={t('player.cast')}
            aria-description={mode === 'advanced' ? t('player.castLater') : undefined}
          >
            <Icon name="cast" className="size-5" />
            <span>{t('player.cast')}</span>
            {mode === 'advanced' ? (
              <span className="text-caption">{t('player.castLater')}</span>
            ) : null}
          </button>
        </div>
      </div>
    </div>
  );
}
