import * as http from 'node:http';
import * as https from 'node:https';

import { buildCommitPrompt } from '../prompts/commitPrompt';
import { analyzeRecentCommitStyle, resolveOutputLanguage } from './commitStyle';
import type { CommitLanguageMode, CommitMessageStyle } from './config';
import type { RecentCommit } from './git';
import { isConventionalCommit, normalizeCommitMessage } from '../utils/conventionalCommit';

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface ModelsResponse {
  data?: Array<{ id?: string }>;
  error?: {
    message?: string;
  };
}

export interface GenerateCommitInput {
  baseURL: string;
  model: string;
  apiKey: string;
  stagedDiff: string;
  recentCommits: RecentCommit[];
  messageStyle: CommitMessageStyle;
  languageMode: CommitLanguageMode;
  promptTemplate: string;
}

function parseJsonSafely(raw: string): ChatResponse {
  try {
    return JSON.parse(raw) as ChatResponse;
  } catch {
    return {};
  }
}

function requestJson(
  url: URL,
  payload: string,
  headers: Record<string, string>,
  timeoutMs = 30000
): Promise<{ statusCode: number; body: string }> {
  const isHttps = url.protocol === 'https:';
  const requester = isHttps ? https.request : http.request;

  return new Promise((resolve, reject) => {
    const req = requester(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers,
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('请求超时，请检查网络或稍后重试。'));
    });

    req.on('error', (error) => reject(error));

    req.write(payload);
    req.end();
  });
}

interface TestConnectionInput {
  baseURL: string;
  model: string;
  apiKey: string;
}

function parseModelsJsonSafely(raw: string): ModelsResponse {
  try {
    return JSON.parse(raw) as ModelsResponse;
  } catch {
    return {};
  }
}

export async function testAIConnection(input: TestConnectionInput): Promise<void> {
  const endpoint = new URL('/v1/chat/completions', input.baseURL.replace(/\/+$/, '') + '/');
  const payload = JSON.stringify({
    model: input.model,
    temperature: 0,
    max_tokens: 1,
    messages: [
      { role: 'system', content: 'Reply with OK.' },
      { role: 'user', content: 'ping' }
    ]
  });

  let response: { statusCode: number; body: string } | undefined;
  let lastError: unknown;
  for (let i = 0; i < 2; i += 1) {
    try {
      response = await requestJson(endpoint, payload, {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`
      });
      break;
    } catch (error) {
      lastError = error;
      if (i === 1) {
        throw error;
      }
    }
  }

  if (!response) {
    const message = lastError instanceof Error ? lastError.message : '连接测试失败';
    throw new Error(message);
  }

  if (response.statusCode >= 200 && response.statusCode < 300) {
    return;
  }

  const parsedChat = parseJsonSafely(response.body);
  const chatError = parsedChat.error?.message?.trim();
  if (chatError) {
    throw new Error(chatError);
  }

  const parsedModels = parseModelsJsonSafely(response.body);
  const modelsError = parsedModels.error?.message?.trim();
  if (modelsError) {
    throw new Error(modelsError);
  }

  throw new Error(`连接测试失败（HTTP ${response.statusCode}）`);
}

export async function generateCommitMessage(input: GenerateCommitInput): Promise<string> {
  const styleProfile = analyzeRecentCommitStyle(input.recentCommits);
  const outputLanguage = resolveOutputLanguage(input.languageMode, styleProfile);
  const prompt = buildCommitPrompt(input.stagedDiff, input.recentCommits, {
    messageStyle: input.messageStyle,
    outputLanguage,
    preferredTypes: styleProfile.preferredTypes,
    preferredScopes: styleProfile.preferredScopes
  }, input.promptTemplate);
  const endpoint = new URL('/v1/chat/completions', input.baseURL.replace(/\/+$/, '') + '/');

  const payload = JSON.stringify({
    model: input.model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          input.messageStyle === 'title+body'
            ? '你是一个只输出 Conventional Commits 的助手。可输出多行，但第一行必须是 Conventional Commit 标题，且不要输出解释。'
            : '你是一个只输出 Conventional Commits 单行标题的助手。禁止输出解释、代码块、序号或多行内容。'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  let response: { statusCode: number; body: string } | undefined;
  let lastError: unknown;
  for (let i = 0; i < 2; i += 1) {
    try {
      response = await requestJson(endpoint, payload, {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`
      });
      break;
    } catch (error) {
      lastError = error;
      if (i === 1) {
        throw error;
      }
    }
  }

  if (!response) {
    const message = lastError instanceof Error ? lastError.message : '请求失败';
    throw new Error(message);
  }

  const { statusCode, body } = response;
  const parsed = parseJsonSafely(body);

  if (statusCode < 200 || statusCode >= 300) {
    const message = parsed.error?.message?.trim() || `AI 服务请求失败（HTTP ${statusCode}）`;
    throw new Error(message);
  }

  const rawContent = parsed.choices?.[0]?.message?.content?.trim();
  if (!rawContent) {
    throw new Error('AI 未返回可用提交信息，请检查模型配置。');
  }

  const candidate = normalizeCommitMessage(rawContent, input.messageStyle);
  if (!candidate) {
    throw new Error('AI 返回内容为空，请重试。');
  }

  if (!isConventionalCommit(candidate, input.messageStyle)) {
    throw new Error(`AI 返回不符合 Conventional Commits 规范：${candidate}`);
  }

  return candidate;
}
