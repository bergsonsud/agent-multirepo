export interface PullRequestInput {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  labels?: string[];
  reviewers?: string[];
  draft?: boolean;
}

export interface PullRequestResult {
  id: number;
  url: string;
  number: number;
}

export interface IssueInput {
  title: string;
  body: string;
  labels?: string[];
}

export interface IssueResult {
  id: number;
  url: string;
  number: number;
}

export interface GitProvider {
  readonly name: 'github' | 'bitbucket';
  createPullRequest(input: PullRequestInput): Promise<PullRequestResult>;
  createIssue(input: IssueInput): Promise<IssueResult>;
  branchExists(branch: string): Promise<boolean>;
}
