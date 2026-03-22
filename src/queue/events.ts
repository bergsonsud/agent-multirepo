import { QueueEvents } from 'bullmq';
import { getRedisUrl } from './connection.js';
import { QUEUE_NAME } from './ticket-queue.js';
import { childLogger } from '../logger.js';

const log = childLogger('queue-events');

let queueEvents: QueueEvents | null = null;

export function startQueueEvents(): QueueEvents {
  queueEvents = new QueueEvents(QUEUE_NAME, {
    connection: { url: getRedisUrl() },
  });

  queueEvents.on('completed', ({ jobId, returnvalue }) => {
    log.debug({ jobId, returnvalue }, 'Queue event: completed');
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    log.debug({ jobId, failedReason }, 'Queue event: failed');
  });

  return queueEvents;
}

export async function stopQueueEvents(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
}
