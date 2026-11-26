import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Dialogs } from '@/components/Dialogs';
import { TrackMenu } from '@/components/TrackMenu';
import { startApp } from '@/lib/app';
import { i18n, restoreLanguage } from '@/lib/i18n';
import { hydrate } from '@/lib/kv';
import { retryUnlessNotFound } from '@/lib/queries';
import { loadRecent } from '@/lib/recent';
import { loadSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: retryUnlessNotFound, staleTime: 30_000 } },
});

/**
 * Nothing paints until the stored language and settings are known, so the first frame is in the
 * right language and theme; then the session is restored from the Keychain (`startApp`).
 */
export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([hydrate(), restoreLanguage()]).then(() => {
      loadSettings();
      loadRecent();
      startApp(queryClient);
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <Shell />
        </I18nextProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { colors, scheme } = useTheme();
  const { t, i18n: active } = useTranslation();
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background }}
      accessibilityLanguage={active.language}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackTitle: t('nav.back'),
          // The native stack owns the status bar on iOS: light text on the dark theme.
          statusBarStyle: scheme === 'dark' ? 'light' : 'dark',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="album/[id]" options={{ title: '' }} />
        <Stack.Screen name="artist/[id]" options={{ title: '' }} />
        <Stack.Screen name="playlist/[id]" options={{ title: '' }} />
        <Stack.Screen name="genre/[name]" options={{ title: '' }} />
        <Stack.Screen name="favorites" options={{ title: t('favorites.title') }} />
        <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
        <Stack.Screen
          name="sign-in"
          options={{ title: t('signIn.title'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="now-playing"
          options={{ title: t('nav.nowPlaying'), presentation: 'modal' }}
        />
        <Stack.Screen name="queue" options={{ title: t('queue.title'), presentation: 'modal' }} />
      </Stack>
      <TrackMenu />
      <Dialogs />
    </View>
  );
}
