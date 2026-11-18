/**
 * Who is asking (F86, F87). The apps send the Jellyfin access token they already hold; the hub asks
 * Jellyfin `GET /Users/Me` once, caches the id, name and admin flag for a few minutes under a hash
 * of the token (the token itself is never stored, nor the rest of the user record), and upserts the
 * profile. Admins: the `RENAISSANCE_HUB_ADMINS` list
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
  /** The profile for a token only if a recent check is cached; never calls Jellyfin. */
  peek(token: string): Profile | null;
  /** Whether a Jellyfin is configured at all. */
  readonly configured: boolean;
}

export interface JellyfinUser {
  Id: string;
  Name: string;
  Policy?: { IsAdministrator?: boolean };
}

/** What the token cache keeps: three fields, not Jellyfin's whole user record. */
export interface CachedUser {
  Id: string;
  Name: string;
  IsAdministrator: boolean;
}

export const TOKEN_CACHE_TTL_MS = 5 * 60_000;

export function isAdmin(user: CachedUser, admins: readonly string[]): boolean {
  if (admins.length === 0) return user.IsAdministrator;
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
  const keyFor = (token: string): string =>
    `auth:${createHash('sha256').update(token).digest('hex')}`;
  const toProfile = (user: CachedUser): Profile =>
    profiles.seen(user.Id, user.Name, isAdmin(user, admins) ? 'admin' : 'member');
  return {
    configured: url !== undefined,
    peek(token) {
      if (!url) return null;
      const cached = cache.get<CachedUser | 'rejected'>(keyFor(token));
      return cached && cached !== 'rejected' ? toProfile(cached) : null;
    },
    async authenticate(token) {
      if (!url) return null;
      const key = keyFor(token);
      const cached = cache.get<CachedUser | 'rejected'>(key);
      let user: CachedUser | 'rejected' | undefined = cached;
      if (user === undefined) {
        const res = await httpJson<JellyfinUser>(
          'jellyfin',
          `${url}/Users/Me`,
          { headers: { 'x-emby-token': token }, okStatuses: [401, 403], timeoutMs: 8_000 },
          doFetch,
        );
        user =
          res.status === 200 && res.body?.Id
            ? {
                Id: res.body.Id,
                Name: res.body.Name,
                IsAdministrator: res.body.Policy?.IsAdministrator === true,
              }
            : 'rejected';
        cache.set(key, user, user === 'rejected' ? 30_000 : TOKEN_CACHE_TTL_MS);
      }
      if (user === 'rejected') return null;
      return toProfile(user);
    },
  };
}

/** For tests and `--dry-run`: every token in the map is a profile. */
export function staticAuthenticator(users: Record<string, Profile>): Authenticator {
  return {
    configured: true,
    peek: (token) => users[token] ?? null,
    authenticate: (token) => Promise.resolve(users[token] ?? null),
  };
}
