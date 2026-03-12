import { describe, expect, it } from 'vitest';

import {
  buildCommitPrompt,
  PROMPT_TEMPLATE_TOKENS,
  validatePromptTemplate
} from '../src/prompts/commitPrompt';

describe('buildCommitPrompt', () => {
  it('包含近期提交、风格偏好与 diff 内容', () => {
    const prompt = buildCommitPrompt(
      'diff --git a/a.ts b/a.ts',
      [
        {
          hash: '1234567890abcdef',
          message: 'feat: 初始提交',
          date: '2026-03-11',
          authorName: 'dev'
        }
      ],
      {
        messageStyle: 'title',
        outputLanguage: 'zh',
        preferredTypes: ['feat', 'fix'],
        preferredScopes: ['auth']
      }
    );

    expect(prompt).toContain('1234567 feat: 初始提交');
    expect(prompt).toContain('优先沿用近期常见 type：feat, fix');
    expect(prompt).toContain('scope 尽量参考：auth');
    expect(prompt).toContain('diff --git a/a.ts b/a.ts');
  });

  it('超长 diff 会被截断', () => {
    const longDiff = `a${'x'.repeat(13000)}`;
    const prompt = buildCommitPrompt(longDiff, [], {
      messageStyle: 'title+body',
      outputLanguage: 'en',
      preferredTypes: [],
      preferredScopes: []
    });

    expect(prompt).toContain('[Diff truncated due to size limit]');
  });

  it('支持自定义模板并替换占位符', () => {
    const prompt = buildCommitPrompt(
      'diff --git a/a.ts b/a.ts',
      [
        {
          hash: 'abcdef1234567890',
          message: 'fix(auth): 修复 token 续期',
          date: '2026-03-11',
          authorName: 'dev'
        }
      ],
      {
        messageStyle: 'title',
        outputLanguage: 'zh',
        preferredTypes: ['fix'],
        preferredScopes: ['auth']
      },
      [
        'RULES:',
        PROMPT_TEMPLATE_TOKENS.messageStyleRules,
        'RECENTS:',
        PROMPT_TEMPLATE_TOKENS.recentCommits,
        'DIFF:',
        PROMPT_TEMPLATE_TOKENS.diff
      ].join('\n')
    );

    expect(prompt).toContain('RULES:');
    expect(prompt).toContain('RECENTS:');
    expect(prompt).toContain('abcdef1 fix(auth): 修复 token 续期');
    expect(prompt).toContain('diff --git a/a.ts b/a.ts');
  });
});

describe('validatePromptTemplate', () => {
  it('缺少必要占位符会返回错误', () => {
    const error = validatePromptTemplate('只写一点说明，不含占位符');
    expect(error).toContain('{{DIFF}}');
  });

  it('空模板视为合法（使用内置模板）', () => {
    expect(validatePromptTemplate('')).toBeUndefined();
  });
});
