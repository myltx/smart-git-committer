import type { CommitLanguageMode } from './config';
import type { RecentCommit } from './git';

export type OutputLanguage = 'zh' | 'en';

export interface CommitStyleProfile {
  preferredTypes: string[];
  preferredScopes: string[];
  detectedLanguage: OutputLanguage;
}

const HEADER_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(([^)]+)\))?!?:\s+(.+)$/i;

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function hasEnglish(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

function topKeys(map: Map<string, number>, limit: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map((item) => item[0]);
}

export function analyzeRecentCommitStyle(recentCommits: RecentCommit[]): CommitStyleProfile {
  const typeCounter = new Map<string, number>();
  const scopeCounter = new Map<string, number>();
  let zhCount = 0;
  let enCount = 0;

  for (const commit of recentCommits) {
    const message = commit.message.trim();
    if (!message) {
      continue;
    }

    if (hasChinese(message)) {
      zhCount += 1;
    }
    if (hasEnglish(message)) {
      enCount += 1;
    }

    const parsed = message.match(HEADER_REGEX);
    if (!parsed) {
      continue;
    }

    const type = parsed[1].toLowerCase();
    typeCounter.set(type, (typeCounter.get(type) ?? 0) + 1);

    const scope = parsed[3]?.trim();
    if (scope) {
      scopeCounter.set(scope, (scopeCounter.get(scope) ?? 0) + 1);
    }
  }

  const detectedLanguage: OutputLanguage = zhCount >= enCount ? 'zh' : 'en';

  return {
    preferredTypes: topKeys(typeCounter, 3),
    preferredScopes: topKeys(scopeCounter, 3),
    detectedLanguage
  };
}

export function resolveOutputLanguage(
  languageMode: CommitLanguageMode,
  styleProfile: CommitStyleProfile
): OutputLanguage {
  if (languageMode === 'zh' || languageMode === 'en') {
    return languageMode;
  }
  return styleProfile.detectedLanguage;
}
