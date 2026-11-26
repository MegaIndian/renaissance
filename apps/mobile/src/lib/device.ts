/**
 * Who this device is to Jellyfin: a stable id (kept in the app's store, so the server shows one
 * device per install) and a readable name ("Renaissance on iPhone").
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { getItem, setItem } from './kv';

const DEVICE_KEY = 'renaissance.deviceId';

export function deviceId(): string {
  const stored = getItem(DEVICE_KEY);
  if (stored) return stored;
  const fresh = Crypto.randomUUID();
  setItem(DEVICE_KEY, fresh);
  return fresh;
}

export function deviceName(): string {
  const name = Constants.deviceName;
  if (name) return name;
  return Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : 'Phone';
}

export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}
