import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { ticketQueue } from '../../queue/ticket-queue.js';
import { featureQueue } from '../../queue/feature-queue.js';
import { bearerAuth, dashboardAuth } from '../middleware/auth.js';
import { getLogPath } from '../../agent/runner.js';

async function findJob(id: string) {
  // IDs are globally unique: t-xxx for tickets, f-xxx for features
  if (id.startsWith('f-')) {
    const j = await featureQueue.getJob(id);
    if (j) return { job: j, queueType: 'feature' as const };
  } else if (id.startsWith('t-')) {
    const j = await ticketQueue.getJob(id);
    if (j) return { job: j, queueType: 'ticket' as const };
  }
  // Fallback: check both
  const fJob = await featureQueue.getJob(id);
  if (fJob) return { job: fJob, queueType: 'feature' as const };
  const tJob = await ticketQueue.getJob(id);
  if (tJob) return { job: tJob, queueType: 'ticket' as const };
  return null;
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'CONCLUIDO', active: 'EM ANDAMENTO', failed: 'FALHOU',
  delayed: 'AGUARDANDO RETRY', waiting: 'NA FILA', prioritized: 'PRIORIDADE',
};

const RESULT_LABEL: Record<string, string> = {
  pr_created: 'PR CRIADO', branch_only: 'APENAS BRANCH', dry_run: 'DRY RUN',
  analyzed: 'ANALISADO', triage: 'TRIAGEM', failed: 'FALHOU',
};

const STEP_LABEL: Record<string, string> = {
  cloning: 'Clonando', installing: 'Instalando dependencias',
  analyzing: 'Analisando complexidade', implementing: 'Implementando',
  testing: 'Rodando testes', committing: 'Commitando',
  pushing: 'Enviando branch', creating_pr: 'Criando PR',
  creating_issues: 'Criando issues',
};

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;overflow-x:auto">$2</pre>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#e8e8e8;padding:1px 5px;border-radius:3px">$1</code>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<h3 style="margin:16px 0 8px">$1</h3>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\| ?(.+?) ?\|/g, (match) => {
      const cells = match.split('|').filter(Boolean).map(c => c.trim());
      return '<tr>' + cells.map(c => `<td style="padding:4px 10px;border:1px solid #ddd">${c}</td>`).join('') + '</tr>';
    })
    .replace(/\n/g, '<br>');
}

