import { env } from '../env.js';

export function getRedisUrl(): string {
  return env.REDIS_URL;
}
