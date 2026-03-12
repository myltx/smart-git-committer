import type { CommitMessageStyle } from '../services/config';

export const CONVENTIONAL_COMMIT_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:\s.+$/;

function stripMarkdownFence(text: string): string {
  const fenced = text.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/);
  if (!fenced?.[1]) {
    return text;
  }
  return fenced[1].trim();
}

export function normalizeCommitMessage(raw: string, messageStyle: CommitMessageStyle): string {
  let text = stripMarkdownFence(raw.trim());

  text = text.replace(/^提交信息[:：]\s*/i, '').trim();
  text = text.replace(/^"|"$/g, '').trim();
  text = text.replace(/\r\n/g, '\n');

  const lines = text.split('\n').map((line) => line.trimEnd());
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmptyIndex < 0) {
    return '';
  }

  const title = lines[firstNonEmptyIndex].trim();
  if (messageStyle === 'title') {
    return title;
  }

  const bodyLines = lines
    .slice(firstNonEmptyIndex + 1)
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  if (!bodyLines) {
    return title;
  }

  return `${title}\n\n${bodyLines}`;
}

export function isConventionalCommit(message: string, messageStyle: CommitMessageStyle): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }

  const lines = normalized.split(/\r?\n/);
  const title = lines[0]?.trim() ?? '';

  if (!CONVENTIONAL_COMMIT_REGEX.test(title)) {
    return false;
  }

  if (messageStyle === 'title') {
    const hasBody = lines.slice(1).some((line) => line.trim().length > 0);
    return !hasBody;
  }

  return true;
}
