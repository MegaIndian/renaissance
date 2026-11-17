import { describe, expect, it } from 'vitest';

import { themeVariables, tokensCss } from '../src/css';
import { colors } from '../src/tokens';

describe('design tokens', () => {
  it('light and dark define the same tokens', () => {
    expect(Object.keys(colors.light).sort()).toEqual(Object.keys(colors.dark).sort());
  });

  it('keeps the mockup values for dark', () => {
    const vars = themeVariables('dark');
    expect(vars['--background']).toBe('#0f0f14');
    expect(vars['--primary']).toBe('#3b82f6');
    expect(vars['--border']).toBe('#2a2a35');
    expect(vars['--radius']).toBe('10px');
  });

  it('generates a stylesheet with both themes', () => {
    const css = tokensCss();
    expect(css).toContain(':root {');
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain('prefers-color-scheme: light');
  });
});
