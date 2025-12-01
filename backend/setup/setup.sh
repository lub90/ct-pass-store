#!/bin/bash

set -e  # abort on error

echo "🚀 === CtPassStore Setup Script ==="

cd ../

if ! command -v composer &> /dev/null; then
  echo "❌ Composer not found. Please install Composer before running this script."
  exit 1
fi

# Step 1: Run composer install
echo "📦 Installing dependencies with Composer..."
composer install --no-dev --optimize-autoloader

# Step 2: Ask for target directory
read -p "📂 Enter the target deployment directory (absolute path): " TARGET_DIR
# Expand ~ to $HOME if present
TARGET_DIR="${TARGET_DIR/#\~/$HOME}"

# Step 3: Check if directory exists
if [ ! -d "$TARGET_DIR" ]; then
  echo "🛠️ Directory does not exist. Creating..."
  mkdir -p "$TARGET_DIR"
fi

# Step 4: Ensure directory is empty
if [ "$(ls -A "$TARGET_DIR")" ]; then
  echo "❌ Error: Target directory is not empty. Aborting."
  exit 1
fi

# Step 5: Copy required folders and files
echo "📁 Copying files to $TARGET_DIR..."
cp -r config "$TARGET_DIR"/
cp -r public "$TARGET_DIR"/
cp -r src "$TARGET_DIR"/
cp -r vendor "$TARGET_DIR"/
cp .htaccess "$TARGET_DIR"

# Step 5a: Rename credentials-example.php to credentials.php
mv "$TARGET_DIR/config/credentials-example.php" "$TARGET_DIR/config/credentials.php"

# Step 6: Create logs folder and empty app.log
echo "📝 Creating logs directory..."
mkdir -p "$TARGET_DIR/logs"
touch "$TARGET_DIR/logs/app.log"

echo "✅ === Setup completed successfully! ==="
echo "Next steps:"
echo "1. Insert your ChurchTools credentials into $TARGET_DIR/config/credentials.php"
echo "2. Upload the contents of $TARGET_DIR to your webserver."
echo "3. Configure your hosting so that public/ is the webroot."
echo "🔒 Ensure the webserver user has write access to $TARGET_DIR/logs/app.log"
