import { Worker, type Job } from 'bullmq';
import { getRedisUrl } from './connection.js';
import { QUEUE_NAME } from './ticket-queue.js';
import { FEATURE_QUEUE_NAME } from './feature-queue.js';
import { executePipeline, executeTriagePipeline } from '../pipeline/executor.js';
import { childLogger } from '../logger.js';
import type { TicketJobPayload, JobResult } from '../types/index.js';

const log = childLogger('worker');

let ticketWorker: Worker<TicketJobPayload, JobResult> | null = null;
let featureWorker: Worker<TicketJobPayload, JobResult> | null = null;

export function startWorker(concurrency: number = 1): void {
  // Feature/triage worker — same concurrency, shares the claude process
  // BullMQ processes one job at a time per worker when concurrency=1
  // Feature worker runs first because we check it before ticket worker
  featureWorker = new Worker<TicketJobPayload, JobResult>(
    FEATURE_QUEUE_NAME,
    async (job: Job<TicketJobPayload, JobResult>) => {
      log.info({ jobId: job.id, projectId: job.data.projectId, ticketId: job.data.ticketId }, 'Processing triage job');
      return executeTriagePipeline(job);
    },
    {
      connection: { url: getRedisUrl() },
      concurrency,
    },
  );

  featureWorker.on('completed', (job) => {
    log.info({ jobId: job.id, result: job.returnvalue?.status }, 'Triage job completed');
  });

  featureWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'Triage job failed');
  });

  // Ticket worker
  ticketWorker = new Worker<TicketJobPayload, JobResult>(
    QUEUE_NAME,
    async (job: Job<TicketJobPayload, JobResult>) => {
      log.info({ jobId: job.id, projectId: job.data.projectId, ticketId: job.data.ticketId }, 'Processing ticket job');
      return executePipeline(job);
    },
    {
      connection: { url: getRedisUrl() },
      concurrency,
    },
  );

  ticketWorker.on('completed', (job) => {
    log.info({ jobId: job.id, result: job.returnvalue?.status }, 'Ticket job completed');
  });

  ticketWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'Ticket job failed');
  });

  log.info({ concurrency }, 'Workers started (triage + tickets)');
}

export async function stopWorker(): Promise<void> {
  if (featureWorker) {
    await featureWorker.close();
    featureWorker = null;
  }
  if (ticketWorker) {
    await ticketWorker.close();
    ticketWorker = null;
  }
  log.info('Workers stopped');
}
