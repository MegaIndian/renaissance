import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';

import '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  const { colors, scheme } = useTheme();
  const { t } = useTranslation();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: t('app.name') }} />
        <Stack.Screen name="sign-in" options={{ title: t('signIn.title') }} />
      </Stack>
    </>
  );
}
