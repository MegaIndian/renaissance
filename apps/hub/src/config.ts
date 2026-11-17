/**
 * Hub configuration. Reads environment variables only: no config files, no CLI flags, nothing in the
 * repo. `.env` is loaded by Node itself (`--env-file-if-exists=.env` in the package scripts), so this
 * module still sees nothing but `process.env`. Secrets are typed as `secret` so they are never logged;
 * `describe()` prints presence, not values.
 */
import { z } from 'zod';

/** Absent or blank means "not configured"; anything else must be a URL. */
const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
  .pipe(z.url().optional());

/** Absent or blank means "not configured". Never logged. */
const secret = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

/** The web app's Vite dev server; allowed by default outside production so a fresh clone just works. */
export const DEV_CORS_ORIGINS = ['http://localhost:5173'] as const;

const schema = z.object({
  NODE_ENV: z.string().trim().default('development'),
  RENAISSANCE_HUB_HOST: z.string().trim().min(1).default('0.0.0.0'),
  RENAISSANCE_HUB_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  RENAISSANCE_HUB_CORS_ORIGINS: z
    .string()
    .trim()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  JELLYFIN_URL: optionalUrl,
  JELLYFIN_API_KEY: secret,
  ANTHROPIC_API_KEY: secret,
  ANTHROPIC_INTENT_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),
  ANTHROPIC_ENRICHMENT_MODEL: z.string().trim().min(1).default('claude-haiku-5-5'),
  LIDARR_URL: optionalUrl,
  LIDARR_API_KEY: secret,
  SLSKD_URL: optionalUrl,
  SLSKD_API_KEY: secret,
});

export interface HubConfig {
  /** `production` or anything else; only CORS defaults depend on it. */
  environment: string;
  host: string;
  port: number;
  /** Browser origins allowed to call the hub. Empty means same origin only. */
  corsOrigins: string[];
  jellyfin: { url: string | undefined; apiKey: string | undefined };
  anthropic: { apiKey: string | undefined; intentModel: string; enrichmentModel: string };
  lidarr: { url: string | undefined; apiKey: string | undefined };
  slskd: { url: string | undefined; apiKey: string | undefined };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): HubConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid hub configuration: ${issues}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const corsOrigins =
    e.RENAISSANCE_HUB_CORS_ORIGINS.length > 0 || production
      ? e.RENAISSANCE_HUB_CORS_ORIGINS
      : [...DEV_CORS_ORIGINS];
  return {
    environment: e.NODE_ENV,
    host: e.RENAISSANCE_HUB_HOST,
    port: e.RENAISSANCE_HUB_PORT,
    corsOrigins,
    jellyfin: { url: e.JELLYFIN_URL, apiKey: e.JELLYFIN_API_KEY },
    anthropic: {
      apiKey: e.ANTHROPIC_API_KEY,
      intentModel: e.ANTHROPIC_INTENT_MODEL,
      enrichmentModel: e.ANTHROPIC_ENRICHMENT_MODEL,
    },
    lidarr: { url: e.LIDARR_URL, apiKey: e.LIDARR_API_KEY },
    slskd: { url: e.SLSKD_URL, apiKey: e.SLSKD_API_KEY },
  };
}

/** Safe to log: says which integrations are configured, never a value. */
export function describe(config: HubConfig): Record<string, string | number | boolean> {
  return {
    environment: config.environment,
    host: config.host,
    port: config.port,
    corsOrigins: config.corsOrigins.length,
    jellyfin: config.jellyfin.url !== undefined && config.jellyfin.apiKey !== undefined,
    anthropic: config.anthropic.apiKey !== undefined,
    intentModel: config.anthropic.intentModel,
    enrichmentModel: config.anthropic.enrichmentModel,
    lidarr: config.lidarr.url !== undefined && config.lidarr.apiKey !== undefined,
    slskd: config.slskd.url !== undefined && config.slskd.apiKey !== undefined,
  };
}
