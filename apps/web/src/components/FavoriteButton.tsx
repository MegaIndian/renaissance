import type { Album, Artist, Playlist, Track } from '@renaissance/core';
import { useTranslation } from 'react-i18next';

import { toggleFavorite } from '../lib/actions';
import { Icon } from './Icon';
import { focusRing } from './focus';

/** The heart (F12): a toggle button whose pressed state is the favourite, synced with Jellyfin. */
export function FavoriteButton({
  kind,
  item,
  className = '',
  size = 'size-8',
}: {
  kind: 'track' | 'album' | 'artist' | 'playlist';
  item: Track | Album | Artist | Playlist;
  className?: string;
  size?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-pressed={item.isFavorite}
      aria-label={item.isFavorite ? t('favorites.remove') : t('favorites.add')}
      onClick={(event) => {
        event.stopPropagation();
        void toggleFavorite(kind, item, t);
      }}
      className={`grid ${size} min-h-6 min-w-6 shrink-0 place-items-center rounded-pill ${
        item.isFavorite ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      } ${focusRing} ${className}`}
    >
      <Icon name={item.isFavorite ? 'heartFilled' : 'heart'} className="size-4" />
    </button>
  );
}
