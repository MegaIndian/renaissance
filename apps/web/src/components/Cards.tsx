import type { Album, Artist, Playlist, Track } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Artwork, colorIndex } from './Artwork';
import { focusRing } from './focus';

const card = `group flex w-full flex-col gap-2 rounded-md p-2 text-left hover:bg-muted/40 ${focusRing}`;

/** Square art, title in body-strong, subtitle in caption (the mockup's grid). Mirrored on mobile. */
export function AlbumCard({ album }: { album: Album }) {
  const { t } = useTranslation();
  const subtitle = [album.artistName || t('library.unknownArtist'), album.year]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link to={`/album/${encodeURIComponent(album.id)}`} className={card}>
      <Artwork imageId={album.imageId} label={album.title} index={colorIndex(album.id)} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body font-medium text-foreground">{album.title}</span>
        <span className="truncate text-caption text-muted-foreground">{subtitle}</span>
      </span>
    </Link>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link to={`/artist/${encodeURIComponent(artist.id)}`} className={card}>
      <Artwork
        imageId={artist.imageId}
        label={artist.name}
        index={colorIndex(artist.id)}
        rounded="rounded-pill"
      />
      <span className="truncate text-center text-body font-medium text-foreground">
        {artist.name}
      </span>
    </Link>
  );
}

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation();
  return (
    <Link to={`/playlist/${encodeURIComponent(playlist.id)}`} className={card}>
      <Artwork imageId={playlist.imageId} label={playlist.name} index={colorIndex(playlist.id)} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body font-medium text-foreground">{playlist.name}</span>
        <span className="truncate text-caption text-muted-foreground">
          {t('library.tracksCount', { count: playlist.trackCount })}
        </span>
      </span>
    </Link>
  );
}

/** A song as a square card for the home rows (simple mode shows these at 1.25×). */
export function TrackCard({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={t('actions.play', { title: track.title })}
      className={card}
    >
      <Artwork imageId={track.imageId} label={track.title} index={colorIndex(track.id)} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body font-medium text-foreground">{track.title}</span>
        <span className="truncate text-caption text-muted-foreground">{track.artistName}</span>
      </span>
    </button>
  );
}

/** A plain text card for genres and years. */
export function LabelCard({
  to,
  title,
  subtitle,
  index,
}: {
  to: string;
  title: string;
  subtitle: string;
  index: number;
}) {
  return (
    <Link to={to} className={`${card} border border-border bg-card`}>
      <span
        className="flex aspect-video items-end rounded-sm p-3"
        style={{ background: `var(--chart-${(index % 6) + 1})` }}
      >
        <span className="truncate text-title font-semibold text-chart-ink">{title}</span>
      </span>
      <span className="truncate text-caption text-muted-foreground">{subtitle}</span>
    </Link>
  );
}
