import * as vscode from 'vscode';
import { testAIConnection } from '../services/ai';

import {
  type CommitLanguageMode,
  getConfig,
  type CommitMessageStyle
} from '../services/config';
import {
  DEFAULT_PROMPT_TEMPLATE,
  PROMPT_TEMPLATE_TOKENS,
  validatePromptTemplate
} from '../prompts/commitPrompt';
import { hasApiKey, promptAndStoreApiKey, resolveApiKey } from '../services/secret';



type ApiKeySource = 'secretStorage' | 'settings' | 'none';
const MOLEAPI_REGISTER_AFFILIATE_URL = 'https://home.moleapi.com/register?aff=GU6Y';

interface SaveBaseSettingsPayload {
  baseURL: string;
  model: string;
  recentCommitCount: number;
  maxDiffChars: number;
  includeGlobs: string[];
  excludeGlobs: string[];
  respectGitIgnore: boolean;
  autoStageUntracked: boolean;
  messageStyle: CommitMessageStyle;
  languageMode: CommitLanguageMode;
  workspaceOverrides: string[];
  apiKeyValue?: string;
}

interface SavePromptTemplatePayload {
  promptTemplate: string;
  workspaceOverrides: string[];
}

interface TestConnectionPayload {
  baseURL: string;
  model: string;
}



interface PanelState {
  hasWorkspace: boolean;
  hasApiKey: boolean;
  apiKeySource: ApiKeySource;
  apiKeyValue?: string;
  workspaceOverrides: string[];
  baseURL: string;
  model: string;
  recentCommitCount: number;
  maxDiffChars: number;
  includeGlobs: string[];
  excludeGlobs: string[];
  respectGitIgnore: boolean;
  autoStageUntracked: boolean;
  messageStyle: CommitMessageStyle;
  languageMode: CommitLanguageMode;
  promptTemplate: string;
}

export class SettingsPanel {
  private static currentPanel: SettingsPanel | undefined;

