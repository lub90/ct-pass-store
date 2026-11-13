#!/usr/bin/env bash
# PreToolUse hook for the security-reviewer subagent:
# allow Write/Edit only on docs/threat-model.md, block everything else.
# Exit code 2 blocks the tool call and shows stderr to the agent.
set -euo pipefail

file_path=$(jq -r '.tool_input.file_path // empty')
project_dir=${CLAUDE_PROJECT_DIR:-$(pwd)}
allowed=$(realpath -m -- "$project_dir/docs/threat-model.md")

if [[ -z "$file_path" ]]; then
  echo "Blocked: security-reviewer may only write docs/threat-model.md (no file_path given)." >&2
  exit 2
fi

# Resolve relative paths, '..' and symlinks before comparing.
[[ "$file_path" = /* ]] || file_path="$project_dir/$file_path"
target=$(realpath -m -- "$file_path")

if [[ "$target" == "$allowed" ]]; then
  exit 0
fi

echo "Blocked: security-reviewer may only write docs/threat-model.md, not $file_path. Report findings instead of changing code." >&2
exit 2
