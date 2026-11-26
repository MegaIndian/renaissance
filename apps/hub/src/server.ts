import { buildApp, buildDegradedApp } from './app.js';
import { describe, loadConfig } from './config.js';
import { DatabaseUnavailableError } from './db/index.js';
import { installStop } from './stop.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // A database the hub cannot write (a read-only volume) keeps the process up on /health 503
  // instead of a restart loop: the problem is seen where the container's health is read.
  const app = await buildApp({ config, logger: true }).catch((error: unknown) => {
    if (error instanceof DatabaseUnavailableError)
      return buildDegradedApp({ config, error, logger: true });
    throw error;
  });
  app.log.info({ integrations: describe(config) }, 'renaissance-hub starting');
  await app.listen({ host: config.host, port: config.port });
  installStop(app);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
