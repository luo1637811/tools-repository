#!/usr/bin/env bash
# 每天备份 SQLite（放在宿主机上跑，不依赖容器）
# 用法：
#   chmod +x backup.sh
#   ( crontab -l 2>/dev/null; echo "30 3 * * * /srv/fleet/deploy/github/backup.sh" ) | crontab -
set -euo pipefail

DATA_DIR="${FT_DATA_HOST:-/srv/fleet/data}"
BACKUP_DIR="${FT_BACKUP_DIR:-/srv/fleet/backups}"
KEEP_DAYS="${FT_BACKUP_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F_%H%M)"
OUT="$BACKUP_DIR/data-$STAMP.db"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DATA_DIR/data.db" ".backup '$OUT'"
else
  # 容器在写时直接 cp 可能拿到半截文件，先停一秒再拷；有 sqlite3 优先用上面的
  cp "$DATA_DIR/data.db" "$OUT"
fi

find "$BACKUP_DIR" -name 'data-*.db' -mtime +"$KEEP_DAYS" -delete
echo "[backup] $OUT"
