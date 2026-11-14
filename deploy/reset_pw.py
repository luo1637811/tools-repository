# -*- coding: utf-8 -*-
"""服务器端账号急救工具（只能在服务器上以 root 运行，网页端无入口）

用途：
  * 超级管理员忘记密码 → 重置
  * 需要移除某个超管（网页端已禁止互删）
  * 看一眼账号现状

用法（在服务器上，建议先停服务再改）：
  sudo systemctl stop fleet
  sudo /opt/miniconda3/bin/python /opt/fleet-tool/deploy/reset_pw.py --list
  sudo /opt/miniconda3/bin/python /opt/fleet-tool/deploy/reset_pw.py root 'NewPass#2026'
  sudo /opt/miniconda3/bin/python /opt/fleet-tool/deploy/reset_pw.py --delete 某个超管
  sudo systemctl start fleet

可选：
  --db /path/to/data.db   指定库（默认自动找）
  --must-change           要求该账号下次登录必须改密（默认关闭，便于立刻登录）
  --role superadmin|admin|editor|viewer   顺便改角色
  --token 账号                            生成 10 分钟有效的救援令牌（网页自助重置用）

安全约定：
  * 本脚本需要服务器 shell 权限 = 物理/SSH 级信任，绕过网页端的全部限制
  * 每次执行都会写一条审计（action=命令行重置密码/命令行删除账号）
"""
import os
import sys
import sqlite3
import secrets
import hashlib
import datetime

ITER = 120000
SUPER = "superadmin"


def find_db(explicit=None):
    if explicit:
        return explicit
    cands = []
    if os.environ.get("FT_DATA"):
        cands.append(os.path.join(os.environ["FT_DATA"], "data.db"))
    cands += [
        "/var/lib/fleet-tool/data.db",
        "/opt/fleet-tool/data/data.db",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.db"),
    ]
    for c in cands:
        if os.path.isfile(c):
            return c
    sys.exit("找不到 data.db，请用 --db 指定，例如 --db /var/lib/fleet-tool/data.db")


def hash_pwd(pwd, salt=None):
    salt = salt or secrets.token_hex(8)
    h = hashlib.pbkdf2_hmac("sha256", pwd.encode("utf-8"), salt.encode("utf-8"), ITER).hex()
    return salt + "$" + h


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def cols(c, table):
    return [r[1] for r in c.execute("PRAGMA table_info(%s)" % table)]


def audit(c, actor, action, target, detail, kind="管理"):
    try:
        ks = cols(c, "audit")
        row = {"ts": now(), "actor": actor, "action": action, "target": target,
               "detail": detail, "kind": kind}
        use = [k for k in row if k in ks]
        c.execute("INSERT INTO audit(%s) VALUES(%s)" % (
            ",".join(use), ",".join("?" * len(use))), [row[k] for k in use])
    except Exception as e:  # 审计失败不影响主流程
        print("（审计写入失败：%s）" % e)


def show(c):
    print("%-4s %-24s %-12s %-8s %-8s %s" % ("id", "username", "role", "status", "scope", "must_change"))
    for r in c.execute("SELECT id,username,role,status,scope,must_change FROM users ORDER BY id"):
        print("%-4d %-24s %-12s %-8s %-8s %s" % (
            r["id"], r["username"], r["role"] or "", r["status"] or "", r["scope"] or "", r["must_change"]))


