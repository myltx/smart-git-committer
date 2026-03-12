import { describe, expect, it } from 'vitest';

import { isConventionalCommit, normalizeCommitMessage } from '../src/utils/conventionalCommit';

describe('normalizeCommitMessage', () => {
  it('title 模式会移除 markdown 代码块与前缀', () => {
    const raw = `\`\`\`text
提交信息: feat(auth): 支持 SSO 登录
\`\`\``;
    expect(normalizeCommitMessage(raw, 'title')).toBe('feat(auth): 支持 SSO 登录');
  });

  it('title 模式多行只取第一行非空文本', () => {
    const raw = '\n\nfix: 修复登录重定向\n补充说明';
    expect(normalizeCommitMessage(raw, 'title')).toBe('fix: 修复登录重定向');
  });

  it('title+body 模式保留正文并补齐空行分隔', () => {
    const raw = 'feat(auth): add oauth login\n- update login service\n- add docs';
    expect(normalizeCommitMessage(raw, 'title+body')).toBe(
      'feat(auth): add oauth login\n\n- update login service\n- add docs'
    );
  });
});

describe('isConventionalCommit', () => {
  it('title 模式校验合法格式', () => {
    expect(isConventionalCommit('feat(auth): 支持 SSO 登录', 'title')).toBe(true);
    expect(isConventionalCommit('chore: 更新依赖', 'title')).toBe(true);
    expect(isConventionalCommit('feat!: 重构配置加载', 'title')).toBe(true);
  });

  it('title 模式拒绝多行与非法格式', () => {
    expect(isConventionalCommit('fix: 修复问题\n\n补充', 'title')).toBe(false);
    expect(isConventionalCommit('更新代码', 'title')).toBe(false);
    expect(isConventionalCommit('feature: 新增功能', 'title')).toBe(false);
  });

  it('title+body 模式允许正文', () => {
    expect(isConventionalCommit('fix: resolve login bug\n\nupdate redirect rule', 'title+body')).toBe(true);
  });
});
