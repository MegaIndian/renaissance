import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { dismissToast, toastStore } from '@/lib/toast';
import { useStoreValue } from '@/lib/useStore';

import { Icon } from './Icon';

/** One quiet toast above the shell, with its undo (DESIGN.md rule 10). Mirrors web's Toast. */
export function Toast() {
  const { t } = useTranslation();
  const toast = useStoreValue(toastStore);
  const { colors, radius, space, type, scale } = useTheme();
  if (!toast) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.toast,
        {
          backgroundColor: colors.card,
          borderColor: toast.tone === 'danger' ? colors.danger : colors.border,
          borderRadius: radius.md,
          marginHorizontal: space[4],
          marginBottom: space[2],
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          gap: space[3],
        },
      ]}
    >
      <Text
        style={{
          flex: 1,
          color: toast.tone === 'danger' ? colors.danger : colors.foreground,
          fontSize: type.body.size * scale,
        }}
      >
        {toast.message}
      </Text>
      {toast.undo ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            toast.undo?.();
            dismissToast(toast.id);
          }}
          style={{ paddingHorizontal: space[2], paddingVertical: space[1] }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontWeight: '600',
              fontSize: type.body.size * scale,
            }}
          >
            {t('actions.undo')}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('actions.dismiss')}
        onPress={() => dismissToast(toast.id)}
        style={{ padding: space[1] }}
      >
        <Icon name="close" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
});
