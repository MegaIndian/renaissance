import { buildApp } from './app.js';
import { describe, loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config, logger: true });
  app.log.info({ integrations: describe(config) }, 'renaissance-hub starting');
  await app.listen({ host: config.host, port: config.port });
  const stop = (): void => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
