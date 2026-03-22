import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Job } from 'bullmq';
import type { TicketJobPayload, JobResult } from '../types/index.js';
import type { ProjectConfig } from '../config/schema.js';
import { registry } from '../config/registry.js';
import { prepareWorkspace, type Workspace } from '../git/workspace.js';
import * as gitOps from '../git/operations.js';
import { buildPrompt, buildTriagePrompt, getSystemAppend } from '../agent/prompt-builder.js';
import { runClaude } from '../agent/runner.js';
import { extractTitle, slugifyContext } from '../agent/output-parser.js';
import { createProvider } from '../providers/factory.js';
import * as discord from '../discord/notifier.js';
import { generateReport, saveReport } from '../report/generator.js';
import { childLogger } from '../logger.js';

const execFileAsync = promisify(execFile);
const log = childLogger('pipeline');

function slugify(text: string, maxLen: number = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
}

function buildBranchName(pattern: string, ticketId?: string, context?: string): string {
  return pattern
    .replace('{{ticketId}}', ticketId ?? 'no-ticket')
    .replace('{{slug}}', slugify(context ?? 'task'))
    .replace('{{timestamp}}', new Date().toISOString().replace(/[:T]/g, '-').slice(0, 15));
}

async function runShellCommand(cmd: string, cwd: string, timeoutMs = 300_000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', cmd], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    return { stdout, stderr, ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', ok: false };
  }
}

async function resolveBranch(
  branch: string,
  workspace: Workspace,
  config: ProjectConfig,
): Promise<string> {
  const exists = await gitOps.remoteBranchExists(workspace.path, branch, config);
  if (!exists) return branch;

  for (let i = 2; i <= 10; i++) {
    const candidate = `${branch}-${i}`;
    const candidateExists = await gitOps.remoteBranchExists(workspace.path, candidate, config);
    if (!candidateExists) return candidate;
  }

  const ts = Date.now().toString(36);
  return `${branch}-${ts}`;
}

