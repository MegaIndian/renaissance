/**
 * The network class for the playback policy (F27). Chrome exposes `navigator.connection`; where it
 * is absent a desktop browser is treated as Wi-Fi and a phone browser as unknown (the policy caps
 * unknown like cellular). Settings can pin either class.
 */
import type { NetworkClass, Settings } from '@renaissance/core';

interface Connection {
  type?: string;
  effectiveType?: string;
}

function connection(): Connection | undefined {
  return (navigator as Navigator & { connection?: Connection }).connection;
}

export function detectNetwork(
  conn: Connection | undefined = connection(),
  coarsePointer: boolean = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches,
  online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine,
): NetworkClass {
  if (!online) return 'offline';
  if (conn?.type) {
    if (conn.type === 'wifi' || conn.type === 'ethernet') return 'wifi';
    if (conn.type === 'cellular') return 'cellular';
    if (conn.type === 'none') return 'offline';
  }
  if (conn?.effectiveType && conn.effectiveType !== '4g') return 'cellular';
  return coarsePointer ? 'unknown' : 'wifi';
}

export function networkFor(settings: Pick<Settings, 'network'>): NetworkClass {
  if (settings.network === 'wifi') return 'wifi';
  if (settings.network === 'cellular') return 'cellular';
  return detectNetwork();
}
