/**
 * Root attributes read by tokens.css: `data-mode` (simple is the default for every profile, DESIGN.md)
 * and `data-theme` (dark or light; absent follows the system). `?theme=` and `?mode=` in the URL
 * override for screenshots and e2e runs.
 */
export type Mode = 'simple' | 'advanced';
export type ThemeChoice = 'dark' | 'light' | 'system';

export function applyDocumentAttributes(search: string = window.location.search): {
  mode: Mode;
  theme: ThemeChoice;
} {
  const params = new URLSearchParams(search);
  const mode: Mode = params.get('mode') === 'advanced' ? 'advanced' : 'simple';
  const themeParam = params.get('theme');
  const theme: ThemeChoice =
    themeParam === 'dark' || themeParam === 'light' ? themeParam : 'system';
  document.documentElement.dataset['mode'] = mode;
  if (theme === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = theme;
  return { mode, theme };
}
