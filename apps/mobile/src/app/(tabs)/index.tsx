import { greetingKey } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';

import { LinkButton } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/lib/theme';

/**
 * Simple-mode home (F84): greeting and three rows, mirroring web. Signed out (all of phase 0), each
 * row is one EmptyState with a full sentence and the one primary on the screen is Sign in. The card's
 * art is the person glyph, never a PlaceholderArt square (DESIGN.md rule 3).
 */
export default function Home() {
  const { t } = useTranslation();
  const { colors, radius, type, space, scale } = useTheme();
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
        art={
          <View
            accessibilityElementsHidden
            style={{
              width: space[12],
              height: space[12],
              borderRadius: radius.pill,
              backgroundColor: colors.muted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="person" size={space[6]} />
          </View>
        }
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
