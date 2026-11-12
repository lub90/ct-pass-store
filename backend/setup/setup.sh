#!/bin/bash
# Builds an upload-ready folder of the PHP backend (spec 6.5).
#
# Usage: bash setup/setup.sh [TARGET_DIR]
#
# Composer runs in a temporary copy, never in your backend/ folder, so your dev dependencies (PHPUnit, ...) stay.

set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== CtPassStore Setup Script ==="

for tool in composer php; do
  if ! command -v "$tool" &> /dev/null; then
    echo "Error: $tool not found. Please install it before running this script."
    exit 1
  fi
done

# Step 1: target directory (first argument, or ask)
TARGET_DIR="${1:-}"
if [ -z "$TARGET_DIR" ]; then
  read -r -p "Enter the target deployment directory (absolute path): " TARGET_DIR
fi
# Expand ~ to $HOME if present
TARGET_DIR="${TARGET_DIR/#\~/$HOME}"
if [ -z "$TARGET_DIR" ]; then
  echo "Error: no target directory given. Aborting."
  exit 1
fi

# Step 2: the target must be empty (created if missing)
if [ ! -d "$TARGET_DIR" ]; then
  echo "Directory does not exist. Creating..."
  mkdir -p "$TARGET_DIR"
fi
if [ "$(ls -A "$TARGET_DIR")" ]; then
  echo "Error: Target directory is not empty. Aborting."
  exit 1
fi
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

# Step 3: version string, asked from git in the developer's folder (spec 6.5)
VERSION="$(php "$BACKEND_DIR/bin/version.php")"

# Step 4: build in a temporary folder
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "Copying sources to a temporary build folder..."
cp "$BACKEND_DIR/composer.json" "$BACKEND_DIR/composer.lock" "$BACKEND_DIR/VERSION" "$BACKEND_DIR/.htaccess" "$BUILD_DIR"/
cp -r "$BACKEND_DIR/public" "$BACKEND_DIR/src" "$BUILD_DIR"/
# Only the cleanup script ships; the other bin/ scripts are development and release tools.
mkdir "$BUILD_DIR/bin"
cp "$BACKEND_DIR/bin/cleanup.php" "$BUILD_DIR/bin"/
mkdir "$BUILD_DIR/config"
cp "$BACKEND_DIR/config/credentials-example.php" "$BUILD_DIR/config"/

echo "Installing dependencies with Composer (without dev tools)..."
(cd "$BUILD_DIR" && composer install --no-dev --optimize-autoloader --no-interaction)

# Step 5: assemble the target
echo "Copying files to $TARGET_DIR..."
cp -r "$BUILD_DIR/bin" "$BUILD_DIR/config" "$BUILD_DIR/public" "$BUILD_DIR/src" "$BUILD_DIR/vendor" "$TARGET_DIR"/
cp "$BUILD_DIR/.htaccess" "$TARGET_DIR"/
printf '%s\n' "$VERSION" > "$TARGET_DIR/version.txt"

# The backend creates its own cache files and logs; the folders just have to exist.
mkdir "$TARGET_DIR/cache" "$TARGET_DIR/logs"

# Step 6: permissions (spec 3.1). Files 640, folders 750; the secret-bearing folders 700.
find "$TARGET_DIR" -type f -exec chmod 640 {} +
find "$TARGET_DIR" -type d -exec chmod 750 {} +
chmod 700 "$TARGET_DIR/config" "$TARGET_DIR/cache" "$TARGET_DIR/logs"

# Step 7: check the result
echo "Checking the deploy folder..."
if ! php "$BACKEND_DIR/bin/check-deploy.php" "$TARGET_DIR"; then
  echo "Error: the deploy check failed. Do not upload $TARGET_DIR."
  exit 1
fi

echo "=== Setup completed successfully! Version $VERSION ==="
echo "Next steps:"
echo "1. Copy $TARGET_DIR/config/credentials-example.php to credentials.php (same folder) and fill in your values."
echo "   See docs/setup.md for every key."
echo "2. Upload the contents of $TARGET_DIR to your webserver and make public/ the web root."
echo "3. Uploads don't keep file modes. Set them again on the server (spec 3.1). Which mode depends on your hosting:"
echo "   - PHP runs as your hosting user (PHP-FPM, suPHP; most shared hosts): config/credentials.php 600,"
echo "     config/, cache/ and logs/ 700."
echo "   - PHP runs as the web server user (e.g. mod_php): give the web server's group read access, e.g."
echo "     config/credentials.php 640 and config/ 750 with that group, and let that group write cache/ and logs/ (770)."
echo "4. Keep cache/ on a local disk (not NFS or a network share) so file locking works."
echo "5. Call GET /v1/test as an admin to verify the installation."
