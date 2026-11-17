#!/usr/bin/env node
/**
 * `pnpm dev`: the web app and the hub together, with one difference from `turbo run dev`: when
 * either process exits, the other is stopped and this script exits with the same code, so a hub
 * that dies on a taken port is not hidden behind a web server that keeps running.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const children = [
  { name: 'web', filter: 'web', port: 5173 },
  { name: 'hub', filter: 'hub', port: Number(process.env.RENAISSANCE_HUB_PORT ?? 8787) },
];

function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

for (const child of children) {
  if (!(await portFree(child.port))) {
    console.error(
      `${child.name}: port ${child.port} is already in use; stop what holds it and run pnpm dev again.`,
    );
    process.exit(1);
  }
}

const running = children.map((child) => {
  const proc = spawn('pnpm', ['--filter', child.filter, 'dev'], {
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  });
  proc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`\n${child.name} exited (${signal ?? code}); stopping the rest.`);
    for (const other of running)
      if (other !== proc && other.exitCode === null) other.kill('SIGTERM');
    process.exit(code ?? 1);
  });
  return proc;
});
let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true;
    for (const proc of running) if (proc.exitCode === null) proc.kill(signal);
    process.exit(0);
  });
}

console.log(`web http://localhost:${children[0].port}   hub http://localhost:${children[1].port}`);
