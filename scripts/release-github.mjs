#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const cmdText = [command, ...args].join(' ');
  console.log(`\n> ${cmdText}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    console.error(stderr || `命令执行失败: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? '').trim();
}

function runCaptureOptional(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    return undefined;
  }
  return (result.stdout ?? '').trim();
}

function fail(message) {
  console.error(`\n[release:github] ${message}`);
  process.exit(1);
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeGitHubRepoUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return '';
  }

  const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  }

  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return '';
}

function getRepoWebUrl(pkg) {
  const repoFromPkg =
    typeof pkg.repository === 'string'
      ? pkg.repository
      : typeof pkg.repository?.url === 'string'
      ? pkg.repository.url
      : '';
  const normalizedFromPkg = normalizeGitHubRepoUrl(repoFromPkg);
  if (normalizedFromPkg) {
    return normalizedFromPkg;
  }

  const remoteUrl = runCaptureOptional('git', ['remote', 'get-url', 'origin']) ?? '';
  const normalizedFromRemote = normalizeGitHubRepoUrl(remoteUrl);
  if (normalizedFromRemote) {
    return normalizedFromRemote;
  }

  fail('无法解析 GitHub 仓库地址，请先在 package.json 的 repository.url 中配置。');
}

function getLatestTag() {
  return runCaptureOptional('git', ['describe', '--tags', '--abbrev=0']);
}

function getCommitSubjectsSince(latestTag) {
  const args = ['log', '--no-merges', '--pretty=format:%s'];
  if (latestTag) {
    args.push(`${latestTag}..HEAD`);
  }

  const raw = runCapture('git', args);
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildReleaseSections(subjects) {
  const sections = {
    Added: [],
    Changed: [],
    Fixed: []
  };

  for (const subject of subjects) {
    const match = subject.match(/^([a-zA-Z]+)(\([^)]*\))?!?:\s+(.+)$/);
    if (!match) {
      sections.Changed.push(subject);
      continue;
    }

    const type = match[1].toLowerCase();
    if (type === 'feat') {
      sections.Added.push(subject);
      continue;
    }
    if (type === 'fix') {
      sections.Fixed.push(subject);
      continue;
    }
    sections.Changed.push(subject);
  }

  if (!sections.Added.length && !sections.Changed.length && !sections.Fixed.length) {
    sections.Changed.push('chore: maintenance release');
  }

  return sections;
}

function buildReleaseSection(version, date, sections) {
  const parts = [`## [${version}] - ${date}`, ''];

  if (sections.Added.length) {
    parts.push('### Added', '');
    for (const item of sections.Added) {
      parts.push(`- ${item}`);
    }
    parts.push('');
  }

  if (sections.Changed.length) {
    parts.push('### Changed', '');
    for (const item of sections.Changed) {
      parts.push(`- ${item}`);
    }
    parts.push('');
  }

  if (sections.Fixed.length) {
    parts.push('### Fixed', '');
    for (const item of sections.Fixed) {
      parts.push(`- ${item}`);
    }
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}

function upsertReference(content, label, url) {
  const pattern = new RegExp(`^\\[${escapeRegExp(label)}\\]:\\s+.*$`, 'm');
  const line = `[${label}]: ${url}`;
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

function updateChangelog({ version, tag, previousTag, subjects, repoWebUrl }) {
  const changelogPath = new URL('../CHANGELOG.md', import.meta.url);
  const today = new Date().toISOString().slice(0, 10);
  const releaseSection = buildReleaseSection(version, today, buildReleaseSections(subjects));

  let content = existsSync(changelogPath)
    ? readFileSync(changelogPath, 'utf8')
    : '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- 暂无\n';

  if (content.includes(`## [${version}]`)) {
    fail(`CHANGELOG 已包含版本 ${version}，请确认后重试。`);
  }

  const unreleasedBlock = '## [Unreleased]\n\n### Added\n\n- 暂无\n';
  const unreleasedPattern = /## \[Unreleased\][\s\S]*?(?=\n## \[|$)/m;
  if (unreleasedPattern.test(content)) {
    content = content.replace(unreleasedPattern, `${unreleasedBlock}\n${releaseSection}\n`);
  } else {
    content = `${content.trimEnd()}\n\n${unreleasedBlock}\n${releaseSection}\n`;
  }

  content = upsertReference(content, 'Unreleased', `${repoWebUrl}/compare/${tag}...HEAD`);
  if (previousTag) {
    content = upsertReference(content, version, `${repoWebUrl}/compare/${previousTag}...${tag}`);
  } else {
    content = upsertReference(content, version, `${repoWebUrl}/releases/tag/${tag}`);
  }

  writeFileSync(changelogPath, `${content.trimEnd()}\n`);
}

const bumpArg = process.argv[2];
if (!bumpArg) {
  fail('请传入版本参数，例如：npm run release:github -- 0.1.0 或 npm run release:github -- patch');
}

const statusOutput = runCapture('git', ['status', '--porcelain']);
if (statusOutput) {
  fail('当前有未提交改动。请先提交或暂存后再执行发布脚本。');
}

const branch = runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  fail(`当前分支是 ${branch}，请切到 main 后再发布。`);
}

const hasOrigin = runCapture('git', ['remote']).split(/\s+/).includes('origin');
if (!hasOrigin) {
  fail('未检测到 origin 远程仓库，请先配置远程地址。');
}

const previousTag = getLatestTag();
const subjects = getCommitSubjectsSince(previousTag);
if (subjects.length === 0) {
  fail(previousTag ? `未检测到 ${previousTag} 之后的提交，无法发布新版本。` : '未检测到可发布提交。');
}

console.log('\n[release:github] 开始执行质量检查...');
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'lint']);
run('npm', ['run', 'test']);
run('npm', ['run', 'build']);

console.log('\n[release:github] 更新版本号...');
run('npm', ['version', bumpArg, '--no-git-tag-version']);

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = String(pkg.version).trim();
if (!version) {
  fail('读取 package.json version 失败。');
}

const tag = `v${version}`;
const tagExists = runCapture('git', ['tag', '--list', tag]);
if (tagExists) {
  fail(`标签 ${tag} 已存在，请更换版本号后重试。`);
}

const repoWebUrl = getRepoWebUrl(pkg);
console.log('\n[release:github] 自动更新 CHANGELOG.md...');
updateChangelog({
  version,
  tag,
  previousTag,
  subjects,
  repoWebUrl
});

console.log(`\n[release:github] 提交版本 ${version}...`);
const filesToAdd = ['package.json', 'CHANGELOG.md'];
if (existsSync(new URL('../package-lock.json', import.meta.url))) {
  filesToAdd.push('package-lock.json');
}
run('git', ['add', ...filesToAdd]);
run('git', ['commit', '-m', `chore(release): ${tag}`]);
run('git', ['tag', tag]);

console.log('\n[release:github] 推送 main 与 tag...');
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);

console.log(`\n[release:github] 完成：${tag} 已推送，GitHub Actions 将自动发布 Release。`);
