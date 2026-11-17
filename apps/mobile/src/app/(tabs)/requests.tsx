import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/lib/theme';

export default function Requests() {
  const { t } = useTranslation();
  const { colors, type, space, scale } = useTheme();
  return (
    <View style={{ flex: 1, padding: space[4], gap: space[3], backgroundColor: colors.background }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.foreground, fontSize: type.heading.size * scale, fontWeight: '600' }}
      >
        {t('nav.requests')}
      </Text>
      <EmptyState title={t('requests.empty')} description={t('requests.emptyBody')} />
    </View>
  );
}
