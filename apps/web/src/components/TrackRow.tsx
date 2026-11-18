import { formatDuration } from '@renaissance/core';
import type { Track } from '@renaissance/core';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Artwork, colorIndex } from './Artwork';
import { FavoriteButton } from './FavoriteButton';
import { Icon } from './Icon';
import { TrackMenu } from './TrackMenu';
import type { MenuItem } from './Menu';
import { focusRing } from './focus';

export const TRACK_ROW_HEIGHT = 56;

/**
 * One song (DESIGN.md rule 8): art or number, title in body-strong, subtitle in caption, duration,
 * heart, menu; hairline below. The whole row is one Play button for the pointer, with the actions
 * beside it reachable by keyboard. Mirrored on mobile by name.
 */
export function TrackRow({
  track,
  index,
  onPlay,
  playing = false,
  paused = false,
  showArt = true,
  showNumber = false,
  subtitle,
  menuExtra,
  hideAlbumLink,
  hideArtistLink,
  leading,
  dragHandleProps,
}: {
  track: Track;
  index: number;
  onPlay: () => void;
  /** This row is the current track. */
  playing?: boolean;
  paused?: boolean;
  showArt?: boolean;
  /** Album pages show the track number instead of art. */
  showNumber?: boolean;
  subtitle?: string;
  menuExtra?: MenuItem[];
  hideAlbumLink?: boolean;
  hideArtistLink?: boolean;
  /** A drag handle or a checkbox, rendered before the art. */
  leading?: ReactNode;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const { t } = useTranslation();
  const sub =
    subtitle ??
    [track.artistName || t('library.unknownArtist'), track.albumTitle].filter(Boolean).join(' · ');
  return (
    <div
      className={`group flex items-center gap-3 border-b border-border px-2 ${playing ? 'bg-muted/60' : 'hover:bg-muted/40'}`}
      style={{ height: TRACK_ROW_HEIGHT }}
      data-playing={playing || undefined}
    >
      {leading}
      {dragHandleProps ? (
        <span
          {...dragHandleProps}
          className={`grid size-6 shrink-0 cursor-grab place-items-center text-muted-foreground ${focusRing}`}
        >
          <Icon name="drag" className="size-4" />
        </span>
      ) : null}
      {showNumber ? (
        <span
          className={`w-6 shrink-0 text-center font-mono text-caption ${playing ? 'text-foreground' : 'text-muted-foreground'}`}
          aria-hidden
        >
          {playing ? (
            <Icon name={paused ? 'pause' : 'play'} className="mx-auto size-3.5" />
          ) : (
            (track.trackNumber ?? index + 1)
          )}
        </span>
      ) : showArt ? (
        <Artwork
          imageId={track.imageId}
          label={track.title}
          index={colorIndex(track.albumId ?? track.id)}
          size="xs"
        />
      ) : null}
      <button
        type="button"
        onClick={onPlay}
        aria-label={
          playing && !paused
            ? t('actions.pause', { title: track.title })
            : t('actions.play', { title: track.title })
        }
        aria-current={playing ? 'true' : undefined}
        className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm py-1 text-left ${focusRing}`}
      >
        <span
          className={`w-full truncate text-body font-medium ${playing ? 'text-primary' : 'text-foreground'}`}
        >
          {track.title}
        </span>
        <span className="w-full truncate text-caption text-muted-foreground">{sub}</span>
      </button>
      <span className="hidden shrink-0 font-mono text-caption text-muted-foreground sm:inline">
        {formatDuration(track.duration)}
      </span>
      <FavoriteButton kind="track" item={track} />
      <TrackMenu
        track={track}
        extra={menuExtra ?? []}
        hideAlbumLink={hideAlbumLink ?? false}
        hideArtistLink={hideArtistLink ?? false}
      />
    </div>
  );
}
