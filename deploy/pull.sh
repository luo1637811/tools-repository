#!/bin/bash
# 从 GitHub 镜像拉取指定文件；只换有变化的，语法不过就不换
# 用法：/opt/fleet-tool/deploy/pull.sh
REPO="luo1637811/tools-repository"
BRANCH="main"
DEST="/opt/fleet-tool"
PY="/opt/miniconda3/bin/python"
FILES="server.py db.py engine.py schema.py util.py static/index.html static/app.js static/style.css static/login.html"
MIRRORS=(
  "https://ghproxy.net/https://raw.githubusercontent.com/$REPO/$BRANCH"
  "https://gh-proxy.com/https://raw.githubusercontent.com/$REPO/$BRANCH"
  "https://cdn.jsdelivr.net/gh/$REPO@$BRANCH"
  "https://raw.githubusercontent.com/$REPO/$BRANCH"
)

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
for f in $FILES; do
  mkdir -p "$TMP/$(dirname "$f")"
  for m in "${MIRRORS[@]}"; do
    if curl -fsSL --max-time 25 "$m/$f" -o "$TMP/$f" && [ -s "$TMP/$f" ]; then
      break
    fi
  done
  [ -s "$TMP/$f" ] || { echo "[$(date +%F' '%T)] 拉取失败: $f"; exit 1; }
done

# 语法检查（后端）
if ! "$PY" -m py_compile "$TMP/server.py" 2>/tmp/pull_err; then
  echo "[$(date +%F' '%T)] 新代码语法错误，放弃本次更新"; cat /tmp/pull_err; exit 1
fi

changed=0
for f in $FILES; do
  if ! cmp -s "$TMP/$f" "$DEST/$f"; then
    cp -a "$DEST/$f" "$DEST/$f.bak-auto"
    cp "$TMP/$f" "$DEST/$f"
    echo "[$(date +%F' '%T)] 更新 $f"
    changed=1
  fi
done

if [ $changed -eq 1 ]; then
  systemctl restart fleet
  echo "[$(date +%F' '%T)] 已重启 fleet：$(systemctl is-active fleet)"
else
  echo "[$(date +%F' '%T)] 无变化"
fi

# 备份滚动清理：每个基名只保留最新 3 个 .bak-*，其余归档到 /root/bak-static
if [ -x "$DEST/deploy/prune_bak.sh" ]; then
  "$DEST/deploy/prune_bak.sh" "$DEST" /root/bak-static 3 30
else
  bash "$DEST/deploy/prune_bak.sh" "$DEST" /root/bak-static 3 30 2>/dev/null || true
fi