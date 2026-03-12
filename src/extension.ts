import * as vscode from 'vscode';

import { SettingsPanel } from './panel/settingsPanel';
import { generateCommitMessage } from './services/ai';
import { getConfig } from './services/config';
import { GitService } from './services/git';
import { promptAndStoreApiKey, resolveApiKey } from './services/secret';
import { applyDiffBudget } from './utils/diffBudget';
import { filterFilesByGlobs } from './utils/glob';

const GENERATE_COMMAND = 'smartGitCommitter.generateCommitMessage';
const SET_API_KEY_COMMAND = 'smartGitCommitter.setApiKey';
const CONFIGURE_COMMAND = 'smartGitCommitter.configure';

function createSettingsStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  item.name = 'Smart Git Committer 设置';
  item.text = '$(settings-gear) SGC 设置';
  item.tooltip = '打开 Smart Git Committer 配置面板';
  item.command = CONFIGURE_COMMAND;
  item.show();
  return item;
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

interface GitRepositoryLike {
  rootUri: vscode.Uri;
  inputBox: {
    value: string;
  };
}

interface GitApiLike {
  repositories: GitRepositoryLike[];
}

interface GitExtensionLike {
  enabled: boolean;
  getAPI(version: number): GitApiLike;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isSameOrParentPath(parent: string, child: string): boolean {
  const parentPath = normalizePath(parent);
  const childPath = normalizePath(child);
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

async function fillScmCommitInput(workspaceRoot: string, message: string): Promise<boolean> {
  let filled = false;

  try {
    vscode.scm.inputBox.value = message;
    filled = true;
  } catch {
    // no-op
  }

  const gitExtension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
  if (!gitExtension) {
    return filled;
  }

  const gitExports = gitExtension.isActive
    ? gitExtension.exports
    : ((await gitExtension.activate()) as GitExtensionLike);

  if (!gitExports.enabled) {
    return filled;
  }

  const gitApi = gitExports.getAPI(1);
  const repo =
    gitApi.repositories.find((item) => isSameOrParentPath(item.rootUri.fsPath, workspaceRoot)) ??
    gitApi.repositories.find((item) => isSameOrParentPath(workspaceRoot, item.rootUri.fsPath));

  if (!repo) {
    return filled;
  }

  repo.inputBox.value = message;
  return true;
}

async function runGenerate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('请先打开一个包含 Git 仓库的工作区。');
    return;
  }

  const config = getConfig();
  const apiKey = await resolveApiKey(context, config.apiKeyFromSettings);
  if (!apiKey) {
    vscode.window.showWarningMessage('未提供 API Key，已取消生成提交信息。');
    return;
  }

