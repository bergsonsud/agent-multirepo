import { Queue } from 'bullmq';
import { getRedisUrl } from './connection.js';
import type { TicketJobPayload } from '../types/index.js';

export const FEATURE_QUEUE_NAME = 'feature-triage';

export const featureQueue = new Queue<TicketJobPayload>(FEATURE_QUEUE_NAME, {
  connection: { url: getRedisUrl() },
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86400 * 30 },
    removeOnFail: { age: 86400 * 30 },
    priority: 1, // Higher priority than tickets (lower number = higher priority)
  },
});
