/**
 * Where the Jellyfin token lives on a phone (F5, ADR 0008): the platform keychain through
 * expo-secure-store (the iOS Keychain; the Android Keystore encrypts the value). Readable after the
 * first unlock so a stream that resumes behind the lock screen still has it, and never synced to
 * another device. The session is validated on the way back in; anything unreadable is cleared.
 */
import { Server } from '@renaissance/core';
import type { Session, SessionVault } from '@renaissance/core';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

const KEY = 'renaissance.session';

/** `keychain`: in the platform keychain. `none`: the keychain refused; the session lasts the run. */
export type VaultMode = 'keychain' | 'none';

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const StoredSession = z.object({
  server: Server,
  userId: z.string().min(1),
  userName: z.string().min(1),
  token: z.string().min(1),
});

export const keychainVault: SessionVault<VaultMode> = {
  async load() {
    const raw = await SecureStore.getItemAsync(KEY, options);
    if (!raw) return null;
    try {
      const parsed = StoredSession.safeParse(JSON.parse(raw));
      if (parsed.success) return { session: parsed.data as Session, mode: 'keychain' };
    } catch {
      /* garbage: cleared below */
    }
    await SecureStore.deleteItemAsync(KEY, options);
    return null;
  },
  async save(session) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(StoredSession.parse(session)), options);
    return 'keychain';
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY, options);
  },
};
