import type { Track } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { titleOf } from '../lib/names';
import { addToQueue, playNext, toggleFavorite } from '../lib/actions';
import { openDialog } from '../lib/dialogs';
import { Menu } from './Menu';
import type { MenuItem } from './Menu';

/** The "more" menu every track row shares: queue, playlist, favourite and navigation actions. */
export function TrackMenu({
  track,
  extra = [],
  hideAlbumLink = false,
  hideArtistLink = false,
}: {
  track: Track;
  /** Context items, for example "Remove from playlist" or "Remove from queue". */
  extra?: MenuItem[];
  hideAlbumLink?: boolean;
  hideArtistLink?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const items: MenuItem[] = [
    { key: 'next', label: t('queue.playNext'), icon: 'next', onSelect: () => playNext([track], t) },
    {
      key: 'queue',
      label: t('queue.addToQueue'),
      icon: 'queue',
      onSelect: () => addToQueue([track], t),
    },
    {
      key: 'playlist',
      label: t('playlist.addTo'),
      icon: 'playlist',
      onSelect: () => openDialog({ kind: 'addToPlaylist', tracks: [track] }),
    },
    {
      key: 'favorite',
      label: track.isFavorite ? t('favorites.remove') : t('favorites.add'),
      icon: track.isFavorite ? 'heartFilled' : 'heart',
      onSelect: () => void toggleFavorite('track', track, t),
    },
    ...(track.albumId && !hideAlbumLink
      ? [
          {
            key: 'album',
            label: t('track.goToAlbum'),
            icon: 'album' as const,
            onSelect: () => void navigate(`/album/${encodeURIComponent(track.albumId ?? '')}`),
          },
        ]
      : []),
    ...(track.artistIds[0] && !hideArtistLink
      ? [
          {
            key: 'artist',
            label: t('track.goToArtist'),
            icon: 'person' as const,
            onSelect: () =>
              void navigate(`/artist/${encodeURIComponent(track.artistIds[0] ?? '')}`),
          },
        ]
      : []),
    ...extra,
  ];
  return <Menu label={t('track.menu', { title: titleOf(track, t) })} items={items} />;
}
