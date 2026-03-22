import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ticketQueue } from '../../queue/ticket-queue.js';
import { registry } from '../../config/registry.js';
import { bearerAuth } from '../middleware/auth.js';

const TicketBodySchema = z.object({
  context: z.string().min(10).max(50000),
  ticketLink: z.string().url().optional(),
  ticketId: z.string().max(100).optional(),
  repoUrl: z.string(),
  dryRun: z.boolean().optional(),
});

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/tickets', {
    preHandler: bearerAuth,
  }, async (request, reply) => {
    const parsed = TicketBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const body = parsed.data;

    const project = registry.findByRepoUrl(body.repoUrl);
    if (!project) {
      return reply.code(404).send({
        error: 'No project configured for this repository URL',
        repoUrl: body.repoUrl,
      });
    }

    const jobPayload = {
      ...body,
      projectId: project.id,
      requestedAt: new Date().toISOString(),
    };

    const jobId = `t-${Date.now().toString(36)}`;
    const job = await ticketQueue.add(
      `ticket-${body.ticketId ?? Date.now()}`,
      jobPayload,
      {
        jobId,
        attempts: project.config.maxRetries + 1,
      },
    );

    return reply.code(202).send({
      jobId: job.id,
      status: 'queued',
      statusUrl: `/api/jobs/${job.id}`,
    });
  });
}
