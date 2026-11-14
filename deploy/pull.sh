#!/usr/bin/env bash
# 追毫中枢 · 从 GitHub 拉取最新代码
#   清单只从 raw.githubusercontent.com 取（CDN 会缓存旧版，导致“无变化”或“大小不符”）
#   正文文件按 sha256 + 字节数双重校验，三镜像轮换，校验不过绝不覆盖线上
# 用法：sudo bash deploy/pull.sh
set -u

DEST="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${FT_REPO:-luo1637811/tools-repository}"
BRANCH="${FT_BRANCH:-main}"
RAW="https://raw.githubusercontent.com/$REPO/$BRANCH"
MIRRORS="$RAW
https://ghproxy.net/$RAW
https://gh-proxy.com/$RAW"

ts() { date +%H:%M:%S; }
say() { echo "[$(ts)] $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MAN="$DEST/deploy/MANIFEST.sha256"

say "拉清单"
ok=0
for i in 1 2 3; do
  if curl -fsSL --connect-timeout 8 --max-time 60 "$RAW/deploy/MANIFEST.sha256" -o "$TMP/M" 2>/dev/null; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  say "拉清单失败：连不上 raw.githubusercontent.com"
  exit 1
fi
N=$(grep -c . "$TMP/M" 2>/dev/null || echo 0)
say "清单：$N 个文件"
cp -f "$TMP/M" "$MAN"

CHANGED=0
FAIL=0
UPDATED=""

while read -r sha path size; do
  [ -z "${path:-}" ] && continue
  case "$path" in
    *.html) ISHTML=1 ;;
    *) ISHTML=0 ;;
  esac
  GOT=0
  while IFS= read -r base; do
    [ -z "$base" ] && continue
    if ! curl -fsSL --retry 1 --connect-timeout 8 --max-time 120 "$base/$path" -o "$TMP/f" 2>/dev/null; then
      continue
    fi
    SZ=$(wc -c < "$TMP/f" | tr -d ' ')
    if [ "$SZ" != "$size" ]; then
      echo "    ! $path 大小不符：$SZ / 期望 $size"
      continue
    fi
    if [ "$ISHTML" = 0 ] && head -c 300 "$TMP/f" | grep -qiE '<!doctype|<html'; then
      echo "    ! $path 拿到的是网页"
      continue
    fi
    SH2=$(sha256sum "$TMP/f" | cut -d' ' -f1)
    if [ "$SH2" != "$sha" ]; then
      echo "    ! $path 校验和不符"
      continue
    fi
    echo "  ✓ $path ($size 字节)"
    GOT=1
    break
  done <<EOF
$MIRRORS
EOF

  if [ "$GOT" != 1 ]; then
    FAIL=1
    say "拉取失败：$path"
    continue
  fi

  TGT="$DEST/$path"
  mkdir -p "$(dirname "$TGT")"
  if [ -f "$TGT" ] && cmp -s "$TMP/f" "$TGT"; then
    continue
  fi
  if [ -f "$TGT" ]; then
    cp -a "$TGT" "$TGT.bak-auto"
  fi
  cp -f "$TMP/f" "$TGT"
  say "更新 $path"
  CHANGED=1
  UPDATED="$UPDATED $path"
done < "$MAN"

if [ "$FAIL" = 1 ]; then
  say "有文件没拉下来，线上保持原样（未重启）"
  exit 1
fi

if [ "$CHANGED" = 1 ]; then
  if systemctl restart fleet; then
    say "已重启：$(systemctl is-active fleet)"
  else
    say "重启失败，请手动 systemctl restart fleet"
  fi
  say "同步完成：$(echo "$UPDATED" | wc -w | tr -d ' ') 个文件"
else
  say "无变化（线上已是最新）"
fi
