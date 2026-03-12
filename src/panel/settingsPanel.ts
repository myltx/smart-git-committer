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

type SettingsScope = 'user' | 'workspace';
type ConfigSource = 'workspace' | 'user' | 'default';
type ApiKeySource = 'secretStorage' | 'settings' | 'none';
const MOLEAPI_REGISTER_AFFILIATE_URL = 'https://home.moleapi.com/register?aff=GU6Y';

interface SaveBaseSettingsPayload {
  scope: SettingsScope;
  baseURL: string;
  model: string;
  recentCommitCount: number;
  autoStageUntracked: boolean;
  messageStyle: CommitMessageStyle;
  languageMode: CommitLanguageMode;
}

interface SavePromptTemplatePayload {
  scope: SettingsScope;
  promptTemplate: string;
}

interface TestConnectionPayload {
  baseURL: string;
  model: string;
}

interface EffectiveConfigItem {
  key: string;
  label: string;
  value: string;
  source: ConfigSource;
}

interface PanelState {
  hasWorkspace: boolean;
  hasApiKey: boolean;
  apiKeySource: ApiKeySource;
  scope: SettingsScope;
  baseURL: string;
  model: string;
  recentCommitCount: number;
  autoStageUntracked: boolean;
  messageStyle: CommitMessageStyle;
  languageMode: CommitLanguageMode;
  promptTemplate: string;
  effectiveConfigs: EffectiveConfigItem[];
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

  private async saveBaseSettings(payload: SaveBaseSettingsPayload): Promise<void> {
    const scope = this.resolveTarget(payload.scope);
    if (!scope) {
      return;
    }

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

    await this.updateSetting('baseURL', baseURL, scope);
    await this.updateSetting('model', model, scope);
    await this.updateSetting('recentCommitCount', count, scope);
    await this.updateSetting('autoStageUntracked', payload.autoStageUntracked, scope);
    await this.updateSetting('messageStyle', payload.messageStyle, scope);
    await this.updateSetting('languageMode', payload.languageMode, scope);

    const scopeLabel = payload.scope === 'workspace' ? 'Workspace' : 'User';
    vscode.window.showInformationMessage(`基础配置已保存到 ${scopeLabel}。`);
  }

  private async savePromptTemplate(payload: SavePromptTemplatePayload): Promise<void> {
    const scope = this.resolveTarget(payload.scope);
    if (!scope) {
      return;
    }

    const promptTemplate = payload.promptTemplate.trim();
    const promptTemplateError = validatePromptTemplate(promptTemplate);
    if (promptTemplateError) {
      vscode.window.showErrorMessage(`Prompt 模板校验失败：${promptTemplateError}`);
      return;
    }

    await this.updateSetting('promptTemplate', promptTemplate, scope);
    const scopeLabel = payload.scope === 'workspace' ? 'Workspace' : 'User';
    vscode.window.showInformationMessage(`高级模板已保存到 ${scopeLabel}。`);
  }

