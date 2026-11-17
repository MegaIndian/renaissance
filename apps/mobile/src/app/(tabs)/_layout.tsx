import { Link, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { LanguageSwitch } from '@/components/LanguageSwitch';
import { TabBar } from '@/components/TabBar';
import { primaryNav } from '@/components/navigation';
import { useTheme } from '@/lib/theme';

/** Simple mode's three tabs; the header carries the app name, the language switch and sign-in. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerTitle: t('app.name'),
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.background },
        headerRight: () => (
          <View style={[styles.right, { gap: space[3], paddingRight: space[4] }]}>
            <LanguageSwitch />
            <Link href="/sign-in" asChild>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('signIn.submit')}
                style={[
                  styles.avatar,
                  {
                    borderColor: colors.border,
                    width: space[8],
                    height: space[8],
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <View
                  style={{
                    width: space[3],
                    height: space[3],
                    borderRadius: radius.pill,
                    borderWidth: 1.5,
                    borderColor: colors.mutedForeground,
                  }}
                />
              </Pressable>
            </Link>
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
  right: { flexDirection: 'row', alignItems: 'center' },
  avatar: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
