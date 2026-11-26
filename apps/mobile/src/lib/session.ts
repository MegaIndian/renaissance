/**
 * The signed-in session on a phone (F1, F2, F86): core's `SessionController` with the token in the
 * Keychain (`vault.ts`) and adapters that ask Jellyfin only for what AVPlayer plays directly.
 */
import { JellyfinAdapter, SessionController } from '@renaissance/core';
import type { Server } from '@renaissance/core';

import { appVersion, deviceId, deviceName } from './device';
import { debug } from './log';
import { keychainVault } from './vault';
import type { VaultMode } from './vault';

/**
 * Containers AVPlayer and ExoPlayer play directly, in the universal endpoint's syntax. Opus, Vorbis
 * and WebM are left out: Jellyfin transcodes those to mp3 for this device.
 */
export const PHONE_CONTAINERS = 'mp3,aac,m4a|aac,m4a|alac,m4b|aac,flac,wav';

/** Codecs the playback policy treats as direct on a phone (reporting says direct or transcode). */
export const PHONE_CODECS = ['mp3', 'aac', 'alac', 'flac', 'm4a', 'wav'];

export function createAdapter(server: Server, fetchImpl: typeof fetch = fetch): JellyfinAdapter {
  return new JellyfinAdapter(server, {
    deviceName: deviceName(),
    deviceId: deviceId(),
    version: appVersion(),
    fetch: fetchImpl,
    WebSocket,
    containers: PHONE_CONTAINERS,
  });
}

export const sessions = new SessionController<JellyfinAdapter, VaultMode>({
  vault: keychainVault,
  createAdapter,
  unsavedMode: 'none',
  log: debug,
});

export const sessionStore = sessions.state;
