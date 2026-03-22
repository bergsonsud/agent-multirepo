import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_BEARER_TOKEN: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PROJECTS_DIR: z.string().default('./projects'),
  AGENTS_DIR: z.string().default('./agents'),
  REPOS_DIR: z.string().default('./repos'),
  REPORTS_DIR: z.string().default('./reports'),
  CLAUDE_BIN: z.string().default('claude'),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  DASHBOARD_USER: z.string().default('admin'),
  DASHBOARD_PASS: z.string().min(1),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
