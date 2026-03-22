import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ProjectConfigSchema, type ProjectConfig } from './schema.js';
import { childLogger } from '../logger.js';

const log = childLogger('config-loader');

export interface LoadedProject {
  id: string;
  config: ProjectConfig;
  filePath: string;
}

export function loadProjectFile(filePath: string): LoadedProject {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(raw);
  const config = ProjectConfigSchema.parse(parsed);
  const id = path.basename(filePath, path.extname(filePath));
  return { id, config, filePath };
}

export function loadAllProjects(projectsDir: string): LoadedProject[] {
  if (!fs.existsSync(projectsDir)) {
    log.warn({ projectsDir }, 'Projects directory not found');
    return [];
  }

  const files = fs.readdirSync(projectsDir).filter(
    f => f.endsWith('.yml') || f.endsWith('.yaml')
  );

  const projects: LoadedProject[] = [];

  for (const file of files) {
    const filePath = path.join(projectsDir, file);
    try {
      projects.push(loadProjectFile(filePath));
      log.info({ id: path.basename(file, path.extname(file)) }, 'Loaded project config');
    } catch (err) {
      log.error({ file, err }, 'Failed to load project config');
    }
  }

  return projects;
}
