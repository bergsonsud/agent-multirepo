import type { ProjectConfig } from '../config/schema.js';
import type { GitProvider } from './types.js';
import { GitHubProvider } from './github.js';
import { BitbucketProvider } from './bitbucket.js';

export function createProvider(config: ProjectConfig): GitProvider {
  switch (config.provider) {
    case 'github':
      return new GitHubProvider(config);
    case 'bitbucket':
      return new BitbucketProvider(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
