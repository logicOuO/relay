---
name: relay
description: relay 开发流程的安装器与兜底入口。用于：给项目安装或更新 relay 流程；或者要修改代码、配置、测试，而项目 AGENTS.md 里没有 relay 段时。项目里已有 relay 段时直接照该段执行，不需要本 Skill。Use to install/update the relay process into a project's AGENTS.md, or before a code-changing task in a project whose AGENTS.md has no relay segment.
---

# Relay

流程本身写在项目根目录 AGENTS.md 的 `<!-- relay:begin vN -->` … `<!-- relay:end -->` 段里，这样 Codex、Cursor、Gemini 等读 AGENTS.md 的 AI 不装任何东西也能遵守。本 Skill 只做两件事：在没有 relay 段的项目里作为兜底入口，以及把流程安装进项目。模板只有一份：[template.md](template.md)。

## 开始改代码前

1. 在项目根目录的 AGENTS.md 里找 relay 段。
2. 找到了：照该段执行。版本号低于 template.md 时，提醒用户可以更新，但不自动改。
3. 没找到：先问用户要不要为本项目安装（推荐安装）。用户不装时，本次按 template.md 的内容执行。

## 安装或更新

1. 读 template.md，取 `relay:begin` 到 `relay:end` 两行之间的内容（含这两行）。
2. 写入 AGENTS.md：
   - 已有 relay 段：整段替换。
   - 没有：插在项目自己的“修改流程”或 workflow 类章节之前；找不到就追加到文件末尾。
   - 没有 AGENTS.md：新建，只放这一段。
   - 保持原文件的换行风格（CRLF 或 LF）。
3. 让 Claude Code 也能读到：CLAUDE.md 不存在就新建，内容为 `@AGENTS.md`；已存在但没有 `@AGENTS.md` 就加一行。
4. 项目原有的流程章节如果和 relay 段重复，删掉重复部分，只保留项目特有的补充，并改为引用 relay 段。删之前先告诉用户要删什么。
5. 检查本机 Codex：若装了 Codex 且 `codex features list` 显示 `default_mode_request_user_input` 为 false，提示用户运行 `npx github:logicOuO/relay install` 或按仓库 README 手动打开（改 `~/.codex/config.toml` 前先问）。
6. 安装本身按常规档的改动处理：完成后给出 diff 摘要，提交前先问用户。

## 不要

- 不在本 Skill 或模板里写项目事实（安全不变量、测试命令、文档同步规则、回滚注意事项）。这些写在 AGENTS.md 的其他章节。
- 不在项目里手改 relay 段。要改就改 template.md，再重新安装。
