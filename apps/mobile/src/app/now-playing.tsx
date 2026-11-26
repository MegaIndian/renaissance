import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FavoriteButton } from '@/components/FavoriteButton';
import { Icon } from '@/components/Icon';
import { Scrubber, TransportControls } from '@/components/PlayerControls';
import { Toast } from '@/components/Toast';
import { titleOf } from '@/lib/names';
import { useSnapshot } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { useCurrentTrack, usePlayer } from '@/lib/usePlayer';

/**
 * Now playing (F24): art, title and artist, the heart, the scrubber, the transport with the one
 * blue on Play, and the way to the queue. Says when the song could not be played or the server is
 * transcoding it.
 */
export default function NowPlaying() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, space, type, scale } = useTheme();
  const track = useCurrentTrack();
  const { status, error, method } = usePlayer();
  const snapshot = useSnapshot();
  if (!track) {
    return (
      <View style={{ flex: 1, padding: space[4], backgroundColor: colors.background }}>
        <EmptyState title={t('queue.empty')} description={t('queue.emptyBody')} />
      </View>
    );
  }
  const cached = snapshot.tracks.find((x) => x.id === track.id) ?? track;
  const line =
    status === 'error'
      ? error === 'signed-out'
        ? t('player.signedOut')
        : t('player.error')
      : status === 'loading'
        ? t('player.loading')
        : method === 'transcode'
          ? t('player.transcode')
          : null;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: space[6], gap: space[6] }}>
        <View style={{ width: '100%', maxWidth: space[12] * 7, alignSelf: 'center' }}>
          <Artwork item={{ id: track.albumId ?? track.id, imageId: track.imageId }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
            <Text
              testID="now-playing-title"
              accessibilityRole="header"
              numberOfLines={2}
              style={{
                color: colors.foreground,
                fontSize: type.display.size * scale,
                fontWeight: '600',
              }}
            >
              {titleOf(track, t)}
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: colors.mutedForeground, fontSize: type.body.size * scale }}
            >
              {[track.artistName || t('library.unknownArtist'), track.albumTitle]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <FavoriteButton kind="track" item={cached} />
        </View>
        <Scrubber />
        {line ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              color: status === 'error' ? colors.danger : colors.mutedForeground,
              fontSize: type.caption.size * scale,
            }}
          >
            {line}
          </Text>
        ) : null}
        <TransportControls />
        <View style={{ alignItems: 'center' }}>
          <Button
            testID="open-queue"
            tone="secondary"
            title={t('player.queue')}
            icon={<Icon name="queue" />}
            onPress={() => router.push('/queue')}
          />
        </View>
      </ScrollView>
      <Toast />
    </View>
  );
}
