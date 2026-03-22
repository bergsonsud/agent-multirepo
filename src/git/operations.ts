import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectConfig } from '../config/schema.js';
import { buildGitEnv } from './auth.js';
import { childLogger } from '../logger.js';

const execFileAsync = promisify(execFile);
const log = childLogger('git-ops');

interface ExecGitOpts {
  cwd: string;
  config?: ProjectConfig;
  timeoutMs?: number;
}

async function git(args: string[], opts: ExecGitOpts): Promise<string> {
  const gitEnv = opts.config ? buildGitEnv(opts.config) : {};
  const env = { ...process.env, ...gitEnv };

  log.debug({ args, cwd: opts.cwd }, 'git');
  const { stdout } = await execFileAsync('git', args, {
    cwd: opts.cwd,
    env,
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function cloneBare(url: string, dest: string, config: ProjectConfig): Promise<void> {
  await git(['clone', '--bare', url, dest], { cwd: '.', config });
}

export async function cloneShallow(url: string, dest: string, branch: string, config: ProjectConfig): Promise<void> {
  await git(['clone', '--depth=1', '--branch', branch, url, dest], { cwd: '.', config });
}

export async function fetch(cwd: string, config: ProjectConfig): Promise<void> {
  await git(['fetch', 'origin', '--prune'], { cwd, config });
}

export async function addWorktree(barePath: string, workPath: string, ref: string): Promise<void> {
  await git(['worktree', 'add', workPath, ref, '--detach'], { cwd: barePath });
}

export async function removeWorktree(barePath: string, workPath: string): Promise<void> {
  await git(['worktree', 'remove', '--force', workPath], { cwd: barePath });
}

export async function checkoutNewBranch(cwd: string, branch: string): Promise<void> {
  await git(['checkout', '-b', branch], { cwd });
}

export async function configUser(cwd: string, name: string, email: string): Promise<void> {
  await git(['config', 'user.name', name], { cwd });
  await git(['config', 'user.email', email], { cwd });
}

export async function addAll(cwd: string): Promise<void> {
  await git(['add', '-A'], { cwd });
}

export async function hasChanges(cwd: string): Promise<boolean> {
  const out = await git(['diff', '--cached', '--stat'], { cwd });
  return out.length > 0;
}

export async function commit(cwd: string, message: string): Promise<void> {
  await git(['commit', '-m', message], { cwd });
}

export async function push(cwd: string, branch: string, config: ProjectConfig): Promise<void> {
  await git(['-c', 'push.default=current', 'push', '-u', 'origin', branch], { cwd, config, timeoutMs: 300_000 });
}

export async function diffStat(cwd: string): Promise<string> {
  return git(['diff', '--cached', '--stat'], { cwd });
}

export async function remoteBranchExists(cwd: string, branch: string, config: ProjectConfig): Promise<boolean> {
  try {
    await git(['ls-remote', '--exit-code', '--heads', 'origin', branch], { cwd, config });
    return true;
  } catch {
    return false;
  }
}

export async function setRemoteUrl(cwd: string, url: string): Promise<void> {
  await git(['remote', 'set-url', 'origin', url], { cwd });
}

export async function pruneWorktrees(cwd: string): Promise<void> {
  await git(['worktree', 'prune'], { cwd });
}

export async function localBranchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', branch], { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function deleteLocalBranch(cwd: string, branch: string): Promise<void> {
  await git(['branch', '-D', branch], { cwd });
}
