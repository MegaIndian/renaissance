import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/lib/theme';

export type ButtonTone = 'primary' | 'secondary' | 'ghost';

function useButtonStyle(tone: ButtonTone, disabled: boolean) {
  const { colors, radius, space, type, scale } = useTheme();
  const fill =
    disabled || tone === 'ghost'
      ? { backgroundColor: disabled ? colors.muted : 'transparent' }
      : tone === 'primary'
        ? { backgroundColor: colors.primary }
        : { backgroundColor: colors.secondary, borderColor: colors.border, borderWidth: 1 };
  const text = disabled
    ? colors.mutedForeground
    : tone === 'primary'
      ? colors.primaryForeground
      : tone === 'secondary'
        ? colors.secondaryForeground
        : colors.mutedForeground;
  return {
    box: [
      styles.box,
      fill,
      { borderRadius: radius.sm, paddingHorizontal: space[3], paddingVertical: space[2] },
    ],
    text: { color: text, fontSize: type.body.size * scale, fontWeight: '500' as const },
  };
}

/** The one blue on a screen is a `primary` Button; disabled drops to muted (DESIGN.md rule 1). */
export function Button({
  tone = 'secondary',
  title,
  disabled = false,
  ...props
}: Omit<ComponentProps<typeof Pressable>, 'children' | 'style'> & {
  tone?: ButtonTone;
  title: string;
  disabled?: boolean;
}) {
  const s = useButtonStyle(tone, disabled);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      {...props}
      style={s.box}
    >
      <Text style={s.text}>{title}</Text>
    </Pressable>
  );
}

export function LinkButton({
  tone = 'secondary',
  title,
  href,
}: {
  tone?: ButtonTone;
  title: string;
  href: ComponentProps<typeof Link>['href'];
}) {
  const s = useButtonStyle(tone, false);
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" style={s.box}>
        <Text style={s.text}>{title}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
});
