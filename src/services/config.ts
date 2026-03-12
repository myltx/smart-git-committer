import * as vscode from 'vscode';

export type CommitMessageStyle = 'title' | 'title+body';
export type CommitLanguageMode = 'auto' | 'zh' | 'en';

export interface SmartGitCommitterConfig {
  baseURL: string;
  model: string;
  recentCommitCount: number;
  autoStageUntracked: boolean;
  messageStyle: CommitMessageStyle;
  languageMode: CommitLanguageMode;
  promptTemplate: string;
  apiKeyFromSettings?: string;
}

function normalizeMessageStyle(value: string | undefined): CommitMessageStyle {
  return value === 'title+body' ? 'title+body' : 'title';
}

function normalizeLanguageMode(value: string | undefined): CommitLanguageMode {
  if (value === 'zh' || value === 'en') {
    return value;
  }
  return 'auto';
}

export function getConfig(): SmartGitCommitterConfig {
  const config = vscode.workspace.getConfiguration('smartGitCommitter');
  const baseURL = (config.get<string>('baseURL') ?? 'https://api.moleapi.com').trim();
  const model = (config.get<string>('model') ?? 'gpt-4o-mini').trim();
  const recentCommitCount = Math.min(Math.max(config.get<number>('recentCommitCount') ?? 3, 1), 10);
  const autoStageUntracked = config.get<boolean>('autoStageUntracked') ?? false;
  const messageStyle = normalizeMessageStyle(config.get<string>('messageStyle'));
  const languageMode = normalizeLanguageMode(config.get<string>('languageMode'));
  const promptTemplate = config.get<string>('promptTemplate') ?? '';
  const apiKeyFromSettings = (config.get<string>('apiKey') ?? '').trim() || undefined;

  return {
    baseURL,
    model,
    recentCommitCount,
    autoStageUntracked,
    messageStyle,
    languageMode,
    promptTemplate,
    apiKeyFromSettings
  };
}
