# -*- coding: utf-8 -*-
"""数据库位置与连接（被 server / engine 共用）。

打包成单文件 exe 后有两套目录，必须分开：
  * RES_DIR  —— 只读资源（static、图标等），PyInstaller 每次启动解包到临时目录；
  * DATA_DIR —— 可写数据（data.db、logs、backups），放在 exe 旁边，不能跟着临时目录走。
"""
import os
import sqlite3
import sys

FROZEN = bool(getattr(sys, "frozen", False))
RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
BASE = RES_DIR
DATA_DIR = (os.environ.get("FT_DATA") or
            (os.path.dirname(os.path.abspath(sys.executable)) if FROZEN
             else os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.abspath(DATA_DIR)
try:
    os.makedirs(DATA_DIR, exist_ok=True)
except Exception:
    pass
DB_PATH = os.path.join(DATA_DIR, "data.db")


def conn():
    # timeout=15：并发写时等待而不是立刻抛 "database is locked"
    # 注意：journal_mode 只在建库时设一次（见 ensure_wal），别在每次连接里改，
    # 否则会和其它读事务互相等待、把登录请求拖到超时。
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    try:
        c.execute("PRAGMA busy_timeout=15000")
    except Exception:
        pass
    return c


def ensure_wal():
    """保留函数名（server 启动时调用）；实测 WAL 下「先读后写」会 SQLITE_BUSY，
    这里固定回滚日志模式，配合 busy_timeout 足够单人/小队使用。"""
    c = sqlite3.connect(DB_PATH, timeout=15)
    try:
        c.execute("PRAGMA journal_mode=DELETE")
        c.execute("PRAGMA synchronous=FULL")
    except Exception:
        pass
    c.close()

def _close_quiet(c):
    try:
        c.close()
    except Exception:
        pass
