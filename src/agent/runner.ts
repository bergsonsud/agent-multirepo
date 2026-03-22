import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';
import type { ProjectConfig } from '../config/schema.js';
import { childLogger } from '../logger.js';

const log = childLogger('claude-runner');

export interface ClaudeRunResult {
  exitCode: number;
  resultText: string;
  costUsd?: number;
  sessionId?: string;
  logPath: string;
}

function ensureLogsDir(projectId: string): string {
  const dir = path.resolve(env.REPORTS_DIR, projectId, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogPath(projectId: string, jobId: string): string {
  return path.resolve(env.REPORTS_DIR, projectId, 'logs', `${jobId}.log`);
}

export async function runClaude(
  prompt: string,
  workingDir: string,
  config: ProjectConfig,
  systemAppend: string,
  projectId: string,
  jobId: string,
  timeoutMs?: number,
): Promise<ClaudeRunResult> {
  const logsDir = ensureLogsDir(projectId);
  const logPath = path.join(logsDir, `${jobId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const ts = () => new Date().toISOString();
  const writeLine = (line: string) => {
    logStream.write(`[${ts()}] ${line}\n`);
  };

  const args: string[] = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', config.claude.model,
  ];

  if (config.claude.permissionMode) {
    args.push('--permission-mode', config.claude.permissionMode);
  }

  if (config.claude.maxBudgetUsd) {
    args.push('--max-budget-usd', String(config.claude.maxBudgetUsd));
  }

  if (config.claude.allowedTools?.length) {
    args.push('--allowedTools', config.claude.allowedTools.join(','));
  }

  if (config.claude.disallowedTools?.length) {
    args.push('--disallowedTools', config.claude.disallowedTools.join(','));
  }

  if (systemAppend) {
    args.push('--append-system-prompt', systemAppend);
  }

  writeLine(`=== Inicio do processo Claude ===`);
  writeLine(`Modelo: ${config.claude.model}`);
  writeLine(`Diretorio: ${workingDir}`);
  writeLine(`Projeto: ${projectId} | Job: ${jobId}`);
  writeLine(`---`);

  log.info({ workingDir, model: config.claude.model }, 'Starting claude process');

  return new Promise<ClaudeRunResult>((resolve, reject) => {
    const childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY;

    const child = spawn(env.CLAUDE_BIN, args, {
      cwd: workingDir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let killed = false;
    let lineBuffer = '';

    // Collect assistant text blocks and result event
    const assistantTexts: string[] = [];
    let resultEvent: { result?: string; cost_usd?: number; session_id?: string } | null = null;

    const timeout = setTimeout(() => {
      killed = true;
      writeLine(`[TIMEOUT] Processo encerrado por timeout`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs ?? config.timeoutMinutes * 60 * 1000);

    function processLine(raw: string) {
      const trimmed = raw.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        formatLogEvent(event, writeLine);

        if (event.type === 'result') {
          resultEvent = event as typeof resultEvent;
        }

        // Extract text from assistant messages
        if (event.type === 'assistant') {
          const msg = event.message as { content?: Array<{ type: string; text?: string }> } | undefined;
          if (msg?.content) {
            for (const block of msg.content) {
              if (block.type === 'text' && block.text) {
                assistantTexts.push(block.text);
              }
            }
          }
        }
      } catch {
        writeLine(trimmed);
      }
    }

    child.stdout.on('data', (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      // Keep the last incomplete line in the buffer
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) writeLine(`[STDERR] ${line.trim()}`);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);

      // Process remaining buffer
      if (lineBuffer.trim()) processLine(lineBuffer);

      writeLine(`---`);
      writeLine(`=== Processo finalizado | exit code: ${code} ===`);
      logStream.end();

      if (killed) {
        reject(new Error('Claude process timed out'));
        return;
      }

      // Extract the final text result
      // Priority: result event > last assistant text
      const resultText = resultEvent?.result
        ?? assistantTexts[assistantTexts.length - 1]
        ?? '';

      log.info({ exitCode: code, resultLen: resultText.length }, 'Claude process finished');

      resolve({
        exitCode: code ?? 1,
        resultText,
        costUsd: resultEvent?.cost_usd,
        sessionId: resultEvent?.session_id as string | undefined,
        logPath,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      writeLine(`[ERRO] ${err.message}`);
      logStream.end();
      reject(err);
    });
  });
}

function formatLogEvent(event: Record<string, unknown>, writeLine: (line: string) => void): void {
  const type = event.type as string;

  switch (type) {
    case 'system': {
      writeLine(`[SISTEMA] ${(event as { message?: string }).message ?? ''}`);
      break;
    }
    case 'assistant': {
      const msg = event.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } | undefined;
      if (msg?.content) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            writeLine(`[ASSISTENTE] ${block.text}`);
          } else if (block.type === 'tool_use') {
            const input = typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? '').slice(0, 300);
            writeLine(`[FERRAMENTA] ${block.name}(${input})`);
          }
        }
      }
      break;
    }
    case 'tool': {
      const content = String((event as { content?: string }).content ?? '').slice(0, 500);
      writeLine(`[RESULTADO] ${content}${content.length >= 500 ? '...' : ''}`);
      break;
    }
    case 'result': {
      const result = event as { cost_usd?: number; duration_ms?: number; session_id?: string; result?: string };
      writeLine(`---`);
      if (result.cost_usd) writeLine(`[CUSTO] $${result.cost_usd.toFixed(4)}`);
      if (result.duration_ms) writeLine(`[DURACAO] ${Math.round(result.duration_ms / 1000)}s`);
      if (result.session_id) writeLine(`[SESSAO] ${result.session_id}`);
      if (result.result) writeLine(`[RESUMO] ${result.result.slice(0, 1000)}`);
      break;
    }
    default: {
      writeLine(`[${type?.toUpperCase() ?? 'EVENT'}] ${JSON.stringify(event).slice(0, 500)}`);
    }
  }
}
