#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合并「同名效果」：保留一条，把节点引用改到保留项，删除其余重复项。

用法（先看不动库）：
    python3 deploy/dedupe_effects.py
真删：
    python3 deploy/dedupe_effects.py --apply
指定库：
    python3 deploy/dedupe_effects.py --db /var/lib/fleet-tool/data.db --apply
"""
import os
import shutil
import sqlite3
import sys
import time

BUILTIN = ["dmg", "freq", "acc", "acc_small", "acc_large", "acc_plane",
           "armor", "crit_rate", "crit", "eff7587", "eva", "eva_missile", "eva_torp",
           "lock", "lockres", "hull", "move", "repair", "shield", "warp", "speed"]


def find_db(arg=None):
    for p in [arg, os.environ.get("FT_DATA"), "/var/lib/fleet-tool/data.db",
              "/opt/fleet-tool/data/data.db",
              os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.db")]:
        if not p:
            continue
        if os.path.isdir(p):
            p = os.path.join(p, "data.db")
        if os.path.exists(p):
            return p
    return None


def main():
    args = sys.argv[1:]
    db = None
    if "--db" in args:
        db = args[args.index("--db") + 1]
    apply_ = "--apply" in args
    db = find_db(db)
    if not db:
        print("找不到 data.db，请用 --db 指定")
        return 1
    print("数据库：", db)
    c = sqlite3.connect(db)
    c.row_factory = sqlite3.Row
    rows = [dict(r) for r in c.execute("SELECT id, name FROM effects ORDER BY id")]
    groups = {}
    for e in rows:
        key = str(e.get("name") or "").strip()
        if not key:
            continue
        groups.setdefault(key, []).append(str(e["id"]))

    plan = []
    for name, ids in groups.items():
        if len(ids) < 2:
            continue
        keeper = next((i for i in ids if i in BUILTIN), sorted(ids)[0])
        drops = [i for i in ids if i != keeper]
        plan.append((name, keeper, drops))

    if not plan:
        print("没有同名重复效果，无需处理")
        return 0

    print("\n发现 %d 组同名重复：" % len(plan))
    total_nodes = 0
    for name, keeper, drops in plan:
        n = c.execute("SELECT COUNT(*) FROM nodes WHERE effect IN (%s)" %
                      ",".join("?" * len(drops)), drops).fetchone()[0]
        total_nodes += n
        print("  %-12s 保留 %s，删除 %s（涉及节点 %d 个）" % (name, keeper, ",".join(drops), n))

    if not apply_:
        print("\n这是预演，没有改库。确认无误后加 --apply 真删。")
        return 0

    bak = db + ".bak-dedupe-" + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(db, bak)
    print("\n已备份：", bak)
    for name, keeper, drops in plan:
        q = ",".join("?" * len(drops))
        c.execute("UPDATE nodes SET effect=? WHERE effect IN (%s)" % q, [keeper] + drops)
        c.execute("DELETE FROM effects WHERE id IN (%s)" % q, drops)
    c.commit()
    left = c.execute("SELECT COUNT(*) FROM effects").fetchone()[0]
    print("完成：重指节点 %d 个，剩余效果 %d 条" % (total_nodes, left))
    return 0


if __name__ == "__main__":
    sys.exit(main())