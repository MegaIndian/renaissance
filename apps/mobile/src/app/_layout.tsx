import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { i18n, restoreLanguage } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/** Nothing paints until the stored language is known, so the first frame is in the right language. */
export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void restoreLanguage().then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!ready) return null;
  return (
    <I18nextProvider i18n={i18n}>
      <Shell />
    </I18nextProvider>
  );
}

function Shell() {
  const { colors, scheme } = useTheme();
  const { t, i18n: active } = useTranslation();
  return (
    <View style={{ flex: 1 }} accessibilityLanguage={active.language}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: t('signIn.title') }} />
      </Stack>
    </View>
  );
}
