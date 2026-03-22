import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/dist/queueAdapters/bullMQ.js';
import { FastifyAdapter } from '@bull-board/fastify';
import { ticketRoutes } from './routes/tickets.js';
import { featureRoutes } from './routes/features.js';
import { jobRoutes } from './routes/jobs.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { ticketQueue } from '../queue/ticket-queue.js';
import { featureQueue } from '../queue/feature-queue.js';
import { dashboardAuth } from './middleware/auth.js';
import { logger } from '../logger.js';

export function buildApp() {
  const app = Fastify({
    logger: false,
  });

  app.register(cookie);
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const parsed = Object.fromEntries(new URLSearchParams(body as string));
    done(null, parsed);
  });

  app.setErrorHandler((error, _request, reply) => {
    logger.error({ err: error }, 'Unhandled error');
    reply.code(500).send({ error: 'Internal server error' });
  });

  // Root redirect
  app.get('/', async (_request, reply) => reply.redirect('/jobs'));

  // Auth routes (login/logout) — no auth needed
  app.register(authRoutes);

  // Bull Board dashboard at /board — protected
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/board');

  createBullBoard({
    queues: [
      new BullMQAdapter(ticketQueue),
      new BullMQAdapter(featureQueue),
    ],
    serverAdapter,
  });

  app.register(async (instance) => {
    instance.addHook('onRequest', dashboardAuth);
    instance.register(serverAdapter.registerPlugin(), { prefix: '/board' });
  });

  // API routes (bearer token)
  app.register(ticketRoutes);
  app.register(featureRoutes);

  // Dashboard routes (cookie auth — applied inside)
  app.register(jobRoutes);

  // Health (public)
  app.register(healthRoutes);

  return app;
}
