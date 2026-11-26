import type { Track } from '@renaissance/core';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';

import { playNow, toggleFavorite } from '@/lib/actions';
import { openTrackMenu } from '@/lib/menu';
import { getPlayer } from '@/lib/player';

import { TrackRow } from './TrackRow';

/**
 * Songs in a virtualised list (20,000 scroll fine): a tap plays the list from that song, or pauses
 * and resumes it when it is the current one; heart and menu on every row. Web's TrackList.
 */
export function TrackList({
  tracks,
  header,
  showNumber = false,
  showAlbum = true,
  testID,
}: {
  tracks: Track[];
  header?: ReactElement;
  showNumber?: boolean;
  showAlbum?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <FlatList
      testID={testID}
      data={tracks}
      keyExtractor={(track, i) => `${track.id}-${i}`}
      ListHeaderComponent={header}
      initialNumToRender={20}
      windowSize={7}
      renderItem={({ item, index }) => (
        <TrackRow
          track={item}
          index={index}
          showNumber={showNumber}
          showAlbum={showAlbum}
          onPlay={() => {
            const player = getPlayer();
            const current = player.snapshot.queue.items[player.snapshot.queue.index];
            if (current?.id === item.id) player.toggle();
            else playNow(tracks, index);
          }}
          onToggleFavorite={() => void toggleFavorite('track', item, t)}
          onMenu={() => openTrackMenu({ track: item })}
        />
      )}
    />
  );
}
