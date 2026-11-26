/* global jest */
// Native modules the unit tests never reach: in-memory stand-ins with the same API.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
    __store: store,
    getItemAsync: jest.fn((key) => Promise.resolve(store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn((key, value) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(() => Promise.reject(new Error('no sqlite in unit tests'))),
  deleteDatabaseAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI', ETHERNET: 'ETHERNET', CELLULAR: 'CELLULAR', NONE: 'NONE' },
  getNetworkStateAsync: jest.fn(() => Promise.resolve({ isConnected: true, type: 'WIFI' })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

jest.mock('react-native-track-player', () => jest.requireActual('./src/test/track-player-mock'));
