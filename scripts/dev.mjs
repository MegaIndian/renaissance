#!/usr/bin/env node
/**
 * `pnpm dev`: the web app and the hub together, with two differences from `turbo run dev`: when
 * either process exits, the other is stopped and this script exits with the same code; and the hub
 * must answer `/health` within a few seconds of starting, or both are stopped and this exits 1. So a
 * hub that dies on a taken port, or throws at start and sits in `node --watch`'s "waiting for file
 * changes", is never hidden behind a web server that keeps running.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const hubPort = Number(process.env.RENAISSANCE_HUB_PORT ?? 8787);
const children = [
  { name: 'web', filter: 'web', port: 5173 },
  { name: 'hub', filter: 'hub', port: hubPort },
];
const HEALTH_TIMEOUT_MS = Number(process.env.RENAISSANCE_DEV_HEALTH_TIMEOUT_MS ?? 15_000);

/** Both loopback families: a listener on ::1 alone would otherwise pass and push Vite to 5174. */
const loopbacks = ['127.0.0.1', '::1'];

function portFree(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    // Anything but "in use" (for example no IPv6 on this machine) counts as free.
    probe.once('error', (error) => resolve(error.code !== 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

for (const child of children) {
  const free = await Promise.all(loopbacks.map((host) => portFree(child.port, host)));
  if (!free.every(Boolean)) {
    console.error(
      `${child.name}: port ${child.port} is already in use; stop what holds it and run pnpm dev again.`,
    );
    process.exit(1);
  }
}

let shuttingDown = false;
const running = [];

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const proc of running) if (proc.exitCode === null) proc.kill('SIGTERM');
  process.exit(code);
}

for (const child of children) {
  const proc = spawn('pnpm', ['--filter', child.filter, 'dev'], {
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  });
  proc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n${child.name} exited (${signal ?? code}); stopping the rest.`);
    stopAll(code ?? 1);
  });
  running.push(proc);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopAll(0));
}

/** True once GET /health answers 200 on either loopback address. */
async function hubAnswers() {
  for (const host of ['127.0.0.1', '[::1]']) {
    try {
      const res = await fetch(`http://${host}:${hubPort}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return true;
    } catch {
      /* not up yet on this address */
    }
  }
  return false;
}

const deadline = Date.now() + HEALTH_TIMEOUT_MS;
let up = false;
while (!up && Date.now() < deadline && !shuttingDown) {
  up = await hubAnswers();
  if (!up) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!up && !shuttingDown) {
  console.error(
    `\nhub: no answer on http://localhost:${hubPort}/health after ${HEALTH_TIMEOUT_MS / 1000} s. ` +
      'The hub failed to start; its error is above. Stopping the web server too.',
  );
  stopAll(1);
}

console.log(`web http://localhost:${children[0].port}   hub http://localhost:${hubPort}`);
