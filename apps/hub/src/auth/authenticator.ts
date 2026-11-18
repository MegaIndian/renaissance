/**
 * Who is asking (F86, F87). The apps send the Jellyfin access token they already hold; the hub asks
 * Jellyfin `GET /Users/Me` once, caches the answer for a few minutes under a hash of the token (the
 * token itself is never stored), and upserts the profile. Admins: the `RENAISSANCE_HUB_ADMINS` list
 * when set, otherwise Jellyfin's own administrators.
 */
import { createHash } from 'node:crypto';

import type { Profile } from '@renaissance/core';

import type { CacheStore } from '../db/cache.js';
import type { ProfileStore } from '../db/profiles.js';
import { httpJson } from '../http.js';
import type { Fetch } from '../http.js';

export interface Authenticator {
  /** The profile for a token, or null when Jellyfin rejects it. */
  authenticate(token: string): Promise<Profile | null>;
  /** Whether a Jellyfin is configured at all. */
  readonly configured: boolean;
}

export interface JellyfinUser {
  Id: string;
  Name: string;
  Policy?: { IsAdministrator?: boolean };
}

export const TOKEN_CACHE_TTL_MS = 5 * 60_000;

export function isAdmin(user: JellyfinUser, admins: readonly string[]): boolean {
  if (admins.length === 0) return user.Policy?.IsAdministrator === true;
  const wanted = new Set(admins.map((a) => a.toLowerCase()));
  return wanted.has(user.Id.toLowerCase()) || wanted.has(user.Name.toLowerCase());
}

export function jellyfinAuthenticator(options: {
  url: string | undefined;
  admins: readonly string[];
  profiles: ProfileStore;
  cache: CacheStore;
  fetch?: Fetch;
}): Authenticator {
  const { url, admins, profiles, cache } = options;
  const doFetch = options.fetch ?? fetch;
  return {
    configured: url !== undefined,
    async authenticate(token) {
      if (!url) return null;
      const key = `auth:${createHash('sha256').update(token).digest('hex')}`;
      const cached = cache.get<JellyfinUser | 'rejected'>(key);
      let user: JellyfinUser | 'rejected' | undefined = cached;
      if (user === undefined) {
        const res = await httpJson<JellyfinUser>(
          'jellyfin',
          `${url}/Users/Me`,
          { headers: { 'x-emby-token': token }, okStatuses: [401, 403], timeoutMs: 8_000 },
          doFetch,
        );
        user = res.status === 200 && res.body?.Id ? res.body : 'rejected';
        cache.set(key, user, user === 'rejected' ? 30_000 : TOKEN_CACHE_TTL_MS);
      }
      if (user === 'rejected') return null;
      return profiles.seen(user.Id, user.Name, isAdmin(user, admins) ? 'admin' : 'member');
    },
  };
}

/** For tests and `--dry-run`: every token in the map is a profile. */
export function staticAuthenticator(users: Record<string, Profile>): Authenticator {
  return {
    configured: true,
    authenticate: (token) => Promise.resolve(users[token] ?? null),
  };
}
