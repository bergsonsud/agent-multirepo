import type { ProjectConfig } from '../config/schema.js';
import type { GitProvider, PullRequestInput, PullRequestResult, IssueInput, IssueResult } from './types.js';
import { childLogger } from '../logger.js';

const log = childLogger('bitbucket-provider');

export class BitbucketProvider implements GitProvider {
  readonly name = 'bitbucket' as const;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: ProjectConfig) {
    const workspace = config.providerConfig?.workspace ?? '';
    const repoSlug = config.providerConfig?.repoSlug ?? '';

    if (!workspace || !repoSlug) {
      throw new Error('Bitbucket provider requires providerConfig.workspace and providerConfig.repoSlug');
    }

    this.baseUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}`;

    const tokenVar = config.auth.tokenEnvVar;
    const token = tokenVar ? process.env[tokenVar] : undefined;

    const email = config.auth.commitAuthor.email;
    const basicAuth = token ? Buffer.from(`${email}:${token}`).toString('base64') : '';

    this.headers = {
      'Content-Type': 'application/json',
      ...(basicAuth ? { Authorization: `Basic ${basicAuth}` } : {}),
    };

    log.debug({ workspace, repoSlug }, 'Bitbucket provider initialized');
  }

  async createPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
    const res = await fetch(`${this.baseUrl}/pullrequests`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        title: input.title,
        description: input.body,
        source: { branch: { name: input.sourceBranch } },
        destination: { branch: { name: input.targetBranch } },
        close_source_branch: false,
        reviewers: input.reviewers?.map(username => ({ username })) ?? [],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bitbucket API error ${res.status}: ${body}`);
    }

    const data = await res.json() as { id: number; links: { html: { href: string } } };

    log.info({ prId: data.id, url: data.links.html.href }, 'PR created');
    return {
      id: data.id,
      url: data.links.html.href,
      number: data.id,
    };
  }

  async createIssue(input: IssueInput): Promise<IssueResult> {
    const res = await fetch(`${this.baseUrl}/issues`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        title: input.title,
        content: { raw: input.body },
        kind: 'task',
        priority: 'major',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bitbucket issue API error ${res.status}: ${body}`);
    }

    const data = await res.json() as { id: number; links: { html: { href: string } } };
    log.info({ issueId: data.id, url: data.links.html.href }, 'Issue created');
    return { id: data.id, url: data.links.html.href, number: data.id };
  }

  async branchExists(branch: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/refs/branches/${encodeURIComponent(branch)}`, {
      headers: this.headers,
    });
    return res.ok;
  }
}
