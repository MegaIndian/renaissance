#!/usr/bin/env node
/**
 * Starts the demo Jellyfin with Creative Commons music and sets it up completely.
 *   node docker/demo/start.mjs            download tracks if missing, docker compose up, finish the
 *                                         wizard, create the user, add the library, scan, print
 *                                         the address and credentials
 *   node docker/demo/start.mjs down       stop and remove the container (config and music stay)
 *   node docker/demo/start.mjs --dry-run  print the API sequence against a fake server; no Docker,
 *                                         no downloads
 * Needs Docker with the compose plugin. Works on macOS, Linux and Windows.
 */
import { spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { fakeJellyfinFetch, setupJellyfin, waitForServer } from './jellyfin-setup.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const musicDir = join(here, 'music');
const configDir = join(here, 'config');
const credentialsFile = join(configDir, 'demo-credentials.json');
const baseUrl = process.env.RENAISSANCE_DEMO_URL ?? 'http://localhost:8096';
const manifest = JSON.parse(readFileSync(join(here, 'tracks.json'), 'utf8'));
/** The songs with a committed lyrics file beside them (F39, F40). */
const lyricTracks = manifest.tracks.filter((t) => t.lyrics).map((t) => t.file);

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

function readCredentials() {
  try {
    return JSON.parse(readFileSync(credentialsFile, 'utf8'));
  } catch {
    return undefined;
  }
}

function printCredentials({ user, password }) {
  console.log('');
  console.log(`Jellyfin is ready at ${baseUrl}`);
  console.log(`  user:     ${user}`);
  console.log(`  password: ${password}`);
  console.log(`  (also in ${credentialsFile}, ignored by Git)`);
  console.log('Stop with: node docker/demo/start.mjs down');
}

async function dryRun() {
  const { fetch } = fakeJellyfinFetch();
  console.log(`Dry run against a fake Jellyfin at ${baseUrl}: the calls that a real run makes.`);
  const result = await setupJellyfin({
    fetch,
    baseUrl,
    password: 'dry-run-password',
    log: (line) => console.log(`  ${line}`),
    lyricTracks,
  });
  console.log(`${result.calls.length} calls; user ${result.user}; library scan requested.`);
}

async function main() {
  if (process.argv.includes('--dry-run')) return dryRun();
  if (process.argv[2] === 'down') {
    compose('down');
    return;
  }
  mkdirSync(musicDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  let fetched = 0;
  for (const track of manifest.tracks) if (await download(track)) fetched++;
  for (const track of manifest.tracks) {
    if (track.lyrics && !existsSync(join(musicDir, track.lyrics)))
      throw new Error(
        `${track.lyrics} is missing from docker/demo/music, where the repository keeps it.`,
      );
  }
  console.log(
    `${manifest.tracks.length} tracks ready (${fetched} downloaded). Licence: ${manifest.licenseUrl}`,
  );
  compose('up', '-d');
  console.log(`Waiting for Jellyfin at ${baseUrl}`);
  const info = await waitForServer({ fetch, baseUrl });

  const saved = readCredentials();
  if (info.StartupWizardCompleted && !saved) {
    console.log(
      `This Jellyfin was set up by hand (no ${credentialsFile}). Sign in with the user you created,` +
        ' or run "node docker/demo/start.mjs down", delete docker/demo/config, and start again.',
    );
    return;
  }
  const result = await setupJellyfin({
    fetch,
    baseUrl,
    password: saved?.password,
    log: (line) => console.log(`  ${line}`),
    lyricTracks,
  });
  const credentials = { url: baseUrl, user: result.user, password: result.password };
  writeFileSync(credentialsFile, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  printCredentials(credentials);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
