export interface DiffBudgetResult {
  diff: string;
  originalChars: number;
  usedChars: number;
  truncated: boolean;
}

function splitDiffSections(diff: string): string[] {
  const lines = diff.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      sections.push(current.join('\n'));
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    sections.push(current.join('\n'));
  }
  return sections;
}

export function applyDiffBudget(diff: string, maxChars: number): DiffBudgetResult {
  const originalChars = diff.length;
  if (originalChars <= maxChars) {
    return {
      diff,
      originalChars,
      usedChars: originalChars,
      truncated: false
    };
  }

  if (maxChars <= 0) {
    return {
      diff: '',
      originalChars,
      usedChars: 0,
      truncated: true
    };
  }

  const sections = splitDiffSections(diff);
  let result = '';

  for (const section of sections) {
    if (result.length >= maxChars) {
      break;
    }

    const next = result ? `${result}\n${section}` : section;
    if (next.length <= maxChars) {
      result = next;
      continue;
    }

    const remain = maxChars - result.length;
    if (remain > 0) {
      const truncatedChunk = section.slice(0, remain);
      result = result ? `${result}\n${truncatedChunk}` : truncatedChunk;
    }
    break;
  }

  if (!result) {
    result = diff.slice(0, maxChars);
  }

  return {
    diff: result,
    originalChars,
    usedChars: result.length,
    truncated: true
  };
}
