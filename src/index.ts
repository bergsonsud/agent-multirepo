import { env } from './env.js';
import { logger } from './logger.js';
import { registry } from './config/registry.js';
import { buildApp } from './server/app.js';
import { startWorker, stopWorker } from './queue/worker.js';
import { startQueueEvents, stopQueueEvents } from './queue/events.js';
import { ticketQueue } from './queue/ticket-queue.js';
import { featureQueue } from './queue/feature-queue.js';

async function main() {
  // Load project configs
  registry.load(env.PROJECTS_DIR);

  // Start queue infrastructure
  startQueueEvents();
  startWorker(env.MAX_CONCURRENCY);

  // Start HTTP server
  const app = buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT }, 'Server started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    // Stop accepting requests
    await app.close().catch(() => {});

    // Stop worker (waits for active jobs)
    await stopWorker();
    await stopQueueEvents();

    // Close queue connection
    await ticketQueue.close();
    await featureQueue.close();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
