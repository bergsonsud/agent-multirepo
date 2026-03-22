import { Octokit } from '@octokit/rest';
import type { ProjectConfig } from '../config/schema.js';
import type { GitProvider, PullRequestInput, PullRequestResult, IssueInput, IssueResult } from './types.js';
import { childLogger } from '../logger.js';

const log = childLogger('github-provider');

export class GitHubProvider implements GitProvider {
  readonly name = 'github' as const;
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: ProjectConfig) {
    const tokenVar = config.auth.tokenEnvVar;
    const token = tokenVar ? process.env[tokenVar] : undefined;

    this.octokit = new Octokit({ auth: token });
    this.owner = config.providerConfig?.owner ?? '';
    this.repo = config.providerConfig?.repo ?? '';

    if (!this.owner || !this.repo) {
      const match = config.repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (match) {
        this.owner = match[1];
        this.repo = match[2];
      }
    }

    log.debug({ owner: this.owner, repo: this.repo }, 'GitHub provider initialized');
  }

  async createPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
    const { data } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
      head: input.sourceBranch,
      base: input.targetBranch,
      draft: input.draft ?? false,
    });

    if (input.labels?.length) {
      await this.octokit.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: data.number,
        labels: input.labels,
      }).catch(err => log.warn({ err }, 'Failed to add labels'));
    }

    if (input.reviewers?.length) {
      await this.octokit.pulls.requestReviewers({
        owner: this.owner,
        repo: this.repo,
        pull_number: data.number,
        reviewers: input.reviewers,
      }).catch(err => log.warn({ err }, 'Failed to add reviewers'));
    }

    log.info({ prNumber: data.number, url: data.html_url }, 'PR created');
    return { id: data.id, url: data.html_url, number: data.number };
  }

  async createIssue(input: IssueInput): Promise<IssueResult> {
    const { data } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
      labels: input.labels,
    });

    log.info({ issueNumber: data.number, url: data.html_url }, 'Issue created');
    return { id: data.id, url: data.html_url, number: data.number };
  }

  async branchExists(branch: string): Promise<boolean> {
    try {
      await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch,
      });
      return true;
    } catch {
      return false;
    }
  }
}
