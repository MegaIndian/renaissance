import type { Album, Artist, Playlist, Track } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import { toggleFavorite } from '@/lib/actions';
import { useTheme } from '@/lib/theme';

import { Icon } from './Icon';

/** The heart for an album, artist or song (F12), synced with Jellyfin; web's FavoriteButton. */
export function FavoriteButton({
  kind,
  item,
}: {
  kind: 'track' | 'album' | 'artist' | 'playlist';
  item: Track | Album | Artist | Playlist;
}) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      testID={`favorite-${item.id}`}
      accessibilityRole="togglebutton"
      accessibilityState={{ checked: item.isFavorite }}
      accessibilityLabel={item.isFavorite ? t('favorites.remove') : t('favorites.add')}
      onPress={() => void toggleFavorite(kind, item, t)}
      style={{
        width: space[10],
        height: space[10],
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon
        name={item.isFavorite ? 'heartFilled' : 'heart'}
        color={item.isFavorite ? colors.foreground : colors.mutedForeground}
      />
    </Pressable>
  );
}
