#!/usr/bin/env node
/**
 * Typeahead latency with four simulated typists (production judge, round 1, E). Builds the hub
 * in-process against a MusicBrainz stand-in that answers after a realistic delay (default 350 ms,
 * about what musicbrainz.org takes from the house) behind the real limiter, Deezer stubbed, Jellyfin
 * stubbed, and has four profiles type four different queries at a human pace: one letter every
 * 180 ms, the app's 250 ms debounce, each new search aborting the previous one as the web app does.
 * Prints per-request latency (p50, p95, max), the share of requests dropped as superseded or busy,
 * and how many MusicBrainz calls were made. `--mb-delay 500` changes the stand-in's delay; `--live`
 * uses the real MusicBrainz and Deezer (read-only calls, about a minute of 1 req/s traffic).
 *
 *   node --disable-warning=ExperimentalWarning --import tsx apps/hub/scripts/typeahead-bench.mjs
 */
import { performance } from 'node:perf_hooks';

import { buildApp } from '../src/app.ts';
import { staticAuthenticator } from '../src/auth/authenticator.ts';
import { loadConfig } from '../src/config.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const live = args.includes('--live');
const mbDelay = Number(flag('--mb-delay', 350));
const keyMs = Number(flag('--key-ms', 180));
const debounceMs = 250;

const typists = {
  'tok-sahil': { id: 'u-sahil', name: 'Sahil', role: 'admin', mode: 'advanced', language: 'en' },
  'tok-kevin': { id: 'u-kevin', name: 'Kevin', role: 'member', mode: 'simple', language: 'en' },
  'tok-mom': { id: 'u-mom', name: 'Mom', role: 'member', mode: 'simple', language: 'gu' },
  'tok-dad': { id: 'u-dad', name: 'Dad', role: 'member', mode: 'simple', language: 'gu' },
};
const queries = {
  'tok-sahil': 'fireman lil wayne',
  'tok-kevin': 'red taylor swift',
  'tok-mom': 'kishore kumar',
  'tok-dad': 'carefree',
};

let mbCalls = 0;
let deezerCalls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** MusicBrainz and Deezer stand-ins: empty but well-formed answers after a delay. */
const fakeFetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('musicbrainz.org')) {
    mbCalls += 1;
    await sleep(mbDelay);
    const body = url.includes('/recording?') ? { recordings: [] } : { 'release-groups': [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.includes('deezer.com')) {
    deezerCalls += 1;
    await sleep(120);
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  // Jellyfin: no library hits.
  return new Response(JSON.stringify({ Items: [], TotalRecordCount: 0 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
const liveFetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('musicbrainz.org')) mbCalls += 1;
  if (url.includes('deezer.com')) deezerCalls += 1;
  if (url.includes('musicbrainz.org') || url.includes('deezer.com')) return fetch(input, init);
  return fakeFetch(input);
};

const app = await buildApp({
  config: loadConfig({
    RENAISSANCE_HUB_DB: ':memory:',
    JELLYFIN_URL: 'http://jellyfin.bench',
    JELLYFIN_API_KEY: 'bench',
    RENAISSANCE_HUB_RATE_LIMIT: '0',
    RENAISSANCE_CONTACT: process.env.RENAISSANCE_CONTACT ?? '',
  }),
  authenticator: staticAuthenticator(typists),
  fetch: live ? liveFetch : fakeFetch,
  startRunner: false,
});
await app.ready();

const samples = [];
let dropped = 0;
let aborted = 0;

/** One person typing: each pause after a letter fires a search; a newer letter abandons the older. */
async function type(token, text) {
  let pending = null;
  for (let i = 2; i <= text.length; i++) {
    const q = text.slice(0, i);
    await sleep(keyMs);
    if (pending) {
      pending.abandoned = true;
      aborted += 1;
    }
    const mine = { abandoned: false };
    pending = mine;
    void (async () => {
      await sleep(debounceMs);
      if (mine.abandoned) return;
      const started = performance.now();
      const res = await app.inject({
        url: `/catalogue/search?q=${encodeURIComponent(q)}`,
        headers: { authorization: `Bearer ${token}` },
      });
      const ms = performance.now() - started;
      if (res.statusCode === 503) dropped += 1;
      else samples.push({ ms, q, token, status: res.statusCode, cached: res.json().cached });
      if (pending === mine) pending = null;
    })();
  }
  // Let the last search finish.
  await sleep(debounceMs + 3_000);
}

const started = performance.now();
await Promise.all(Object.entries(queries).map(([token, text]) => type(token, text)));
const wall = performance.now() - started;

// For the record: a full search (what Enter and the pipeline pay) for each final query, serialised
// behind the limiter as four simultaneous Enters would be.
const fullStarted = performance.now();
const full = await Promise.all(
  Object.values(queries).map(async (q) => {
    const t0 = performance.now();
    await app.hub.catalogue.search(q).catch(() => undefined);
    return Math.round(performance.now() - t0);
  }),
);
const fullWall = Math.round(performance.now() - fullStarted);

const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const finals = Object.entries(queries).map(([token, text]) => {
  const s = samples.find((x) => x.token === token && x.q === text);
  return `${typists[token].name} "${text}": ${s ? `${Math.round(s.ms)} ms` : 'no answer'}`;
});
console.log(
  JSON.stringify(
    {
      mode: live ? 'live MusicBrainz' : `stand-in MusicBrainz (${mbDelay} ms per call)`,
      typists: 4,
      keystrokeMs: keyMs,
      debounceMs,
      searchesAnswered: samples.length,
      searchesAbandonedBeforeSending: aborted,
      searchesDropped503: dropped,
      musicBrainzCalls: mbCalls,
      deezerCalls,
      latencyMs: { p50: Math.round(pct(50)), p95: Math.round(pct(95)), max: Math.round(pct(100)) },
      finalQueryLatency: finals,
      wallClockSeconds: Math.round(wall / 1000),
      fullSearchOnEnterMs: { each: full, allFourTogether: fullWall },
    },
    null,
    2,
  ),
);
await app.close();
