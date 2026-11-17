import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { rem, scaleVariables, themeVariables, tokensCss } from '../src/css';
import { formatTokensCss } from '../src/format';
import { colors, simpleModeScale, space, type } from '../src/tokens';

describe('design tokens', () => {
  it('light and dark define the same tokens', () => {
    expect(Object.keys(colors.light).sort()).toEqual(Object.keys(colors.dark).sort());
  });

  it('keeps the mockup neutrals for dark', () => {
    const vars = themeVariables('dark');
    expect(vars['--background']).toBe('#0f0f14');
    expect(vars['--card']).toBe('#17171e');
    expect(vars['--border']).toBe('#2a2a35');
    expect(scaleVariables()['--radius']).toBe('10px');
  });

  it('emits the type scale and spacing in rem so simple mode and the browser setting scale them', () => {
    const vars = scaleVariables();
    expect(rem(16)).toBe('1rem');
    expect(vars['--font-size-body']).toBe(rem(type.body.size));
    expect(vars['--font-size-caption']).toBe('0.6875rem');
    expect(vars['--line-height-heading']).toBe(rem(type.heading.lineHeight));
    expect(vars['--space-4']).toBe(rem(space[4]));
    for (const [name, value] of Object.entries(vars)) {
      if (/^--(font-size|line-height|space)-/.test(name)) expect(value).toMatch(/rem$/);
    }
    expect(vars['--radius']).toMatch(/px$/);
  });

  it('generates a stylesheet with both themes, simple mode and reduced motion', () => {
    const css = tokensCss();
    expect(css).toContain(':root {');
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain('prefers-color-scheme: light');
    expect(css).toContain(`:root[data-mode="simple"] {\n  font-size: ${simpleModeScale * 100}%;`);
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('tokens.css in git is exactly the formatted build output', async () => {
    const file = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8');
    expect(file).toBe(await formatTokensCss());
  });
});
