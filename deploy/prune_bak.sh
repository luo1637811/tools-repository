#!/bin/bash
# 备份滚动清理：同一基名（app.js / index.html ...）只保留最新 KEEP 个，
# 其余移到归档目录按日期分桶；归档超过 ARCH_DAYS 天自动删除。
# 用法：prune_bak.sh [目标目录] [归档目录] [保留个数] [归档保留天数]
DEST="${1:-/opt/fleet-tool}"
ARCH="${2:-/root/bak-static}"
KEEP="${3:-3}"
ARCH_DAYS="${4:-30}"

[ -d "$DEST" ] || { echo "目录不存在: $DEST"; exit 0; }
mkdir -p "$ARCH"
TODAY=$(date +%Y%m%d)

moved=$(find "$DEST" -maxdepth 2 -type f -name '*.bak-*' -printf '%T@|%p\n' 2>/dev/null \
  | sort -t'|' -k1,1 -rn \
  | awk -F'|' -v keep="$KEEP" -v arch="$ARCH" -v day="$TODAY" '
      {
        p = $2
        n = split(p, a, "/")
        fn = a[n]
        sub(/\.bak-.*$/, "", fn)
        c[fn]++
        if (c[fn] > keep) {
          cmd = "mkdir -p \"" arch "/" day "\" && mv -f \"" p "\" \"" arch "/" day "/\" 2>/dev/null"
          if (system(cmd) == 0) print fn
        }
      }' | wc -l)

# 归档超过 ARCH_DAYS 天的
old=$(find "$ARCH" -type f -mtime +"$ARCH_DAYS" 2>/dev/null | wc -l)
find "$ARCH" -type f -mtime +"$ARCH_DAYS" -delete 2>/dev/null

echo "[$(date +%F' '%T)] 备份清理：归档 $moved 个 .bak，删除过期归档 $old 个"