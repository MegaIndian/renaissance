import type { Album, Artist, Playlist, Track } from '@renaissance/core';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { artistNameOf, playlistNameOf, titleOf } from '@/lib/names';
import { useTheme } from '@/lib/theme';

import { Artwork } from './Artwork';

/** Square art over a title and a subtitle: the one card shape (web's Cards.tsx by name). */
function Card({
  item,
  title,
  subtitle,
  onPress,
  round = false,
  testID,
}: {
  item: { id: string; imageId?: string | undefined };
  title: string;
  subtitle?: string;
  onPress: () => void;
  round?: boolean;
  testID?: string;
}) {
  const { colors, radius, space, type, scale } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={[styles.card, { borderRadius: radius.md, gap: space[2] }]}
    >
      <Artwork item={item} round={round} />
      <View>
        <Text
          numberOfLines={1}
          style={{ color: colors.foreground, fontSize: type.body.size * scale, fontWeight: '500' }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function AlbumCard({ album }: { album: Album }) {
  const { t } = useTranslation();
  const router = useRouter();
  const subtitle = [album.artistName || t('library.unknownArtist'), album.year]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card
      testID={`album-${album.id}`}
      item={album}
      title={titleOf(album, t)}
      subtitle={subtitle}
      onPress={() => router.push({ pathname: '/album/[id]', params: { id: album.id } })}
    />
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card
      item={artist}
      round
      title={artistNameOf(artist, t)}
      onPress={() => router.push({ pathname: '/artist/[id]', params: { id: artist.id } })}
    />
  );
}

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card
      item={playlist}
      title={playlistNameOf(playlist, t)}
      subtitle={t('library.tracksCount', { count: playlist.trackCount ?? 0 })}
      onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: playlist.id } })}
    />
  );
}

export function TrackCard({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const { t } = useTranslation();
  return (
    <Card
      item={{ id: track.albumId ?? track.id, imageId: track.imageId }}
      title={titleOf(track, t)}
      subtitle={track.artistName || t('library.unknownArtist')}
      onPress={onPlay}
    />
  );
}

const styles = StyleSheet.create({ card: { flex: 1 } });
