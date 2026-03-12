#!/usr/bin/env node

import { readFileSync } from 'node:fs';
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

function fail(message) {
  console.error(`\n[release:github] ${message}`);
  process.exit(1);
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

console.log(`\n[release:github] 提交版本 ${version}...`);
run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', `chore(release): ${tag}`]);
run('git', ['tag', tag]);

console.log('\n[release:github] 推送 main 与 tag...');
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);

console.log(`\n[release:github] 完成：${tag} 已推送，GitHub Actions 将自动发布 Release。`);
