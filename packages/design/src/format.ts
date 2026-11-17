/**
 * The exact text of `tokens.css`: the generated stylesheet run through prettier with the repo's
 * config, so the committed file and `build:css` agree byte for byte (the test checks this).
 */
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

import { generatedHeader, tokensCss } from './css';

export async function formatTokensCss(): Promise<string> {
  const filepath = fileURLToPath(new URL('./tokens.css', import.meta.url));
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(`${generatedHeader}\n${tokensCss()}\n`, { ...options, parser: 'css' });
}
