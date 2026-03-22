import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { ticketQueue } from '../../queue/ticket-queue.js';
import { registry } from '../../config/registry.js';
import { env } from '../../env.js';

const execFileAsync = promisify(execFile);

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_request, reply) => {
    const checks: Record<string, unknown> = {};

    // Redis
    try {
      const client = await ticketQueue.client;
      await client.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    // Claude CLI
    try {
      const { stdout } = await execFileAsync(env.CLAUDE_BIN, ['--version'], { timeout: 10_000 });
      checks.claude = stdout.trim();
    } catch {
      checks.claude = 'not available';
    }

    // Queue stats
    const counts = await ticketQueue.getJobCounts();
    checks.queue = counts;

    // Projects
    checks.projects = registry.all().map(p => ({
      id: p.id,
      name: p.config.name,
      provider: p.config.provider,
    }));

    const healthy = checks.redis === 'ok';
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'healthy' : 'degraded',
      checks,
      uptime: process.uptime(),
    });
  });
}
