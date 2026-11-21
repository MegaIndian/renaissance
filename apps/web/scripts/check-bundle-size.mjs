#!/usr/bin/env node
/**
 * The shell's first-load budget: every script the entry page loads before any route chunk, gzipped,
 * must stay under 200 kB (plan.md, phase 1). Walks the static import graph from `dist/index.html`,
 * so lazily loaded routes do not count and nothing is guessed from file names. Exits 1 over budget.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BUDGET = 200 * 1024;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const html = readFileSync(`${dist}index.html`, 'utf8');
const entries = [...html.matchAll(/<script[^>]+src="\/?([^"]+\.js)"/g)].map((m) => m[1]);
const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/?([^"]+\.js)"/g)].map(
  (m) => m[1],
);
const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/?([^"]+\.css)"/g)].map(
  (m) => m[1],
);

const seen = new Set();
const queue = [...entries, ...preloads];
while (queue.length) {
  const file = queue.shift();
  if (!file || seen.has(file)) continue;
  seen.add(file);
  const source = readFileSync(`${dist}${file}`, 'utf8');
  // Static imports only: `import "./x.js"`, `from "./x.js"`. Dynamic `import("./x.js")` is a route chunk.
  for (const match of source.matchAll(
    /(?:^|[;\s])import\s*(?:[^'"()]*?from\s*)?["']\.?\/?([^"']+\.js)["']/g,
  )) {
    queue.push(
      match[1].startsWith('assets/') ? match[1] : `assets/${match[1].replace(/^\.\//, '')}`,
    );
  }
}

const rows = [...seen].map((file) => ({
  file,
  gzip: gzipSync(readFileSync(`${dist}${file}`)).length,
}));
rows.sort((a, b) => b.gzip - a.gzip);
const total = rows.reduce((sum, r) => sum + r.gzip, 0);
const cssTotal = css.reduce((sum, f) => sum + gzipSync(readFileSync(`${dist}${f}`)).length, 0);
const all = readdirSync(`${dist}assets`).filter((f) => f.endsWith('.js'));

for (const row of rows) console.log(`${String(row.gzip).padStart(8)} B  ${row.file}`);
console.log(
  `\nshell JS: ${(total / 1024).toFixed(1)} kB gzipped across ${rows.length} of ${all.length} chunks`,
);
console.log(`shell CSS: ${(cssTotal / 1024).toFixed(1)} kB gzipped`);
console.log(`budget: ${BUDGET / 1024} kB JS`);
if (total > BUDGET) {
  console.error(`over budget by ${((total - BUDGET) / 1024).toFixed(1)} kB`);
  process.exit(1);
}
