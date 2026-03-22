import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';
import type { ProjectConfig } from '../config/schema.js';
import { buildCloneUrl } from './auth.js';
import * as gitOps from './operations.js';
import { childLogger } from '../logger.js';

const log = childLogger('workspace');

export interface Workspace {
  path: string;
  cleanup: () => Promise<void>;
}

export async function prepareWorkspace(
  projectId: string,
  jobId: string,
  config: ProjectConfig,
): Promise<Workspace> {
  if (config.isolation === 'clone') {
    return prepareClone(projectId, jobId, config);
  }
  return prepareWorktree(projectId, jobId, config);
}

async function prepareWorktree(
  projectId: string,
  jobId: string,
  config: ProjectConfig,
): Promise<Workspace> {
  const barePath = path.resolve(env.REPOS_DIR, projectId, '.bare');
  const workPath = path.resolve(env.REPOS_DIR, projectId, `work-${jobId}`);
  const cloneUrl = buildCloneUrl(config);

  if (!fs.existsSync(barePath)) {
    log.info({ projectId }, 'Cloning bare repository');
    fs.mkdirSync(path.dirname(barePath), { recursive: true });
    await gitOps.cloneBare(cloneUrl, barePath, config);
  } else {
    await gitOps.setRemoteUrl(barePath, cloneUrl);
  }

  await gitOps.fetch(barePath, config);
  await gitOps.pruneWorktrees(barePath);
  // Clean stale workdir if exists
  if (fs.existsSync(workPath)) {
    fs.rmSync(workPath, { recursive: true, force: true });
    await gitOps.pruneWorktrees(barePath);
  }
  await gitOps.addWorktree(barePath, workPath, config.defaultBranch);
  await gitOps.configUser(workPath, config.auth.commitAuthor.name, config.auth.commitAuthor.email);
  await gitOps.setRemoteUrl(workPath, cloneUrl);

  log.info({ projectId, jobId, workPath }, 'Worktree ready');

  return {
    path: workPath,
    cleanup: async () => {
      try {
        await gitOps.removeWorktree(barePath, workPath);
        log.debug({ workPath }, 'Worktree removed');
      } catch (err) {
        log.warn({ workPath, err }, 'Failed to remove worktree, removing directory');
        fs.rmSync(workPath, { recursive: true, force: true });
      }
    },
  };
}

async function prepareClone(
  projectId: string,
  jobId: string,
  config: ProjectConfig,
): Promise<Workspace> {
  const workPath = path.resolve(env.REPOS_DIR, projectId, `work-${jobId}`);
  const cloneUrl = buildCloneUrl(config);

  fs.mkdirSync(path.dirname(workPath), { recursive: true });
  await gitOps.cloneShallow(cloneUrl, workPath, config.defaultBranch, config);
  await gitOps.configUser(workPath, config.auth.commitAuthor.name, config.auth.commitAuthor.email);

  log.info({ projectId, jobId, workPath }, 'Clone ready');

  return {
    path: workPath,
    cleanup: async () => {
      fs.rmSync(workPath, { recursive: true, force: true });
      log.debug({ workPath }, 'Clone removed');
    },
  };
}
