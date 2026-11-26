/**
 * The signed-in session on any platform (F1, F2, F86): one Jellyfin user per household member. The
 * platform injects the vault that keeps the token (the Keychain or Keystore on mobile, ADR 0008 on
 * web) and the adapter factory; this owns the state machine. `restore` runs once at startup so the
 * app comes back signed in without asking, a 401 to a request that carried this session's token
 * ends the session with `reason: 'expired'`, and signing out revokes the token on the server.
 */
import { carriesToken } from './address';
import { ServerError } from './adapters/jellyfin';
import type { Server } from './models';
import type { Credentials, ServerAdapter, Session } from './server-adapter';
import type { Store } from './store';
import { createStore } from './store';

export interface SessionVault<Mode extends string = string> {
  /** The stored session, or null when there is none or it cannot be read. */
  load(): Promise<{ session: Session; mode: Mode } | null>;
  /** Keep the session; resolves to how it was kept. */
  save(session: Session): Promise<Mode>;
  clear(): Promise<void>;
}

export interface SessionState<
  A extends ServerAdapter = ServerAdapter,
  Mode extends string = string,
> {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  adapter: A | null;
  vault: Mode | null;
  /**
   * Why the app is signed out: `expired` when the server answered 401 to this token (a password
   * change, the device removed in Jellyfin); the sign-in screen says so.
   */
  reason: 'expired' | null;
}

export interface SessionPlatform<A extends ServerAdapter, Mode extends string> {
  vault: SessionVault<Mode>;
  /** Build an adapter that sends its requests through `fetch`. */
  createAdapter(server: Server, fetch: typeof globalThis.fetch): A;
  /** The platform's fetch; the global one by default. */
  fetch?: typeof globalThis.fetch;
  /** The session ended here (a sign-out or an expiry), so peers can follow; optional. */
  onEnded?(session: Session, reason: SessionState['reason']): void;
  /** The mode to report when the vault refused the session; it then lasts the run. */
  unsavedMode: Mode;
  log?(where: string, error: unknown): void;
}

export function sessionKey(session: Session): string {
  return `${session.server.id}:${session.userId}`;
}

export class SessionController<
  A extends ServerAdapter = ServerAdapter,
  Mode extends string = string,
> {
  readonly state: Store<SessionState<A, Mode>>;
  private readonly platform: SessionPlatform<A, Mode>;
  private restoring: Promise<void> | null = null;

  constructor(platform: SessionPlatform<A, Mode>) {
    this.platform = platform;
    this.state = createStore<SessionState<A, Mode>>({
      status: 'loading',
      session: null,
      adapter: null,
      vault: null,
      reason: null,
    });
  }

  private signedOut(reason: SessionState['reason'] = null): SessionState<A, Mode> {
    return { status: 'signedOut', session: null, adapter: null, vault: null, reason };
  }

  private log(where: string): (error: unknown) => void {
    return (error) => this.platform.log?.(where, error);
  }

  /** An adapter for a server with no session yet (ping, sign-in, Quick Connect). */
  probe(server: Server): A {
    const base = this.platform.fetch ?? globalThis.fetch.bind(globalThis);
    return this.platform.createAdapter(server, base);
  }

  /**
   * The adapter for a signed-in session. A 401 to a request that carried a token ends the session:
   * the token was revoked. Only the adapter the app currently holds may do that: a sync still paging
   * with the previous user's adapter after a sign-out sees 401s of its own, and those must not sign
   * the next user out. A wrong password stays a wrong password (sign-in carries no token).
   */
  private watched(server: Server): A {
    const base = this.platform.fetch ?? globalThis.fetch.bind(globalThis);
    const adapter: A = this.platform.createAdapter(server, async (input, init) => {
      const response = await base(input, init);
      if (response.status === 401 && carriesToken(init) && this.state.get().adapter === adapter) {
        this.expire();
      }
      return response;
    });
    return adapter;
  }

  /** The server revoked this token: forget it and show the sign-in screen with a sentence. */
  expire(): void {
    const { status, session } = this.state.get();
    if (status !== 'signedIn' || !session) return;
    this.state.set(this.signedOut('expired'));
    void this.platform.vault.clear().catch(this.log('vault clear failed'));
    this.platform.onEnded?.(session, 'expired');
  }

  /** A peer ended this user's session (another tab); follow it without telling the server again. */
  follow(key: string, reason: SessionState['reason']): void {
    const { status, session } = this.state.get();
    if (status !== 'signedIn' || !session || sessionKey(session) !== key) return;
    this.state.set(this.signedOut(reason === 'expired' ? 'expired' : null));
  }

  private async adopt(server: Server, session: Session): Promise<void> {
    const adapter = this.watched(server);
    const vault = await this.platform.vault
      .save(session)
      .catch<Mode>(() => this.platform.unsavedMode);
    this.state.set({ status: 'signedIn', session, adapter, vault, reason: null });
  }

  async signIn(server: Server, credentials: Credentials): Promise<Session> {
    const session = await this.probe(server).signIn(credentials);
    await this.adopt(server, session);
    return session;
  }

  async signInWithQuickConnect(server: Server, secret: string): Promise<Session> {
    const session = await this.probe(server).quickConnect.authenticate(secret);
    await this.adopt(server, session);
    return session;
  }

  /** The user chose to sign out: revoke the token on the server and forget it here. */
  async signOut(): Promise<void> {
    const { adapter, session } = this.state.get();
    this.state.set(this.signedOut());
    await this.platform.vault.clear().catch(this.log('vault clear failed'));
    if (session) this.platform.onEnded?.(session, null);
    if (adapter && session)
      await adapter.signOut(session).catch(this.log('server sign-out failed'));
  }

  /**
   * Read the vault once; the state is `loading` until then so screens do not flash signed out. The
   * restored token is checked with one `/Users/Me`: a 401 means it was revoked while the app was
   * closed. A server that is down keeps the session, so the cache works offline.
   */
  restore(): Promise<void> {
    this.restoring ??= this.platform.vault
      .load()
      .then(async (stored) => {
        if (!stored) {
          this.state.set(this.signedOut());
          return;
        }
        const adapter = this.watched(stored.session.server);
        this.state.set({
          status: 'signedIn',
          session: stored.session,
          adapter,
          vault: stored.mode,
          reason: null,
        });
        try {
          await adapter.me(stored.session);
        } catch (error) {
          if (error instanceof ServerError && (error.status === 401 || error.status === 403)) {
            this.expire();
          }
        }
      })
      .catch(() => {
        this.state.set(this.signedOut());
      });
    return this.restoring;
  }

  /** For tests: forget the restore so the next call reads the vault again. */
  reset(): void {
    this.restoring = null;
    this.state.set({ status: 'loading', session: null, adapter: null, vault: null, reason: null });
  }
}
