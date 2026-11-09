# -*- coding: utf-8 -*-
"""在服务器上重建超级管理员账号（root）。用法：python3 fix_root.py [新密码]"""
import hashlib
import secrets
import shutil
import sqlite3
import sys
import time

DB = "/opt/fleet-tool/data/data.db"
USERNAME = "root"
PWD = sys.argv[1] if len(sys.argv) > 1 else "Root#2026!"

bak = DB + ".bak-root-" + time.strftime("%Y%m%d-%H%M%S")
shutil.copy2(DB, bak)
print("已备份数据库:", bak)

con = sqlite3.connect(DB, timeout=10)
cols = [r[1] for r in con.execute("PRAGMA table_info(users)")]
salt = secrets.token_hex(8)
h = salt + "$" + hashlib.pbkdf2_hmac("sha256", PWD.encode(), salt.encode(), 120000).hex()
now = time.strftime("%Y-%m-%d %H:%M:%S")

row = {
    "username": USERNAME, "pwd": h, "role": "superadmin", "name": "超级管理员",
    "status": "在职", "perms": "", "scope": "all",
    "must_change": 1, "created_at": now, "updated_at": now,
}
row = {k: v for k, v in row.items() if k in cols}

old = con.execute("SELECT id FROM users WHERE username=?", (USERNAME,)).fetchone()
if old:
    sets = ", ".join("%s=?" % k for k in row if k != "username")
    con.execute("UPDATE users SET %s WHERE id=?" % sets,
                [v for k, v in row.items() if k != "username"] + [old[0]])
    print("已重置账号:", USERNAME, "(id=%s)" % old[0])
else:
    keys = ", ".join(row.keys())
    qs = ", ".join("?" * len(row))
    con.execute("INSERT INTO users(%s) VALUES(%s)" % (keys, qs), list(row.values()))
    print("已创建账号:", USERNAME)
con.commit()

print("\n当前账号列表：")
for r in con.execute("SELECT id, username, role, status, perms, scope FROM users ORDER BY id"):
    print("  %-4s %-14s %-12s %-6s perms=%-28s scope=%s" % r)

print("\n登录口令：%s / %s" % (USERNAME, PWD))
print("登录后请立刻改密（右上角 → 修改密码）。")
con.close()
