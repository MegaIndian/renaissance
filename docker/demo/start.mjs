#!/usr/bin/env node
/**
 * Starts the demo Jellyfin with Creative Commons music.
 *   node docker/demo/start.mjs          download tracks if missing, docker compose up, print the address
 *   node docker/demo/start.mjs down     stop and remove the container (config and music stay)
 * Needs Docker with the compose plugin. Works on macOS, Linux and Windows.
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const musicDir = join(here, 'music');
const manifest = JSON.parse(readFileSync(join(here, 'tracks.json'), 'utf8'));

function compose(...args) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: here, stdio: 'inherit' });
  if (result.error) {
    console.error(
      'Docker is not installed or not on PATH. Install Docker Desktop, then run this again.',
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function download(track) {
  const target = join(musicDir, track.file);
  if (existsSync(target) && statSync(target).size === track.bytes) return false;
  console.log(
    `Downloading ${track.title} (${(track.bytes / 1e6).toFixed(1)} MB) from ${track.url}`,
  );
  const response = await fetch(track.url);
  if (!response.ok || !response.body) throw new Error(`${track.url}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  const size = statSync(target).size;
  if (size !== track.bytes)
    throw new Error(`${track.file}: expected ${track.bytes} bytes, got ${size}`);
  return true;
}

async function main() {
  if (process.argv[2] === 'down') {
    compose('down');
    return;
  }
  mkdirSync(musicDir, { recursive: true });
  mkdirSync(join(here, 'config'), { recursive: true });
  let fetched = 0;
  for (const track of manifest.tracks) if (await download(track)) fetched++;
  console.log(
    `${manifest.tracks.length} tracks ready (${fetched} downloaded). Licence: ${manifest.licenseUrl}`,
  );
  compose('up', '-d');
  console.log('');
  console.log('Jellyfin is starting at http://localhost:8096');
  console.log(
    'First run: finish the setup wizard there, create a user, and add a Music library at /media/music.',
  );
  console.log('Stop with: node docker/demo/start.mjs down');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