  try {
    const git = new GitService(workspaceRoot);
    if (!(await git.isRepo())) {
      vscode.window.showErrorMessage('当前工作区不是 Git 仓库。');
      return;
    }

    let diffSource: 'staged' | 'workingTree' = 'staged';
    let commitContextDiff = '';
    let autoStagedFiles: string[] = [];
    let filteredOutCount = 0;
    let gitIgnoredCount = 0;

    const applyGitIgnoreIfNeeded = async (files: string[]): Promise<string[]> => {
      if (!config.respectGitIgnore || files.length === 0) {
        return files;
      }
      const result = await git.filterIgnoredFiles(files);
      gitIgnoredCount += result.ignored.length;
      return result.included;
    };

    const stagedFiles = await git.getStagedChangedFiles();
    if (stagedFiles.length > 0) {
      const stagedFilterResult = filterFilesByGlobs(stagedFiles, config.includeGlobs, config.excludeGlobs);
      filteredOutCount += stagedFilterResult.excluded.length;
      const stagedIncludedFiles = await applyGitIgnoreIfNeeded(stagedFilterResult.included);
      if (stagedIncludedFiles.length === 0) {
        vscode.window.showInformationMessage(
          `暂存区共有 ${stagedFiles.length} 个变更文件，但都被过滤规则或 .gitignore 排除了。请调整规则后重试。`
        );
        return;
      }
      commitContextDiff = await git.getStagedDiffForFiles(stagedIncludedFiles);
    }

    if (!commitContextDiff.trim() && stagedFiles.length === 0) {
      const workingTreeFiles = await git.getWorkingTreeChangedFiles(config.autoStageUntracked);
      const workingTreeFilterResult = filterFilesByGlobs(
        workingTreeFiles,
        config.includeGlobs,
        config.excludeGlobs
      );
      filteredOutCount += workingTreeFilterResult.excluded.length;
      autoStagedFiles = await applyGitIgnoreIfNeeded(workingTreeFilterResult.included);
      if (autoStagedFiles.length === 0) {
        if (config.autoStageUntracked) {
          vscode.window.showInformationMessage(
            '未检测到可用于生成的信息：暂存区和工作区都没有可用变更，或全部被过滤规则/.gitignore 排除。'
          );
          return;
        }
        vscode.window.showInformationMessage(
          '暂存区为空，且未检测到可自动暂存的已跟踪改动（或已被过滤/.gitignore 排除）。若需包含新文件，请先 git add 或开启 autoStageUntracked。'
        );
        return;
      }

      await git.stageFiles(autoStagedFiles);
      commitContextDiff = await git.getStagedDiffForFiles(autoStagedFiles);
      diffSource = 'workingTree';
    }
    if (!commitContextDiff.trim()) {
      vscode.window.showInformationMessage('已暂存变更，但无法提取可用于生成的信息（可能仅包含二进制文件）。');
      return;
    }

    const budgetedDiff = applyDiffBudget(commitContextDiff, config.maxDiffChars);

    const commitMessage = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Smart Git Committer 正在生成提交信息...',
        cancellable: false
      },
      async () => {
        const recentCommits = await git.getRecentCommits(config.recentCommitCount);
        return generateCommitMessage({
          baseURL: config.baseURL,
          model: config.model,
          apiKey,
          stagedDiff: budgetedDiff.diff,
          recentCommits,
          messageStyle: config.messageStyle,
          languageMode: config.languageMode,
          promptTemplate: config.promptTemplate
        });
      }
    );

    const finalMessage = commitMessage.trim();
    if (!finalMessage) {
      vscode.window.showErrorMessage('生成失败：AI 返回了空提交信息。');
      return;
    }

    const filled = await fillScmCommitInput(workspaceRoot, finalMessage);
    if (!filled) {
      vscode.window.showErrorMessage('未能填充到提交输入框，请确认 Git 扩展已启用并已打开 Git 仓库。');
      return;
    }

    const tips: string[] = [];
    if (filteredOutCount > 0) {
      tips.push(`已按 include/exclude 规则过滤 ${filteredOutCount} 个文件`);
    }
    if (gitIgnoredCount > 0) {
      tips.push(`已按 .gitignore 过滤 ${gitIgnoredCount} 个文件`);
    }
    if (budgetedDiff.truncated) {
      tips.push(`Diff 超出预算，已裁剪为 ${budgetedDiff.usedChars}/${budgetedDiff.originalChars} 字符`);
    }
    const tail = tips.length > 0 ? `（${tips.join('；')}）` : '';

    if (diffSource === 'workingTree') {
      const untrackedText = config.autoStageUntracked ? '（已包含未跟踪文件）' : '（未包含未跟踪文件）';
      vscode.window.showInformationMessage(
        `暂存区为空，已基于工作区变更生成并填充提交信息，自动暂存 ${autoStagedFiles.length} 个文件 ${untrackedText}。${tail}`
      );
      return;
    }

    vscode.window.showInformationMessage(`已基于暂存区变更生成并填充到 Source Control 提交输入框。${tail}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    vscode.window.showErrorMessage(`生成失败：${message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const generateDisposable = vscode.commands.registerCommand(GENERATE_COMMAND, async () => {
    await runGenerate(context);
  });

  const setApiKeyDisposable = vscode.commands.registerCommand(SET_API_KEY_COMMAND, async () => {
    const key = await promptAndStoreApiKey(context);
    if (!key) {
      vscode.window.showWarningMessage('未输入 API Key。');
      return;
    }
    vscode.window.showInformationMessage('API Key 已安全保存到 SecretStorage。');
  });

  const configureDisposable = vscode.commands.registerCommand(CONFIGURE_COMMAND, async () => {
    SettingsPanel.createOrShow(context);
  });

  const settingsStatusBarItem = createSettingsStatusBarItem();
  context.subscriptions.push(generateDisposable, setApiKeyDisposable, configureDisposable, settingsStatusBarItem);
}

export function deactivate(): void {
  // no-op
}
