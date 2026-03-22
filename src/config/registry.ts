import { type LoadedProject, loadAllProjects } from './loader.js';
import { childLogger } from '../logger.js';

const log = childLogger('config-registry');

class ProjectRegistry {
  private projects = new Map<string, LoadedProject>();
  private urlIndex = new Map<string, string>();

  load(projectsDir: string): void {
    this.projects.clear();
    this.urlIndex.clear();

    const loaded = loadAllProjects(projectsDir);
    for (const project of loaded) {
      this.projects.set(project.id, project);
      this.urlIndex.set(this.normalizeUrl(project.config.repoUrl), project.id);
    }

    log.info({ count: this.projects.size }, 'Project registry loaded');
  }

  get(id: string): LoadedProject | undefined {
    return this.projects.get(id);
  }

  findByRepoUrl(repoUrl: string): LoadedProject | undefined {
    const normalized = this.normalizeUrl(repoUrl);
    const id = this.urlIndex.get(normalized);
    return id ? this.projects.get(id) : undefined;
  }

  all(): LoadedProject[] {
    return Array.from(this.projects.values());
  }

  private normalizeUrl(url: string): string {
    return url
      .replace(/\.git$/, '')
      .replace(/\/+$/, '')
      .replace(/^https?:\/\//, '')
      .replace(/^git@([^:]+):/, '$1/')
      .toLowerCase();
  }
}

export const registry = new ProjectRegistry();
