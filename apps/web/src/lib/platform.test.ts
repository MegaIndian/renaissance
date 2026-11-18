import { describe, expect, it } from 'vitest';

import { shortcutKey } from './platform';

describe('shortcutKey', () => {
  it('is ⌘ on Apple platforms and Ctrl everywhere else', () => {
    expect(shortcutKey('MacIntel')).toBe('mac');
    expect(shortcutKey('iPhone')).toBe('mac');
    expect(shortcutKey('iPad')).toBe('mac');
    expect(shortcutKey('Win32')).toBe('other');
    expect(shortcutKey('Linux x86_64')).toBe('other');
    expect(shortcutKey('')).toBe('other');
  });
});
