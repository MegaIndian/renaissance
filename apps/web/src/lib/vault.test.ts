import { afterEach, describe, expect, it } from 'vitest';

import { session } from '../test/fakes';
import { clearSession, loadSession, saveSession, vaultMode } from './vault';

describe('vault', () => {
  afterEach(() => clearSession());

  it('encrypts the session under a non-extractable key and reads it back', async () => {
    expect(vaultMode()).toBe('encrypted');
    expect(await saveSession(session)).toBe('encrypted');
    const stored = await loadSession();
    expect(stored).toEqual({ session, mode: 'encrypted' });
    // The raw record never holds the token in clear text.
    const { openDB } = await import('idb');
    const db = await openDB('renaissance-vault', 1);
    const record = (await db.get('sessions', 'session')) as { mode: string; data: ArrayBuffer };
    db.close();
    expect(record.mode).toBe('encrypted');
    expect(new TextDecoder().decode(record.data)).not.toContain('tok');
    const key = (await (
      await openDB('renaissance-vault', 1)
    ).get('keys', 'session-key')) as CryptoKey;
    expect(key.extractable).toBe(false);
  });

  it('clears and reports nothing when empty or corrupt', async () => {
    expect(await loadSession()).toBeNull();
    await saveSession(session);
    await clearSession();
    expect(await loadSession()).toBeNull();
    const { openDB } = await import('idb');
    const db = await openDB('renaissance-vault', 1);
    await db.put('sessions', { mode: 'plain', data: '{"nope":true}' }, 'session');
    db.close();
    expect(await loadSession()).toBeNull();
  });
});
