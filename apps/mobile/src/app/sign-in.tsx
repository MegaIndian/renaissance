import {
  addressHasScheme,
  classifySignInError,
  isPlainHttp,
  serverFromAddress,
  withHttp,
} from '@renaissance/core';
import type { Server, SignInFailure } from '@renaissance/core';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

import { Button } from '@/components/Button';
import { getItem, setItem } from '@/lib/kv';
import { useSession } from '@/lib/queries';
import { sessions } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const LAST_SERVER_KEY = 'renaissance.lastServer';

function describe(failure: SignInFailure, t: TFunction): string {
  if (failure === 'credentials') return t('signIn.errorCredentials');
  if (failure === 'unreachable') return t('signIn.errorUnreachable');
  if (failure === 'address') return t('signIn.errorAddress');
  return t('signIn.errorServer', { status: failure.status });
}

/**
 * Sign in (F1) and Quick Connect (F2), the same rules as web's SignIn: an address without a scheme
 * is tried on https first; when only http answers, the field is rewritten to `http://` and a notice
 * says the password would travel in clear text, before anything is sent. A revoked token lands here
 * with a sentence saying so. The token goes to the Keychain.
 */
export default function SignIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const { colors, radius, space, type, scale } = useTheme();
  const [address, setAddress] = useState(() => getItem(LAST_SERVER_KEY) ?? '');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ server: Server; code: string; secret: string } | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);
  const alive = useRef(true);
  const expired = session.status === 'signedOut' && session.reason === 'expired';
  const typed = serverFromAddress(address);
  const plainHttp = !!typed && addressHasScheme(address) && isPlainHttp(typed);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const finish = (server: Server): void => {
    setItem(LAST_SERVER_KEY, server.url);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  useEffect(() => {
    if (!quick?.secret) return;
    const adapter = sessions.probe(quick.server);
    let cancelled = false;
    const poll = async (): Promise<void> => {
      while (!cancelled) {
        try {
          if (await adapter.quickConnect.state(quick.secret)) {
            await sessions.signInWithQuickConnect(quick.server, quick.secret);
            if (!cancelled) finish(quick.server);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `finish` only reads the router
  }, [quick, t]);

  const parseServer = (): Server | null => {
    const server = serverFromAddress(address);
    if (!server) setError(t('signIn.errorAddress'));
    return server;
  };

  /** No scheme typed: is https answering? If only http is, say so and send nothing yet. */
  const resolveScheme = async (server: Server): Promise<Server | null> => {
    if (addressHasScheme(address)) return server;
    try {
      await sessions.probe(server).ping();
      return server;
    } catch {
      const http = withHttp(server);
      try {
        await sessions.probe(http).ping();
      } catch {
        setError(t('signIn.errorUnreachable'));
        return null;
      }
      setAddress(http.url);
      setNotice(t('signIn.httpNotice'));
      return null;
    }
  };

  const submit = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    const typedServer = parseServer();
    if (!typedServer) return;
    setBusy(true);
    try {
      const server = await resolveScheme(typedServer);
      if (!server) return;
      await sessions.signIn(server, { userName: userName.trim(), password });
      finish(server);
    } catch (err) {
      if (alive.current) setError(describe(classifySignInError(err), t));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const startQuickConnect = async (): Promise<void> => {
    setError(null);
    setQuickError(null);
    setNotice(null);
    const typedServer = parseServer();
    if (!typedServer) return;
    setBusy(true);
    try {
      const server = await resolveScheme(typedServer);
      if (!server) return;
      const adapter = sessions.probe(server);
      if (!(await adapter.quickConnect.enabled())) {
        setQuickError(t('signIn.quickConnectUnavailable'));
        setQuick({ server, code: '', secret: '' });
        return;
      }
      setQuick({ server, ...(await adapter.quickConnect.initiate()) });
    } catch (err) {
      setError(describe(classifySignInError(err), t));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const card = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[4],
    gap: space[3],
  };
  const body = { color: colors.foreground, fontSize: type.body.size * scale };
  const caption = { color: colors.mutedForeground, fontSize: type.caption.size * scale };
  const danger = { color: colors.danger, fontSize: type.body.size * scale };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space[4], gap: space[4] }}
        style={{ backgroundColor: colors.background }}
      >
        {quick ? (
          <View style={card}>
            <Text
              accessibilityRole="header"
              style={[body, { fontSize: type.heading.size * scale, fontWeight: '600' }]}
            >
              {t('signIn.quickConnectTitle')}
            </Text>
            {quickError ? (
              <Text accessibilityRole="alert" style={danger}>
                {quickError}
              </Text>
            ) : (
              <>
                <Text style={[body, { color: colors.mutedForeground }]}>
                  {t('signIn.quickConnectBody')}
                </Text>
                <Text
                  testID="quick-connect-code"
                  accessibilityLiveRegion="polite"
                  selectable
                  style={[
                    body,
                    {
                      textAlign: 'center',
                      fontSize: type.display.size * scale * 1.5,
                      fontWeight: '600',
                      letterSpacing: space[1],
                    },
                  ]}
                >
                  {quick.code}
                </Text>
                <Text accessibilityLiveRegion="polite" style={caption}>
                  {t('signIn.quickConnectWaiting')}
                </Text>
              </>
            )}
            <Button
              tone="ghost"
              title={t('signIn.quickConnectCancel')}
              onPress={() => setQuick(null)}
            />
          </View>
        ) : (
          <>
            {session.status === 'signedIn' && session.session ? (
              <Text style={caption}>
                {t('signIn.signedInAs', { name: session.session.userName })}
              </Text>
            ) : null}
            {expired ? (
              <Text accessibilityRole="alert" style={danger}>
                {t('signIn.expired')}
              </Text>
            ) : null}
            <View style={card}>
              <Field
                testID="sign-in-address"
                label={t('signIn.serverUrl')}
                hint={t('signIn.serverUrlHint')}
                value={address}
                onChangeText={setAddress}
                keyboardType="url"
                textContentType="URL"
                autoComplete="url"
              />
              <Field
                testID="sign-in-user"
                label={t('signIn.userName')}
                value={userName}
                onChangeText={setUserName}
                textContentType="username"
                autoComplete="username"
              />
              <Field
                testID="sign-in-password"
                label={t('signIn.password')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                onSubmitEditing={() => void submit()}
                returnKeyType="go"
              />
              {notice || plainHttp ? (
                <Text accessibilityLiveRegion="polite" style={caption}>
                  {notice ?? t('signIn.httpNotice')}
                </Text>
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={danger}>
                  {error}
                </Text>
              ) : null}
              <Button
                testID="sign-in-submit"
                tone="primary"
                title={busy ? t('signIn.signingIn') : t('signIn.submit')}
                disabled={busy || !address.trim() || !userName.trim()}
                onPress={() => void submit()}
              />
              <Button
                testID="sign-in-quick-connect"
                tone="ghost"
                title={t('signIn.quickConnect')}
                disabled={busy || !address.trim()}
                onPress={() => void startQuickConnect()}
              />
            </View>
            <Text style={caption}>{t('signIn.perPerson')}</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const { colors, radius, space, type, scale } = useTheme();
  return (
    <View style={{ gap: space[1] }}>
      <Text
        style={{ color: colors.foreground, fontSize: type.label.size * scale, fontWeight: '500' }}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        placeholderTextColor={colors.mutedForeground}
        style={{
          borderWidth: 1,
          borderColor: colors.inputBorder,
          borderRadius: radius.sm,
          backgroundColor: colors.background,
          color: colors.foreground,
          fontSize: type.body.size * scale,
          paddingHorizontal: space[3],
          paddingVertical: space[2],
        }}
        {...props}
      />
      {hint ? (
        <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
