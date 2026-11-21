import type { PlayerSnapshot, Track } from '@renaissance/core';
import { useSyncExternalStore } from 'react';

import { getPlayer } from './player';

/** The player snapshot, live. */
export function usePlayer(): PlayerSnapshot {
  const player = getPlayer();
  return useSyncExternalStore(
    player.subscribe.bind(player),
    () => player.snapshot,
    () => player.snapshot,
  );
}

export function useCurrentTrack(): Track | undefined {
  const { queue } = usePlayer();
  return queue.items[queue.index];
}

/** Is this track the one in the player, and is it moving. */
export function useIsPlaying(trackId: string | undefined): { current: boolean; playing: boolean } {
  const snapshot = usePlayer();
  const current = !!trackId && snapshot.queue.items[snapshot.queue.index]?.id === trackId;
  return {
    current,
    playing: current && (snapshot.status === 'playing' || snapshot.status === 'loading'),
  };
}
