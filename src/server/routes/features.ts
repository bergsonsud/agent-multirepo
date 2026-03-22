import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { featureQueue } from '../../queue/feature-queue.js';
import { registry } from '../../config/registry.js';
import { bearerAuth } from '../middleware/auth.js';

const FeatureBodySchema = z.object({
  context: z.string().min(10).max(50000),
  ticketLink: z.string().url().optional(),
  ticketId: z.string().max(100).optional(),
  repoUrl: z.string(),
});

export async function featureRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/features', {
    preHandler: bearerAuth,
  }, async (request, reply) => {
    const parsed = FeatureBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Body invalido',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const body = parsed.data;

    const project = registry.findByRepoUrl(body.repoUrl);
    if (!project) {
      return reply.code(404).send({
        error: 'Nenhum projeto configurado para esta URL de repositorio',
        repoUrl: body.repoUrl,
      });
    }

    const jobPayload = {
      ...body,
      projectId: project.id,
      requestedAt: new Date().toISOString(),
    };

    const jobId = `f-${Date.now().toString(36)}`;
    const job = await featureQueue.add(
      `feature-${body.ticketId ?? Date.now()}`,
      jobPayload,
      {
        jobId,
        attempts: project.config.maxRetries + 1,
      },
    );

    return reply.code(202).send({
      jobId: job.id,
      type: 'triage',
      status: 'queued',
      statusUrl: `/api/jobs/${job.id}?queue=features`,
    });
  });
}
