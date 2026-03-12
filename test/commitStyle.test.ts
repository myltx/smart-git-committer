import { describe, expect, it } from 'vitest';

import { analyzeRecentCommitStyle, resolveOutputLanguage } from '../src/services/commitStyle';

describe('analyzeRecentCommitStyle', () => {
  it('提取常见 type 与 scope', () => {
    const profile = analyzeRecentCommitStyle([
      { hash: '1', message: 'feat(auth): add login', date: '2026-03-11', authorName: 'dev' },
      { hash: '2', message: 'fix(auth): resolve token issue', date: '2026-03-11', authorName: 'dev' },
      { hash: '3', message: 'feat(ui): improve table', date: '2026-03-11', authorName: 'dev' }
    ]);

    expect(profile.preferredTypes[0]).toBe('feat');
    expect(profile.preferredScopes).toContain('auth');
  });

  it('自动识别语言倾向', () => {
    const zhProfile = analyzeRecentCommitStyle([
      { hash: '1', message: 'feat: 新增登录能力', date: '2026-03-11', authorName: 'dev' },
      { hash: '2', message: 'fix: 修复跳转问题', date: '2026-03-11', authorName: 'dev' }
    ]);

    const enProfile = analyzeRecentCommitStyle([
      { hash: '1', message: 'feat: add login flow', date: '2026-03-11', authorName: 'dev' },
      { hash: '2', message: 'fix: resolve redirect bug', date: '2026-03-11', authorName: 'dev' }
    ]);

    expect(zhProfile.detectedLanguage).toBe('zh');
    expect(enProfile.detectedLanguage).toBe('en');
  });
});

describe('resolveOutputLanguage', () => {
  it('尊重手动配置优先级', () => {
    const profile = { preferredTypes: [], preferredScopes: [], detectedLanguage: 'en' as const };

    expect(resolveOutputLanguage('zh', profile)).toBe('zh');
    expect(resolveOutputLanguage('en', profile)).toBe('en');
    expect(resolveOutputLanguage('auto', profile)).toBe('en');
  });
});
