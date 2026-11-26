/**
 * The network class for the playback policy (F27), from expo-network; Settings can pin either
 * class. Read when a stream URL is built, so a walk out of Wi-Fi caps the next song.
 */
import type { NetworkClass, Settings } from '@renaissance/core';
import * as Network from 'expo-network';

let current: NetworkClass = 'unknown';

function classify(state: Network.NetworkState): NetworkClass {
  if (state.isConnected === false) return 'offline';
  if (
    state.type === Network.NetworkStateType.WIFI ||
    state.type === Network.NetworkStateType.ETHERNET
  ) {
    return 'wifi';
  }
  if (state.type === Network.NetworkStateType.CELLULAR) return 'cellular';
  return 'unknown';
}

/** Follow the network from now on; returns the unsubscribe. */
export function watchNetwork(): () => void {
  void Network.getNetworkStateAsync()
    .then((state) => {
      current = classify(state);
    })
    .catch(() => undefined);
  const sub = Network.addNetworkStateListener((state) => {
    current = classify(state);
  });
  return () => sub.remove();
}

export function networkFor(settings: Pick<Settings, 'network'>): NetworkClass {
  if (settings.network === 'wifi') return 'wifi';
  if (settings.network === 'cellular') return 'cellular';
  return current;
}