def main():
    args = [a for a in sys.argv[1:]]
    db, must_change, role, delete, token_for = None, 0, None, None, None
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--token":
            i += 1
            token_for = args[i]
        elif a == "--db":
            i += 1
            db = args[i]
        elif a == "--must-change":
            must_change = 1
        elif a == "--role":
            i += 1
            role = args[i]
        elif a == "--delete":
            i += 1
            delete = args[i]
        elif a in ("-l", "--list"):
            rest = ["--list"]
        else:
            rest.append(a)
        i += 1

    path = find_db(db)
    print("库：%s" % path)
    c = sqlite3.connect(path, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=15000")

    if token_for:
        r = c.execute("SELECT id,username,role FROM users WHERE username=?", (token_for,)).fetchone()
        if not r:
            sys.exit("没有这个账号：%s（用 --list 看现有账号）" % token_for)
        if (r["role"] or "") != "superadmin":
            sys.exit("救援令牌只发给超级管理员；%s 当前角色是 %s" % (token_for, r["role"]))
        import hashlib, secrets, time as _t
        A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        tok = "".join(secrets.choice(A) for _ in range(4)) + "-" + \
              "".join(secrets.choice(A) for _ in range(4))
        raw = hashlib.sha256(tok.encode("utf-8")).hexdigest() + "|" + str(int(_t.time()) + 600)
        k = "rescue:" + token_for.lower()
        cur = c.execute("UPDATE settings SET v=? WHERE k=?", (raw, k))
        if cur.rowcount == 0:
            c.execute("INSERT INTO settings(k,v) VALUES(?,?)", (k, raw))
        c.commit()
        print("")
        print("  救援令牌：%s" % tok)
        print("  10 分钟内有效、只能使用一次。")
        print("  用法：登录页 →「超管：用救援令牌」→ 填 账号 + 令牌 + 新密码。")
        print("  （重置成功后令牌自动作废，并踢掉该账号的全部登录）")
        return

    if not rest or rest == ["--list"]:
        show(c)
        return

    if delete:
        un = delete
    else:
        if len(rest) == 1:
            # 只给了账号 → 交互输入新密码
            un = rest[0]
            import getpass
            pw1 = getpass.getpass("新密码（≥8 位，含两类字符）：")
            pw2 = getpass.getpass("再输一次：")
            if pw1 != pw2:
                sys.exit("两次输入不一致")
        elif len(rest) >= 2:
            un, pw1 = rest[0], rest[1]
        else:
            sys.exit("用法：reset_pw.py [--list] [账号 [新密码]] [--delete 账号] [--role 角色] [--token 账号] [--db 库]")

    r = c.execute("SELECT id,username,role FROM users WHERE username=?", (un,)).fetchone()
    if not r:
        sys.exit("没有这个账号：%s（用 --list 看现有账号）" % un)

    if delete:
        if r["role"] == SUPER:
            n = c.execute("SELECT COUNT(*) n FROM users WHERE role=?", (SUPER,)).fetchone()["n"]
            if n <= 1:
                sys.exit("这是最后一个超级管理员，删掉就没人能发布版本/建管理员了")
        c.execute("DELETE FROM users WHERE id=?", (r["id"],))
        c.execute("DELETE FROM sessions WHERE user=?", (r["id"],))
        audit(c, "server-cli", "命令行删除账号", r["username"], "role=%s" % (r["role"] or ""))
        c.commit()
        print("✓ 已删除账号 %s（id=%d）" % (r["username"], r["id"]))
        return

    if len(pw1) < 8:
        sys.exit("密码至少 8 位")
    c.execute("UPDATE users SET pwd=?, must_change=?, pwd_changed_at=?, updated_at=? WHERE id=?",
              (hash_pwd(pw1), must_change, now(), now(), r["id"]))
    if role:
        c.execute("UPDATE users SET role=? WHERE id=?", (role, r["id"]))
    c.execute("DELETE FROM sessions WHERE user=?", (r["id"],))
    audit(c, "server-cli", "命令行重置密码", r["username"],
          "role=%s%s" % (role or r["role"] or "", "，需改密" if must_change else ""))
    c.commit()
    print("✓ 已重置 %s 的密码（id=%d）%s" % (r["username"], r["id"], "，角色改为 %s" % role if role else ""))
    print("  已踢掉该账号的全部会话；现在可以启动服务并登录。")


if __name__ == "__main__":
    main()
