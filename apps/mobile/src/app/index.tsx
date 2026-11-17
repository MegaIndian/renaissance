import { chart } from '@renaissance/design';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AskBar } from '@/components/AskBar';
import { useTheme } from '@/lib/theme';

/** Simple-mode home (F84): greeting, the Ask bar, three rows. Placeholders until phase 3. */
export default function Home() {
  const { t } = useTranslation();
  const { colors, radius, type, scale } = useTheme();
  const rows = [t('home.mySongs'), t('home.recent'), t('home.mixes')];
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: colors.background }}
    >
      <Text
        style={{ color: colors.foreground, fontSize: type.display.size * scale, fontWeight: '600' }}
      >
        {t('home.greeting', { name: 'Sahil' })}
      </Text>
      <AskBar />
      {rows.map((title, r) => (
        <View key={title} style={styles.section}>
          <Text
            style={{
              color: colors.foreground,
              fontSize: type.heading.size * scale,
              fontWeight: '600',
            }}
          >
            {title}
          </Text>
          <View style={styles.row}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.card}>
                <View
                  style={[
                    styles.art,
                    { backgroundColor: chart[(r * 2 + i) % chart.length], borderRadius: radius.sm },
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}
                >
                  {t('home.empty')}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
      <Link href="/sign-in" style={{ color: colors.primary, fontSize: type.body.size * scale }}>
        {t('signIn.title')}
      </Link>
      <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
        {t('status.preAlpha')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 24 },
  section: { gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  card: { flex: 1, gap: 4 },
  art: { aspectRatio: 1, width: '100%' },
});