const PAGE_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
  .card { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 24px; max-width: 960px; margin: 0 auto 16px; }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .header h1 { font-size: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .grid-item { background: #fafafa; border-radius: 6px; padding: 10px 14px; }
  .grid-item label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .grid-item p { font-size: 14px; font-weight: 500; margin-top: 2px; word-break: break-all; }
  .summary { line-height: 1.7; font-size: 14px; }
  .summary pre { margin: 10px 0; font-size: 13px; }
  .summary li { margin-left: 20px; }
  .summary table { border-collapse: collapse; margin: 10px 0; }
  a { color: #3498db; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .badge { color: #fff; padding: 2px 10px; border-radius: 4px; font-size: 13px; font-weight: 500; }
  .nav { max-width: 960px; margin: 0 auto 16px; }
  .nav a { font-size: 13px; color: #888; }
  table.jobs { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.jobs th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #eee; font-size: 12px; color: #888; text-transform: uppercase; }
  table.jobs td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
  table.jobs tr:hover { background: #fafafa; }
  .search-bar { display: flex; gap: 8px; margin-bottom: 16px; }
  .search-bar input { flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
  .pagination { display: flex; justify-content: center; gap: 8px; margin-top: 16px; }
  .pagination a, .pagination span { padding: 6px 12px; border-radius: 4px; font-size: 13px; border: 1px solid #ddd; }
  .pagination span { background: #3498db; color: #fff; border-color: #3498db; }
`;

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  // JSON API — protected
  app.get('/api/jobs/:id', {
    preHandler: bearerAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await findJob(id);

    if (!found) {
      return reply.code(404).send({ error: 'Job nao encontrado' });
    }

    const job = found.job;

    const state = await job.getState();
    const progress = job.progress;

    return reply.send({
      jobId: job.id,
      status: state,
      progress,
      data: {
        projectId: job.data.projectId,
        ticketId: job.data.ticketId,
        ticketLink: job.data.ticketLink,
        dryRun: job.data.dryRun,
        requestedAt: job.data.requestedAt,
      },
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn ?? null,
    });
  });

  // ==================== PAINEL DE JOBS ====================
  app.get('/jobs', { preHandler: dashboardAuth }, async (request, reply) => {
    const query = request.query as { page?: string; q?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const search = (query.q ?? '').trim().toLowerCase();
    const perPage = 15;

    // Fetch all job types from both queues
    const states = ['waiting', 'active', 'completed', 'failed', 'delayed', 'prioritized'] as const;
    const [ticketJobs, featureJobs] = await Promise.all([
      Promise.all(states.map(s => ticketQueue.getJobs([s], 0, 200))),
      Promise.all(states.map(s => featureQueue.getJobs([s], 0, 200))),
    ]);

    // Tag jobs with their queue type
    const taggedTickets = ticketJobs.flat().map(j => ({ job: j, queueType: 'ticket' as const }));
    const taggedFeatures = featureJobs.flat().map(j => ({ job: j, queueType: 'feature' as const }));

    let allTagged = [...taggedFeatures, ...taggedTickets]
      .sort((a, b) => (b.job.timestamp ?? 0) - (a.job.timestamp ?? 0));

    let allJobs = allTagged.map(t => t.job);

    // Search filter
    if (search) {
      allJobs = allJobs.filter(j => {
        const d = j.data;
        return (d.ticketId ?? '').toLowerCase().includes(search)
          || (d.projectId ?? '').toLowerCase().includes(search)
          || (d.context ?? '').toLowerCase().includes(search);
      });
    }

    const total = allTagged.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const paginatedTagged = allTagged.slice((page - 1) * perPage, page * perPage);

    const jobStates = await Promise.all(paginatedTagged.map(t => t.job.getState()));

    const rows = paginatedTagged.map((t, i) => {
      const j = t.job;
      const state = jobStates[i];
      const result = j.returnvalue as Record<string, unknown> | null;
      const statusColor: Record<string, string> = {
        completed: '#2ecc71', active: '#3498db', failed: '#e74c3c',
        delayed: '#f39c12', waiting: '#95a5a6', prioritized: '#9b59b6',
      };
      const color = statusColor[state] ?? '#999';
      const created = j.timestamp ? new Date(j.timestamp).toLocaleString('pt-BR') : '—';
      const prLink = result?.prUrl ? `<a href="${result.prUrl}" target="_blank">PR #${result.prNumber}</a>` : '—';
      const typeLabel = t.queueType === 'feature'
        ? '<span class="badge" style="background:#9b59b6">TRIAGEM</span>'
        : '<span class="badge" style="background:#34495e">TICKET</span>';
      const displayId = String(j.id);
      const jobLink = `/jobs/${j.id}`;

      const durSec = result?.duration ? Math.round(Number(result.duration) / 1000) : 0;
      const durText = !durSec
        ? (state === 'active' ? '...' : '—')
        : durSec >= 60 ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : `${durSec}s`;

      return `<tr>
        <td><a href="${jobLink}">${displayId}</a></td>
        <td>${typeLabel}</td>
        <td>${j.data.ticketId ?? '—'}</td>
        <td>${j.data.projectId}</td>
        <td><span class="badge" style="background:${color}">${STATUS_LABEL[state] ?? state.toUpperCase()}</span></td>
        <td>${result?.status ? RESULT_LABEL[String(result.status)] ?? result.status : '—'}</td>
        <td>${prLink}</td>
        <td>${durText}</td>
        <td>${created}</td>
      </tr>`;
    }).join('');

    // Pagination
    const paginationLinks = [];
    for (let p = 1; p <= totalPages; p++) {
      const qs = search ? `&q=${encodeURIComponent(search)}` : '';
      if (p === page) {
        paginationLinks.push(`<span>${p}</span>`);
      } else {
        paginationLinks.push(`<a href="/jobs?page=${p}${qs}">${p}</a>`);
      }
    }

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Painel de Jobs</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Painel de Jobs</h1>
      <span style="font-size:13px;color:#888">${total} job(s)</span>
      <span style="margin-left:auto;font-size:12px;display:flex;gap:12px"><a href="/board" style="color:#888">Bull Board</a><a href="/logout" style="color:#888">Sair</a></span>
    </div>
    <form method="get" action="/jobs" class="search-bar">
      <input type="text" name="q" placeholder="Buscar por ticket, projeto ou contexto..." value="${search.replace(/"/g, '&quot;')}">
      <button type="submit" style="padding:8px 16px;border:1px solid #3498db;background:#3498db;color:#fff;border-radius:6px;cursor:pointer">Buscar</button>
      ${search ? '<a href="/jobs" style="padding:8px 12px;font-size:13px">Limpar</a>' : ''}
    </form>
    <table class="jobs">
      <thead>
        <tr>
          <th>ID</th>
          <th>Tipo</th>
          <th>Chamado</th>
          <th>Projeto</th>
          <th>Status</th>
          <th>Resultado</th>
          <th>PR</th>
          <th>Duracao</th>
          <th>Criado em</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="9" style="text-align:center;padding:24px;color:#888">Nenhum job encontrado</td></tr>'}
      </tbody>
    </table>
    ${totalPages > 1 ? `<div class="pagination">${paginationLinks.join('')}</div>` : ''}
  </div>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  // ==================== LOGS RAW (JSON) ====================
  app.get('/jobs/:id/logs', { preHandler: dashboardAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { offset?: string };
    const offset = parseInt(query.offset ?? '0', 10) || 0;

    const found = await findJob(id);
    if (!found) {
      return reply.code(404).send({ error: 'Job nao encontrado' });
    }
    const job = found.job;
    const logId = id;

    const logFile = getLogPath(job.data.projectId, logId);
    if (!fs.existsSync(logFile)) {
      return reply.send({ content: '', size: 0, offset: 0 });
    }

    const stat = fs.statSync(logFile);
    const readFrom = Math.min(offset, stat.size);
    const stream = fs.createReadStream(logFile, { start: readFrom, encoding: 'utf-8' });
    let content = '';
    for await (const chunk of stream) {
      content += chunk;
    }

    return reply.send({ content, size: stat.size, offset: readFrom });
  });

  // ==================== DETALHE DO JOB ====================
  app.get('/jobs/:id', { preHandler: dashboardAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await findJob(id);

    if (!found) {
      return reply.code(404).type('text/html').send('<h1>Job nao encontrado</h1>');
    }

    const job = found.job;

    const state = await job.getState();
    const result = job.returnvalue as Record<string, unknown> | null;
    const data = job.data;
    const progress = job.progress as Record<string, unknown> | null;
    const durationSec = result?.duration ? Math.round(Number(result.duration) / 1000) : 0;
    const duration = !durationSec ? '—' : durationSec >= 60 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : `${durationSec}s`;
    const finishedAt = job.finishedOn ? new Date(job.finishedOn).toLocaleString('pt-BR') : '—';
    const createdAt = job.timestamp ? new Date(job.timestamp).toLocaleString('pt-BR') : '—';
    const stepLabel = STEP_LABEL[String(progress?.step ?? '')] ?? String(progress?.step ?? '—');

    const statusColor: Record<string, string> = {
      completed: '#2ecc71', active: '#3498db', failed: '#e74c3c',
      delayed: '#f39c12', waiting: '#95a5a6', prioritized: '#9b59b6',
    };
    const resultColor: Record<string, string> = {
      pr_created: '#2ecc71', branch_only: '#f39c12', dry_run: '#3498db',
      analyzed: '#3498db', failed: '#e74c3c',
    };

    const badge = (color: string, text: string) =>
      `<span class="badge" style="background:${color}">${text}</span>`;

    const summary = String(result?.summary ?? job.failedReason ?? 'Em andamento...');
    const summaryHtml = renderMarkdown(summary);
    const isActive = state === 'active';
    const logId = id;
    const logFile = getLogPath(data.projectId, logId);
    const hasLogs = fs.existsSync(logFile);

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Job #${id} — ${data.ticketId ?? 'N/A'}</title>
  <style>
    ${PAGE_STYLE}
    ${isActive ? '.card { border-left: 4px solid #3498db; }' : ''}
    #log-container {
      background: #1e1e2e; color: #cdd6f4; font-family: 'Fira Code', 'Cascadia Code', monospace;
      font-size: 12px; line-height: 1.6; padding: 16px; border-radius: 6px;
      max-height: 600px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
    }
    #log-container .ts { color: #6c7086; }
    #log-container .system { color: #89b4fa; }
    #log-container .assistant { color: #a6e3a1; }
    #log-container .tool { color: #f9e2af; }
    #log-container .result { color: #94e2d5; }
    #log-container .stderr { color: #f38ba8; }
    #log-container .cost { color: #fab387; }
    .tab-bar { display: flex; gap: 0; margin-bottom: -1px; position: relative; z-index: 1; }
    .tab { padding: 8px 20px; cursor: pointer; border: 1px solid #ddd; border-bottom: none;
      border-radius: 6px 6px 0 0; background: #f5f5f5; font-size: 13px; color: #666; }
    .tab.active { background: #fff; color: #333; font-weight: 500; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .log-status { font-size: 12px; color: #888; margin-top: 8px; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="nav" style="display:flex;justify-content:space-between;align-items:center">
    <a href="/jobs">&larr; Voltar ao painel</a>
    ${state !== 'completed' && state !== 'failed' ? `<form method="post" action="/jobs/${id}/cancel" style="margin:0" onsubmit="return confirm('Cancelar este job?')"><button type="submit" style="padding:4px 12px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">Cancelar</button></form>` : ''}
  </div>
  <div class="card">
    <div class="header">
      <h1>Job #${id}</h1>
      <span id="status-badges">
        ${badge(statusColor[state] ?? '#999', STATUS_LABEL[state] ?? state.toUpperCase())}
        ${result?.status ? badge(resultColor[String(result.status)] ?? '#999', RESULT_LABEL[String(result.status)] ?? String(result.status).toUpperCase()) : ''}
      </span>
    </div>
    <div id="status-grid" class="grid">
      <div class="grid-item"><label>Chamado</label><p>${data.ticketId ? `<a href="${data.ticketLink}" target="_blank">${data.ticketId}</a>` : '—'}</p></div>
      <div class="grid-item"><label>Projeto</label><p>${data.projectId}</p></div>
      <div class="grid-item"><label>Etapa</label><p>${stepLabel}</p></div>
      <div class="grid-item"><label>Duracao</label><p id="duration">${isActive ? '00:00:00' : duration}</p></div>
      <div class="grid-item"><label>Criado em</label><p>${createdAt}</p></div>
      <div class="grid-item"><label>Finalizado em</label><p>${finishedAt}</p></div>
      ${result?.branch ? `<div class="grid-item"><label>Branch</label><p><code>${result.branch}</code></p></div>` : ''}
      ${result?.prUrl ? `<div class="grid-item"><label>Pull Request</label><p><a href="${result.prUrl}" target="_blank">PR #${result.prNumber}</a></p></div>` : ''}
      ${result?.filesChanged ? `<div class="grid-item"><label>Arquivos Alterados</label><p>${result.filesChanged}</p></div>` : ''}
    </div>
  </div>
  <div class="card" style="padding-bottom:8px">
    <div class="tab-bar">
      <div class="tab active" data-tab="summary" onclick="switchTab('summary')">Resumo</div>
      <div class="tab" data-tab="logs" onclick="switchTab('logs')">Logs${hasLogs ? '' : ' (aguardando)'}</div>
    </div>
    <div id="tab-summary" class="tab-content active" style="padding-top:16px">
      <div style="background:#f8f9fa;border-left:3px solid #3498db;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:16px">
        <strong style="font-size:12px;color:#888;text-transform:uppercase">Chamado</strong>
        <p style="margin-top:4px;font-size:14px">${(data.context ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
      </div>
      <div class="summary">${summaryHtml}</div>
    </div>
    <div id="tab-logs" class="tab-content" style="padding-top:16px">
      <div id="log-container">Carregando logs...</div>
      <div class="log-status">
        <span id="log-size"></span>
        <span id="log-poll">${isActive ? 'Atualizando a cada 3s...' : ''}</span>
      </div>
    </div>
  </div>
<script>
let currentTab = localStorage.getItem('job-tab-${id}') || 'summary';

// Duration timer for active jobs
const jobCreatedAt = ${job.timestamp ?? 0};
if (${isActive} && jobCreatedAt) {
  const durationEl = document.getElementById('duration');
  function updateTimer() {
    const elapsed = Math.floor((Date.now() - jobCreatedAt) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    if (durationEl) durationEl.textContent = h + ':' + m + ':' + s;
  }
  updateTimer();
  setInterval(updateTimer, 1000);
}

function switchTab(tab) {
  currentTab = tab;
  localStorage.setItem('job-tab-${id}', tab);
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
  if (tab === 'logs' && !logsLoaded) fetchLogs();
}

// Restore tab on load
if (currentTab !== 'summary') switchTab(currentTab);

const jobId = '${id}';
let isActive = ${isActive};
let logOffset = 0;
let logsLoaded = false;

function colorize(text) {
  return text.replace(/^(\\[.*?\\]) (.*)/gm, (match, ts, rest) => {
    let cls = '';
    if (rest.startsWith('[SISTEMA]')) cls = 'system';
    else if (rest.startsWith('[ASSISTENTE]')) cls = 'assistant';
    else if (rest.startsWith('[FERRAMENTA]')) cls = 'tool';
    else if (rest.startsWith('[RESULTADO]')) cls = 'result';
    else if (rest.startsWith('[STDERR]')) cls = 'stderr';
    else if (rest.startsWith('[CUSTO]') || rest.startsWith('[DURACAO]') || rest.startsWith('[SESSAO]')) cls = 'cost';
    else if (rest.startsWith('[RESUMO]')) cls = 'assistant';
    return '<span class="ts">' + ts + '</span> ' + (cls ? '<span class="' + cls + '">' + rest + '</span>' : rest);
  });
}

async function fetchLogs() {
  try {
    const res = await fetch('/jobs/' + jobId + '/logs?offset=' + logOffset);
    const data = await res.json();
    const container = document.getElementById('log-container');

    if (data.content) {
      if (!logsLoaded) container.innerHTML = '';
      container.innerHTML += colorize(data.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
      logOffset = data.size;
      container.scrollTop = container.scrollHeight;
      logsLoaded = true;
    } else if (!logsLoaded) {
      container.innerHTML = 'Nenhum log disponivel ainda...';
    }

    document.getElementById('log-size').textContent = data.size ? (data.size / 1024).toFixed(1) + ' KB' : '';

    if (isActive) {
      setTimeout(fetchLogs, 3000);
    }
  } catch (e) {
    if (isActive) setTimeout(fetchLogs, 5000);
  }
}

// Refresh job status via AJAX (no page reload)
async function refreshStatus() {
  if (!isActive) return;
  try {
    const res = await fetch('/jobs/' + jobId + '/status');
    const d = await res.json();
    // Update badges
    document.getElementById('status-badges').innerHTML = d.badgesHtml;
    // Update grid
    document.getElementById('status-grid').innerHTML = d.gridHtml;
    // Update summary
    document.getElementById('tab-summary').innerHTML = '<div class="summary">' + d.summaryHtml + '</div>';
    // Check if job finished
    if (d.state !== 'active') {
      isActive = false;
      document.querySelectorAll('.card').forEach(c => c.style.borderLeft = '');
      document.getElementById('log-poll').textContent = '';
    }
  } catch (e) {}
  if (isActive) setTimeout(refreshStatus, 5000);
}

// Load logs if tab is active (works for completed jobs too)
if (currentTab === 'logs') fetchLogs();

if (isActive) {
  setTimeout(refreshStatus, 5000);
}
</script>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  // AJAX status update (no page reload)
  app.get('/jobs/:id/status', { preHandler: dashboardAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await findJob(id);
    if (!found) return reply.code(404).send({});
    const job = found.job;

    const state = await job.getState();
    const result = job.returnvalue as Record<string, unknown> | null;
    const data = job.data;
    const progress = job.progress as Record<string, unknown> | null;
    const durationSec = result?.duration ? Math.round(Number(result.duration) / 1000) : 0;
    const duration = !durationSec ? '—' : durationSec >= 60 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : `${durationSec}s`;
    const finishedAt = job.finishedOn ? new Date(job.finishedOn).toLocaleString('pt-BR') : '—';
    const createdAt = job.timestamp ? new Date(job.timestamp).toLocaleString('pt-BR') : '—';
    const stepLabel = STEP_LABEL[String(progress?.step ?? '')] ?? String(progress?.step ?? '—');

    const statusColor: Record<string, string> = {
      completed: '#2ecc71', active: '#3498db', failed: '#e74c3c',
      delayed: '#f39c12', waiting: '#95a5a6', prioritized: '#9b59b6',
    };
    const resultColor: Record<string, string> = {
      pr_created: '#2ecc71', branch_only: '#f39c12', dry_run: '#3498db',
      analyzed: '#3498db', failed: '#e74c3c',
    };

    const badge = (color: string, text: string) =>
      `<span class="badge" style="background:${color}">${text}</span>`;

    const badgesHtml = [
      badge(statusColor[state] ?? '#999', STATUS_LABEL[state] ?? state.toUpperCase()),
      result?.status ? badge(resultColor[String(result.status)] ?? '#999', RESULT_LABEL[String(result.status)] ?? String(result.status).toUpperCase()) : '',
    ].join(' ');

    const gridHtml = [
      `<div class="grid-item"><label>Chamado</label><p>${data.ticketId ? `<a href="${data.ticketLink}" target="_blank">${data.ticketId}</a>` : '—'}</p></div>`,
      `<div class="grid-item"><label>Projeto</label><p>${data.projectId}</p></div>`,
      `<div class="grid-item"><label>Etapa</label><p>${stepLabel}</p></div>`,
      `<div class="grid-item"><label>Duracao</label><p>${duration}</p></div>`,
      `<div class="grid-item"><label>Criado em</label><p>${createdAt}</p></div>`,
      `<div class="grid-item"><label>Finalizado em</label><p>${finishedAt}</p></div>`,
      result?.branch ? `<div class="grid-item"><label>Branch</label><p><code>${result.branch}</code></p></div>` : '',
      result?.prUrl ? `<div class="grid-item"><label>Pull Request</label><p><a href="${result.prUrl}" target="_blank">PR #${result.prNumber}</a></p></div>` : '',
      result?.filesChanged ? `<div class="grid-item"><label>Arquivos Alterados</label><p>${result.filesChanged}</p></div>` : '',
    ].filter(Boolean).join('');

    const summary = String(result?.summary ?? job.failedReason ?? 'Em andamento...');
    const summaryHtml = renderMarkdown(summary);

    return reply.send({ state, badgesHtml, gridHtml, summaryHtml });
  });

  // Cancel job (POST from form, GET from direct URL)
  const cancelHandler = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const found = await findJob(id);
    if (!found) return reply.code(404).send({ error: 'Job nao encontrado' });

    const job = found.job;
    const state = await job.getState();

    if (state === 'completed' || state === 'failed') {
      return reply.redirect(`/jobs/${id}`);
    }

    try {
      if (state === 'active') {
        await job.moveToFailed(new Error('Cancelado pelo usuario'), 'cancel', true);
      } else {
        await job.remove();
      }
    } catch {
      // If moveToFailed fails, try discard
      try { await job.discard(); } catch { /* ignore */ }
      try { await job.remove(); } catch { /* ignore */ }
    }

    return reply.redirect('/jobs');
  };
  app.post('/jobs/:id/cancel', { preHandler: dashboardAuth }, cancelHandler);
  app.get('/jobs/:id/cancel', { preHandler: dashboardAuth }, cancelHandler);

  // Redirect old summary URL
  app.get('/api/jobs/:id/summary', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.redirect(`/jobs/${id}`);
  });
}
