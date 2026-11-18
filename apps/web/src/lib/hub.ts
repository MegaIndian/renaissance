/**
 * The hub (ADR 0007 point 4): one client for the whole app, built from the hub address and the
 * caller's Jellyfin token, plus the profile the hub answers for that token. Phase 0 shell: the token
 * is read from `?hubToken=` once (stored under `renaissance.hubToken`) because there is no sign-in
 * yet; phase 1's session store replaces `readHubToken` with the signed-in session's token and nothing
 * else here changes. App-side Ask actions (`play`, `queue`, `make_playlist`) run through `perform`,
 * which phase 1 wires to its playback actions; until then the cards say playback is not connected.
 */
import { HubClientError, createHubClient } from '@renaissance/core';
import type { AskAction, HubClient, Profile } from '@renaissance/core';
import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export const HUB_TOKEN_KEY = 'renaissance.hubToken';

/** The hub's address: `VITE_HUB_URL`, else this host on the hub's default port. */
export function hubUrl(): string {
  const fromEnv = import.meta.env.VITE_HUB_URL as string | undefined;
  if (fromEnv) return fromEnv;
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

export function readHubToken(search: string = window.location.search): string | null {
  try {
    const fromUrl = new URLSearchParams(search).get('hubToken');
    if (fromUrl) {
      localStorage.setItem(HUB_TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(HUB_TOKEN_KEY);
  } catch {
    return null;
  }
}

export type HubStatus = 'off' | 'loading' | 'ready' | 'unauthorized' | 'unreachable';

/** Performs or undoes an app-side Ask action (the app holds the player, not the hub). */
export type PerformAction = (action: AskAction, direction: 'do' | 'undo') => Promise<void>;

/** Builds the URL of a library item's art, when the app knows the media server. */
export type LibraryArt = (imageId: string) => string;

export interface HubState {
  client: HubClient | null;
  profile: Profile | null;
  status: HubStatus;
  perform: PerformAction | null;
  libraryArt: LibraryArt | null;
}

const HubContext = createContext<HubState>({
  client: null,
  profile: null,
  status: 'off',
  perform: null,
  libraryArt: null,
});

/** Provides the hub to the tree. `client` is injected by tests; the app builds one from the token. */
export function HubProvider({
  client,
  perform = null,
  libraryArt = null,
  children,
}: {
  client?: HubClient | null;
  perform?: PerformAction | null;
  libraryArt?: LibraryArt | null;
  children: ReactNode;
}) {
  const built = useMemo(() => {
    if (client !== undefined) return client;
    const token = readHubToken();
    return token ? createHubClient({ url: hubUrl(), token }) : null;
  }, [client]);
  const [state, setState] = useState<HubState>({
    client: built,
    profile: null,
    status: built ? 'loading' : 'off',
    perform,
    libraryArt,
  });

  useEffect(() => {
    if (!built) {
      setState({ client: null, profile: null, status: 'off', perform, libraryArt });
      return;
    }
    let cancelled = false;
    setState({ client: built, profile: null, status: 'loading', perform, libraryArt });
    built.me().then(
      (profile) => {
        if (!cancelled) setState({ client: built, profile, status: 'ready', perform, libraryArt });
      },
      (error: unknown) => {
        if (cancelled) return;
        const unauthorized = error instanceof HubClientError && error.status === 401;
        setState({
          client: built,
          profile: null,
          status: unauthorized ? 'unauthorized' : 'unreachable',
          perform,
          libraryArt,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [built, perform, libraryArt]);

  return createElement(HubContext.Provider, { value: state }, children);
}

export function useHub(): HubState {
  return useContext(HubContext);
}

/**
 * How much of the machinery a person sees (design B): simple mode shows plain sentences only;
 * advanced mode (the profile's choice, or `?mode=advanced` on the web) and admins also get the
 * collapsed "what happened" list with the pipeline's own words.
 */
export function useDetailLevel(): { advanced: boolean; admin: boolean; showDetail: boolean } {
  const { profile } = useHub();
  const advanced =
    profile?.mode === 'advanced' || document.documentElement.dataset['mode'] === 'advanced';
  const admin = profile?.role === 'admin';
  return { advanced, admin, showDetail: advanced || admin };
}
