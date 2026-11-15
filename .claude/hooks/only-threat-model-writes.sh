#!/usr/bin/env bash
# PreToolUse hook for the security-reviewer subagent:
# allow Write/Edit only on docs/threat-model.md at the top of a worktree of THIS repository
# (the main checkout or a linked worktree), block everything else.
# Exit code 2 blocks the tool call and shows stderr to the agent. Any other exit code would let
# the call through, so every error path (missing jq, bad JSON, git failure) exits 2: fail closed.
# Tests: bash .claude/hooks/only-threat-model-writes.test.sh
set -euo pipefail

block() { echo "Blocked: $*" >&2; exit 2; }
trap 'block "write guard failed; security-reviewer may only write docs/threat-model.md."' ERR

command -v jq >/dev/null 2>&1 || block "jq is not installed; the write guard can't check the path."
command -v git >/dev/null 2>&1 || block "git is not installed; the write guard can't check the path."

input=$(cat)
file_path=$(jq -r '.tool_input.file_path // empty' <<<"$input" 2>/dev/null) \
  || block "could not read the tool input."
[[ -n "$file_path" ]] || block "security-reviewer may only write docs/threat-model.md (no file_path given)."

project_dir=${CLAUDE_PROJECT_DIR:-$(pwd)}
# Resolve relative paths, '..' and symlinks before comparing.
[[ "$file_path" = /* ]] || file_path="$project_dir/$file_path"
target=$(realpath -m -- "$file_path")

# The worktree that contains the target: nearest existing parent folder, then its git top level.
dir=$(dirname -- "$target")
while [[ ! -d "$dir" ]]; do dir=$(dirname -- "$dir"); done
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) \
  || block "security-reviewer may only write docs/threat-model.md, not $file_path (not in a git worktree)."
top=$(realpath -- "$top")

# That worktree must belong to this repository (same common git dir as the project).
common() { realpath -- "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)"; }
mine=$(common "$project_dir") || block "the project folder is not a git repository."
theirs=$(common "$top") || block "could not read the git folder of $top."

if [[ "$theirs" == "$mine" && "$target" == "$top/docs/threat-model.md" ]]; then
  exit 0
fi

block "security-reviewer may only write docs/threat-model.md of a worktree of this repository, not $file_path. Report findings instead of changing code."
