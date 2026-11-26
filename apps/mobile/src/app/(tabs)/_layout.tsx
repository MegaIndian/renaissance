import { Tabs, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { TabBar } from '@/components/TabBar';
import { primaryNav } from '@/components/navigation';
import { useSession } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

/**
 * Simple mode's three tabs; the header carries the app name and the way to Settings (or Sign in).
 * Album, artist, playlist, genre, favourites and settings are pushed over the tabs from the root
 * stack and carry the same Ask bar and player (`PageShell`).
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const session = useSession();
  const signedIn = session.status === 'signedIn';
  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerTitle: t('app.name'),
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.background },
        // Header items are slotted by expo-router: the element and its child take flat styles only.
        headerRight: () => (
          <View style={{ paddingRight: space[4] }}>
            <Pressable
              testID="header-account"
              onPress={() => router.push(signedIn ? '/settings' : '/sign-in')}
              accessibilityRole="link"
              accessibilityLabel={signedIn ? t('settings.title') : t('signIn.submit')}
              style={StyleSheet.flatten([
                styles.avatar,
                {
                  borderColor: colors.border,
                  width: space[8],
                  height: space[8],
                  borderRadius: radius.pill,
                },
              ])}
            >
              <Icon name={signedIn ? 'settings' : 'person'} />
            </Pressable>
          </View>
        ),
      }}
    >
      {primaryNav.map((item) => (
        <Tabs.Screen key={item.name} name={item.name} options={{ title: t(item.key) }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  avatar: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