export async function executePipeline(job: Job<TicketJobPayload, JobResult>): Promise<JobResult> {
  const start = Date.now();
  const { data: payload } = job;

  const project = registry.get(payload.projectId);
  if (!project) {
    throw new Error(`Project not found: ${payload.projectId}`);
  }

  const config = project.config;
  const jobId = String(job.id);

  await discord.notifyJobStarted(config, jobId, payload.ticketId, payload.ticketLink ?? '');

  let workspace: Workspace | null = null;
  let branch = '';

  try {
    // Step 1: Prepare workspace
    await job.updateProgress({ step: 'cloning' });
    workspace = await prepareWorkspace(payload.projectId, jobId, config);

    // Step 2: Create branch
    branch = buildBranchName(config.branchPattern, payload.ticketId, payload.context);
    branch = await resolveBranch(branch, workspace, config);
    // Clean stale local branch if exists (from previous failed runs)
    if (await gitOps.localBranchExists(workspace.path, branch)) {
      await gitOps.deleteLocalBranch(workspace.path, branch);
    }
    await gitOps.checkoutNewBranch(workspace.path, branch);
    log.info({ branch }, 'Branch created');

    // Step 3: Pre-commands
    if (config.commands.install) {
      await job.updateProgress({ step: 'installing' });
      const result = await runShellCommand(config.commands.install, workspace.path);
      if (!result.ok) {
        log.warn({ stderr: result.stderr }, 'Install command failed');
      }
    }

    for (const cmd of config.commands.preAnalysis) {
      await runShellCommand(cmd, workspace.path);
    }

    // Step 4: Run Claude
    await job.updateProgress({ step: 'implementing' });
    await discord.notifyImplementationStart(config, jobId, payload.ticketId, payload.ticketLink ?? '');
    const prompt = buildPrompt(payload, config, workspace.path);
    const systemAppend = getSystemAppend(config);
    const claudeResult = await runClaude(prompt, workspace.path, config, systemAppend, payload.projectId, jobId);

    const summary = claudeResult.resultText;

    // Dry run — return analysis only
    if (payload.dryRun) {
      return {
        status: 'dry_run',
        branch,
        filesChanged: 0,
        summary: claudeResult.resultText,
        duration: Date.now() - start,
      };
    }

    // Step 5: Post-implementation commands
    let testOutput = '';
    for (const cmd of config.commands.postImplementation) {
      await job.updateProgress({ step: 'testing' });
      const result = await runShellCommand(cmd, workspace.path);
      testOutput += result.stdout + result.stderr;
      if (!result.ok) {
        log.warn({ cmd, stderr: result.stderr.slice(0, 500) }, 'Post-implementation command failed');
      }
    }

    // Step 6: Commit
    await job.updateProgress({ step: 'committing' });
    await gitOps.addAll(workspace.path);
    const changed = await gitOps.hasChanges(workspace.path);
    const diffStatOutput = changed ? await gitOps.diffStat(workspace.path) : '';
    const filesChanged = diffStatOutput ? diffStatOutput.split('\n').length - 1 : 0;

    await discord.notifyImplementationDone(config, jobId, payload.ticketId, summary, filesChanged);

    if (!changed) {
      log.info('No file changes detected, returning analysis only');
      return {
        status: 'analyzed',
        branch,
        filesChanged: 0,
        summary: summary || claudeResult.resultText,
        duration: Date.now() - start,
      };
    }

    const title = extractTitle(claudeResult.resultText, payload.context);
    const commitMsg = payload.ticketId
      ? `${payload.ticketId}: ${title}`
      : title;

    await gitOps.commit(workspace.path, commitMsg);

    // Step 7: Push
    await job.updateProgress({ step: 'pushing' });
    await gitOps.push(workspace.path, branch, config);

    // Step 8: Create PR
    await job.updateProgress({ step: 'creating_pr' });
    try {
      const provider = createProvider(config);

      const prTitle = payload.ticketId
        ? `${payload.ticketId}: ${title}`
        : title;

      const prBody = [
        '## Chamado',
        '',
        payload.context,
        '',
        payload.ticketId && payload.ticketLink ? `[${payload.ticketId}](${payload.ticketLink})` : (payload.ticketLink ?? ''),
        '',
        '## Proposta',
        '',
        claudeResult.resultText,
        '',
        '## Alteracoes',
        '',
        '```',
        diffStatOutput,
        '```',
      ].filter(Boolean).join('\n');

      const pr = await provider.createPullRequest({
        title: prTitle,
        body: prBody,
        sourceBranch: branch,
        targetBranch: config.defaultBranch,
        labels: config.pr.labels,
        reviewers: config.pr.reviewers,
        draft: config.pr.draft,
      });

      await discord.notifyPRCreated(config, pr.url, branch, summary, payload.ticketId);

      return {
        status: 'pr_created',
        branch,
        prUrl: pr.url,
        prNumber: pr.number,
        filesChanged,
        summary,
        duration: Date.now() - start,
      };
    } catch (prError: unknown) {
      // Fallback: branch is pushed but PR failed
      const errMsg = prError instanceof Error ? prError.message : String(prError);
      log.error({ err: errMsg }, 'PR creation failed, entering fallback');

      const report = generateReport({
        ticketId: payload.ticketId,
        ticketLink: payload.ticketLink ?? '',
        branch,
        repoUrl: config.repoUrl,
        summary,
        diffStat: diffStatOutput,
        error: errMsg,
        testOutput: testOutput || undefined,
      }, config);

      const reportPath = saveReport(payload.projectId, jobId, report);
      await discord.notifyPRFailed(config, branch, errMsg, report, payload.ticketId);

      return {
        status: 'branch_only',
        branch,
        reportPath,
        filesChanged,
        summary,
        duration: Date.now() - start,
      };
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ err: errMsg, jobId }, 'Pipeline failed');
    await discord.notifyJobFailed(config, jobId, errMsg, payload.ticketId);
    throw err;
  } finally {
    if (workspace) {
      await workspace.cleanup().catch(e => log.warn({ e }, 'Workspace cleanup failed'));
    }
  }
}

// ==================== TRIAGE PIPELINE ====================

interface TriageResult {
  complexidade: string;
  justificativa: string;
  estimativa_arquivos: number;
  estimativa_migrations: number;
  riscos: string[];
  subtarefas: Array<{ titulo: string; descricao: string; arquivos_impactados?: string[] }>;
  proposta: string;
  resposta_solicitante?: string;
  titulo?: string;
}

function parseTriageResponse(text: string): TriageResult | null {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as TriageResult;
  } catch {
    return null;
  }
}

