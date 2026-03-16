# Changelog

项目的关键变更记录在此维护。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 暂无

## [0.3.1] - 2026-03-16

### Added

- feat(release): 精简配置项，优化设置保存逻辑
- feat(release): 添加自动生成 Release 说明功能


### Added

- 暂无

## [0.3.0] - 2026-03-12

### Added

- feat(release): 在状态栏添加快捷入口


### Added

- 暂无

## [0.2.0] - 2026-03-12

### Added

- feat(release): 更新 README.md 中的自动发布说明
- feat(release): 增加对文件过滤和 Diff 字符预算的支持
- feat(release): 修改 smartGitCommitter 语言模式
- feat(release): 自动更新 CHANGELOG.md

### Changed

- docs: add changelog


### Added

- 暂无

## [0.0.1] - 2026-03-12

### Added

- 初始化 VS Code 插件项目结构（TypeScript + VS Code Extension API + simple-git）。
- 支持基于暂存区（或工作区回退）生成 Conventional Commits 提交信息。
- 支持根据最近提交历史自动推断语言/风格（`auto`/`zh`/`en`）。
- 支持单行标题与多行（`title` / `title+body`）提交风格。
- 支持将生成结果自动填充到 Source Control 提交输入框。
- 支持 API Key 使用 SecretStorage 安全存储，并对明文配置提供迁移提示。
- 提供设置面板（基础配置与高级模板分离保存、连接测试、邀请链接入口）。
- 提供 GitHub Actions：`main` 做质量检查，`v*` tag 自动发布 Release 并上传 `.vsix`。

[Unreleased]: https://github.com/myltx/smart-git-committer/compare/v0.3.1...HEAD
[0.0.1]: https://github.com/myltx/smart-git-committer/releases/tag/v0.0.1
[0.2.0]: https://github.com/myltx/smart-git-committer/compare/v0.1.0...v0.2.0
[0.3.0]: https://github.com/myltx/smart-git-committer/compare/v0.2.0...v0.3.0
[0.3.1]: https://github.com/myltx/smart-git-committer/compare/v0.3.0...v0.3.1
