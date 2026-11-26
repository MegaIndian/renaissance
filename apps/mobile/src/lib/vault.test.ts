import * as SecureStore from 'expo-secure-store';

import { keychainVault } from './vault';

const session = {
  server: { id: 'h:8096', kind: 'jellyfin' as const, name: 'h', url: 'http://h:8096' },
  userId: 'u1',
  userName: 'demo',
  token: 'secret-token',
};

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe('keychainVault', () => {
  beforeEach(() => store.clear());

  it('keeps the session in the keychain, readable after first unlock on this device only', async () => {
    expect(await keychainVault.save(session)).toBe('keychain');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'renaissance.session',
      expect.any(String),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
    );
    expect(await keychainVault.load()).toEqual({ session, mode: 'keychain' });
    await keychainVault.clear();
    expect(await keychainVault.load()).toBeNull();
  });

  it('clears a stored value that is not a session', async () => {
    store.set('renaissance.session', '{"token":""}');
    expect(await keychainVault.load()).toBeNull();
    expect(store.has('renaissance.session')).toBe(false);
    store.set('renaissance.session', 'not json');
    expect(await keychainVault.load()).toBeNull();
    expect(store.has('renaissance.session')).toBe(false);
  });

  it('refuses to save something that is not a session', async () => {
    await expect(keychainVault.save({ ...session, token: '' })).rejects.toThrow();
  });
});
