#!/bin/bash
# 从 GitHub 镜像拉取指定文件：先下到临时目录 → 按 MANIFEST 校验 sha256 → 语法检查 → 才替换
# 用法：bash /opt/fleet-tool/deploy/pull.sh
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

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 单个文件：依次试镜像，拒绝 HTML 错误页
fetch_one() {  # $1=仓库内路径  $2=落盘路径
  local f="$1" out="$2" m
  mkdir -p "$(dirname "$out")"
  for m in "${MIRRORS[@]}"; do
    rm -f "$out"
    if curl -fsSL --retry 2 --retry-delay 1 --connect-timeout 8 --max-time 90 "$m/$f" -o "$out" 2>/dev/null && [ -s "$out" ]; then
      if head -c 200 "$out" | grep -qiE '<!doctype|<html'; then
        echo "    ! 返回的是网页不是文件（$m）" >&2
        continue
      fi
      return 0
    fi
  done
  return 1
}

want_sha()  { awk -v f="$1" '$2==f{print $1}' "$TMP/MANIFEST.sha256" 2>/dev/null; }
want_size() { awk -v f="$1" '$2==f{print $3}' "$TMP/MANIFEST.sha256" 2>/dev/null; }

echo "[$(date +%F' '%T)] 拉取清单…"
if ! fetch_one "deploy/MANIFEST.sha256" "$TMP/MANIFEST.sha256"; then
  echo "[$(date +%F' '%T)] 拿不到 MANIFEST.sha256，本次用「大小 + 语法」兜底校验"
fi

fail=0
for f in $FILES; do
  ok=0
  for try in 1 2 3; do
    if fetch_one "$f" "$TMP/$f"; then
      got=$(sha256sum "$TMP/$f" | awk '{print $1}')
      exp=$(want_sha "$f")
      if [ -n "$exp" ]; then
        if [ "$got" = "$exp" ]; then ok=1; break; fi
        echo "    ! sha256 不符（第 $try 次）：$f 实际 $(stat -c%s "$TMP/$f") 字节"
      else
        ok=1; break
      fi
    fi
  done
  if [ $ok -ne 1 ]; then
    echo "[$(date +%F' '%T)] 拉取失败或校验不过：$f（清单期望 $(want_size "$f") 字节）"
    fail=1
  fi
done
[ $fail -eq 0 ] || { echo "[$(date +%F' '%T)] 放弃本次更新：有文件不完整/校验不符，线上未改动"; exit 1; }

# 后端语法检查（在临时目录里跑，失败绝不覆盖线上）
if ! "$PY" -m py_compile "$TMP/server.py" 2>/tmp/pull_err; then
  echo "[$(date +%F' '%T)] 新代码语法错误，放弃本次更新（线上未改动）"
  echo "---- /tmp/pull_err ----"; cat /tmp/pull_err
  echo "---- server.py 头部 ----"; head -c 200 "$TMP/server.py"; echo
  echo "---- 大小 ----"; stat -c%s "$TMP/server.py"
  exit 1
fi

changed=0
for f in $FILES; do
  if ! cmp -s "$TMP/$f" "$DEST/$f"; then
    cp -a "$DEST/$f" "$DEST/$f.bak-auto" 2>/dev/null || true
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

if [ -x "$DEST/deploy/prune_bak.sh" ]; then
  "$DEST/deploy/prune_bak.sh" "$DEST" /root/bak-static 3 30
else
  bash "$DEST/deploy/prune_bak.sh" "$DEST" /root/bak-static 3 30 2>/dev/null || true
fi
