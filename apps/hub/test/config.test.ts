import { describe as suite, expect, it } from 'vitest';

import { ConfigError, DEV_CORS_ORIGINS, describe, loadConfig } from '../src/config.js';

suite('loadConfig', () => {
  it('uses defaults with an empty environment, including the dev CORS origin', () => {
    const c = loadConfig({});
    expect(c.port).toBe(8787);
    expect(c.host).toBe('0.0.0.0');
    expect(c.environment).toBe('development');
    expect(c.corsOrigins).toEqual([...DEV_CORS_ORIGINS]);
    expect(c.anthropic.intentModel).toBe('claude-opus-5-5');
    expect(c.anthropic.enrichmentModel).toBe('claude-haiku-5-5');
  });

  it('allows no browser origin in production unless configured', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).corsOrigins).toEqual([]);
    expect(
      loadConfig({ NODE_ENV: 'production', RENAISSANCE_HUB_CORS_ORIGINS: 'https://m.test' })
        .corsOrigins,
    ).toEqual(['https://m.test']);
  });

  it('reads values and splits CORS origins', () => {
    const c = loadConfig({
      RENAISSANCE_HUB_PORT: '9000',
      RENAISSANCE_HUB_CORS_ORIGINS: 'http://a.test, http://b.test',
      JELLYFIN_URL: 'http://jf.test:8096',
      JELLYFIN_API_KEY: 'k',
    });
    expect(c.port).toBe(9000);
    expect(c.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(c.jellyfin.url).toBe('http://jf.test:8096');
  });

  it('rejects a bad port or URL', () => {
    expect(() => loadConfig({ RENAISSANCE_HUB_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ JELLYFIN_URL: 'not a url' })).toThrow(ConfigError);
  });

  it('describe never includes secret values', () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: 'sk-test-value', LIDARR_API_KEY: 'lidarr-value' });
    const text = JSON.stringify(describe(c));
    expect(text).not.toContain('sk-test-value');
    expect(text).not.toContain('lidarr-value');
    expect(describe(c).anthropic).toBe(true);
    expect(describe(c).lidarr).toBe(false);
  });
});
