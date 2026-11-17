import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { i18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
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