  private resolveTarget(scope: SettingsScope): vscode.ConfigurationTarget | undefined {
    if (scope === 'workspace') {
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showErrorMessage('当前没有打开工作区，无法写入 Workspace 设置。');
        return undefined;
      }
      return vscode.ConfigurationTarget.Workspace;
    }
    return vscode.ConfigurationTarget.Global;
  }

  private async updateSetting(
    key: string,
    value: string | number | boolean,
    target: vscode.ConfigurationTarget
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('smartGitCommitter');
    await config.update(key, value, target);
  }

  private resolveSource(config: vscode.WorkspaceConfiguration, key: string): ConfigSource {
    const inspectResult = config.inspect<unknown>(key);
    if (!inspectResult) {
      return 'default';
    }

    if (vscode.workspace.workspaceFolders?.length && inspectResult.workspaceValue !== undefined) {
      return 'workspace';
    }
    if (inspectResult.globalValue !== undefined) {
      return 'user';
    }
    return 'default';
  }

  private buildEffectiveItems(config: ReturnType<typeof getConfig>): EffectiveConfigItem[] {
    const vscodeConfig = vscode.workspace.getConfiguration('smartGitCommitter');

    return [
      {
        key: 'baseURL',
        label: 'Base URL',
        value: config.baseURL,
        source: this.resolveSource(vscodeConfig, 'baseURL')
      },
      {
        key: 'model',
        label: 'Model',
        value: config.model,
        source: this.resolveSource(vscodeConfig, 'model')
      },
      {
        key: 'recentCommitCount',
        label: 'Recent Commit Count',
        value: String(config.recentCommitCount),
        source: this.resolveSource(vscodeConfig, 'recentCommitCount')
      },
      {
        key: 'autoStageUntracked',
        label: 'Auto Stage Untracked',
        value: config.autoStageUntracked ? '开启' : '关闭',
        source: this.resolveSource(vscodeConfig, 'autoStageUntracked')
      },
      {
        key: 'messageStyle',
        label: 'Message Style',
        value: config.messageStyle,
        source: this.resolveSource(vscodeConfig, 'messageStyle')
      },
      {
        key: 'languageMode',
        label: 'Language Mode',
        value: config.languageMode,
        source: this.resolveSource(vscodeConfig, 'languageMode')
      },
      {
        key: 'promptTemplate',
        label: 'Prompt Template',
        value: config.promptTemplate.trim() ? '自定义模板' : '内置默认模板',
        source: this.resolveSource(vscodeConfig, 'promptTemplate')
      }
    ];
  }

  private async buildState(): Promise<PanelState> {
    const config = getConfig();
    const workspaceScopeEnabled = Boolean(vscode.workspace.workspaceFolders?.length);
    const hasSecretApiKey = await hasApiKey(this.context);
    const hasSettingApiKey = Boolean(config.apiKeyFromSettings?.trim());

    return {
      hasWorkspace: workspaceScopeEnabled,
      hasApiKey: hasSecretApiKey || hasSettingApiKey,
      apiKeySource: hasSecretApiKey ? 'secretStorage' : hasSettingApiKey ? 'settings' : 'none',
      scope: workspaceScopeEnabled ? 'workspace' : 'user',
      baseURL: config.baseURL,
      model: config.model,
      recentCommitCount: config.recentCommitCount,
      autoStageUntracked: config.autoStageUntracked,
      messageStyle: config.messageStyle,
      languageMode: config.languageMode,
      promptTemplate: config.promptTemplate,
      effectiveConfigs: this.buildEffectiveItems(config)
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
      --line-height: 1.45;
      --bg: var(--vscode-settings-editorBackground, var(--vscode-editor-background));
      --fg: var(--vscode-settings-textInputForeground, var(--vscode-foreground));
      --muted: var(--vscode-descriptionForeground);
      --line: color-mix(in srgb, var(--vscode-panel-border) 65%, transparent);
      --row-focus-bg: var(--vscode-settings-focusedRowBackground, color-mix(in srgb, var(--vscode-list-hoverBackground) 35%, transparent));
      --row-focus-border: var(--vscode-settings-focusedRowBorder, var(--vscode-focusBorder));
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

    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font-family);
      font-size: var(--font-size);
      line-height: var(--line-height);
    }

    .container {
      max-width: 880px;
      margin: 0 auto;
      padding: 20px 20px 34px;
    }

    .header {
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }

    .header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 500;
    }

    .header-desc {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 12px;
    }

    .top-summary {
      margin-bottom: 22px;
      border: 1px solid var(--line);
      border-radius: 4px;
      overflow: hidden;
    }

    .summary-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--bg) 92%, transparent);
      font-size: 12px;
      color: var(--muted);
    }

    .summary-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }

    .summary-badges {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .summary-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 11px;
      color: var(--muted);
      background: var(--bg);
    }

    .badge.ok {
      color: var(--vscode-terminal-ansiGreen);
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 45%, transparent);
    }

    .badge.warn {
      color: var(--vscode-terminal-ansiYellow);
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiYellow) 45%, transparent);
    }

    .badge.dirty {
      color: var(--vscode-terminal-ansiYellow);
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiYellow) 45%, transparent);
      background: color-mix(in srgb, var(--vscode-terminal-ansiYellow) 12%, transparent);
    }

    .badge.clean {
      color: var(--muted);
      border-color: var(--line);
      background: var(--bg);
    }

    .table-container {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 12px;
    }

    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-weight: 600;
      background: color-mix(in srgb, var(--bg) 90%, transparent);
    }

    tr:last-child td {
      border-bottom: none;
    }

    .source-tag {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      border: 1px solid currentColor;
      color: var(--muted);
      font-size: 11px;
    }

    .setting-group {
      margin-bottom: 30px;
    }

    .group-actions {
      max-width: 720px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
    }

    .section-title {
      margin: 0 0 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.25px;
    }

    .setting-item {
      max-width: 720px;
      padding: 12px 10px 14px;
      border-bottom: 1px solid var(--line);
      border-left: 2px solid transparent;
      transition: background-color 0.12s ease-in-out, border-left-color 0.12s ease-in-out;
    }

    .setting-item:last-child {
      border-bottom: none;
    }

    .setting-item:focus-within {
      background: var(--row-focus-bg);
      border-left-color: var(--row-focus-border);
    }

    .setting-label {
      display: block;
      margin-bottom: 4px;
      font-size: 13px;
      font-weight: 600;
    }

    .setting-desc {
      margin-bottom: 8px;
      font-size: 12px;
      color: var(--muted);
    }

    input[type="text"], input[type="number"], select, textarea {
      width: 100%;
      max-width: 560px;
      padding: 6px 9px;
      border: 1px solid var(--input-border);
      border-radius: 3px;
      background: var(--input-bg);
      color: var(--fg);
      font: inherit;
    }

    textarea {
      max-width: 100%;
      min-height: 165px;
      resize: vertical;
      font-family: "Consolas", "Menlo", monospace;
      font-size: 12px;
      line-height: 1.4;
    }

    input:focus, select:focus, textarea:focus {
      outline: 1px solid var(--focus-border);
      outline-offset: -1px;
      border-color: var(--focus-border);
    }

    select { cursor: pointer; }

    .checkbox-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .checkbox-item input[type="checkbox"] {
      margin-top: 4px;
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    .token-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }

    .token {
      padding: 2px 8px;
      border: 1px solid var(--line);
      border-radius: 3px;
      background: var(--input-bg);
      color: var(--muted);
      font-family: "Consolas", monospace;
      font-size: 11px;
      cursor: pointer;
    }

    .token:hover {
      color: var(--fg);
      border-color: var(--focus-border);
    }

    .text-link {
      margin-left: 8px;
      border: none;
      background: transparent;
      color: var(--vscode-textLink-foreground);
      font-size: 12px;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
      font: inherit;
    }

    .text-link:hover {
      color: var(--vscode-textLink-activeForeground);
    }

    .btn {
      padding: 6px 12px;
      border: 1px solid transparent;
      border-radius: 3px;
      background: var(--button-bg);
      color: var(--button-fg);
      font-size: 12px;
      cursor: pointer;
    }

    .btn:hover {
      background: var(--button-hover);
    }

    .btn-secondary {
      background: var(--button2-bg);
      color: var(--button2-fg);
    }

    .btn-secondary:hover {
      background: var(--button2-hover);
    }

  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Smart Git Committer</h1>
      <p class="header-desc">配置会按选择作用域保存。下方先展示当前生效配置，再编辑表单。</p>
    </div>

    <div class="top-summary">
      <div class="summary-head">
        <span>当前生效配置（合并 Workspace/User/Default 后）</span>
        <div class="summary-right">
          <div class="summary-badges">
            <span class="badge" id="scopeBadge">Scope: -</span>
            <span class="badge warn" id="apiStatusBadge">API Key: 未配置</span>
            <span class="badge" id="apiKeySourceBadge">来源: -</span>
          </div>
          <div class="summary-actions">
            <button class="btn btn-secondary" id="setApiKey">设置/更新 API Key</button>
            <button class="btn btn-secondary" id="testConnection">测试连接</button>
            <button class="btn btn-secondary" id="refresh">刷新当前视图</button>
          </div>
        </div>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr><th>配置项</th><th style="width:55%">当前值</th><th>来源</th></tr>
          </thead>
          <tbody id="effectiveConfigRows"></tbody>
        </table>
      </div>
    </div>

    <div class="setting-group">
      <h2 class="section-title">基础配置</h2>
      <div class="setting-item">
        <label class="setting-label">配置作用域 (Scope)</label>
        <div class="setting-desc" id="scopeHint">选择配置保存的位置。</div>
        <select id="scope">
          <option value="user">User (全局适用所有工作区)</option>
          <option value="workspace">Workspace (仅当前工作区)</option>
        </select>
      </div>

      <div class="setting-item">
        <label class="setting-label" for="baseURL">Base URL</label>
        <div class="setting-desc">
          AI 模型调用的 API 地址（默认 MoleAPI，也可填写其他兼容中转服务）。
          <button type="button" class="text-link" id="openMoleApiInvite">打开 MoleAPI 邀请链接</button>
        </div>
        <input id="baseURL" type="text" placeholder="https://api.moleapi.com" />
      </div>

      <div class="setting-item">
        <label class="setting-label" for="model">Model</label>
        <div class="setting-desc">指定使用的 AI 模型，例如 <code>gpt-4o-mini</code> 或 <code>claude-3-haiku</code>。</div>
        <input id="model" type="text" placeholder="gpt-4o-mini" />
      </div>

      <div class="setting-item">
        <label class="setting-label" for="recentCommitCount">参考最近提交数量 (1-10)</label>
        <div class="setting-desc">提供给 AI 参考风格的最近几次本地提交记录的数量。</div>
        <input id="recentCommitCount" type="number" min="1" max="10" />
      </div>

      <div class="setting-item">
        <label class="setting-label">提交信息风格 (Message Style)</label>
        <div class="setting-desc">生成单行标题，还是附带详细正文解释。</div>
        <select id="messageStyle">
          <option value="title">仅生成简短 Title</option>
          <option value="title+body">生成 Title + 详细 Body</option>
        </select>
      </div>

      <div class="setting-item">
        <label class="setting-label">语言模式 (Language Mode)</label>
        <div class="setting-desc">生成的提交信息使用的语言倾向。</div>
        <select id="languageMode">
          <option value="auto">Auto (根据最近提交自动推断)</option>
          <option value="zh">强制使用中文 (Chinese)</option>
          <option value="en">强制使用英文 (English)</option>
        </select>
      </div>

      <div class="setting-item checkbox-item" style="padding-bottom: 24px;">
        <input id="autoStageUntracked" type="checkbox" />
        <div>
          <label class="setting-label" for="autoStageUntracked" style="margin-bottom: 2px;">自动暂存未跟踪文件</label>
          <div class="setting-desc" id="autoStageHint" style="margin-bottom: 0;">当暂存区为空时，尝试分析并包含所有未跟踪文件变更。</div>
        </div>
      </div>

      <div class="group-actions">
        <button class="btn" id="saveBase">仅保存基础配置</button>
      </div>
    </div>

    <div class="setting-group">
      <h2 class="section-title">高级 Prompt 模板</h2>
      
      <div class="setting-item" style="max-width: 100%; border-bottom: none;">
        <label class="setting-label">自定义模板内容</label>
        <div class="setting-desc">
          如果留空，将使用内置提示词。若使用自定义模板，内容中<strong>必须包含</strong>占位符：<code>{{DIFF}}</code> 和 <code>{{RECENT_COMMITS}}</code>。
        </div>
        
        <div class="token-bar">
          <button type="button" class="token">{{DIFF}}</button>
          <button type="button" class="token">{{RECENT_COMMITS}}</button>
          <button type="button" class="token">{{MESSAGE_STYLE_RULES}}</button>
          <button type="button" class="token">{{LANGUAGE_INSTRUCTION}}</button>
          <button type="button" class="token">{{STYLE_PREFERENCE}}</button>
          <button type="button" class="token">{{ALLOWED_TYPES}}</button>
        </div>
        
        <textarea id="promptTemplate" placeholder="留空使用内置模板..."></textarea>
        <div class="setting-desc" id="promptTemplateHint" style="margin-top: 8px;"></div>

        <div style="display:flex; align-items:center; gap:8px; margin-top: 12px; flex-wrap:wrap;">
          <span class="badge" id="promptTemplateDirty">模板未改动</span>
          <button class="btn" id="savePromptTemplate">仅保存高级模板</button>
          <button class="btn btn-secondary" id="resetPromptTemplate">清空为内置模板（未保存）</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const el = (id) => document.getElementById(id);
    let promptTemplateSavedValue = '';
    let testConnectionPending = false;

    function updateScopeHint() {
      const scope = el('scope').value;
      const optWS = el('scope').querySelector('option[value="workspace"]');
      if (optWS && optWS.disabled) {
        el('scopeHint').innerHTML = '未检测到工作区，只能保存为<strong>全局用户级 (User)</strong> 设置。';
        el('scopeBadge').textContent = 'Scope: User';
      } else if (scope === 'workspace') {
        el('scopeHint').innerHTML = '将保存至当前项目的 <code>.vscode/settings.json</code>，跟随 Git 仓库共享。';
        el('scopeBadge').textContent = 'Scope: Workspace';
      } else {
        el('scopeHint').innerHTML = '将保存至编辑器的用户全局配置，作为所有此插件的默认后备选项。';
        el('scopeBadge').textContent = 'Scope: User';
      }
    }

    function updateAutoStageHint() {
      el('autoStageHint').textContent = el('autoStageUntracked').checked
        ? '已勾选：生成时将会连同工作区未加入暂存的文件一起提交。' : '未勾选：严谨模式，仅针对您 git add 过的变更生成信息。';
    }

    function updatePromptTemplateHint() {
      const current = el('promptTemplate').value.trim();
      const dirty = current !== promptTemplateSavedValue;
      const dirtyBadge = el('promptTemplateDirty');
      dirtyBadge.className = dirty ? 'badge dirty' : 'badge clean';
      dirtyBadge.textContent = dirty ? '模板有未保存修改' : '模板未改动';
      el('promptTemplateHint').innerHTML = current
        ? '<span style="color:var(--vscode-charts-yellow)">当前编辑的是自定义模板。</span>'
        : '留空时使用内置默认模板。';
    }

    function updateApiState(hasApiKey, apiKeySource) {
      const b = el('apiStatusBadge');
      b.textContent = hasApiKey ? 'API Key: 已就绪' : 'API Key: 亟待设置';
      b.className = hasApiKey ? 'badge ok' : 'badge warn';
      const m = { secretStorage: 'SecretStorage (安全)', settings: 'settings.json (明文,不推荐)', none: '缺失' };
      el('apiKeySourceBadge').textContent = '来源: ' + (m[apiKeySource] || '未知');
    }

    function renderEffectiveConfigs(items) {
      el('effectiveConfigRows').innerHTML = '';
      items.forEach(item => {
        const tr = document.createElement('tr');
        const k = document.createElement('td'); k.textContent = item.label; k.style.fontWeight = '500';
        const v = document.createElement('td'); v.style.fontFamily = 'monospace';
        v.textContent = item.value.length > 70 ? item.value.substring(0, 67) + '...' : item.value;
        const s = document.createElement('td');
        const sourceMap = { workspace: 'Workspace', user: 'User', default: 'Default' };
        s.innerHTML = '<span class="source-tag" style="border-color:' + (item.source==='workspace'?'#3b82f6':item.source==='user'?'#10b981':'currentColor') + '; color:' + (item.source==='workspace'?'#3b82f6':item.source==='user'?'#10b981':'currentColor') + '">' + sourceMap[item.source] + '</span>';
        tr.append(k, v, s); el('effectiveConfigRows').appendChild(tr);
      });
    }

    function setTestConnectionPending(pending) {
      testConnectionPending = pending;
      const btn = el('testConnection');
      btn.disabled = pending;
      btn.textContent = pending ? '测试中...' : '测试连接';
    }

    function setState(state) {
      const optWS = el('scope').querySelector('option[value="workspace"]');
      if (optWS) optWS.disabled = !state.hasWorkspace;
      el('scope').value = state.hasWorkspace ? state.scope : 'user';

      el('baseURL').value = state.baseURL;
      el('model').value = state.model;
      el('recentCommitCount').value = String(state.recentCommitCount);
      el('autoStageUntracked').checked = Boolean(state.autoStageUntracked);
      el('messageStyle').value = state.messageStyle;
      el('languageMode').value = state.languageMode;
      el('promptTemplate').value = state.promptTemplate;
      promptTemplateSavedValue = state.promptTemplate.trim();

      updatePromptTemplateHint(); updateAutoStageHint(); updateScopeHint();
      updateApiState(Boolean(state.hasApiKey), state.apiKeySource);
      renderEffectiveConfigs(state.effectiveConfigs || []);
      if (testConnectionPending) {
        setTestConnectionPending(false);
      }
    }

    window.addEventListener('message', e => { if (e.data?.type === 'state') setState(e.data.payload); });

    el('scope').addEventListener('change', updateScopeHint);
    el('autoStageUntracked').addEventListener('change', updateAutoStageHint);
    el('promptTemplate').addEventListener('input', updatePromptTemplateHint);
    el('openMoleApiInvite').addEventListener('click', () => vscode.postMessage({ type: 'openMoleApiInvite' }));
    
    document.querySelectorAll('.token').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = el('promptTemplate'); const text = btn.textContent;
        const s = t.selectionStart, e = t.selectionEnd;
        t.value = t.value.substring(0, s) + text + t.value.substring(e);
        t.selectionStart = t.selectionEnd = s + text.length; t.focus(); updatePromptTemplateHint();
      });
    });

    el('saveBase').addEventListener('click', () => vscode.postMessage({ type: 'saveBase', payload: {
      scope: el('scope').value,
      baseURL: el('baseURL').value,
      model: el('model').value,
      recentCommitCount: Number(el('recentCommitCount').value),
      autoStageUntracked: el('autoStageUntracked').checked,
      messageStyle: el('messageStyle').value,
      languageMode: el('languageMode').value
    }}));

    el('savePromptTemplate').addEventListener('click', () => {
      const promptTemplate = el('promptTemplate').value;
      const trimmed = promptTemplate.trim();
      if (trimmed && (!trimmed.includes('{{DIFF}}') || !trimmed.includes('{{RECENT_COMMITS}}'))) {
        window.alert('模板至少需要包含 {{DIFF}} 与 {{RECENT_COMMITS}}。');
        return;
      }
      const confirmed = window.confirm('确认仅保存高级模板配置吗？');
      if (!confirmed) {
        return;
      }
      vscode.postMessage({
        type: 'savePromptTemplate',
        payload: {
          scope: el('scope').value,
          promptTemplate
        }
      });
    });

    el('resetPromptTemplate').addEventListener('click', () => {
      el('promptTemplate').value = '';
      updatePromptTemplateHint();
    });
    el('setApiKey').addEventListener('click', () => vscode.postMessage({ type: 'setApiKey' }));
    el('testConnection').addEventListener('click', () => {
      if (testConnectionPending) {
        return;
      }
      setTestConnectionPending(true);
      vscode.postMessage({
        type: 'testConnection',
        payload: {
          baseURL: el('baseURL').value,
          model: el('model').value
        }
      });
    });
    el('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
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
