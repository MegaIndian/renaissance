/**
 * The app's small key-value state (settings, the last server, recent searches, the saved queue)
 * in AsyncStorage, mirrored in memory so stores can read it synchronously once `hydrate` has run at
 * startup. Writes go to memory at once and to disk in the background; a refused write is kept for
 * the session only. Never the token: that lives in the Keychain (`vault.ts`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const memory = new Map<string, string>();

/** Read every stored key once, before the first screen paints. */
export async function hydrate(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const pairs = await AsyncStorage.multiGet(keys.filter((k) => k.startsWith('renaissance.')));
    for (const [key, value] of pairs) if (value !== null) memory.set(key, value);
  } catch {
    /* storage unavailable: defaults for this launch */
  }
}

export function getItem(key: string): string | null {
  return memory.get(key) ?? null;
}

export function setItem(key: string, value: string): void {
  memory.set(key, value);
  AsyncStorage.setItem(key, value).catch(() => {
    /* kept in memory for the session */
  });
}

export function removeItem(key: string): void {
  memory.delete(key);
  AsyncStorage.removeItem(key).catch(() => {
    /* nothing to remove */
  });
}

/** For tests. */
export function resetKvForTests(): void {
  memory.clear();
}
