import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { useLibrary } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { relativeTime } from '@/lib/time';

/** One line on how fresh the library is (web's SyncStatus): loading, refreshing, failed or when. */
export function SyncStatus() {
  const { t } = useTranslation();
  const { colors, type, scale } = useTheme();
  const { sync, snapshot } = useLibrary();
  const kind = (k: string) =>
    k === 'track'
      ? t('library.tracks')
      : k === 'album'
        ? t('library.albums')
        : k === 'artist'
          ? t('library.artists')
          : t('library.playlists');
  const text =
    sync.status === 'syncing' && sync.progress && !snapshot.syncedAt
      ? t('library.syncing', {
          done: sync.progress.done,
          total: sync.progress.total,
          kind: kind(sync.progress.kind),
        })
      : sync.status === 'syncing' && !snapshot.syncedAt
        ? t('library.syncingFirst')
        : sync.status === 'error'
          ? snapshot.syncedAt
            ? t('library.syncFailed')
            : t('library.firstSyncFailed')
          : snapshot.syncedAt
            ? t('library.syncedAt', { when: relativeTime(snapshot.syncedAt, t) })
            : null;
  if (!text) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={{
        color: sync.status === 'error' ? colors.danger : colors.mutedForeground,
        fontSize: type.caption.size * scale,
      }}
    >
      {text}
    </Text>
  );
}
