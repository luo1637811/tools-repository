# -*- coding: utf-8 -*-
"""小工具函数。"""
import json

def j(v):
    return v if isinstance(v, dict) else json.loads(v or "{}")


def num(x, d=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d
