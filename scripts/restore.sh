#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./scripts/restore.sh <path_to_backup_directory>"
  exit 1
fi

BACKUP_PATH="$1"
echo "Restoring from $BACKUP_PATH..."

if [ -d "$BACKUP_PATH/chromium-profiles" ]; then
  mkdir -p ./data
  cp -r "$BACKUP_PATH/chromium-profiles" ./data/
fi

if [ -f "$BACKUP_PATH/.env.backup" ]; then
  cp "$BACKUP_PATH/.env.backup" .env
fi

echo "✅ Restore completed successfully."
