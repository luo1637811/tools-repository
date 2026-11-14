# -*- coding: utf-8 -*-
"""把 nodes.effect 里指向"已被删除的效果 id"改写为保留下来的 id。

用法：
  python deploy/repair_effect_keys.py --list                  # 只列出可疑引用
  python deploy/repair_effect_keys.py emw6jmd52=emw6izpl3     # 预演
  python deploy/repair_effect_keys.py emw6jmd52=emw6izpl3 --apply
  python deploy/repair_effect_keys.py --db /path/data.db ...
"""
import argparse, json, os, shutil, sqlite3, sys, time

def find_db(explicit=None):
    if explicit:
        return explicit
    cands = []
    env = os.environ.get("FT_DATA")
    if env:
        cands.append(os.path.join(env, "data.db"))
    cands += ["/var/lib/fleet-tool/data.db", "/opt/fleet-tool/data/data.db",
              os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data.db")]
    for c in cands:
        c = os.path.abspath(c)
        if os.path.isfile(c):
            return c
    raise SystemExit("找不到 data.db，请用 --db 指定")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pairs", nargs="*", help="old=new，可多个")
    ap.add_argument("--db")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    db = find_db(a.db)
    print("数据库：", db)
    c = sqlite3.connect(db); c.row_factory = sqlite3.Row
    ids = {r["id"] for r in c.execute("SELECT id FROM effects")}
    rows = c.execute("SELECT id, sys, label, effect FROM nodes").fetchall()
    broken = []
    for r in rows:
        raw = r["effect"]
        try:
            obj = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        miss = [k for k in obj if k not in ids]
        if miss:
            broken.append((r["id"], r["sys"], r["label"], obj, miss))
    print("节点总数 %d，含失效引用 %d 个" % (len(rows), len(broken)))
    for b in broken:
        print("   %-16s %-18s %-10s -> %s" % (b[0], b[1] or "", b[2] or "", ", ".join(b[4])))
    if a.list or not a.pairs:
        c.close(); return
    mp = {}
    for p in a.pairs:
        if "=" not in p:
            raise SystemExit("参数要写成 old=new：" + p)
        o, n = p.split("=", 1)
        mp[o.strip()] = n.strip()
    print("\n映射：", mp)
    todo = []
    for (nid, sysn, label, obj, miss) in broken:
        new = dict(obj); changed = False
        for k in list(new):
            if k in mp:
                v = new.pop(k)
                new[mp[k]] = new.get(mp[k], 0) + v
                changed = True
        if changed:
            todo.append((nid, json.dumps(new, ensure_ascii=False)))
            print("   改写 %-16s %s -> %s" % (nid, json.dumps(obj, ensure_ascii=False), todo[-1][1]))
    if not todo:
        print("没有需要改写的节点。"); c.close(); return
    if not a.apply:
        print("\n这是预演，没有改库。确认无误后加 --apply。"); c.close(); return
    bak = db + ".bak-keys-" + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(db, bak); print("\n已备份：", bak)
    for nid, eff in todo:
        c.execute("UPDATE nodes SET effect=? WHERE id=?", (eff, nid))
    c.commit()
    left = 0
    for r in c.execute("SELECT effect FROM nodes"):
        try: obj = json.loads(r["effect"])
        except Exception: continue
        if isinstance(obj, dict) and [k for k in obj if k not in ids]:
            left += 1
    print("完成：改写 %d 个节点，剩余失效引用 %d 个" % (len(todo), left))
    c.close()

if __name__ == "__main__":
    main()
