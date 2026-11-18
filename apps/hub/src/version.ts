/**
 * The hub's version, read once from the package manifest that ships beside `dist` (in the image,
 * `apps/hub/package.json` is copied next to `dist`), so `/health` reports the real version however the
 * process was started: `pnpm dev`, `node dist/server.js`, or the container.
 */
import { readFileSync } from 'node:fs';

export function readVersion(url: URL = new URL('../package.json', import.meta.url)): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(url, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const version = (parsed as { version: unknown }).version;
      if (typeof version === 'string' && version.length > 0) return version;
    }
  } catch {
    /* fall through: a manifest that is missing or unreadable reports 0.0.0 */
  }
  return '0.0.0';
}

export const version = readVersion();
