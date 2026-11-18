# Relay

给 Claude Code 和 Codex 用的轻量开发流程：开工前用白话对齐需求，完工后逐条对照需求验收。

流程正文写在各项目的 `AGENTS.md` 里，跟着 git 走。所有会读 `AGENTS.md` 的 AI（Codex、Cursor、Gemini CLI 等）不用另外安装就能遵守。本仓库提供的是 Claude Code 的入口和安装器，以及一键部署和卸载。

## 流程概要

1. **分档**：微小改动直接改；碰到安全不变量的属于高风险，每一步都不能跳。
2. **对齐需求**：用白话说明要做什么、什么不变，最多问 3 个问题，并附上推荐答案。能弹选择框的工具就用选择框问。用户回复之前不开工。
3. **开工前**：工作区必须干净；改动拆成可以单独回滚的小提交。
4. **实现**：只做确认过的范围；发现方案不对就停下，重新对齐。
5. **验收**：分两部分报告，一是测试命令和退出码，二是逐条对照需求。高风险改动在提交前，由没参与实现的子代理或新会话审 diff。
6. **交付**：同步文档，提交说明里写用户确认过的取舍和回滚影响；推送和部署前先问。新发现的约束经用户同意后写回：默认进模块文档，只有每次都要守的规则才进 AGENTS.md，并同时清理旧规则。

被委派的执行方（任务里已经给出验收命令）跳过第 2 步，直接实现。

完整内容见 [skill/template.md](skill/template.md)。

## 一键部署

需要 Node.js 18 以上版本。

```bash
npx github:logicOuO/relay install
```

部署会做以下几件事。每一项都可以单独跳过，重复运行不会重复添加：

| 内容 | 位置 | 跳过参数 |
| --- | --- | --- |
| Skill（入口和安装器） | `~/.claude/skills/relay/` | 无 |
| Codex Skill（入口和安装器） | `~/.codex/skills/relay/` | `--no-codex` |
| 工作区检查钩子：每次新对话开始时检查一次，有未提交改动就提醒 | `~/.claude/settings.json` 的 `hooks.SessionStart` | `--no-hook` |
| 一行全局指令：改代码按项目 AGENTS.md 的 relay 段执行（没有该段才用 relay skill），确认门槛优先于“自行假设”一类规则 | `~/.claude/CLAUDE.md` | `--no-claude-md` |
| Codex 默认模式下也能弹选择框 | `~/.codex/config.toml` 的 `[features] default_mode_request_user_input = true` | `--no-codex` |

`--no-codex` 同时跳过 Codex Skill 和对话选择框开关；没有 `~/.codex/` 目录时，这两项也会跳过。

修改任何文件之前，都会先在同一目录生成 `.relay-backup` 备份。

部署完成后重启 Claude Code。之后在某个项目里第一次提出改代码时，它会问你要不要把流程装进这个项目的 `AGENTS.md`。

## 一键卸载

```bash
npx github:logicOuO/relay uninstall
```

只撤掉安装时加的内容：删除 skill 目录，移除钩子、那一行全局指令和 Codex 开关。你自己的其他配置不受影响。已经写进各项目 `AGENTS.md` 的流程段不会动，那是项目内容，要删请在项目里自行删除。

## 状态检查

```bash
npx github:logicOuO/relay status
```

## Codex 开关说明

Codex 的 `request_user_input` 默认只在 Plan 模式下可用，打开 `default_mode_request_user_input` 后，默认模式也能弹选择框。这个开关被 Codex 标为“开发中”，升级后可能改名或移除；失效时流程会自动退回用文字列选项，不影响使用。

## 不做什么

- 不在流程里写项目的具体事实，比如安全不变量、测试命令、文档同步规则。这些写在各项目 `AGENTS.md` 的其他章节。
- 不替代项目自己的规则，只规定“怎么做”。
