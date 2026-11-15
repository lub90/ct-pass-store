#!/bin/sh
# Enables the repository's hooks (.githooks/) for this clone: sets core.hooksPath in the clone's .git/config only.
# Works without npm or composer. Refuses to replace a different, existing core.hooksPath.
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
if [ ! -f .githooks/pre-commit ]; then
  echo "install-hooks: .githooks/pre-commit not found in $root" >&2
  exit 1
fi
current=$(git config --get core.hooksPath)
if [ -n "$current" ] && [ "$current" != ".githooks" ]; then
  echo "install-hooks: core.hooksPath is already set to '$current'; not changed. Merge the hooks by hand or unset it first." >&2
  exit 1
fi
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
echo "install-hooks: core.hooksPath = .githooks (pre-commit check enabled for this clone)"
