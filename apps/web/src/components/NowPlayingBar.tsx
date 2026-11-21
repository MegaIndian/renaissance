import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { titleOf } from '../lib/names';
import { useIsDesktop } from '../lib/media';
import { useMode } from '../lib/mode';
import { getPlayer } from '../lib/player';
import { useCurrentTrack, usePlayer } from '../lib/usePlayer';
import { Artwork, colorIndex } from './Artwork';
import { FavoriteButton } from './FavoriteButton';
import { Icon } from './Icon';
import { Scrubber, TransportControls, VolumeControl } from './PlayerControls';
import { focusRing } from './focus';

/**
 * Bottom player, on every screen (F24 bar form). Nothing queued: the Play button is muted, never a
 * second blue. From the tablet breakpoint the bar adds the transport and the scrubber; the title
 * block has no fixed basis below `lg`, so an 820 px bar keeps the scrubber visible and the heart and
 * queue on one line. From `lg` the title takes 14 rem, from `xl` 16 rem, so the scrubber keeps at
 * least 160 px beside a 12.5 rem sidebar at every width in both modes. The times and the volume
 * slider show from `lg` in advanced mode and from `xl` in simple mode, where everything is 1.25×
 * and a 1024 to 1279 px bar has no room for them. The phone keeps art, title, play and next, and
 * tapping the title opens the now-playing screen. Hidden on the now-playing route on phones; shown
 * there on wider screens, where it owns the transport.
 */
export function NowPlayingBar() {
  const { t } = useTranslation();
  const desktop = useIsDesktop();
  const mode = useMode();
  const track = useCurrentTrack();
  const { status, error } = usePlayer();
  const location = useLocation();
  if (location.pathname === '/now-playing' && !desktop) return null;
  const player = getPlayer();
  const playing = status === 'playing' || status === 'loading';
  const wideFrom = mode === 'simple' ? 'xl' : 'lg';
  const statusLine =
    status === 'error'
      ? error === 'signed-out'
        ? t('player.signedOut')
        : t('player.error')
      : status === 'loading'
        ? t('player.loading')
        : null;

  if (!track) {
    return (
      <footer className="flex items-center gap-3 border-t border-border bg-card px-4 py-3 text-body">
        <span aria-hidden className="size-9 shrink-0 rounded-sm bg-muted" />
        <span className="min-w-0 truncate text-muted-foreground">{t('player.nothingPlaying')}</span>
        <button
          type="button"
          aria-label={t('player.play')}
          disabled
          className={`ml-auto grid size-8 shrink-0 place-items-center rounded-pill bg-muted text-muted-foreground disabled:cursor-not-allowed ${focusRing}`}
        >
          <Icon name="play" className="size-4" />
        </button>
      </footer>
    );
  }

  return (
    <footer className="flex flex-col border-t border-border bg-card text-body">
      <div className="flex items-center gap-3 px-3 py-2 md:px-4">
        <Link
          to="/now-playing"
          aria-label={t('player.openNowPlaying')}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-sm md:w-44 md:flex-none lg:w-56 xl:w-64 ${focusRing}`}
        >
          <Artwork
            imageId={track.imageId}
            label={titleOf(track, t)}
            index={colorIndex(track.id)}
            size="xs"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-foreground">{titleOf(track, t)}</span>
            <span className="truncate text-caption text-muted-foreground">
              {statusLine ?? track.artistName}
            </span>
          </span>
        </Link>
        {desktop ? (
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <TransportControls size="sm" withModes />
            <Scrubber className="max-w-xl" timesFrom={wideFrom} />
          </div>
        ) : null}
        <div className="flex shrink-0 flex-nowrap items-center gap-1">
          {desktop ? <FavoriteButton kind="track" item={track} /> : null}
          {desktop ? <VolumeControl from={wideFrom} /> : null}
          {desktop ? (
            <Link
              to="/queue"
              aria-label={t('player.queue')}
              className={`grid size-8 min-h-6 min-w-6 place-items-center rounded-pill text-muted-foreground hover:text-foreground ${focusRing} ${location.pathname === '/queue' ? 'bg-muted text-foreground' : ''}`}
            >
              <Icon name="queue" className="size-4" />
            </Link>
          ) : (
            <>
              <button
                type="button"
                aria-label={playing ? t('player.pause') : t('player.play')}
                onClick={() => player.toggle()}
                className={`grid size-9 place-items-center rounded-pill bg-primary text-primary-foreground ${focusRing}`}
              >
                <Icon name={playing ? 'pause' : 'play'} className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t('player.next')}
                onClick={() => player.next()}
                className={`grid size-9 place-items-center rounded-pill text-foreground ${focusRing}`}
              >
                <Icon name="next" className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>
      {desktop ? null : <MiniProgress />}
    </footer>
  );
}

/** A 3 px progress hairline under the phone bar (DESIGN.md rule 9). */
function MiniProgress() {
  const { position, duration } = usePlayer();
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div aria-hidden className="h-0.5 w-full bg-muted">
      <div className="h-full bg-info" style={{ width: `${pct}%` }} />
    </div>
  );
}
