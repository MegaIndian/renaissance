import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

import { AskBar } from './AskBar';
import { NowPlayingBar } from './NowPlayingBar';
import { Toast } from './Toast';

/**
 * The bottom of every screen: the toast, the Ask bar and the player (DESIGN.md: the Ask bar is on
 * every screen). The tabs add their tab row under it (`TabBar`); pages pushed over the tabs (album,
 * artist, playlist, ...) render it through `PageShell`. It rises with the keyboard.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setOpen(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setOpen(false));
    const didShow = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const didHide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
      didShow.remove();
      didHide.remove();
    };
  }, []);
  return open;
}

export function BottomShell({ children, inset = true }: { children?: ReactNode; inset?: boolean }) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  // While typing, the player and the tabs make room for the results above the keyboard.
  const typing = useKeyboardOpen();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ backgroundColor: colors.card }}
    >
      <Toast />
      <View
        style={{
          borderTopWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: space[4],
          paddingVertical: space[2],
        }}
      >
        <AskBar compact />
      </View>
      {typing ? null : <NowPlayingBar />}
      {typing ? null : children}
      {inset && !children && !typing ? <View style={{ height: insets.bottom }} /> : null}
    </KeyboardAvoidingView>
  );
}

/** A page pushed over the tabs: its content, then the bottom shell. */
export function PageShell({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>{children}</View>
      <BottomShell />
    </View>
  );
}
