import * as vscode from 'vscode';

const API_KEY_SECRET_KEY = 'smartGitCommitter.apiKey';
const PLAIN_KEY_WARNED_FLAG = 'smartGitCommitter.warnedPlainApiKey';

export async function setApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  await context.secrets.store(API_KEY_SECRET_KEY, apiKey.trim());
}

export async function hasApiKey(context: vscode.ExtensionContext): Promise<boolean> {
  const key = (await context.secrets.get(API_KEY_SECRET_KEY))?.trim();
  return Boolean(key);
}

export async function promptAndStoreApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    title: 'Smart Git Committer',
    prompt: '请输入 AI API Key（将安全存储到 VS Code SecretStorage）',
    placeHolder: 'sk-xxxx',
    password: true,
    ignoreFocusOut: true
  });

  const key = input?.trim();
  if (!key) {
    return undefined;
  }

  await setApiKey(context, key);
  return key;
}

async function maybeMigratePlainKey(context: vscode.ExtensionContext, plainKey: string): Promise<void> {
  const warned = context.globalState.get<boolean>(PLAIN_KEY_WARNED_FLAG);
  if (warned) {
    return;
  }

  const action = await vscode.window.showWarningMessage(
    '检测到 smartGitCommitter.apiKey 明文配置，建议迁移到 SecretStorage。',
    '立即迁移',
    '稍后'
  );

  await context.globalState.update(PLAIN_KEY_WARNED_FLAG, true);

  if (action !== '立即迁移') {
    return;
  }

  await setApiKey(context, plainKey);

  const config = vscode.workspace.getConfiguration('smartGitCommitter');
  try {
    await config.update('apiKey', '', vscode.ConfigurationTarget.Global);
  } catch {
    // 某些环境无全局设置写权限，保留降级行为即可。
  }

  vscode.window.showInformationMessage('API Key 已迁移到 SecretStorage。');
}

export async function resolveApiKey(
  context: vscode.ExtensionContext,
  apiKeyFromSettings?: string
): Promise<string | undefined> {
  const keyFromSecret = (await context.secrets.get(API_KEY_SECRET_KEY))?.trim();
  if (keyFromSecret) {
    return keyFromSecret;
  }

  if (apiKeyFromSettings?.trim()) {
    await maybeMigratePlainKey(context, apiKeyFromSettings);
    return apiKeyFromSettings.trim();
  }

  return promptAndStoreApiKey(context);
}
