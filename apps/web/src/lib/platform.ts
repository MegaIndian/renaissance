/** The key that focuses the Ask bar, as the hint should spell it: ⌘ on Apple platforms, Ctrl elsewhere. */
export function shortcutKey(
  platform: string = typeof navigator === 'undefined' ? '' : navigator.platform,
): 'mac' | 'other' {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'mac' : 'other';
}
