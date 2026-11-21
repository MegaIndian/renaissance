// Bundles the hub with esbuild: `@renaissance/core` is TypeScript source with extensionless imports,
// so it is inlined; every other dependency (fastify, the Anthropic SDK, ...) stays external and is
// loaded from node_modules at run time. Two entry points: the server and the request CLI.
import { readFileSync } from 'node:fs';

import { build } from 'esbuild';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Every published dependency stays external; the workspace package is inlined.
const external = Object.keys(manifest.dependencies).filter(
  (name) => !name.startsWith('@renaissance/'),
);

await build({
  entryPoints: ['src/server.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external,
  sourcemap: true,
  logLevel: 'info',
});
