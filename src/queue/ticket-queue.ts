import { Queue } from 'bullmq';
import { getRedisUrl } from './connection.js';
import type { TicketJobPayload } from '../types/index.js';

export const QUEUE_NAME = 'ticket-processing';

export const ticketQueue = new Queue<TicketJobPayload>(QUEUE_NAME, {
  connection: { url: getRedisUrl() },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86400 * 7 },
    removeOnFail: { age: 86400 * 30 },
  },
});