export async function executeTriagePipeline(job: Job<TicketJobPayload, JobResult>): Promise<JobResult> {
  const start = Date.now();
  const { data: payload } = job;

  const project = registry.get(payload.projectId);
  if (!project) {
    throw new Error(`Project not found: ${payload.projectId}`);
  }

  const config = project.config;
  const jobId = String(job.id);

  await discord.notifyJobStarted(config, jobId, payload.ticketId, payload.ticketLink ?? '');

  let workspace: Workspace | null = null;

  try {
    // Step 1: Prepare workspace
    await job.updateProgress({ step: 'cloning' });
    workspace = await prepareWorkspace(payload.projectId, jobId, config);

    // Step 2: Install deps
    if (config.commands.install) {
      await job.updateProgress({ step: 'installing' });
      await runShellCommand(config.commands.install, workspace.path);
    }

    // Step 3: Run triage
    await job.updateProgress({ step: 'analyzing' });
    const prompt = buildTriagePrompt(payload, config, workspace.path);
    const systemAppend = getSystemAppend(config);
    const claudeResult = await runClaude(prompt, workspace.path, config, systemAppend, payload.projectId, jobId);

    const triage = parseTriageResponse(claudeResult.resultText);

    if (!triage) {
      log.warn('Could not parse triage response, returning raw');
      return {
        status: 'triage',
        branch: '',
        filesChanged: 0,
        summary: claudeResult.resultText,
        duration: Date.now() - start,
      };
    }

    log.info({ complexidade: triage.complexidade, subtarefas: triage.subtarefas.length }, 'Triage complete');

    // === SIMPLES: implementar automaticamente ===
    if (triage.complexidade.toLowerCase() === 'simples') {
      log.info('Triage classified as SIMPLES, switching to implementation');

      // Create branch and implement
      let branch = buildBranchName(config.branchPattern, payload.ticketId, payload.context);
      branch = await resolveBranch(branch, workspace, config);
      if (await gitOps.localBranchExists(workspace.path, branch)) {
        await gitOps.deleteLocalBranch(workspace.path, branch);
      }
      await gitOps.checkoutNewBranch(workspace.path, branch);

      await job.updateProgress({ step: 'implementing' });
      await discord.notifyImplementationStart(config, jobId, payload.ticketId, payload.ticketLink ?? '');

      const implPrompt = buildPrompt({ ...payload, context: `${payload.context}\n\nProposta tecnica aprovada:\n${triage.proposta}` }, config, workspace.path);
      const implResult = await runClaude(implPrompt, workspace.path, config, systemAppend, payload.projectId, `${jobId}-impl`);
      const implSummary = implResult.resultText;

      await gitOps.addAll(workspace.path);
      const changed = await gitOps.hasChanges(workspace.path);

      if (!changed) {
        return {
          status: 'analyzed',
          branch,
          filesChanged: 0,
          summary: `## Triagem: SIMPLES\n\n${triage.resposta_solicitante ?? ''}\n\n---\n\n${implSummary}`,
          duration: Date.now() - start,
        };
      }

      const diffStatOutput = await gitOps.diffStat(workspace.path);
      const filesChanged = diffStatOutput ? diffStatOutput.split('\n').length - 1 : 0;
      await discord.notifyImplementationDone(config, jobId, payload.ticketId, implSummary, filesChanged);

      const implTitle = extractTitle(implResult.resultText, payload.context);
      const commitMsg = payload.ticketId
        ? `${payload.ticketId}: ${implTitle}`
        : implTitle;
      await gitOps.commit(workspace.path, commitMsg);

      await job.updateProgress({ step: 'pushing' });
      await gitOps.push(workspace.path, branch, config);

      await job.updateProgress({ step: 'creating_pr' });
      try {
        const provider = createProvider(config);
        const prTitle = payload.ticketId
          ? `${payload.ticketId}: ${implTitle}`
          : implTitle;

        const prBody = [
          '## Chamado',
          '',
          payload.context,
          '',
          payload.ticketId && payload.ticketLink ? `[${payload.ticketId}](${payload.ticketLink})` : (payload.ticketLink ?? ''),
          '',
          '## Proposta',
          '',
          implResult.resultText,
          '',
          '## Alteracoes',
          '',
          '```',
          diffStatOutput,
          '```',
        ].filter(Boolean).join('\n');

        const pr = await provider.createPullRequest({
          title: prTitle,
          body: prBody,
          sourceBranch: branch,
          targetBranch: config.defaultBranch,
          labels: config.pr.labels,
          reviewers: config.pr.reviewers,
          draft: config.pr.draft,
        });

        await discord.notifyPRCreated(config, pr.url, branch, implSummary, payload.ticketId);

        return {
          status: 'pr_created',
          branch,
          prUrl: pr.url,
          prNumber: pr.number,
          filesChanged,
          summary: `## Triagem: SIMPLES (implementado)\n\n${triage.resposta_solicitante ?? ''}\n\n---\n\n${implSummary}`,
          duration: Date.now() - start,
        };
      } catch (prError: unknown) {
        const errMsg = prError instanceof Error ? prError.message : String(prError);
        const report = generateReport({
          ticketId: payload.ticketId,
          ticketLink: payload.ticketLink ?? '',
          branch,
          repoUrl: config.repoUrl,
          summary: implSummary,
          diffStat: diffStatOutput,
          error: errMsg,
        }, config);
        const reportPath = saveReport(payload.projectId, jobId, report);
        await discord.notifyPRFailed(config, branch, errMsg, report, payload.ticketId);

        return {
          status: 'branch_only',
          branch,
          reportPath,
          filesChanged,
          summary: implSummary,
          duration: Date.now() - start,
        };
      }
    }

    // === INVESTIGACAO: apenas resposta/analise ===
    const isInvestigation = triage.complexidade.toLowerCase() === 'investigacao';
    const label = isInvestigation ? 'INVESTIGACAO' : 'COMPLEXO';
    const status = isInvestigation ? 'analyzed' as const : 'triage' as const;

    const summary = [
      `## Triagem: ${label}`,
      '',
      `**Justificativa:** ${triage.justificativa}`,
      !isInvestigation ? `**Estimativa:** ~${triage.estimativa_arquivos} arquivos, ${triage.estimativa_migrations} migrations` : '',
      '',
      '## Resposta ao Solicitante',
      '',
      triage.resposta_solicitante ?? 'Resposta nao gerada.',
      '',
      '---',
      '',
      isInvestigation ? '## Analise' : '## Proposta Tecnica',
      '',
      triage.proposta,
      '',
      triage.riscos.length > 0 ? '## Riscos' : '',
      '',
      ...triage.riscos.map(r => `- ${r}`),
      '',
      triage.subtarefas.length > 0 ? '## Subtarefas' : '',
      '',
      ...triage.subtarefas.map((sub, idx) => {
        const prioridade = (sub as { prioridade?: string }).prioridade ?? 'media';
        const arquivos = sub.arquivos_impactados?.length
          ? `\n  Arquivos: \`${sub.arquivos_impactados.join('`, `')}\``
          : '';
        return `### ${idx + 1}. ${sub.titulo} (${prioridade})\n\n${sub.descricao}${arquivos}`;
      }),
    ].filter(Boolean).join('\n');

    // Create issue if no ticketLink was provided
    let issueUrl = '';
    if (!payload.ticketLink) {
      try {
        const provider = createProvider(config);
        const triageTitle = triage.titulo || extractTitle(claudeResult.resultText, payload.context);
        const issueTitle = payload.ticketId
          ? `[${label}] ${payload.ticketId}: ${triageTitle}`
          : `[${label}] ${triageTitle}`;
        const issue = await provider.createIssue({
          title: issueTitle,
          body: summary,
          labels: [isInvestigation ? 'investigacao' : 'triagem'],
        });
        issueUrl = issue.url;
        log.info({ url: issue.url }, 'Issue created for triage');
      } catch (err) {
        log.warn({ err }, 'Failed to create issue');
      }
    }

    const reportContent = generateReport({
      ticketId: payload.ticketId,
      ticketLink: issueUrl || payload.ticketLink || '',
      branch: '',
      repoUrl: config.repoUrl,
      summary,
      diffStat: '',
    }, config);
    const reportPath = saveReport(payload.projectId, jobId, reportContent);

    if (!isInvestigation) {
      await discord.notifyTriageComplex(config, jobId, payload.ticketId, triage.justificativa);
    }

    return {
      status,
      branch: '',
      filesChanged: 0,
      summary: issueUrl ? `${summary}\n\n**Issue:** ${issueUrl}` : summary,
      duration: Date.now() - start,
      reportPath,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ err: errMsg, jobId }, 'Triage pipeline failed');
    await discord.notifyJobFailed(config, jobId, errMsg, payload.ticketId);
    throw err;
  } finally {
    if (workspace) {
      await workspace.cleanup().catch(e => log.warn({ e }, 'Workspace cleanup failed'));
    }
  }
}
