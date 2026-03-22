import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';
import type { ProjectConfig } from '../config/schema.js';
import type { TicketJobPayload } from '../types/index.js';

const SYSTEM_APPEND = `Voce esta atuando como um desenvolvedor senior. Nunca revele que voce e uma IA ou ferramenta automatizada. Nao mencione Claude, assistentes de IA ou automacao em nenhum output, comentario, mensagem de commit ou documentacao. Escreva todos os comentarios e mensagens como um desenvolvedor humano escreveria. Sempre responda e escreva resumos em portugues (pt-BR).`;

export function loadAgentMd(config: ProjectConfig, workspacePath: string): string {
  if (config.claude.agentMdPath) {
    const resolved = path.resolve(workspacePath, config.claude.agentMdPath);
    if (fs.existsSync(resolved)) {
      return fs.readFileSync(resolved, 'utf-8');
    }
  }

  const defaultPath = path.resolve(env.AGENTS_DIR, 'default.md');
  if (fs.existsSync(defaultPath)) {
    return fs.readFileSync(defaultPath, 'utf-8');
  }

  return '';
}

export function buildPrompt(payload: TicketJobPayload, config: ProjectConfig, workspacePath: string): string {
  const agentMd = loadAgentMd(config, workspacePath);
  const dryRunInstruction = payload.dryRun
    ? '\n\n**IMPORTANTE: Isto e um DRY RUN. Analise o codebase e produza um plano de implementacao detalhado. NAO faca nenhuma alteracao nos arquivos. Apenas apresente sua analise e abordagem proposta.**'
    : '';

  return `${agentMd}

---

## Tarefa

Voce recebeu o seguinte chamado de suporte de um usuario final. O usuario pode nao usar termos tecnicos.

**Chamado**: ${payload.ticketId || 'N/A'}
${payload.ticketLink ? `**Link**: ${payload.ticketLink}` : ''}

### Relato do usuario

${payload.context}
${dryRunInstruction}

---

## ANTES DE IMPLEMENTAR — Avaliacao de Complexidade

Antes de qualquer mudanca, avalie se este chamado e uma correcao/ajuste simples ou um pedido complexo.

E COMPLEXO se:
- Pede um modulo/sistema novo (login, admin, relatorios, emails, integracoes)
- Precisa de mais de 5 arquivos novos
- Precisa de integracao com sistema externo
- Pede uma funcionalidade que nao existe no projeto

E SIMPLES se:
- Correcao de bug existente
- Adicionar validacao
- Ajuste visual ou de texto
- Ordenacao, mascara, confirmacao
- Mudanca em poucos arquivos existentes

### Se for COMPLEXO:
NAO implemente nada. NAO altere nenhum arquivo. Apenas retorne:

**Complexidade:** COMPLEXO
**Motivo:** [por que nao pode ser feito como correcao simples]
**Resposta ao cliente:** [texto curto (2-4 frases) explicando que o pedido foi recebido, que precisa de uma analise mais detalhada por envolver mudancas maiores no sistema, e que a equipe tecnica vai avaliar. Linguagem simples, SEM termos tecnicos.]

### Se for SIMPLES:
Implemente normalmente seguindo as instrucoes abaixo.

## Instrucoes (apenas para chamados SIMPLES)

1. Interprete o relato do usuario e identifique o problema tecnico no codebase.
2. Analise o codigo para encontrar a causa raiz.
3. Implemente a correcao seguindo os padroes do projeto.
4. Escreva ou atualize testes para a correcao.
5. Revise seu codigo: verifique edge cases, validacoes e consistencia.
6. Garanta que suas mudancas estejam completas e nao deixe comentarios TODO.

## Resumo final OBRIGATORIO

Voce DEVE escrever o resumo EXATAMENTE neste formato. Todos os campos sao obrigatorios:

**Titulo:** Adicionar validacao de unicidade em Vaccine
**Diagnostico:** O modelo Vaccine nao possuia validacao de unicidade.
**Solucao:** Adicionada validacao validates_uniqueness_of no modelo.
**Resposta ao cliente:** Corrigimos o problema. Agora o sistema nao permite cadastrar vacinas com nomes repetidos.

Regras:
- **Titulo**: maximo 50 caracteres, tecnico e curto. Descreva O QUE foi feito, nao o problema.
- **Diagnostico**: o que foi identificado.
- **Solucao**: o que foi feito.
- **Resposta ao cliente**: 2-4 frases simples, sem termos tecnicos.

## Restricoes

- NAO mencione nenhuma ferramenta de IA, assistente ou sistema automatizado em comentarios de codigo, mensagens de commit ou documentacao.
- Escreva mensagens de commit como um desenvolvedor senior escreveria.
- Sempre escreva em portugues (pt-BR).
`.trim();
}

export function buildTriagePrompt(payload: TicketJobPayload, config: ProjectConfig, workspacePath: string): string {
  const agentMd = loadAgentMd(config, workspacePath);

  return `${agentMd}

---

## Triagem e Estudo Tecnico

Voce e um arquiteto de software senior. Analise o chamado abaixo e classifique.

**Chamado**: ${payload.ticketId || 'N/A'}
${payload.ticketLink ? `**Link**: ${payload.ticketLink}` : ''}

### Descricao

${payload.context}

---

## Instrucoes

1. Analise o codebase: estrutura, models, controllers, views, rotas, testes, gems.
2. Classifique o chamado em uma das 3 categorias.
3. Responda OBRIGATORIAMENTE no formato JSON abaixo.

## Categorias

- **simples**: ajuste localizado, adicionar gem, paginacao, validacao, poucos arquivos. PODE ser implementado diretamente.
- **complexo**: modulo/sistema novo (login, admin, emails, API REST), integracao externa, 3+ migrations, 8+ arquivos novos. NAO pode ser implementado diretamente.
- **investigacao**: pergunta sobre arquitetura, auditoria de seguranca, analise de qualidade, duvida tecnica. NAO precisa implementar nada, apenas responder.

## Formato de Resposta (JSON obrigatorio)

Responda APENAS com um JSON valido, sem texto antes ou depois:

{
  "titulo": "Titulo curto e tecnico, maximo 50 caracteres. Ex: Implementar sistema de autenticacao, Auditoria de seguranca do projeto",
  "complexidade": "simples" ou "complexo" ou "investigacao",
  "justificativa": "Explicacao breve",
  "estimativa_arquivos": 5,
  "estimativa_migrations": 0,
  "riscos": ["risco 1"],
  "proposta": "Proposta tecnica detalhada da implementacao ou resultado da investigacao.",
  "resposta_solicitante": "Texto curto (3-5 frases) para responder quem pediu. Linguagem simples, SEM termos tecnicos, SEM nomes de arquivos ou libs.",
  "subtarefas": [
    {
      "titulo": "Titulo da subtarefa",
      "descricao": "O que precisa ser feito, quais arquivos criar/alterar",
      "arquivos_impactados": ["caminho/arquivo.rb"],
      "prioridade": "alta" ou "media" ou "baixa"
    }
  ]
}

## Restricoes

- Responda SOMENTE com o JSON, sem markdown, sem texto adicional.
- Sempre em portugues (pt-BR).
`.trim();
}

export function getSystemAppend(config: ProjectConfig): string {
  const parts = [SYSTEM_APPEND];
  if (config.claude.appendSystemPrompt) {
    parts.push(config.claude.appendSystemPrompt);
  }
  return parts.join('\n\n');
}
