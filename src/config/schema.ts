import { z } from 'zod';

export const ProjectConfigSchema = z.object({
  name: z.string(),
  repoUrl: z.string(),
  provider: z.enum(['github', 'bitbucket']),
  defaultBranch: z.string().default('main'),

  auth: z.object({
    method: z.enum(['ssh', 'https']),
    tokenEnvVar: z.string().optional(),
    username: z.string().optional(),
    sshKeyPath: z.string().optional(),
    commitAuthor: z.object({
      name: z.string(),
      email: z.string().email(),
    }),
  }),

  branchPattern: z.string().default('auto/{{ticketId}}-{{slug}}'),

  claude: z.object({
    model: z.string().default('sonnet'),
    effortLevel: z.enum(['low', 'medium', 'high', 'max']).default('high'),
    maxBudgetUsd: z.number().positive().optional(),
    permissionMode: z.enum(['bypassPermissions', 'default', 'plan']).default('bypassPermissions'),
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    agentMdPath: z.string().optional(),
    appendSystemPrompt: z.string().optional(),
  }).default({}),

  commands: z.object({
    install: z.string().optional(),
    preAnalysis: z.array(z.string()).default([]),
    postImplementation: z.array(z.string()).default([]),
  }).default({}),

  pr: z.object({
    titlePattern: z.string().default('{{ticketId}}: {{summary}}'),
    bodyTemplate: z.string().optional(),
    labels: z.array(z.string()).default([]),
    reviewers: z.array(z.string()).default([]),
    draft: z.boolean().default(true),
  }).default({}),

  discord: z.object({
    webhookUrl: z.string().url().optional(),
    notifyOn: z.array(z.enum([
      'job_started', 'triage_complex', 'implementation_start', 'implementation_done',
      'tests_passed', 'tests_failed', 'pr_created', 'pr_failed', 'job_failed',
    ])).default(['pr_created', 'pr_failed', 'job_failed']),
  }).default({}),

  providerConfig: z.object({
    owner: z.string().optional(),
    repo: z.string().optional(),
    workspace: z.string().optional(),
    repoSlug: z.string().optional(),
  }).optional(),

  concurrency: z.number().int().positive().default(1),
  timeoutMinutes: z.number().positive().default(30),
  maxRetries: z.number().int().min(0).default(2),
  isolation: z.enum(['worktree', 'clone']).default('worktree'),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
