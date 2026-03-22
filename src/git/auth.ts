import type { ProjectConfig } from '../config/schema.js';

export interface GitEnv {
  GIT_SSH_COMMAND?: string;
  GIT_ASKPASS?: string;
  GIT_TERMINAL_PROMPT?: string;
  [key: string]: string | undefined;
}

export function buildGitEnv(config: ProjectConfig): GitEnv {
  const gitEnv: GitEnv = {
    GIT_TERMINAL_PROMPT: '0',
  };

  if (config.auth.method === 'ssh' && config.auth.sshKeyPath) {
    gitEnv.GIT_SSH_COMMAND = `ssh -i ${config.auth.sshKeyPath} -o StrictHostKeyChecking=no`;
  }

  return gitEnv;
}

export function buildCloneUrl(config: ProjectConfig): string {
  if (config.auth.method === 'ssh') {
    return config.repoUrl;
  }

  const tokenVar = config.auth.tokenEnvVar;
  if (!tokenVar) return config.repoUrl;

  const token = process.env[tokenVar];
  if (!token) return config.repoUrl;

  try {
    const url = new URL(config.repoUrl);
    url.username = config.auth.username ?? 'x-token-auth';
    url.password = token;
    return url.toString();
  } catch {
    return config.repoUrl;
  }
}
