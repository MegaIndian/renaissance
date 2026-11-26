import type { ListenSource, Track } from '@renaissance/core';
import { useEffect, useState } from 'react';

import { playNow } from '../lib/actions';
import { usePlayer } from '../lib/usePlayer';
import { TrackRow, trackRowHeightPx } from './TrackRow';
import { VirtualList } from './VirtualList';

/** The row height follows the root font size (simple mode, the browser's own setting). */
export function useTrackRowHeight(): number {
  const [height, setHeight] = useState(trackRowHeightPx);
  useEffect(() => {
    const measure = (): void => setHeight(trackRowHeightPx());
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode'],
    });
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return height;
}

/**
 * Songs: a virtualised list of `TrackRow`s that reads the player so the current row is marked.
 * Any screen with a list of songs (Library, Artist, Favourites, Search, the Library's "Mine" rows)
 * renders this; a play starts the whole list from the chosen row.
 */
export function TrackList({
  tracks,
  showNumber = false,
  hideAlbumLink = false,
  source,
}: {
  tracks: Track[];
  showNumber?: boolean;
  hideAlbumLink?: boolean;
  /** Where these songs are, for the listening log (F47). */
  source?: ListenSource;
}) {
  const player = usePlayer();
  const rowHeight = useTrackRowHeight();
  const currentId = player.queue.items[player.queue.index]?.id;
  const paused = player.status !== 'playing' && player.status !== 'loading';
  return (
    <VirtualList
      items={tracks}
      rowHeight={rowHeight}
      keyOf={(track) => track.id}
      renderItem={(track, i) => (
        <TrackRow
          track={track}
          index={i}
          showNumber={showNumber}
          showArt={!showNumber}
          hideAlbumLink={hideAlbumLink}
          playing={track.id === currentId}
          paused={paused}
          onPlay={() => playNow(tracks, i, source)}
        />
      )}
    />
  );
}
