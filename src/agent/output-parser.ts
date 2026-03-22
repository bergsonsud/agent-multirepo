export function extractSummary(result: string, maxLength: number = 500): string {
  const junk = [/^tudo (correto|certo|pronto)/i, /^resumo final/i, /^pronto/i, /^aqui est[aá]/i, /^segue /i, /^---+$/];
  const lines = result.split('\n').filter(l => {
    const t = l.trim();
    return t && !junk.some(p => p.test(t));
  });
  const summary = lines.slice(-10).join('\n');
  return summary.length <= maxLength ? summary : summary.slice(0, maxLength) + '...';
}

export function extractTitle(resultText: string, context: string): string {
  // 1. Try **Titulo:** from Claude's response
  const match = resultText.match(/\*\*Titulo:\*\*\s*(.+)/i);
  if (match) {
    return match[1].trim().replace(/^\[|\]$/g, '').slice(0, 70);
  }

  // 2. Try **Diagnostico:** first sentence
  const diagMatch = resultText.match(/\*\*Diagn[oó]stico:\*\*\s*(.+)/i);
  if (diagMatch) {
    const firstSentence = diagMatch[1].split(/[.!]\s/)[0].trim();
    if (firstSentence.length > 10 && firstSentence.length <= 70) {
      return firstSentence;
    }
  }

  // 3. Generate from context: take first sentence, clean and truncate
  const firstSentence = context.split(/[.!?\n]/)[0].trim();
  if (firstSentence.length <= 50) return firstSentence;
  // Cut at last word boundary before 50 chars
  const cut = firstSentence.slice(0, 50);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
}

export function slugifyContext(context: string, maxLen: number = 60): string {
  return context
    .replace(/[^a-zA-Z0-9\u00C0-\u017F ]/g, '')
    .trim()
    .slice(0, maxLen);
}
