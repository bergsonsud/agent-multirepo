import { env } from '../env.js';
import type { ProjectConfig } from '../config/schema.js';
import { childLogger } from '../logger.js';

const log = childLogger('discord');

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
}

type NotifyEvent =
  | 'job_started'
  | 'triage_complex'
  | 'implementation_start'
  | 'implementation_done'
  | 'tests_passed'
  | 'tests_failed'
  | 'pr_created'
  | 'pr_failed'
  | 'job_failed';

function getWebhookUrl(config: ProjectConfig): string | undefined {
  return config.discord.webhookUrl ?? env.DISCORD_WEBHOOK_URL;
}

function shouldNotify(config: ProjectConfig, event: NotifyEvent): boolean {
  const url = getWebhookUrl(config);
  if (!url) return false;
  return config.discord.notifyOn.includes(event);
}

async function send(webhookUrl: string, content: string, embeds?: DiscordEmbed[]): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds }),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'Discord webhook falhou');
    }
  } catch (err) {
    log.warn({ err }, 'Falha ao enviar notificacao Discord');
  }
}

export async function notifyJobStarted(
  config: ProjectConfig,
  jobId: string,
  ticketId: string | undefined,
  ticketLink: string,
): Promise<void> {
  if (!shouldNotify(config, 'job_started')) return;
  const url = getWebhookUrl(config)!;

  await send(url, '', [{
    title: `Job Iniciado: ${ticketId ?? 'N/A'}`,
    description: `Processando chamado [${ticketId ?? 'link'}](${ticketLink})`,
    color: 0x3498db,
    fields: [
      { name: 'Projeto', value: config.name, inline: true },
      { name: 'Job ID', value: jobId, inline: true },
    ],
    timestamp: new Date().toISOString(),
  }]);
}

export async function notifyImplementationStart(
  config: ProjectConfig,
  jobId: string,
  ticketId: string | undefined,
  ticketLink: string,
): Promise<void> {
  if (!shouldNotify(config, 'implementation_start')) return;
  const url = getWebhookUrl(config)!;

  await send(url, '', [{
    title: `Implementando: ${ticketId ?? 'N/A'}`,
    description: `Iniciando implementacao do chamado [${ticketId ?? 'link'}](${ticketLink})`,
    color: 0x9b59b6,
    fields: [
      { name: 'Projeto', value: config.name, inline: true },
      { name: 'Job ID', value: jobId, inline: true },
    ],
    timestamp: new Date().toISOString(),
  }]);
}

export async function notifyImplementationDone(
  config: ProjectConfig,
  jobId: string,
  ticketId: string | undefined,
  summary: string,
  filesChanged: number,
): Promise<void> {
  if (!shouldNotify(config, 'implementation_done')) return;
  const url = getWebhookUrl(config)!;

  await send(url, '', [{
    title: `Implementacao concluida: ${ticketId ?? 'N/A'}`,
    description: summary.slice(0, 1500),
    color: 0x8e44ad,
    fields: [
      { name: 'Projeto', value: config.name, inline: true },
      { name: 'Arquivos alterados', value: String(filesChanged), inline: true },
    ],
    timestamp: new Date().toISOString(),
  }]);
}

export async function notifyTriageComplex(
  config: ProjectConfig,
  jobId: string,
  ticketId: string | undefined,
  justificativa: string,
): Promise<void> {
  if (!shouldNotify(config, 'triage_complex')) return;
  const url = getWebhookUrl(config)!;

  await send(url, '', [{
    title: `Triagem Concluida: ${ticketId ?? 'N/A'}`,
    description: `Classificado como **complexo**. ${justificativa.slice(0, 500)}`,
    color: 0xe67e22,
    fields: [
      { name: 'Projeto', value: config.name, inline: true },
      { name: 'Job ID', value: jobId, inline: true },
    ],
    timestamp: new Date().toISOString(),
  }]);
}

export async function notifyPRCreated(
  config: ProjectConfig,
  prUrl: string,
  branch: string,
  summary: string,
  ticketId?: string,
): Promise<void> {
  if (!shouldNotify(config, 'pr_created')) return;
  const url = getWebhookUrl(config)!;

  await send(url, '', [{
    title: `PR Criado: ${ticketId ?? branch}`,
    description: summary.slice(0, 2000),
    color: 0x2ecc71,
    fields: [
      { name: 'Projeto', value: config.name, inline: true },
      { name: 'Branch', value: `\`${branch}\``, inline: true },
      { name: 'PR', value: prUrl },
    ],
    timestamp: new Date().toISOString(),
  }]);
}

export async function notifyPRFailed(
  config: ProjectConfig,
  branch: string,
  error: string,
  report: string,
  ticketId?: string,
): Promise<void> {
  if (!shouldNotify(config, 'pr_failed')) return;
  const url = getWebhookUrl(config)!;

  const description = [
    `Branch \`${branch}\` foi enviada mas a criacao do PR falhou.`,
    '',
    '**Erro:**',
    `\`\`\`${error.slice(0, 500)}\`\`\``,
    '',
    '**Passos manuais:**',
    `Crie um PR de \`${branch}\` para \`${config.defaultBranch}\``,
  ].join('\n');

  await send(url, '', [{
    title: `PR Falhou: ${ticketId ?? branch}`,
    description: description.slice(0, 2000),
    color: 0xf39c12,
    fields: [
      { name: 'Projeto', value: config.name, inline: true },
      { name: 'Branch', value: `\`${branch}\``, inline: true },
    ],
    timestamp: new Date().toISOString(),
  }]);

  if (report.length > 0 && report.length <= 1900) {
    await send(url, `\`\`\`md\n${report}\n\`\`\``);
  }
}

export async function notifyJobFailed(
  config: ProjectConfig,
  jobId: string,
  error: string,
  ticketId?: string,
): Promise<void> {
  if (!shouldNotify(config, 'job_failed')) return;
  const url = getWebhookUrl(config)!;

  await send(url, '', [{
    title: `Job Falhou: ${ticketId ?? jobId}`,
    description: `\`\`\`${error.slice(0, 1500)}\`\`\``,
    color: 0xe74c3c,
    fields: [
      { name: 'Projeto', value: config.name, inline: true },
      { name: 'Job ID', value: jobId, inline: true },
    ],
    timestamp: new Date().toISOString(),
  }]);
}
