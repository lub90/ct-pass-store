#!/usr/bin/env bash
# Tests for only-threat-model-writes.sh. Run: bash .claude/hooks/only-threat-model-writes.test.sh
# Builds throwaway repos in a temp folder; touches nothing in the real repository.
set -uo pipefail

hook="$(cd "$(dirname "$0")" && pwd)/only-threat-model-writes.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

g() { git -c user.name=t -c user.email=t@example.invalid "$@" >/dev/null 2>&1; }
main="$tmp/main"; wt="$tmp/wt"; other="$tmp/other"
mkdir -p "$main/docs" "$other/docs"
echo x > "$main/docs/threat-model.md"; echo x > "$main/README.md"
g -C "$main" init -q; g -C "$main" add -A; g -C "$main" commit -qm init
g -C "$main" worktree add -q --detach "$wt"
echo x > "$other/docs/threat-model.md"
g -C "$other" init -q; g -C "$other" add -A; g -C "$other" commit -qm init
ln -s "$main/README.md" "$wt/docs/link.md"

pass=0; fail=0
# expect <want-exit> <name> <json> [env assignments...]
expect() {
  local want=$1 name=$2 json=$3; shift 3
  local got
  printf '%s' "$json" | env CLAUDE_PROJECT_DIR="$main" "$@" bash "$hook" >/dev/null 2>&1
  got=$?
  if [[ $got == "$want" ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name (exit $got, want $want)"; fi
}
fp() { printf '{"tool_input":{"file_path":"%s"}}' "$1"; }

expect 0 "main checkout threat model"            "$(fp "$main/docs/threat-model.md")"
expect 0 "linked worktree threat model"          "$(fp "$wt/docs/threat-model.md")"
expect 0 "relative path resolves to project dir" "$(fp "docs/threat-model.md")"
expect 2 "other file in main checkout"           "$(fp "$main/README.md")"
expect 2 "other file in worktree"                "$(fp "$wt/README.md")"
expect 2 "threat model of an unrelated repo"     "$(fp "$other/docs/threat-model.md")"
expect 2 "dot-dot escape to another file"        "$(fp "$wt/docs/../README.md")"
expect 2 "symlink to another file"               "$(fp "$wt/docs/link.md")"
expect 2 "threat model outside any repo"         "$(fp "$tmp/docs/threat-model.md")"
expect 2 "nested docs folder"                    "$(fp "$wt/sub/docs/threat-model.md")"
expect 2 "no file_path"                          '{"tool_input":{}}'
expect 2 "invalid JSON"                          'not json'

# jq missing: PATH with every tool the hook needs except jq.
bin="$tmp/bin"; mkdir -p "$bin"
for t in bash env git realpath dirname cat; do ln -s "$(command -v "$t")" "$bin/$t"; done
expect 2 "jq missing"                            "$(fp "$main/docs/threat-model.md")" PATH="$bin"

echo "$pass passed, $fail failed"
[[ $fail == 0 ]]
