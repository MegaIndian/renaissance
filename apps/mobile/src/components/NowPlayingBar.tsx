import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { titleOf } from '@/lib/names';
import { getPlayer } from '@/lib/player';
import { useTheme } from '@/lib/theme';
import { useCurrentTrack, usePlayer } from '@/lib/usePlayer';

import { Artwork } from './Artwork';
import { Icon } from './Icon';

/**
 * Bottom player on every tab (F24 bar form), mirroring web's phone bar: art, title, play and next;
 * tapping the title opens the now-playing screen. Nothing queued: the Play button is muted, never a
 * second blue.
 */
export function NowPlayingBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, space, type, scale } = useTheme();
  const track = useCurrentTrack();
  const { status, error, position, duration } = usePlayer();
  const playing = status === 'playing' || status === 'loading';
  const bar = [
    styles.bar,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
      paddingHorizontal: space[4],
      paddingVertical: space[2],
      gap: space[3],
    },
  ];
  if (!track) {
    return (
      <View style={bar}>
        <View
          accessibilityElementsHidden
          style={{
            width: space[10],
            height: space[10],
            backgroundColor: colors.muted,
            borderRadius: radius.sm,
          }}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            { color: colors.mutedForeground, fontSize: type.body.size * scale },
          ]}
        >
          {t('player.nothingPlaying')}
        </Text>
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('player.play')}
          accessibilityState={{ disabled: true }}
          style={[
            styles.icon,
            {
              backgroundColor: colors.muted,
              width: space[8],
              height: space[8],
              borderRadius: radius.pill,
            },
          ]}
        >
          <Icon name="play" color={colors.mutedForeground} />
        </View>
      </View>
    );
  }
  const statusLine =
    status === 'error'
      ? error === 'signed-out'
        ? t('player.signedOut')
        : t('player.error')
      : status === 'loading'
        ? t('player.loading')
        : null;
  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <View>
      <View style={{ height: 1, backgroundColor: colors.border }}>
        <View
          style={{ height: 1, width: `${fraction * 100}%`, backgroundColor: colors.foreground }}
        />
      </View>
      <View style={[bar, { borderTopWidth: 0 }]}>
        <Pressable
          testID="now-playing-bar"
          accessibilityRole="button"
          accessibilityLabel={t('player.openNowPlaying')}
          accessibilityHint={titleOf(track, t)}
          onPress={() => router.push('/now-playing')}
          style={[styles.open, { gap: space[3] }]}
        >
          <View style={{ width: space[10] }}>
            <Artwork item={{ id: track.albumId ?? track.id, imageId: track.imageId }} size="sm" />
          </View>
          <View style={styles.title}>
            <Text
              numberOfLines={1}
              style={{
                color: colors.foreground,
                fontSize: type.body.size * scale,
                fontWeight: '500',
              }}
            >
              {titleOf(track, t)}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                color: status === 'error' ? colors.danger : colors.mutedForeground,
                fontSize: type.caption.size * scale,
              }}
            >
              {statusLine ?? (track.artistName || t('library.unknownArtist'))}
            </Text>
          </View>
        </Pressable>
        <Pressable
          testID="bar-toggle"
          accessibilityRole="button"
          accessibilityLabel={playing ? t('player.pause') : t('player.play')}
          onPress={() => getPlayer().toggle()}
          style={[
            styles.icon,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
              borderWidth: 1,
              width: space[8],
              height: space[8],
              borderRadius: radius.pill,
            },
          ]}
        >
          <Icon name={playing ? 'pause' : 'play'} color={colors.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('player.next')}
          onPress={() => getPlayer().next()}
          style={[styles.icon, { width: space[8], height: space[8], borderRadius: radius.pill }]}
        >
          <Icon name="next" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, minWidth: 0 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
