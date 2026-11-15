#!/usr/bin/env bash
# Tests for only-threat-model-writes.sh. Run: bash .claude/hooks/only-threat-model-writes.test.sh
# Builds throwaway repos in a temp folder; touches nothing in the real repository.
set -uo pipefail

hook="$(cd "$(dirname "$0")" && pwd)/only-threat-model-writes.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CEILING_DIRECTORIES="$tmp"

g() { git -c user.name=t -c user.email=t@example.invalid "$@" >/dev/null 2>&1; }
main="$tmp/main"; wt="$tmp/wt"; other="$tmp/other"
mkdir -p "$main/docs" "$other/docs"
echo x > "$main/docs/threat-model.md"; echo x > "$main/README.md"
g -C "$main" init -q; g -C "$main" add -A; g -C "$main" commit -qm init
g -C "$main" worktree add -q --detach "$wt"
echo x > "$other/docs/threat-model.md"
g -C "$other" init -q; g -C "$other" add -A; g -C "$other" commit -qm init
ln -s "$main/README.md" "$wt/docs/link.md"
# Worktrees of this repository whose threat model path is a symlink: Write would follow it.
for w in wt-file wt-other wt-dir-other wt-dir-same; do g -C "$main" worktree add -q --detach "$tmp/$w"; done
ln -sf "$tmp/wt-file/README.md" "$tmp/wt-file/docs/threat-model.md"                 # the file, to another file
ln -sf "$other/docs/threat-model.md" "$tmp/wt-other/docs/threat-model.md"           # the file, to another repo
rm -rf "$tmp/wt-dir-other/docs"; ln -s "$other/docs" "$tmp/wt-dir-other/docs"       # docs/, to another repo
mkdir -p "$tmp/wt-dir-same/notes"; echo x > "$tmp/wt-dir-same/notes/threat-model.md"
rm -rf "$tmp/wt-dir-same/docs"; ln -s "$tmp/wt-dir-same/notes" "$tmp/wt-dir-same/docs" # docs/, to another folder
plain="$tmp/plain"; mkdir -p "$plain"                                               # not a git repository

pass=0; fail=0
# expect <want-exit> <name> <json> [env assignments...]
expect() {
  local want=$1 name=$2 json=$3; shift 3
  local got
  printf '%s' "$json" | env CLAUDE_PROJECT_DIR="$main" "$@" bash "$hook" >/dev/null 2>&1
  got=$?
  if [[ $got == "$want" ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name (exit $got, want $want)"; fi
}
# expect_err <want-exit> <name> <json> <stderr substring> [env assignments...]: pins the branch that blocked.
expect_err() {
  local want=$1 name=$2 json=$3 msg=$4; shift 4
  local got err
  err=$(printf '%s' "$json" | env CLAUDE_PROJECT_DIR="$main" "$@" bash "$hook" 2>&1 >/dev/null)
  got=$?
  if [[ $got == "$want" && $err == *"$msg"* ]]; then pass=$((pass+1)); else
    fail=$((fail+1)); echo "FAIL: $name (exit $got, want $want; stderr: $err)"; fi
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
expect_err 2 "threat model outside any repo"     "$(fp "$tmp/docs/threat-model.md")" "(not in a git worktree)"
expect 2 "nested docs folder"                    "$(fp "$wt/sub/docs/threat-model.md")"
expect 2 "no file_path"                          '{"tool_input":{}}'
expect 2 "invalid JSON"                          'not json'
expect 2 "threat model is a symlink to a file"   "$(fp "$tmp/wt-file/docs/threat-model.md")"
expect 2 "threat model is a symlink to a repo"   "$(fp "$tmp/wt-other/docs/threat-model.md")"
expect 2 "docs/ is a symlink to another repo"    "$(fp "$tmp/wt-dir-other/docs/threat-model.md")"
expect 2 "docs/ is a symlink to another folder"  "$(fp "$tmp/wt-dir-same/docs/threat-model.md")"
expect_err 2 "project folder is not a git repo"  "$(fp "$main/docs/threat-model.md")" \
  "the project folder is not a git repository." CLAUDE_PROJECT_DIR="$plain"

# jq missing: PATH with every tool the hook needs except jq.
bin="$tmp/bin"; mkdir -p "$bin"
for t in bash env git realpath dirname cat; do ln -s "$(command -v "$t")" "$bin/$t"; done
expect 2 "jq missing"                            "$(fp "$main/docs/threat-model.md")" PATH="$bin"

# An unexpected failure of an unguarded command (here: realpath) must still block, through the ERR trap.
failbin="$tmp/failbin"; mkdir -p "$failbin"
for t in bash env git dirname cat jq; do ln -s "$(command -v "$t")" "$failbin/$t"; done
printf '#!/bin/sh\nexit 1\n' > "$failbin/realpath"; chmod +x "$failbin/realpath"
expect 2 "unexpected failure exits 2 (ERR trap)" "$(fp "$main/docs/threat-model.md")" PATH="$failbin"

echo "$pass passed, $fail failed"
[[ $fail == 0 ]]
