#!/usr/bin/env bash
# UserPromptSubmit hook: remind when the current git repo has uncommitted changes.
# Never blocks; silent outside git repos.
dir="${CLAUDE_PROJECT_DIR:-$PWD}"
n=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
[ "${n:-0}" -gt 0 ] || exit 0
name=$(basename "$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)")
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"[relay] %s 有 %s 个未提交改动。若要开始新的代码任务，先请用户决定提交或 stash。"}}' "$name" "$n"
exit 0