  static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active;
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      void SettingsPanel.currentPanel.pushState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'smartGitCommitterSettings',
      'Smart Git Committer Settings',
      column,
      { enableScripts: true }
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, context);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    this.panel.webview.html = this.renderHtml();
    void this.pushState();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null || !('type' in message)) {
      return;
    }

    const typedMessage = message as { type?: string; payload?: unknown };
    if (typedMessage.type === 'refresh') {
      await this.pushState();
      return;
    }

    if (typedMessage.type === 'setApiKey') {
      const key = await promptAndStoreApiKey(this.context);
      if (key) {
        vscode.window.showInformationMessage('API Key 已安全保存到 SecretStorage。');
      }
      await this.pushState();
      return;
    }

    if (typedMessage.type === 'saveBase') {
      const payload = typedMessage.payload as SaveBaseSettingsPayload | undefined;
      if (!payload) {
        return;
      }
      await this.saveBaseSettings(payload);
      await this.pushState();
      return;
    }

    if (typedMessage.type === 'savePromptTemplate') {
      const payload = typedMessage.payload as SavePromptTemplatePayload | undefined;
      if (!payload) {
        return;
      }
      await this.savePromptTemplate(payload);
      await this.pushState();
      return;
    }

    if (typedMessage.type === 'testConnection') {
      const payload = typedMessage.payload as TestConnectionPayload | undefined;
      if (!payload) {
        return;
      }
      await this.testConnection(payload);
      await this.pushState();
      return;
    }

    if (typedMessage.type === 'openMoleApiInvite') {
      await vscode.env.openExternal(vscode.Uri.parse(MOLEAPI_REGISTER_AFFILIATE_URL));
    }
  }

  private async testConnection(payload: TestConnectionPayload): Promise<void> {
    const baseURL = payload.baseURL.trim();
    if (!baseURL) {
      vscode.window.showErrorMessage('连接测试失败：Base URL 不能为空。');
      return;
    }
    try {
      new URL(baseURL);
    } catch {
      vscode.window.showErrorMessage('连接测试失败：Base URL 格式无效。');
      return;
    }

    const model = payload.model.trim();
    if (!model) {
      vscode.window.showErrorMessage('连接测试失败：Model 不能为空。');
      return;
    }

    const currentConfig = getConfig();
    const apiKey = await resolveApiKey(this.context, currentConfig.apiKeyFromSettings);
    if (!apiKey) {
      vscode.window.showWarningMessage('未提供 API Key，已取消连接测试。');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Smart Git Committer 正在测试连接...',
          cancellable: false
        },
        async () => {
          await testAIConnection({ baseURL, model, apiKey });
        }
      );
      vscode.window.showInformationMessage('连接测试成功：API Key、Base URL 和 Model 均可用。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      vscode.window.showErrorMessage(`连接测试失败：${message}`);
    }
  }

  private async applySettingWithOverride(key: string, value: string | number | boolean | string[] | undefined, workspaceOverrides: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('smartGitCommitter');
    const isWorkspace = workspaceOverrides.includes(key);
    
    if (isWorkspace && vscode.workspace.workspaceFolders?.length) {
      await config.update(key, value, vscode.ConfigurationTarget.Workspace);
    } else {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
      if (vscode.workspace.workspaceFolders?.length) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
      }
    }
  }

  private async saveBaseSettings(payload: SaveBaseSettingsPayload): Promise<void> {

    const baseURL = payload.baseURL.trim();
    if (!baseURL) {
      vscode.window.showErrorMessage('Base URL 不能为空。');
      return;
    }
    try {
      new URL(baseURL);
    } catch {
      vscode.window.showErrorMessage('Base URL 格式无效，请输入完整 URL。');
      return;
    }

    const model = payload.model.trim();
    if (!model) {
      vscode.window.showErrorMessage('Model 不能为空。');
      return;
    }

    const count = Math.floor(payload.recentCommitCount);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      vscode.window.showErrorMessage('Recent Commit Count 必须是 1 到 10 的整数。');
      return;
    }

    const maxDiffChars = Math.floor(payload.maxDiffChars);
    if (!Number.isInteger(maxDiffChars) || maxDiffChars < 2000 || maxDiffChars > 200000) {
      vscode.window.showErrorMessage('Max Diff Chars 必须是 2000 到 200000 的整数。');
      return;
    }

    const includeGlobs = this.normalizeGlobListInput(payload.includeGlobs);
    const excludeGlobs = this.normalizeGlobListInput(payload.excludeGlobs);

    // Global properties that should not be overridden by workspace settings
    await this.updateSetting('baseURL', baseURL, vscode.ConfigurationTarget.Global);
    await this.updateSetting('model', model, vscode.ConfigurationTarget.Global);

    // Context-dependent properties
    const overrides = payload.workspaceOverrides || [];
    await this.applySettingWithOverride('recentCommitCount', count, overrides);
    await this.applySettingWithOverride('maxDiffChars', maxDiffChars, overrides);
    await this.applySettingWithOverride('includeGlobs', includeGlobs, overrides);
    await this.applySettingWithOverride('excludeGlobs', excludeGlobs, overrides);
    await this.applySettingWithOverride('respectGitIgnore', payload.respectGitIgnore, overrides);
    await this.applySettingWithOverride('autoStageUntracked', payload.autoStageUntracked, overrides);
    await this.applySettingWithOverride('messageStyle', payload.messageStyle, overrides);
    await this.applySettingWithOverride('languageMode', payload.languageMode, overrides);

    if (payload.apiKeyValue !== undefined) {
      if (payload.apiKeyValue.trim() === '') {
        await this.updateSetting('apiKey', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await this.updateSetting('apiKey', payload.apiKeyValue.trim(), vscode.ConfigurationTarget.Global);
      }
    }

    vscode.window.showInformationMessage('配置项已成功保存。');
  }

  private async savePromptTemplate(payload: SavePromptTemplatePayload): Promise<void> {

    const promptTemplate = payload.promptTemplate.trim();
    const promptTemplateError = validatePromptTemplate(promptTemplate);
    if (promptTemplateError) {
      vscode.window.showErrorMessage(`Prompt 模板校验失败：${promptTemplateError}`);
      return;
    }

    await this.applySettingWithOverride('promptTemplate', promptTemplate, payload.workspaceOverrides || []);
    vscode.window.showInformationMessage('高级模板配置已保存。');
  }

  private getWorkspaceOverrides(vscodeConfig: vscode.WorkspaceConfiguration): string[] {
    const overrideableKeys = ['recentCommitCount', 'maxDiffChars', 'includeGlobs', 'excludeGlobs', 'respectGitIgnore', 'autoStageUntracked', 'messageStyle', 'languageMode', 'promptTemplate'];
    if (!vscode.workspace.workspaceFolders?.length) {
      return [];
    }
    return overrideableKeys.filter((key) => {
      const inspect = vscodeConfig.inspect(key);
      return inspect && inspect.workspaceValue !== undefined;
    });
  }

  private async updateSetting(
    key: string,
    value: string | number | boolean | string[] | undefined,
    target: vscode.ConfigurationTarget
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('smartGitCommitter');
    await config.update(key, value, target);
  }

  private normalizeGlobListInput(input: string[]): string[] {
    return input
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }


  private async buildState(): Promise<PanelState> {
    const config = getConfig();
    const vscodeConfig = vscode.workspace.getConfiguration('smartGitCommitter');
    const workspaceScopeEnabled = Boolean(vscode.workspace.workspaceFolders?.length);
    const hasSecretApiKey = await hasApiKey(this.context);
    const hasSettingApiKey = Boolean(config.apiKeyFromSettings?.trim());
    const apiKeySource = hasSecretApiKey ? 'secretStorage' : hasSettingApiKey ? 'settings' : 'none';

    return {
      hasWorkspace: workspaceScopeEnabled,
      hasApiKey: hasSecretApiKey || hasSettingApiKey,
      apiKeySource,
      apiKeyValue: apiKeySource === 'settings' ? config.apiKeyFromSettings : undefined,
      workspaceOverrides: this.getWorkspaceOverrides(vscodeConfig),
      baseURL: config.baseURL,
      model: config.model,
      recentCommitCount: config.recentCommitCount,
      maxDiffChars: config.maxDiffChars,
      includeGlobs: config.includeGlobs,
      excludeGlobs: config.excludeGlobs,
      respectGitIgnore: config.respectGitIgnore,
      autoStageUntracked: config.autoStageUntracked,
      messageStyle: config.messageStyle,
      languageMode: config.languageMode,
      promptTemplate: config.promptTemplate
    };
  }

  private async pushState(): Promise<void> {
    const state = await this.buildState();
    await this.panel.webview.postMessage({
      type: 'state',
      payload: state,
      meta: {
        defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
        promptTokens: PROMPT_TEMPLATE_TOKENS
      }
    });
  }

  private renderHtml(): string {
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>Smart Git Committer Settings</title>
  <style>
    :root {
      --font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
      --font-size: var(--vscode-font-size, 13px);
      --bg: var(--vscode-settings-editorBackground, var(--vscode-editor-background));
      --fg: var(--vscode-settings-textInputForeground, var(--vscode-foreground));
      --muted: var(--vscode-descriptionForeground);
      --line: color-mix(in srgb, var(--vscode-panel-border) 65%, transparent);
      --input-bg: var(--vscode-settings-textInputBackground, var(--vscode-input-background));
      --input-border: var(--vscode-settings-textInputBorder, var(--vscode-input-border));
      --focus-border: var(--vscode-focusBorder);
      --button-bg: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --button-hover: var(--vscode-button-hoverBackground);
      --button2-bg: var(--vscode-button-secondaryBackground);
      --button2-fg: var(--vscode-button-secondaryForeground);
      --button2-hover: var(--vscode-button-secondaryHoverBackground);
    }
    * { box-sizing: border-box; }
    body { background: var(--bg); color: var(--fg); font-family: var(--font-family); font-size: var(--font-size); margin: 0; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
    
    .header { padding: 20px 24px 0; flex-shrink: 0; }
    .header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 500; }
    .header p { margin: 0; color: var(--muted); font-size: 13px; }

    .tabs { display: flex; border-bottom: 1px solid var(--line); margin: 20px 24px 0; flex-shrink: 0; }
    .tab { padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--muted); font-size: 13px; }
    .tab:hover { color: var(--fg); }
    .tab.active { color: var(--fg); border-bottom-color: var(--focus-border); font-weight: 600; }

    .tab-content { display: none; padding: 24px 24px 80px; max-width: 800px; flex: 1; overflow-y: auto; width: 100%; }
    .tab-content.active { display: block; }
    
    .setting-item { margin-bottom: 24px; }
    .setting-label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 13px; }
    .setting-desc { color: var(--muted); font-size: 12px; margin-bottom: 8px; line-height: 1.5; }
    
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: normal; background: color-mix(in srgb, var(--muted) 15%, transparent); color: var(--muted); vertical-align: middle; margin-left: 6px; border: 1px solid var(--line); }
    .badge.ok { color: var(--vscode-terminal-ansiGreen); border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 45%, transparent); background: transparent; }
    .badge.warn { color: var(--vscode-terminal-ansiYellow); border-color: color-mix(in srgb, var(--vscode-terminal-ansiYellow) 45%, transparent); background: transparent; }
    
    input[type="text"], input[type="password"], input[type="number"], select, textarea { width: 100%; max-width: 500px; padding: 6px 8px; border: 1px solid var(--input-border); background: var(--input-bg); color: var(--fg); border-radius: 3px; font-family: inherit; font-size: 13px; }
    input:disabled { opacity: 0.6; cursor: not-allowed; }
    textarea { max-width: 100%; min-height: 200px; font-family: "Consolas", monospace; resize: vertical; }
    input:focus:not(:disabled), select:focus:not(:disabled), textarea:focus:not(:disabled) { outline: 1px solid var(--focus-border); border-color: var(--focus-border); }
    
    .checkbox-item { display: flex; align-items: flex-start; gap: 8px; }
    .checkbox-item input { margin-top: 3px; cursor: pointer; }
    .checkbox-item label { font-weight: 600; margin-bottom: 2px; display: block; }
    .checkbox-item .setting-desc { margin-bottom: 0; }
    
    .btn { padding: 6px 12px; border: 1px solid transparent; background: var(--button-bg); color: var(--button-fg); border-radius: 3px; cursor: pointer; font-size: 13px; }
    .btn:hover { background: var(--button-hover); }
    .btn-secondary { background: var(--button2-bg); color: var(--button2-fg); border-color: var(--button2-bg); }
    .btn-secondary:hover { background: var(--button2-hover); }
    
    .text-link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; font-size: 12px; margin-left: 8px; }
    .text-link:hover { color: var(--vscode-textLink-activeForeground); }
    
    .bottom-bar { position: fixed; bottom: 0; left: 0; right: 0; background: color-mix(in srgb, var(--bg) 95%, transparent); backdrop-filter: blur(8px); border-top: 1px solid var(--line); padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; z-index: 100; }
    
    .flex-row { display: flex; gap: 8px; align-items: center; }
    
    .pattern-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; max-width: 500px; }
    .pattern-row { display: flex; gap: 8px; }
    .pattern-row input { flex: 1; }
    
    .token-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .token { padding: 2px 8px; border: 1px solid var(--line); border-radius: 3px; background: var(--input-bg); color: var(--muted); font-family: "Consolas", monospace; font-size: 11px; cursor: pointer; }
    .token:hover { color: var(--fg); border-color: var(--focus-border); }
    
    .override-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
    .override-grid label { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--fg); font-size: 12px; width: fit-content; }
    .override-grid label.disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>

  <div class="header">
    <h1>Smart Git Committer</h1>
    <p>快速配置您的 AI 提交信息生成器。</p>
  </div>

  <div class="tabs">
    <div class="tab active" data-target="tab-general">通用与连接</div>
    <div class="tab" data-target="tab-rules">项目与规则</div>
    <div class="tab" data-target="tab-prompt">高级 Prompt</div>
  </div>

  <div id="tab-general" class="tab-content active">
    <div class="setting-item">
      <label class="setting-label">API Key 凭证 <span id="apiStatusBadge" class="badge">检查中</span></label>
      <div class="setting-desc">提供给 AI 调用的私钥。推荐通过 SecretStorage 安全保存。当前来源: <strong id="apiKeySourceText">-</strong></div>
      <div class="flex-row" style="margin-bottom: 8px;">
         <input id="apiKeyValue" type="password" placeholder="正在加载..." style="max-width:300px;" />
         <button class="btn btn-secondary" id="toggleApiKeyVisible" type="button" style="display:none; min-width:32px; padding: 6px 8px;" title="显示/隐藏明文">👁</button>
      </div>
      <div class="flex-row">
        <button class="btn btn-secondary" id="setApiKey">安全录入到 SecretStorage</button>
        <button class="btn btn-secondary" id="testConnection">测试连接</button>
      </div>
    </div>
    
    <div class="setting-item">
      <label class="setting-label" for="baseURL">Base URL <span class="badge">全局专属 (User)</span></label>
      <div class="setting-desc">AI 模型调用的端点地址。<button type="button" class="text-link" id="openMoleApiInvite">获取 MoleAPI 邀请</button></div>
      <input id="baseURL" type="text" placeholder="https://api.moleapi.com" />
    </div>

    <div class="setting-item">
      <label class="setting-label" for="model">Model <span class="badge">全局专属 (User)</span></label>
      <div class="setting-desc">指定使用的模型（如 gpt-4o-mini）。</div>
      <input id="model" type="text" placeholder="gpt-4o-mini" />
    </div>
  </div>

  <div id="tab-rules" class="tab-content">
    <div class="setting-item" style="background: color-mix(in srgb, var(--input-bg) 60%, transparent); padding: 16px; border-radius: 6px; border: 1px solid var(--line); margin-bottom: 24px;">
      <h3 style="margin-top: 0; margin-bottom: 6px; font-size: 14px;">工作区属性覆盖 (Workspace Overrides)</h3>
      <div class="setting-desc" style="margin-bottom: 12px; color: var(--muted);" id="workspaceOverrideHint">
        勾选下方的配置项，表示你希望该选项被独占保存到当前工作区的 <code>.vscode/settings.json</code> 中。未勾选的项统一退回读取并使用全局 User 级别的后备配置。
      </div>
      <div class="override-grid" id="overrideCheckboxes">
        <label><input type="checkbox" value="recentCommitCount"> 参考历史数量</label>
        <label><input type="checkbox" value="maxDiffChars"> 最大 Diff 长度控制</label>
        <label><input type="checkbox" value="messageStyle"> 提交信息风格</label>
        <label><input type="checkbox" value="languageMode"> 语言偏好</label>
        <label><input type="checkbox" value="includeGlobs"> 仅处理指定文件</label>
        <label><input type="checkbox" value="excludeGlobs"> 排除特定文件</label>
        <label><input type="checkbox" value="respectGitIgnore"> 遵循 .gitignore</label>
        <label><input type="checkbox" value="autoStageUntracked"> 自动介入未暂存文件</label>
        <label><input type="checkbox" value="promptTemplate" id="chkPromptTemplate"> 高级 Prompt 模板</label>
      </div>
    </div>

    <div style="display: flex; gap: 24px; max-width: 600px; flex-wrap: wrap;">
      <div class="setting-item" style="flex: 1; min-width: 250px;">
        <label class="setting-label" for="messageStyle">提交信息风格</label>
        <select id="messageStyle" style="max-width: 100%;">
          <option value="title">仅生成单行标题 (Title)</option>
          <option value="title+body">生成详细的标题 + 正文 (Title+Body)</option>
        </select>
      </div>

      <div class="setting-item" style="flex: 1; min-width: 250px;">
        <label class="setting-label" for="languageMode">语言偏好</label>
        <select id="languageMode" style="max-width: 100%;">
          <option value="auto">自动 (跟随最近的提交)</option>
          <option value="zh">强制使用中文</option>
          <option value="en">强制使用英文</option>
        </select>
      </div>
    </div>

    <div style="display: flex; gap: 24px; max-width: 600px; flex-wrap: wrap;">
      <div class="setting-item" style="flex: 1; min-width: 250px;">
        <label class="setting-label" for="recentCommitCount">参考历史数量</label>
        <div class="setting-desc">让 AI 学习您的近期风格(1-10)。</div>
        <input id="recentCommitCount" type="number" min="1" max="10" style="max-width: 100px;" />
      </div>

      <div class="setting-item" style="flex: 1; min-width: 250px;">
        <label class="setting-label" for="maxDiffChars">最大 Diff 长度控制</label>
        <div class="setting-desc">避免过大变更导致超时或费用超支。</div>
        <input id="maxDiffChars" type="number" min="2000" max="200000" style="max-width: 100px;" />
      </div>
    </div>

    <div class="setting-item">
      <label class="setting-label">仅处理指定文件 (Include Globs)</label>
      <div class="setting-desc">若配置，仅当变更文件匹配时才作分析。留空处理全部。</div>
      <div id="includeGlobsList" class="pattern-list"></div>
      <button class="btn btn-secondary" id="addIncludeGlob" style="padding: 4px 10px; font-size: 12px;">+ 添加规则</button>
    </div>

    <div class="setting-item">
      <label class="setting-label">排除特定文件 (Exclude Globs)</label>
      <div class="setting-desc">忽略锁定文件或构建目录，避免污染上下文。</div>
      <div id="excludeGlobsList" class="pattern-list"></div>
      <button class="btn btn-secondary" id="addExcludeGlob" style="padding: 4px 10px; font-size: 12px;">+ 添加排除</button>
    </div>

    <div class="setting-item checkbox-item">
      <input id="respectGitIgnore" type="checkbox" />
      <div>
        <label for="respectGitIgnore">遵循项目 .gitignore 规范</label>
        <div class="setting-desc">开启则跳过已被 .gitignore 定义排出的文件。</div>
      </div>
    </div>

    <div class="setting-item checkbox-item">
      <input id="autoStageUntracked" type="checkbox" />
      <div>
        <label for="autoStageUntracked">自动介入未暂存(Untracked)文件</label>
        <div class="setting-desc">当未执行 git add 时，尝试合并并未跟踪的变更。</div>
      </div>
    </div>
  </div>

  <div id="tab-prompt" class="tab-content">
    <div class="setting-item">
      <label class="setting-label">定制化 Prompt 模板 <span id="promptTemplateBadge" class="badge">加载中</span></label>
      <div class="setting-desc">若留白将走优化过的基础引擎。若修改须内嵌代码 <code>{{DIFF}}</code> 与 <code>{{RECENT_COMMITS}}</code>。</div>
      <div class="token-bar">
        <button type="button" class="token">{{DIFF}}</button>
        <button type="button" class="token">{{RECENT_COMMITS}}</button>
        <button type="button" class="token">{{MESSAGE_STYLE_RULES}}</button>
        <button type="button" class="token">{{LANGUAGE_INSTRUCTION}}</button>
        <button type="button" class="token">{{STYLE_PREFERENCE}}</button>
        <button type="button" class="token">{{ALLOWED_TYPES}}</button>
      </div>
      <textarea id="promptTemplate" placeholder="留空以使用默认内置模板..."></textarea>
      
      <div class="flex-row" style="margin-top: 12px;">
        <button class="btn btn-secondary" id="resetPromptTemplate">还原为空 (撤消)</button>
        <div class="setting-desc" id="promptTemplateHint" style="margin-bottom: 0;"></div>
      </div>
    </div>
  </div>

  <div class="bottom-bar">
    <div class="flex-row">
      <button class="btn btn-secondary" id="refresh" style="background: transparent; color: var(--muted); border: 1px solid var(--line);">↺ 获取最新状态</button>
    </div>
    <div class="flex-row">
      <button class="btn btn-secondary" id="savePromptTemplate" style="display:none; border-color: var(--button-bg);">保存 Prompt 设置</button>
      <button class="btn" id="saveBase">保存各项原则</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const el = (id) => document.getElementById(id);
    let promptTemplateSavedValue = '';
    let testConnectionPending = false;

    // Tabs logic
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab, .tab-content').forEach(e => e.classList.remove('active'));
        tab.classList.add('active');
        el(tab.dataset.target).classList.add('active');
        
        const isPrompt = tab.dataset.target === 'tab-prompt';
        el('savePromptTemplate').style.display = isPrompt ? 'inline-block' : 'none';
        el('saveBase').textContent = isPrompt ? '保存通用与规则项目配置' : '保存本页设定';
        
        if (isPrompt) {
            // When user edits prompt, automatically check the override box for promptTemplate if workspace is available
            const ptChk = el('chkPromptTemplate');
            if(ptChk && !ptChk.disabled && !ptChk.checked && el('promptTemplate').value.trim() !== '') {
               // We don't force check it, just an idea. We will leave it to manual for now.
            }
        }
      });
    });

    function updateApiState(state) {
      const b = el('apiStatusBadge');
      b.textContent = state.hasApiKey ? '已就绪' : '缺少许可';
      b.className = state.hasApiKey ? 'badge ok' : 'badge warn';
      
      const m = { secretStorage: 'SecretStorage (安全)', settings: 'settings.json (明文)', none: '缺少录入' };
      el('apiKeySourceText').textContent = m[state.apiKeySource] || '-';

      const keyInput = el('apiKeyValue');
      const keyToggle = el('toggleApiKeyVisible');
      if (state.apiKeySource === 'secretStorage') {
         keyInput.value = '••••••••••••••••••••••••';
         keyInput.disabled = true;
         keyToggle.style.display = 'none';
      } else if (state.apiKeySource === 'settings') {
         keyInput.value = state.apiKeyValue || '';
         keyInput.disabled = false;
         keyToggle.style.display = 'inline-block';
         keyToggle.textContent = '👁';
         keyInput.type = 'password';
      } else {
         keyInput.value = '';
         keyInput.disabled = false;
         keyToggle.style.display = 'none';
      }
    }

    el('toggleApiKeyVisible').addEventListener('click', (e) => {
        const keyInput = el('apiKeyValue');
        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            e.target.textContent = '🔒';
        } else {
            keyInput.type = 'password';
            e.target.textContent = '👁';
        }
    });

    function createPatternRow(container, value, placeholder) {
      const row = document.createElement('div');
      row.className = 'pattern-row';
      const input = document.createElement('input');
      input.type = 'text'; input.value = value || ''; input.placeholder = placeholder || '';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button'; removeBtn.className = 'btn btn-secondary'; removeBtn.textContent = 'x'; removeBtn.style.padding = '4px 8px'; removeBtn.title = '移除';
      removeBtn.addEventListener('click', () => {
        row.remove();
        if (container.children.length === 0) container.appendChild(createPatternRow(container, '', placeholder));
      });
      row.append(input, removeBtn);
      return row;
    }

    function renderPatternList(containerId, patterns, placeholder) {
      const container = el(containerId); container.innerHTML = '';
      const safePatterns = Array.isArray(patterns) && patterns.length > 0 ? patterns : [''];
      safePatterns.forEach(pattern => container.appendChild(createPatternRow(container, pattern, placeholder)));
    }

    function readPatternList(containerId) {
      return Array.from(el(containerId).querySelectorAll('input[type="text"]'))
        .map(input => input.value.trim()).filter(v => v.length > 0);
    }

    function updatePromptStateLabel(val) {
      const badge = el('promptTemplateBadge');
      if(val.trim().length > 0) {
        badge.textContent = '已定制化';
        badge.className = 'badge warn';
      } else {
        badge.textContent = '内置生效';
        badge.className = 'badge ok';
      }
    }

    function getWorkspaceOverrides() {
      return Array.from(document.querySelectorAll('#overrideCheckboxes input[type="checkbox"]:checked')).map(cb => cb.value);
    }

    function setState(state) {
      const hint = el('workspaceOverrideHint');
      if (!state.hasWorkspace) {
         hint.innerHTML = '<span style="color:var(--vscode-terminal-ansiYellow)">未发现有效工作区，下方复选框已被禁用。所有配置将统一写入全局 User 中。</span>';
      } else {
         hint.innerHTML = '勾选下方的配置项，表示你希望该选项被独占保存到当前工作区的 <code>.vscode/settings.json</code> 中。未勾选的项统一退回读取并使用全局 User 级别的后备配置。';
      }

      document.querySelectorAll('#overrideCheckboxes input[type="checkbox"]').forEach(cb => {
         cb.checked = state.workspaceOverrides.includes(cb.value);
         cb.disabled = !state.hasWorkspace;
         cb.parentElement.className = !state.hasWorkspace ? 'disabled' : '';
      });

      el('baseURL').value = state.baseURL; el('model').value = state.model;
      el('recentCommitCount').value = String(state.recentCommitCount);
      el('maxDiffChars').value = String(state.maxDiffChars);
      renderPatternList('includeGlobsList', state.includeGlobs, 'src/**');
      renderPatternList('excludeGlobsList', state.excludeGlobs, '**/*.lock');
      el('respectGitIgnore').checked = Boolean(state.respectGitIgnore);
      el('autoStageUntracked').checked = Boolean(state.autoStageUntracked);
      el('messageStyle').value = state.messageStyle;
      el('languageMode').value = state.languageMode;
      
      el('promptTemplate').value = state.promptTemplate;
      promptTemplateSavedValue = state.promptTemplate.trim();
      updatePromptStateLabel(state.promptTemplate);

      updateApiState(state);
      
      if (testConnectionPending) { testConnectionPending = false; el('testConnection').textContent = '测试连接'; el('testConnection').disabled = false; }
    }

    window.addEventListener('message', e => { if (e.data?.type === 'state') setState(e.data.payload); });
    
    el('promptTemplate').addEventListener('input', (e) => updatePromptStateLabel(e.target.value));
    
    el('openMoleApiInvite').addEventListener('click', () => vscode.postMessage({ type: 'openMoleApiInvite' }));
    el('addIncludeGlob').addEventListener('click', () => el('includeGlobsList').appendChild(createPatternRow(el('includeGlobsList'), '', 'src/**')));
    el('addExcludeGlob').addEventListener('click', () => el('excludeGlobsList').appendChild(createPatternRow(el('excludeGlobsList'), '', '**/*.lock')));
    
    document.querySelectorAll('.token').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = el('promptTemplate'); const text = btn.textContent;
        const s = t.selectionStart, e = t.selectionEnd;
        t.value = t.value.substring(0, s) + text + t.value.substring(e);
        t.selectionStart = t.selectionEnd = s + text.length; t.focus();
        updatePromptStateLabel(t.value);
      });
    });

    el('saveBase').addEventListener('click', () => vscode.postMessage({ type: 'saveBase', payload: {
      workspaceOverrides: getWorkspaceOverrides(),
      apiKeyValue: el('apiKeyValue').disabled ? undefined : el('apiKeyValue').value,
      baseURL: el('baseURL').value, model: el('model').value,
      recentCommitCount: Number(el('recentCommitCount').value), maxDiffChars: Number(el('maxDiffChars').value),
      includeGlobs: readPatternList('includeGlobsList'), excludeGlobs: readPatternList('excludeGlobsList'),
      respectGitIgnore: el('respectGitIgnore').checked, autoStageUntracked: el('autoStageUntracked').checked,
      messageStyle: el('messageStyle').value, languageMode: el('languageMode').value
    }}));

    el('savePromptTemplate').addEventListener('click', () => {
      const template = el('promptTemplate').value;
      if (template.trim() && (!template.includes('{{DIFF}}') || !template.includes('{{RECENT_COMMITS}}'))) {
        return window.alert('模板必须配置注入 {{DIFF}} 与 {{RECENT_COMMITS}}。');
      }
      vscode.postMessage({ type: 'savePromptTemplate', payload: { workspaceOverrides: getWorkspaceOverrides(), promptTemplate: template } });
    });

    el('resetPromptTemplate').addEventListener('click', () => { el('promptTemplate').value = ''; updatePromptStateLabel(''); });
    el('setApiKey').addEventListener('click', () => vscode.postMessage({ type: 'setApiKey' }));
    el('testConnection').addEventListener('click', () => {
      if (testConnectionPending) return;
      testConnectionPending = true; el('testConnection').disabled = true; el('testConnection').textContent = '调测进行中...';
      vscode.postMessage({ type: 'testConnection', payload: { baseURL: el('baseURL').value, model: el('model').value } });
    });
    el('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>
`;
  }

  private dispose(): void {
    SettingsPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 16; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
