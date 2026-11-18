import type { Server } from '@renaissance/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  classifySignInError,
  createAdapter,
  serverFromAddress,
  signIn,
  signInWithQuickConnect,
  useLastServer,
} from '../lib/signin';
import { useSession } from '../lib/queries';
import { Button } from '../components/Button';
import { focusRing } from '../components/focus';

/**
 * Sign in (F1) and Quick Connect (F2). Each household member signs in as their own Jellyfin user
 * (F86). Errors are full sentences that say what to do; the one primary is Sign in.
 */
export function SignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const [lastServer, rememberServer] = useLastServer();
  const [address, setAddress] = useState(lastServer);
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ server: Server; code: string; secret: string } | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!quick) return;
    const adapter = createAdapter(quick.server);
    let cancelled = false;
    const poll = async (): Promise<void> => {
      while (!cancelled) {
        try {
          if (await adapter.quickConnect.state(quick.secret)) {
            await signInWithQuickConnect(quick.server, quick.secret);
            rememberServer(quick.server.url);
            if (!cancelled) void navigate('/');
            return;
          }
        } catch (err) {
          if (!cancelled) setQuickError(describe(classifySignInError(err), t));
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [quick, navigate, rememberServer, t]);

  const parseServer = (): Server | null => {
    const server = serverFromAddress(address);
    if (!server) setError(t('signIn.errorAddress'));
    return server;
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    const server = parseServer();
    if (!server) return;
    setBusy(true);
    try {
      await signIn(server, { userName: userName.trim(), password });
      rememberServer(server.url);
      void navigate('/');
    } catch (err) {
      if (alive.current) setError(describe(classifySignInError(err), t));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const startQuickConnect = async (): Promise<void> => {
    setError(null);
    setQuickError(null);
    const server = parseServer();
    if (!server) return;
    setBusy(true);
    try {
      const adapter = createAdapter(server);
      if (!(await adapter.quickConnect.enabled())) {
        setQuickError(t('signIn.quickConnectUnavailable'));
        setQuick({ server, code: '', secret: '' });
        return;
      }
      const start = await adapter.quickConnect.initiate();
      setQuick({ server, ...start });
    } catch (err) {
      setError(describe(classifySignInError(err), t));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (quick) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="text-heading font-semibold">{t('signIn.quickConnectTitle')}</h1>
        <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
          {quickError ? (
            <p className="text-body text-danger" role="alert">
              {quickError}
            </p>
          ) : (
            <>
              <p className="text-body text-muted-foreground">{t('signIn.quickConnectBody')}</p>
              <p
                className="text-center font-mono text-display font-semibold tracking-widest"
                aria-live="polite"
              >
                {quick.code}
              </p>
              <p className="text-caption text-muted-foreground" aria-live="polite">
                {t('signIn.quickConnectWaiting')}
              </p>
            </>
          )}
          <Button tone="ghost" onClick={() => setQuick(null)}>
            {t('signIn.quickConnectCancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4">
      <h1 className="text-heading font-semibold">{t('signIn.title')}</h1>
      {session.status === 'signedIn' && session.session ? (
        <p className="text-caption text-muted-foreground">
          {t('signIn.signedInAs', { name: session.session.userName })}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
        onSubmit={(e) => void submit(e)}
      >
        <Field
          id="server"
          label={t('signIn.serverUrl')}
          hint={t('signIn.serverUrlHint')}
          type="text"
          value={address}
          onChange={setAddress}
          autoComplete="url"
          inputMode="url"
        />
        <Field
          id="user"
          label={t('signIn.userName')}
          type="text"
          value={userName}
          onChange={setUserName}
          autoComplete="username"
        />
        <Field
          id="password"
          label={t('signIn.password')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {error ? (
          <p className="text-body text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" tone="primary" disabled={busy || !address.trim() || !userName.trim()}>
          {busy ? t('signIn.signingIn') : t('signIn.submit')}
        </Button>
        <Button
          tone="ghost"
          className="text-caption"
          disabled={busy || !address.trim()}
          onClick={() => void startQuickConnect()}
        >
          {t('signIn.quickConnect')}
        </Button>
      </form>
      <p className="text-caption text-muted-foreground">{t('signIn.perPerson')}</p>
    </div>
  );
}

function describe(
  failure: ReturnType<typeof classifySignInError>,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (failure === 'credentials') return t('signIn.errorCredentials');
  if (failure === 'unreachable') return t('signIn.errorUnreachable');
  if (failure === 'address') return t('signIn.errorAddress');
  return t('signIn.errorServer', { status: failure.status });
}

function Field({
  id,
  label,
  hint,
  type,
  value,
  onChange,
  autoComplete,
  inputMode,
}: {
  id: string;
  label: string;
  hint?: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  inputMode?: 'url';
}) {
  return (
    <div className="flex flex-col gap-1 text-label font-medium">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize="none"
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`min-h-6 rounded-sm border border-input-border bg-background px-2.5 py-1.5 text-body font-normal text-foreground ${focusRing}`}
      />
      {hint ? (
        <span id={`${id}-hint`} className="text-caption font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
