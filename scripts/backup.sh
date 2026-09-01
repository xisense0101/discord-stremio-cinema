#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="./data/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Creating backup in $BACKUP_DIR..."

if [ -d "./data/chromium-profiles" ]; then
  cp -r ./data/chromium-profiles "$BACKUP_DIR/"
fi

if [ -f ".env" ]; then
  cp .env "$BACKUP_DIR/.env.backup"
fi

echo "✅ Backup successfully created at $BACKUP_DIR"
