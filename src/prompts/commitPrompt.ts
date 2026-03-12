import type { CommitMessageStyle } from '../services/config';
import type { OutputLanguage } from '../services/commitStyle';
import type { RecentCommit } from '../services/git';

const DIFF_CHAR_LIMIT = 12000;
export const ALLOWED_COMMIT_TYPES = 'feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert';

export const PROMPT_TEMPLATE_TOKENS = {
  diff: '{{DIFF}}',
  recentCommits: '{{RECENT_COMMITS}}',
  messageStyleRules: '{{MESSAGE_STYLE_RULES}}',
  languageInstruction: '{{LANGUAGE_INSTRUCTION}}',
  stylePreference: '{{STYLE_PREFERENCE}}',
  allowedTypes: '{{ALLOWED_TYPES}}'
} as const;

const REQUIRED_PROMPT_TOKENS = [PROMPT_TEMPLATE_TOKENS.diff, PROMPT_TEMPLATE_TOKENS.recentCommits] as const;

export const DEFAULT_PROMPT_TEMPLATE = [
  '你是一个资深工程师，请根据 Git 变更生成 Conventional Commits 提交信息。',
  '通用要求：',
  PROMPT_TEMPLATE_TOKENS.messageStyleRules,
  `5) type 仅限 ${PROMPT_TEMPLATE_TOKENS.allowedTypes}。`,
  `6) ${PROMPT_TEMPLATE_TOKENS.languageInstruction}`,
  '7) 避免使用“更新代码”“修改问题”等模糊描述。',
  '',
  '历史风格偏好：',
  PROMPT_TEMPLATE_TOKENS.stylePreference,
  '',
  '近期提交风格参考：',
  PROMPT_TEMPLATE_TOKENS.recentCommits,
  '',
  '当前变更 diff：',
  PROMPT_TEMPLATE_TOKENS.diff
].join('\n');

export interface CommitPromptOptions {
  messageStyle: CommitMessageStyle;
  outputLanguage: OutputLanguage;
  preferredTypes: string[];
  preferredScopes: string[];
}

function clipDiff(diff: string): string {
  if (diff.length <= DIFF_CHAR_LIMIT) {
    return diff;
  }
  return `${diff.slice(0, DIFF_CHAR_LIMIT)}\n\n[Diff truncated due to size limit]`;
}

function languageInstruction(outputLanguage: OutputLanguage): string {
  return outputLanguage === 'zh'
    ? 'subject 与 body 使用中文，术语可保留英文。'
    : 'subject 与 body 使用英文，表达简洁明确。';
}

function styleInstruction(options: CommitPromptOptions): string {
  const lines: string[] = [];

  if (options.preferredTypes.length > 0) {
    lines.push(`- 优先沿用近期常见 type：${options.preferredTypes.join(', ')}。`);
  }

  if (options.preferredScopes.length > 0) {
    lines.push(`- scope 尽量参考：${options.preferredScopes.join(', ')}。`);
  }

  if (lines.length === 0) {
    lines.push('- 无明显历史偏好时，选择最贴切的 type 与 scope。');
  }

  return lines.join('\n');
}

function messageStyleInstruction(messageStyle: CommitMessageStyle): string {
  if (messageStyle === 'title+body') {
    return [
      '1) 输出标准提交信息，可包含多行。',
      '2) 第一行必须是 Conventional Commit 标题：<type>(<scope>): <subject> 或 <type>: <subject>。',
      '3) 若包含 body，则第二行必须为空行，再写 2-4 行要点；不要写序号。',
      '4) 仅输出提交信息，不要额外解释。'
    ].join('\n');
  }

  return [
    '1) 只输出一行提交标题，不要解释。',
    '2) 格式必须是 <type>(<scope>): <subject> 或 <type>: <subject>。',
    '3) 仅输出该行，不要额外内容。'
  ].join('\n');
}

function replaceToken(template: string, token: string, value: string): string {
  return template.split(token).join(value);
}

export function validatePromptTemplate(template: string): string | undefined {
  const trimmed = template.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length > 8000) {
    return '模板长度不能超过 8000 字符。';
  }

  for (const token of REQUIRED_PROMPT_TOKENS) {
    if (!trimmed.includes(token)) {
      return `缺少必要占位符 ${token}。`;
    }
  }

  return undefined;
}

export function buildCommitPrompt(
  diff: string,
  recentCommits: RecentCommit[],
  options: CommitPromptOptions,
  customTemplate = ''
): string {
  const recent = recentCommits.length
    ? recentCommits
        .map((c) => `- ${c.hash.slice(0, 7)} ${c.message}`)
        .join('\n')
    : '- (无历史提交可参考)';

  const template = customTemplate.trim() ? customTemplate : DEFAULT_PROMPT_TEMPLATE;
  const templateValidationError = validatePromptTemplate(template);
  if (templateValidationError) {
    throw new Error(`Prompt 模板无效：${templateValidationError}`);
  }

  let prompt = template;
  prompt = replaceToken(prompt, PROMPT_TEMPLATE_TOKENS.allowedTypes, ALLOWED_COMMIT_TYPES);
  prompt = replaceToken(prompt, PROMPT_TEMPLATE_TOKENS.messageStyleRules, messageStyleInstruction(options.messageStyle));
  prompt = replaceToken(prompt, PROMPT_TEMPLATE_TOKENS.languageInstruction, languageInstruction(options.outputLanguage));
  prompt = replaceToken(prompt, PROMPT_TEMPLATE_TOKENS.stylePreference, styleInstruction(options));
  prompt = replaceToken(prompt, PROMPT_TEMPLATE_TOKENS.recentCommits, recent);
  prompt = replaceToken(prompt, PROMPT_TEMPLATE_TOKENS.diff, clipDiff(diff));

  return prompt;
}
