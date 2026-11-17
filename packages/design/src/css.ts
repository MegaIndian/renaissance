import { chart, colors, font, radius, type } from './tokens';
import type { Theme } from './tokens';

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** CSS custom properties for one theme, in the mockup's `--name` form. */
export function themeVariables(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(colors[theme])) out[`--${kebab(name)}`] = value;
  chart.forEach((c, i) => {
    out[`--chart-${i + 1}`] = c;
  });
  out['--radius'] = `${radius.md}px`;
  out['--radius-sm'] = `${radius.sm}px`;
  out['--radius-lg'] = `${radius.lg}px`;
  out['--font-sans'] = font.sans;
  out['--font-mono'] = font.mono;
  out['--text-body'] = `${type.body.size}px`;
  out['--text-caption'] = `${type.caption.size}px`;
  out['--text-title'] = `${type.title.size}px`;
  out['--text-heading'] = `${type.heading.size}px`;
  return out;
}

function block(selector: string, vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/** The full stylesheet text that `tokens.css` is generated from. Dark by default, light by attribute or preference. */
export function tokensCss(): string {
  return [
    block(':root', themeVariables('dark')),
    block(':root[data-theme="light"]', themeVariables('light')),
    `@media (prefers-color-scheme: light) {\n${block(
      '  :root:not([data-theme="dark"])',
      themeVariables('light'),
    )
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')}\n}`,
  ].join('\n\n');
}
