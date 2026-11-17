import { greetingKey } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';

import { LinkButton } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { PlaceholderArt } from '@/components/PlaceholderArt';
import { useTheme } from '@/lib/theme';

/**
 * Simple-mode home (F84): greeting and three rows, mirroring web. Signed out (all of phase 0), each
 * row is one EmptyState with a full sentence and the one primary on the screen is Sign in.
 */
export default function Home() {
  const { t } = useTranslation();
  const { colors, type, space, scale } = useTheme();
  const rows = [
    { title: t('home.mySongs'), empty: t('home.mySongsEmpty') },
    { title: t('home.recent'), empty: t('home.recentEmpty') },
    { title: t('home.mixes'), empty: t('home.mixesEmpty') },
  ];
  return (
    <ScrollView
      contentContainerStyle={{ padding: space[4], gap: space[6] }}
      style={{ backgroundColor: colors.background }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: colors.foreground, fontSize: type.display.size * scale, fontWeight: '600' }}
      >
        {t(greetingKey())}
      </Text>
      <EmptyState
        title={t('home.empty')}
        description={t('home.emptyBody')}
        art={<PlaceholderArt index={1} size="sm" />}
        action={<LinkButton href="/sign-in" tone="primary" title={t('signIn.submit')} />}
      />
      {rows.map((row) => (
        <View key={row.title} style={{ gap: space[2] }}>
          <Text
            accessibilityRole="header"
            style={{
              color: colors.foreground,
              fontSize: type.heading.size * scale,
              fontWeight: '600',
            }}
          >
            {row.title}
          </Text>
          <EmptyState title={row.empty} quiet />
        </View>
      ))}
      <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
        {t('status.preAlpha')}
      </Text>
    </ScrollView>
  );
}
