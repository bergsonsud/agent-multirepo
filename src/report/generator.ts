import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';
import type { ProjectConfig } from '../config/schema.js';

export interface ReportData {
  ticketId?: string;
  ticketLink: string;
  branch: string;
  repoUrl: string;
  summary: string;
  diffStat: string;
  error?: string;
  prBody?: string;
  testOutput?: string;
}

export function generateReport(data: ReportData, config: ProjectConfig): string {
  const lines = [
    `# Relatorio de Implementacao: ${data.ticketId ?? 'N/A'}`,
    '',
    `**Chamado**: [${data.ticketId ?? 'Link'}](${data.ticketLink})`,
    `**Branch**: \`${data.branch}\``,
    `**Repositorio**: ${data.repoUrl}`,
    `**Data**: ${new Date().toISOString()}`,
    `**Status**: Branch enviada, criacao do PR falhou`,
    '',
  ];

  if (data.error) {
    lines.push('## Detalhes do Erro', '', '```', data.error, '```', '');
  }

  lines.push('## Resumo das Mudancas', '', data.summary, '');

  if (data.diffStat) {
    lines.push('## Arquivos Alterados', '', '```', data.diffStat, '```', '');
  }

  lines.push(
    '## Passos Manuais Necessarios',
    '',
    '1. Navegue ate o repositorio',
    `2. Crie um pull request de \`${data.branch}\` para \`${config.defaultBranch}\``,
    '3. Revise as mudancas',
  );

  if (data.prBody) {
    lines.push('', '### Corpo do PR Preparado', '', '---', data.prBody, '---');
  }

  if (data.testOutput) {
    lines.push('', '## Resultado dos Testes', '', '```', data.testOutput, '```');
  }

  return lines.join('\n');
}

export function saveReport(projectId: string, jobId: string, content: string): string {
  const dir = path.resolve(env.REPORTS_DIR, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${jobId}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}
