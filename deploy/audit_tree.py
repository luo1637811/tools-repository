# -*- coding: utf-8 -*-
# 加点层级自查：逐船逐系统统计层数、每层节点数，并列出异常节点
# 用法：python3 audit_tree.py [data.db 路径]
import os, sys, sqlite3, collections

def find_db():
    if len(sys.argv) > 1:
        return sys.argv[1]
    cands = []
    if os.environ.get("FT_DATA"):
        cands.append(os.path.join(os.environ["FT_DATA"], "data.db"))
    cands += ["/var/lib/fleet-tool/data.db", "/opt/fleet-tool/data/data.db",
              os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.db")]
    for c0 in cands:
        if os.path.isfile(c0):
            return c0
    sys.exit("找不到 data.db，请把路径作为参数传入")

db = find_db()
c = sqlite3.connect(db)
c.row_factory = sqlite3.Row
print("库：%s" % db)

def par(n):
    return (n["parent"] or "").split(",")[0].strip()

rows, bad = [], []
for sh in c.execute("SELECT id,name FROM ships ORDER BY id"):
    sysrows = c.execute("SELECT id,name FROM systems WHERE ship=? ORDER BY id", (sh["id"],)).fetchall()
    descr = []
    for sy in sysrows:
        nodes = c.execute("SELECT id,label,parent FROM nodes WHERE sys=? ORDER BY id", (sy["id"],)).fetchall()
        if not nodes:
            continue
        byid = {n["id"]: n for n in nodes}
        def depth(n):
            d, p, g = 0, par(n), 0
            while p and p in byid and g < 30:
                d += 1
                p = par(byid[p])
                g += 1
            return d + 1
        cnt = collections.Counter(depth(n) for n in nodes)
        ks = sorted(cnt)
        descr.append("%s[%d层:%s]" % (sy["name"], len(ks), "/".join(str(cnt[k]) for k in ks)))
        for n in nodes:
            ps = [x.strip() for x in (n["parent"] or "").split(",") if x.strip()]
            if len(ps) > 1:
                bad.append((sh["name"], sy["name"], n["label"], "多前置（只按第一个算层）", n["parent"], depth(n)))
            for p in ps:
                if p not in byid:
                    bad.append((sh["name"], sy["name"], n["label"], "前置不在本系统", p, depth(n)))
    rows.append((sh["id"], sh["name"], len(sysrows), " ".join(descr)))

w = max([len(r[1]) for r in rows] + [10])
for r in rows:
    print("%-9s %-*s 系统%d  %s" % (r[0], w, r[1], r[2], r[3]))
print()
if bad:
    print("== 需关注 ==")
    for b in bad:
        print(" · ".join(map(str, b)))
else:
    print("== 无异常：所有节点的前置都在本系统内，且没有多前置 ==")
print()
print("说明：只有层数 >1 的系统才会出现第 2/3 层；其余系统所有节点的前置为空，只有第 1 层。")
