export interface TicketRequest {
  context: string;
  ticketLink?: string;
  ticketId?: string;
  repoUrl: string;
  dryRun?: boolean;
  skipTriage?: boolean;
}

export interface TicketJobPayload extends TicketRequest {
  projectId: string;
  requestedAt: string;
}

export interface TriageIssue {
  title: string;
  body: string;
  url?: string;
}

export interface JobResult {
  status: 'pr_created' | 'branch_only' | 'dry_run' | 'analyzed' | 'triage' | 'failed';
  branch: string;
  prUrl?: string;
  prNumber?: number;
  reportPath?: string;
  filesChanged: number;
  summary: string;
  duration: number;
  triageIssues?: TriageIssue[];
}

export type JobStatus =
  | 'queued'
  | 'cloning'
  | 'analyzing'
  | 'implementing'
  | 'testing'
  | 'committing'
  | 'pushing'
  | 'creating_pr'
  | 'completed'
  | 'failed';
