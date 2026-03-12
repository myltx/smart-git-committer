# Smart Git Committer

一个 VS Code 插件：读取 Git 暂存区 diff + 最近提交记录，通过兼容 OpenAI 协议的 AI 接口生成 Conventional Commits 风格提交信息。
生成后会直接自动填充到 Source Control 提交输入框（无二次确认）。
当暂存区为空时，会自动回退使用工作区未暂存变更进行生成。
在该回退场景下，会把本次识别到的已跟踪变更文件自动加入暂存区；未跟踪文件默认不自动加入。

## 开发命令

- `npm run build`：使用 tsup 打包到 `out/`
- `npm run watch`：监听构建
- `npm run typecheck`：类型检查
- `npm run lint`：ESLint 校验
- `npm run test`：Vitest 单测
- `npm run package:vsix`：打包扩展

## GitHub 发布

- 已内置 GitHub Actions 工作流：
- `push` 到 `main` 或 `PR -> main`：只执行质量检查（typecheck/lint/test/build）
- `push` 标签 `v*`（如 `v0.1.0`）：在通过质量检查后，自动打包 `.vsix` 并上传到 GitHub Releases

手动发布步骤示例：
- 更新 `package.json` 版本号（例如 `0.1.0`）
- 提交代码并推送到 `main`
- 打标签并推送：`git tag v0.1.0 && git push origin v0.1.0`

自动发布（推荐）：
- 常用：`npm run release:github -- patch`（自动 +0.0.1）
- 其他：`npm run release:github -- minor` / `npm run release:github -- major`
- 指定版本：`npm run release:github -- 0.1.0`
- 脚本会自动执行：质量检查 → 更新版本 → 自动写入 `CHANGELOG.md` → 提交 → 打 tag → 推送 `main` 与 tag
- 推送 tag 后会触发 GitHub Actions 自动上传 `.vsix` 到 Releases

## Commands

- `Smart Git Committer: 根据变更生成提交信息并填入输入框`
- `Smart Git Committer: 设置 API Key`
- `Smart Git Committer: 打开 Smart Git Committer 设置`（配置面板）
- 状态栏右下角提供快捷入口：`SGC 设置`
- Source Control 视图标题栏仅保留“生成提交信息”快捷按钮；“插件设置”位于仓库项菜单（右键仓库或对应二级菜单）
- 配置面板顶部提供 `测试连接`（使用当前 Base URL / Model + 已保存 API Key 进行连通性校验）

## Configuration

- `smartGitCommitter.baseURL` (default: `https://api.moleapi.com`)
- `smartGitCommitter.model` (default: `gpt-4o-mini`)
- `smartGitCommitter.apiKey` (不推荐，建议通过 SecretStorage)
- `smartGitCommitter.recentCommitCount` (default: `3`)
- `smartGitCommitter.maxDiffChars` (default: `12000`)
- `smartGitCommitter.includeGlobs` (default: `[]`)
- `smartGitCommitter.excludeGlobs` (default: `["**/*.lock","dist/**","out/**","coverage/**",".vscode/settings.json"]`)
- `smartGitCommitter.respectGitIgnore` (default: `true`)
- `smartGitCommitter.autoStageUntracked` (default: `false`)
- `smartGitCommitter.messageStyle` (`title` | `title+body`, default: `title`)
- `smartGitCommitter.languageMode` (`auto` | `zh` | `en`, default: `auto`)
- `smartGitCommitter.promptTemplate` (default: `""`, 留空使用内置模板)

`promptTemplate` 支持占位符：
- `{{DIFF}}`
- `{{RECENT_COMMITS}}`
- `{{MESSAGE_STYLE_RULES}}`
- `{{LANGUAGE_INSTRUCTION}}`
- `{{STYLE_PREFERENCE}}`
- `{{ALLOWED_TYPES}}`

## Security

- 优先将 API Key 存储到 VS Code `SecretStorage`
- 不会将 diff 或源代码打印到控制台日志

## 说明

- 若设置中存在明文 `smartGitCommitter.apiKey`，插件会提示迁移到 SecretStorage
- AI 输出会做 Conventional Commits 格式校验，不符合时会直接报错而不是自动提交
- 配置面板中“基础配置保存”和“高级模板保存”分离，降低误操作风险
- 可在配置面板点击 `测试连接`，快速验证 `API Key + Base URL + Model` 是否可用
- 配置面板 Base URL 说明区提供 MoleAPI 邀请链接入口：`https://home.moleapi.com/register?aff=GU6Y`
- 支持 include/exclude 文件过滤与 Diff 字符预算裁剪，提升大仓库生成稳定性
- 支持结合项目 `.gitignore` 规则过滤文件（可在设置面板开关）
- 默认忽略并排除 `.vscode/settings.json`，避免本地编辑器配置误提交
