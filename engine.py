# -*- coding: utf-8 -*-
"""纯计算：舰船/模块/舱位校验与指标计算（不碰 HTTP、不碰数据库）。"""
import json

from util import num, j
from db import conn

GROUP_RANK = {"小编组": 1, "中编组": 1, "中型编组": 1,
              "大编组": 2, "大型编组": 2}
GROUP_ALIAS = {"小": "中编组", "中": "中编组", "大": "大编组",
               "小型编组": "中编组", "大型编组": "大编组"}


def norm_group(g):
    """把各种写法统一成「中编组 / 大编组」；空值返回空串。"""
    s = str(g or "").strip()
    if not s:
        return ""
    s = GROUP_ALIAS.get(s, s)
    return s if s in ("中编组", "大编组") else s


def _group_ok(plane_group, bay_allow):
    """中/小编组战机可进大编组舱；大编组战机只进大编组舱；舱位没写限制则不限。"""
    if isinstance(bay_allow, (list, tuple)):
        allow = [norm_group(x) for x in bay_allow if str(x).strip()]
    else:
        allow = [norm_group(x) for x in str(bay_allow or "").replace("/", ",").split(",") if x.strip()]
    allow = [a for a in allow if a]
    if not allow:
        return True
    pg = norm_group(plane_group)
    if not pg:
        return True
    # 舱位写了多个编组时是「任选其一」，取最宽松的那个
    return GROUP_RANK.get(pg, 0) <= max(GROUP_RANK.get(a, 0) for a in allow)


def _normalize_ship(d):
    """尺寸与舰种/舰型保持一致：超主力舰=超大型舰船；主力舰=舰型；舰载机=尺寸即舰型。"""
    kind = (d.get("kind") or "").strip()
    cls = (d.get("cls") or "").strip()
    size = (d.get("size") or "").strip()
    if kind == "超主力舰":
        d["size"] = "超大型舰船"
    elif kind == "主力舰":
        if cls in ("巡洋舰", "驱逐舰", "护卫舰"):
            d["size"] = cls
    elif kind == "舰载机":
        if size in ("战机", "护航艇"):
            d["cls"] = size
        elif cls in ("战机", "护航艇"):
            d["size"] = cls
    return d



def _weapon_totals(ship):
    """武器系统的三类伤害合计（来自 systems.stats_norm 的 dmg_atk/dmg_air/dmg_siege）。"""
    import json as _json
    out = {"atk": 0.0, "air": 0.0, "siege": 0.0, "systems": 0}
    for sy in ship.get("systems") or []:
        raw = sy.get("stats_norm")
        if not raw:
            continue
        try:
            nm = _json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            continue
        hit = False
        for k, key in (("dmg_atk", "atk"), ("dmg_air", "air"), ("dmg_siege", "siege")):
            if k in nm:
                out[key] += float(nm[k] or 0)
                hit = True
        if hit:
            out["systems"] += 1
    for k in out:
        if k != "systems":
            out[k] = round(out[k], 1)
    return out


def sys_has_bay(sy):
    """这个系统能不能搭载舰载机（自带舱位 或 模块舱位）。"""
    try:
        if (sy.get("bays") or []):
            return True
    except Exception:
        pass
    n = sy.get("norm") or {}
    for k in ("bay_plane", "bay_boat", "bay_drone"):
        try:
            if float(n.get(k) or 0) > 0:
                return True
        except Exception:
            pass
    return False


def _crit_mul(pairs):
    """暴击期望倍率 = 1 + [Σ(概率×暴伤) + 全局暴伤×概率之和] / 10000。

    pairs 里每条是 (概率, 暴伤)，来自「一条效果」：
      - 同一节点同时写了 crit_rate 和 crit（如「30% 概率额外造成 50% 暴击伤害」）
        → 这一条自己成对相乘，不会被别的概率串味；
      - 只写暴伤、没写概率的节点是全局暴伤，加在**所有**概率上；
      - 只写概率、没写暴伤的节点（「暴击率 +30」）和同样单边的暴伤节点配对，
        行为与老口径一致。
    旧的「(Σ概率)×(Σ暴伤)」在两条各自带暴伤的概率效果并存时会高估
    （0.2×0.3 + 0.1×0.8 = 0.14，旧算法 (0.2+0.1)×(0.3+0.8) = 0.33）。"""
    both = 0.0       # Σ 成对效果的 概率×暴伤
    p_all = 0.0      # 所有概率之和
    cd_orphan = 0.0  # 只写暴伤、没写概率的那部分暴伤（全局暴伤）
    for _a, _b in (pairs or []):
        p_all += _a
        if _a and _b:
            both += _a * _b
        elif _b:
            cd_orphan += _b
    return 1.0 + (both + cd_orphan * p_all) / 10000.0


def plane_dpm_of(base, cd_reduce=0.0):
    """单架舰载机 DPM（完整系统制）。

    优先用 base 里的「单发伤害 / 弹药 / 攻击次数 / 持续时间 / 冷却时间」按母舰武器同一套
    周期公式算：dpm = 单发 × 弹药 × 攻击次数 × 60 / max(0.5, 持续 + 冷却)。
    cd_reduce 是「冷却缩减 %」合计（自身节点 + 承载系统节点），只作用在冷却时间上。
    字段没填齐的老数据退回 base.dpm（历史单值），结果不变、不报错。
    """
    b = base or {}
    dmg = num(b.get("dmg"), 0)
    ammo = num(b.get("ammo"), 0)
    atk = num(b.get("atk"), 1) or 1
    dur = num(b.get("dur"), 0)
    cdv = num(b.get("cd"), 0)
    if dmg and ammo and (dur or cdv):
        cdv = cdv * (1 - num(cd_reduce, 0) / 100.0)
        return dmg * ammo * atk / max(0.5, dur + cdv) * 60.0
    return num(b.get("dpm"), 0)


_RULES_CACHE = {}


def _rules():
    if "v" in _RULES_CACHE:
        return _RULES_CACHE["v"]
    try:
        from schema import EFFECT_RULES as _er
        _RULES_CACHE["v"] = _er
    except Exception:
        _RULES_CACHE["v"] = {}
    return _RULES_CACHE["v"]


# ---- 效果作用域 / 每级数组 / 六字段三路出数（schema v4） ----
EFF_SCOPE = {}      # {效果键: ship|system|weapon|plane}，simulate 里从库里读一次
STD_ARMOR = 10.0    # 对舰公式里扣掉的「标准护甲」，tooltip 写死的
AIR_RATIO = 0.80    # 对空相对对舰的系数（实测）
SYS_SCOPES = ("system", "weapon")


def _scope_of(k):
    """效果键的作用域：ship 整舰 / system 系统内 / weapon 武器 / plane 舰载机。

    以库里 effects.scope 为准（schema v3 已建列），库里没这个键时退回
    schema.EFFECT_RULES 的第三个字段；两边都没有的老键按 ship 处理，
    行为与 v3 之前完全一致（全键累加到整舰）。
    """
    s = (EFF_SCOPE.get(k) or "").strip() if EFF_SCOPE else ""
    if s:
        return s
    r = _rules().get(k)
    return (r[2] if r else "") or "ship"


def _per_lv(nd, k):
    """取节点的「每级数组」：per_lv 可以是 [2,2,3]（单键节点），
    也可以是 {"dmg": [2,2,3]}（多键节点）；没有就返回 None。"""
    pv = nd.get("per_lv")
    if isinstance(pv, dict):
        pv = pv.get(k)
    if isinstance(pv, (list, tuple)):
        arr = [num(x, 0) for x in pv]
        return arr or None
    return None


def _lv_amt(nd, k, v, lv):
    """一个节点在 lv 级时给某个键的加成，返回 (数额, 每级数组或 None)。

    有 per_lv 就逐级取和（「前 3 级 +2%、后 2 级 +3%」这种），级数超过数组长度
    时按最后一项继续外推；没有 per_lv 就是老口径「每级 v × 级数」。
    """
    lv = max(0, int(num(lv, 0)))
    arr = _per_lv(nd, k)
    if not arr:
        return float(num(v, 0)) * lv, None
    if lv <= len(arr):
        return float(sum(arr[:lv])), arr
    return float(sum(arr) + arr[-1] * (lv - len(arr))), arr


def _fmt_num(x):
    """整数不带小数尾巴，详情文案里好看一点。"""
    x = float(num(x, 0))
    return str(int(round(x))) if abs(x - round(x)) < 1e-9 else str(round(x, 2))


def _weapon_sys(sy):
    """这个系统有没有武器输出（多武器表 / 存好的三行 / 能算的六字段）。"""
    if sy.get("is_weapon"):
        return True
    n = sy.get("norm") or {}
    if isinstance(n.get("weapons"), list) and n.get("weapons"):
        return True
    if any(k in n for k in ("dmg_atk", "dmg_air", "dmg_siege")):
        return True
    ammo = num(n.get("ammo"), 0)
    atk = num(n.get("atk"), 0)
    volley = ammo * atk if (ammo and atk) else num(n.get("ammo_atk"), 0)
    return bool(num(n.get("dmg"), 0) and volley and (num(n.get("dur"), 0) or num(n.get("cd"), 0)))


def _weapon_out(sy, b, own_pairs, all_pairs, g=None):
    """把一个武器系统的六字段折算成三路输出：对舰 / 对空 / 攻城。

    多武器（stats_norm.weapons[]，文档重建后的新数据）逐把累加，每把带
    guns（门数）、armor（对舰扣的标准护甲，火炮/轨道炮 10，其余 0）、
    k（文档校准系数，反推不出来时让公式正好复现文档值）。
      对舰 = (单发 − armor) × 弹药 × 攻击次数 × 60 ÷ 周期 × 门数 × k
      对空 =  单发          × 弹药 × 攻击次数 × 60 ÷ 周期 × 门数 × k × 0.80
      周期 = max(0.5, 持续 + 冷却 × (1 − 冷却缩减%))
    对空有存档值时优先用存档值（每把武器有隐藏防空系数，反推不出来）；
    攻城公式也没反推出来：有 dmg_siege 就用存档值，没有标 pending。
    没有 weapons[] 的老数据退回单武器六字段，再退回存好的三行。
    """
    nm = sy.get("norm") or {}
    b = b or {}
    g = g or {}
    cdred = num(b.get("cd"), 0) + num(b.get("freq"), 0)
    durred = num(b.get("dur"), 0)
    fam_b = nm.get("fam_bonus") if isinstance(nm.get("fam_bonus"), dict) else {}
    crit = _crit_mul(own_pairs) * _crit_mul(all_pairs)
    m = 1 + num(b.get("dmg"), 0) / 100.0
    ws = nm.get("weapons")
    if isinstance(ws, list) and ws:
        tot_atk, tot_air, rows = 0.0, 0.0, []
        for w in ws:
            if not isinstance(w, dict):
                continue
            dmg = num(w.get("dmg"), 0)
            volley = num(w.get("volley"), 0)
            if not volley:
                volley = num(w.get("ammo"), 1) * num(w.get("atk"), 1)
            dur = num(w.get("dur"), 0)
            cdv = num(w.get("cd"), 0)
            guns = num(w.get("guns"), 0)
            armor = num(w.get("armor"), STD_ARMOR)
            kk = num(w.get("k"), 1) or 1.0
            fam = str(w.get("family") or "")
            # 伤害加成：系统调校/系统内节点（dmg_<族>）+ 整舰被动/节点（dmg_<族>）
            # 系统内 dmg（pct，整系统）统一在下面按 m 乘一次，和单武器/前端保持同一口径
            pct = (num(fam_b.get(fam), 0)
                   + num(b.get("dmg_" + fam), 0) + num(g.get("dmg_" + fam), 0))
            cyc = max(0.5, dur * (1 - durred / 100.0) + cdv * (1 - cdred / 100.0))
            p = 1 + pct / 100.0
            a = max(0.0, dmg - armor) * volley / cyc * 60.0 * guns * kk * p
            air = dmg * volley / cyc * 60.0 * guns * kk * p * AIR_RATIO
            tot_atk += a
            tot_air += air
            rows.append({"name": w.get("name") or fam, "family": fam, "dmg": dmg,
                         "volley": volley, "guns": guns, "armor": armor, "k": kk,
                         "cycle": round(cyc, 2), "atk": round(a, 1),
                         "air": round(air, 1)})
        _sa = nm.get("dmg_air")
        air_base = num(_sa, 0) if _sa is not None else tot_air
        air_src = "stored" if _sa is not None else "fields"
        # 对舰：文档（游戏显示值）给了系统级对舰就以它为准——近防/隐藏系数
        # 反推不出来（雨海 B 单发 10 算出 0，游戏写 80），现算只作核对。
        _sk = nm.get("dmg_atk")
        atk_calc = tot_atk * m * (1 + num(b.get("dmg_atk_pct"), 0) / 100.0)
        atk_src = "stored" if _sk is not None else "fields"
        atk_v = atk_calc if _sk is None else num(_sk, 0) * m * (1 + num(b.get("dmg_atk_pct"), 0) / 100.0)
        air_v = air_base * m * (1 + num(b.get("dmg_air_pct"), 0) / 100.0)
        _ss = nm.get("dmg_siege")
        sie = num(_ss, 0)
        sie_v = sie * m * (1 + num(b.get("dmg_siege_pct"), 0) / 100.0)
        f0 = ws[0] if isinstance(ws[0], dict) else {}
        return {
            "id": sy["id"], "name": sy["name"], "slot": (sy.get("slot") or "").strip(),
            "src": "weapons", "air_src": air_src, "atk_src": atk_src,
            "atk_calc": round(atk_calc * crit, 1),
            "cycle": rows[0]["cycle"] if rows else 0.0,
            "volley": num(f0.get("volley"), 0), "guns": num(f0.get("guns"), 0),
            "fields": {"dmg": num(f0.get("dmg"), 0), "ammo": num(f0.get("ammo"), 0),
                       "atk": num(f0.get("atk"), 0), "dur": num(f0.get("dur"), 0),
                       "cd": num(f0.get("cd"), 0)},
            "rows": rows,
            "atk": round(atk_v * crit, 1), "air": round(air_v * crit, 1),
            "siege": round(sie_v * crit, 1) if _ss is not None else None,
            "siege_src": "stored" if _ss is not None else "pending",
            "crit": round(crit, 3),
            "bonus": {k: round(num(b.get(k), 0), 2) for k in
                      ("dmg", "dmg_atk_pct", "dmg_air_pct", "dmg_siege_pct",
                       "cd", "freq", "crit_rate", "crit") if num(b.get(k), 0)},
        }
    dmg = num(nm.get("dmg"), 0)
    ammo = num(nm.get("ammo"), 0)
    atk = num(nm.get("atk"), 0)
    volley = ammo * atk if (ammo and atk) else num(nm.get("ammo_atk"), 0)
    dur = num(nm.get("dur"), 0)
    cdv = num(nm.get("cd"), 0)
    guns = num(nm.get("guns"), 0) or 1.0
    cycle = max(0.5, dur * (1 - durred / 100.0) + cdv * (1 - cdred / 100.0))
    if dmg and volley and (dur or cdv):
        shot = dmg * volley / cycle * 60.0 * guns
        atk_v = max(0.0, dmg - STD_ARMOR) * volley / cycle * 60.0 * guns
        air_v = shot * AIR_RATIO
        src = "fields"
    else:
        atk_v = num(nm.get("dmg_atk"), 0)
        air_v = num(nm.get("dmg_air"), 0)
        src = "stored"
    atk_calc = atk_v
    _sk = nm.get("dmg_atk")
    if _sk is not None:
        atk_v = num(_sk, 0)
        src = "stored"
    _sa = nm.get("dmg_air")
    if _sa is not None:
        air_v = num(_sa, 0)
    atk_v *= m * (1 + num(b.get("dmg_atk_pct"), 0) / 100.0)
    air_v *= m * (1 + num(b.get("dmg_air_pct"), 0) / 100.0)
    sie = num(nm.get("dmg_siege"), 0)
    sie_v = sie * m * (1 + num(b.get("dmg_siege_pct"), 0) / 100.0)
    cm = _crit_mul(own_pairs) * _crit_mul(all_pairs)
    return {
        "id": sy["id"], "name": sy["name"], "slot": (sy.get("slot") or "").strip(),
        "src": src, "cycle": round(cycle, 2), "volley": volley, "guns": guns,
        "atk_src": "stored" if _sk is not None else "fields",
        "atk_calc": round(atk_calc * cm, 1),
        "fields": {"dmg": dmg, "ammo": ammo, "atk": atk, "dur": dur, "cd": cdv},
        "atk": round(atk_v * cm, 1), "air": round(air_v * cm, 1),
        "siege": round(sie_v * cm, 1) if sie else None,
        "siege_src": "stored" if sie else "pending",
        "crit": round(cm, 3),
        "bonus": {k: round(num(b.get(k), 0), 2) for k in
                  ("dmg", "dmg_atk_pct", "dmg_air_pct", "dmg_siege_pct",
                   "cd", "freq", "crit_rate", "crit") if num(b.get(k), 0)},
    }


def simulate(ship, sel, alloc, bundle, plane_sel, light=False):
    """ship 是 load_bundle 里的对象（含 systems/modules）。"""
    global EFF, EFF_UNIT, EFF_SCOPE
    with conn() as _c:
        EFF = {r["id"]: r["name"] for r in _c.execute("SELECT id,name FROM effects")}
        EFF_UNIT = {r["id"]: (r["unit"] or "") for r in _c.execute("SELECT id,unit FROM effects")}
        try:
            EFF_SCOPE = {r["id"]: (r["scope"] or "") for r in _c.execute("SELECT id,scope FROM effects")}
        except Exception:
            EFF_SCOPE = {}
    base = ship["base"]
    agg = dict(dmg=0, cd=0, acc=0, eva=0, freq=0, armor=0, shield=0, hull=0, repair=0, plane=0)
    detail, ignored, violations = [], [], []
    unapplied = set()
    launch = None

    mods = {}
    for k, v in (sel or {}).items():
        ids = v if isinstance(v, (list, tuple)) else [v]
        for mid in ids:
            if mid:
                mods[mid] = mid
    if not ship["mod_ok"]:
        if mods:
            ignored = sorted(mods.keys())
        mods = {}
    by_id = {m["id"]: m for m in ship["modules"]}
    # 同系列（M/A/B…）只能装一个模块
    picked = {}
    for mid in list(mods.keys()):
        mm = by_id.get(mid)
        if not mm:
            continue
        letter = (mm.get("slot") or "")[:1]
        if not letter:
            continue
        if letter in picked:
            violations.append(f"{letter} 系列只能选一个模块：{picked[letter]} 与 {mid} 冲突，已忽略 {mid}")
            mods.pop(mid, None)
        else:
            picked[letter] = mid
    launches = []
    for mid in list(mods.keys()):
        m = by_id.get(mid)
        if not m:
            violations.append(f"模块 {mid} 不在「{ship['name']}」的模块表里（可能已删或换了 id）")
            continue
        for k, v in (m["bonus"] or {}).items():
            agg[k] = agg.get(k, 0) + v
        if m.get("bays"):
            launches.append(m)
        detail.append({"from": "模块 " + m["name"],
                       "text": "、".join(f"{k}+{v}" for k, v in (m["bonus"] or {}).items() if v) or "无加成（待填）"})
    # 没有模块、舱位直接写在系统上的（文档重建后的新数据）：系统自己当搭载位
    _covered = set((m.get("slot") or "").strip() for m in launches)
    for _sy in (ship.get("systems") or []):
        _slot = (_sy.get("slot") or "").strip()
        if not _slot or _slot in _covered:
            continue
        if _sy.get("bays") or sys_has_bay(_sy):
            launches.append({"id": _sy["id"], "name": _sy.get("name") or _sy["id"],
                             "slot": _slot, "bays": _sy.get("bays") or [],
                             "bonus": {}, "sys": _sy["id"]})

    tech_total = 0
    sys_used = {}
    bay_agg = {}
    per_sys_bay = {}
    # 系统调校级别的载机加成（如「本系统机库内载机伤害提高 5%」），按 slot 归属
    sys_carry = {}
    for _sy0 in (ship.get("systems") or []):
        _pv0 = num((_sy0.get("norm") or {}).get("plane"), 0)
        if _pv0:
            sys_carry[(_sy0.get("slot") or "").strip()] = _pv0
    bay_pairs = {}
    sys_agg = {}        # 系统内加成：{slot: {效果键: 合计}}（scope=system/weapon）
    crit_show = {}      # 暴击展示值：系统自带 + 系统内节点（整舰口径的暴击在 agg 里）
    node_pairs = []     # 整舰所有节点的暴击对，武器三路出数要乘它
    disp = {}           # 系统内 / 舰载机口径的展示值（命中、突防等不进计算的键）
    for sy in ship["systems"]:
        # 系统自带暴击（建船向导填的「自带暴击率 / 自带暴击伤害」）：计入整舰暴击展示值
        _snorm = sy.get("norm") or {}
        _slot = (sy.get("slot") or "").strip()
        _base_pairs = []
        for _ck in ("crit_rate", "crit"):
            _cv = num(_snorm.get(_ck), 0)
            if _cv:
                crit_show[_ck] = crit_show.get(_ck, 0) + _cv
        _base_pairs.append((num(_snorm.get("crit_rate"), 0), num(_snorm.get("crit"), 0)))
        _has_bay = sys_has_bay(sy)
        _is_wpn = _weapon_sys(sy)
        _bkt = sys_agg.setdefault(_slot, {})
        _dropped = []
        used, cnt, active = 0, 0, 0
        for nd in sy["nodes"]:
            lv = int(num((alloc or {}).get(nd["id"]), 0))
            lv = max(0, min(lv, int(nd["max_lv"])))
            if lv <= 0:
                continue
            # 前置节点可以是多个（逗号分隔）：满足任意一个即可
            pars = [x.strip() for x in str(nd.get("parent") or "").replace("，", ",").split(",") if x.strip()]
            if pars:
                if not any(int(num((alloc or {}).get(p), 0)) > 0 for p in pars):
                    pname = "」或「".join(
                        next((x["label"] for x in sy["nodes"] if x["id"] == p), p) for p in pars)
                    violations.append(f"{sy['name']}/{nd['label']}：前置节点「{pname}」都还没点，这一点不计入")
                    continue
            costs = nd.get("costs") or []
            if isinstance(costs, str):
                try:
                    costs = json.loads(costs or "[]")
                except Exception:
                    costs = []
            if costs:
                used += sum(num(x, 0) for x in costs[:lv])
            else:
                used += lv * int(nd["cost"])
            cnt += lv
            active += 1
            _ef = nd["effect"]
            _cr_amt, _cd_amt = 0.0, 0.0
            for k, v in _ef.items():
                if k not in _rules():
                    unapplied.add(k)
                amt, _arr = _lv_amt(nd, k, v, lv)
                if not amt:
                    continue
                sc = _scope_of(k)
                if sc == "plane":
                    # 舰载机加成只认承载它的系统（舱位所在系统），不进整舰 agg
                    _pb = per_sys_bay.setdefault(_slot, {})
                    _pb[k] = _pb.get(k, 0) + amt
                    disp[k] = disp.get(k, 0) + amt
                elif sc in SYS_SCOPES:
                    _bkt[k] = _bkt.get(k, 0) + amt
                    if _has_bay:
                        bay_agg[k] = bay_agg.get(k, 0) + amt
                        _pb = per_sys_bay.setdefault(_slot, {})
                        _pb[k] = _pb.get(k, 0) + amt
                    if k in ("crit_rate", "crit"):
                        crit_show[k] = crit_show.get(k, 0) + amt
                    if k == "repair":
                        agg[k] = agg.get(k, 0) + amt      # 维修量目前只有整舰一个口径
                    if not _is_wpn and not _has_bay and k not in ("repair", "crit_rate", "crit", "syshull"):
                        _dropped.append(k)
                    disp[k] = disp.get(k, 0) + amt
                else:
                    agg[k] = agg.get(k, 0) + amt
                if k == "crit_rate":
                    _cr_amt = amt
                elif k == "crit":
                    _cd_amt = amt
            if _cr_amt or _cd_amt:
                node_pairs.append((_cr_amt, _cd_amt))
                if _has_bay:
                    bay_pairs.setdefault(_slot, []).append((_cr_amt, _cd_amt))
            parts = []
            for k, v in _ef.items():
                amt, _arr = _lv_amt(nd, k, v, lv)
                if not amt:
                    continue
                nm = EFF.get(k, k)
                un = EFF_UNIT.get(k, "")
                if _arr:
                    parts.append(f"{nm} 每级+{'/'.join(_fmt_num(x) for x in _arr)}{un} × {lv} 级 = +{_fmt_num(amt)}{un}")
                elif lv > 1:
                    parts.append(f"{nm} 每级+{_fmt_num(v)}{un} × {lv} 级 = +{_fmt_num(amt)}{un}")
                else:
                    parts.append(f"{nm} +{_fmt_num(amt)}{un}")
            if _dropped:
                parts.append("（该系统没有武器/舰载机输出，" +
                             "、".join(EFF.get(k, k) for k in _dropped) + " 没有落点）")
            if not parts:
                parts.append("无加成")
            detail.append({"from": f"加点 {nd['label']} Lv{lv}（{sy['name']}）",
                           "text": "；".join(parts)})
        cap = int(sy.get("tech_cap") or 0)
        over = bool(cap) and active > cap
        sys_used[sy["id"]] = {"used": used, "cap": cap, "points": cnt,
                              "active": active, "over": over}
        if over:
            violations.append(
                f"{sy['name']}：已点亮 {active} 个节点，超出可用节点数 {cap}"
                f"（系统里共 {len(sy['nodes'])} 个节点，实际最多点 {cap} 个）")
        tech_total += used
    _tt = num(ship.get("tech_total"), 0)
    if _tt and tech_total > _tt:
        violations.append(f"技术值 {tech_total} 超出整舰上限 {_tt}")

    # —— 武器三路出数（对舰 / 对空 / 攻城）——
    # scope 把「系统内」加成收进 sys_agg，这里按系统逐个折算：六字段填齐就现算，
    # 没填齐（老数据）退回存好的三行，攻城没有公式只能吃存档值。
    weapons = []
    for sy in ship["systems"]:
        if not _weapon_sys(sy):
            continue
        _slot = (sy.get("slot") or "").strip()
        _sn = sy.get("norm") or {}
        _op = [(num(_sn.get("crit_rate"), 0), num(_sn.get("crit"), 0))]
        w = _weapon_out(sy, sys_agg.get(_slot, {}), _op, node_pairs, agg)
        weapons.append(w)
        _src_txt = "文档值" if w.get("atk_src") == "stored" else (
            "多武器现算" if w["src"] == "weapons" else
            {"fields": "六字段", "stored": "存档三行"}.get(w["src"], w["src"]))
        _wtxt = "对舰 %s · 对空 %s · 攻城 %s（%s）" % (
            _fmt_num(w["atk"]), _fmt_num(w["air"]),
            _fmt_num(w["siege"]) if w["siege"] is not None else "待定", _src_txt)
        _ac = w.get("atk_calc")
        if _ac is not None and abs(_ac - w["atk"]) > max(1.0, abs(w["atk"]) * 0.0005):
            _wtxt += "，六字段现算 %s（差 %s）" % (
                _fmt_num(_ac), _fmt_num(round(_ac - w["atk"], 1)))
        detail.append({"from": f"武器 {sy['name']}（{_slot or '—'}）", "text": _wtxt})
    weapon = {"atk": 0.0, "air": 0.0, "siege": 0.0, "systems": len(weapons),
              "siege_pending": 0, "stored": _weapon_totals(ship)}
    for w in weapons:
        weapon["atk"] += w["atk"]
        weapon["air"] += w["air"]
        if w["siege"] is None:
            weapon["siege_pending"] += 1
        else:
            weapon["siege"] += w["siege"]
    for _k in ("atk", "air", "siege"):
        weapon[_k] = round(weapon[_k], 1)

    # —— 统一口径（与「基础加成」页展示一致）——
    # 1) 物理护甲、能量护盾、通用闪避：系统基础值 + 加点加成（点数/百分点直接相加）
    armor = num(base.get("armor")) + agg.get("armor", 0)
    shield = num(base.get("shield")) + agg.get("shield", 0)
    eva_total = num(base.get("eva")) + agg.get("eva", 0)
    # 2) 锁定时间、冷却时间、突防速度：基础值 ×（1 - 加成%）
    dur = num(base.get("dur"), 1)
    cd = num(base.get("cd"), 1) * (1 - (agg.get("cd", 0) + agg.get("freq", 0)) / 100)
    lock_t = num(base.get("lock")) * (1 - agg.get("lock", 0) / 100)
    spd_t = num(base.get("spd")) * (1 - agg.get("move", 0) / 100)
    # 3) 无基础值的命中/闪避类：只按加点加成的百分点显示
    acc_univ = num(base.get("acc")) + agg.get("acc", 0)
    # 4) 其余：系统基础值 ×（1 + 加成%）
    hull = num(base.get("hull")) * (1 + (agg.get("hull", 0) + num(base.get("hull_bonus_pct"))) / 100)
    volley = num(base.get("ammo")) * num(base.get("atk"))
    dmg = num(base.get("dmg")) * (1 + agg.get("dmg", 0) / 100)
    cycle = max(0.5, dur + cd)
    dpm = dmg * volley / cycle * 60 if volley else 0.0
    ehp = (hull + shield) * (1 + armor * 0.002) * (1 + eva_total / 100)
    # 维修量也按「基础值 ×（1+加成%）」；工作次数不参与，维修 DPM = 每次修复量 / 周期 × 60
    repair = num(base.get("repair")) * (1 + agg.get("repair", 0) / 100) / cycle * 60
    # 巡航 / 曲率：系统基础值 ×（1 + 加成%）
    cruise_v = num(base.get("cruise")) * (1 + agg.get("speed", 0) / 100)
    warp_v = num(base.get("warp")) * (1 + agg.get("warp", 0) / 100)

    rows, used_slots = [], 0
    launched = []
    matched_idx = set()
    for lm in launches:
        for bi, bay in enumerate(lm.get("bays") or []):
            bkind = (bay.get("kind") or "").replace("搭载系统", "")
            if bkind == "无人机":
                continue          # 无人机由系统自带，不占舱位、也不接受手动装载
            # 编组只对战机舱有意义：护航艇、无人机没有大 / 中编组之分（老数据可能残留 allow_group）
            allow = [] if bkind in ("护航艇", "无人机") else \
                [norm_group(g) for g in str(bay.get("allow_group") or "").split(",") if g.strip()]
            cap = int(num(bay.get("cap"), 0))
            used_b = 0
            for p_i, p in enumerate(plane_sel or []):
                if (p.get("m") or "") != lm["id"]:
                    continue
                if int(num(p.get("bay"), 0)) != bi:
                    continue
                matched_idx.add(p_i)
                pb = bundle["plane"].get(p.get("id"))
                if not pb:
                    continue
                # 舰载机自身节点：来自它自己（ships 记录）各系统下的 nodes
                _pship = next((x for x in (bundle.get("ships") or [])
                               if x.get("id") == p.get("id")), None)
                if _pship:
                    _pnodes = []
                    for _sy in (_pship.get("systems") or []):
                        _pnodes.extend(_sy.get("nodes") or [])
                    if _pnodes:
                        pb = dict(pb)
                        pb["nodes"] = _pnodes
                count = max(0, int(round(num(p.get("count"), 0))))
                if count == 0:
                    continue
                # 1 架 = 1 舱；游戏内的「每组架数」不参与判定
                groups = count
                if bkind and pb["kind"] != bkind:
                    violations.append(f"{pb['name']}：{lm['name']} 的{bkind}舱不能带{pb['kind']}（已忽略这条）")
                    continue
                if allow and not _group_ok(pb.get("pgroup") or "", allow):
                    violations.append(f"{pb['name']}（{norm_group(pb.get('pgroup')) or '未标编组'}）："
                                      f"{lm['name']} 的{bkind}舱只收 {'/'.join(allow)}（已忽略这条）")
                    continue
                used_b += groups
                used_slots += groups
                # 复制一份：下面的累加不能写回 bundle 里的 base.bonus（同一型号多架会重复叠加）
                _own = dict((pb.get("base") or {}).get("bonus") or {})
                _own_pairs = []
                if "crit_rate" in _own or "crit" in _own:
                    _own_pairs.append((float(num(_own.get("crit_rate"), 0)),
                                       float(num(_own.get("crit"), 0))))
                _palloc = p.get("alloc") or {}
                for _pn in (pb.get("nodes") or []):
                    _lv = int(num(_palloc.get(_pn.get("id")), 0))
                    _lv = max(0, min(_lv, int(_pn.get("max_lv") or 0)))
                    if _lv <= 0:
                        continue
                    _pars = [x.strip() for x in str(_pn.get("parent") or "").replace("，", ",").split(",") if x.strip()]
                    if _pars and not any(int(num(_palloc.get(x), 0)) > 0 for x in _pars):
                        continue
                    for _k, _v in (_pn.get("effect") or {}).items():
                        # 全键累加：以后新增效果（冷却缩减等）不用再改这里
                        _own[_k] = float(num(_own.get(_k), 0)) + _lv_amt(_pn, _k, _v, _lv)[0]
                    _pef = _pn.get("effect") or {}
                    if "crit_rate" in _pef or "crit" in _pef:
                        _own_pairs.append((_lv_amt(_pn, "crit_rate", _pef.get("crit_rate"), _lv)[0],
                                           _lv_amt(_pn, "crit", _pef.get("crit"), _lv)[0]))
                _own_pct = float(num(_own.get("plane"), 0)) + float(num(_own.get("dmg"), 0))
                _agg = per_sys_bay.get((lm.get("slot") or "").strip()) or {}
                _car = float(_agg.get("plane", 0)) + float(_agg.get("dmg", 0)) \
                    + float(sys_carry.get((lm.get("slot") or "").strip(), 0))
                _pct = _car + _own_pct
                _cmul = _crit_mul((bay_pairs.get((lm.get("slot") or "").strip()) or []) + _own_pairs)
                _own_cd = num(_own.get("cd"), 0) + num(_own.get("freq"), 0)
                _car_cd = num(_agg.get("cd"), 0) + num(_agg.get("freq"), 0)
                d = plane_dpm_of(pb["base"], _own_cd + _car_cd) * (1 + _pct / 100) * _cmul * count
                rows.append({"name": pb["name"], "count": count, "groups": groups,
                             "per_group": 1, "module": lm["name"], "bay": bi,
                             "bay_kind": bkind, "dpm": round(d, 1),
                             "ehp": round(pb["base"]["ehp"] * count, 1)})
            if used_b > cap:
                violations.append(f"舱位超出：{lm['name']} 的{bkind}舱 需要 {used_b} 舱，只有 {cap} 舱")
            launched.append({"id": lm["id"], "name": lm["name"], "bay": bi,
                             "kind": bkind, "cap": cap, "used": used_b,
                             "allow_group": bay.get("allow_group") or ""})

    for p_i, p in enumerate(plane_sel or []):
        if p_i in matched_idx:
            continue
        pb = bundle["plane"].get(p.get("id"))
        nm = (pb or {}).get("name") or p.get("id")

    # 无人机：系统自带，按 systems.stats_norm.bay_drone 自动计入，不占舱位
    drone_pl = next((pl for pl in bundle["plane"].values() if pl.get("kind") == "无人机"), None)
    if drone_pl:
        for sy in ship["systems"]:
            dn = int(num(sy.get("norm", {}).get("bay_drone"), 0))
            if dn <= 0:
                continue
            _own2 = (drone_pl.get("base") or {}).get("bonus") or {}
            _agg2 = per_sys_bay.get((sy.get("slot") or "").strip()) or {}
            _car2 = (float(_agg2.get("plane", 0)) + float(_agg2.get("dmg", 0))
                     + float(num(_own2.get("plane"), 0)) + float(num(_own2.get("dmg"), 0)))
            d = plane_dpm_of(drone_pl["base"]) * (1 + _car2 / 100) * dn
            rows.append({"name": drone_pl["name"], "count": dn, "groups": dn,
                         "per_group": 1, "module": sy["name"], "bay": -1,
                         "bay_kind": "无人机", "auto": True, "dpm": round(d, 1),
                         "ehp": round(drone_pl["base"]["ehp"] * dn, 1)})
            launched.append({"id": sy["id"], "name": sy["name"], "bay": -1,
                             "kind": "无人机", "cap": dn, "used": dn, "allow_group": "", "auto": True})

    for p_i, p in enumerate(plane_sel or []):
        if p_i in matched_idx:
            continue
        pb = bundle["plane"].get(p.get("id"))
        nm = (pb or {}).get("name") or p.get("id")
        holder = [m for m in launches if m["id"] == p.get("m")]
        nb = len(holder[0].get("bays") or []) if holder else 0
        violations.append("%s：没有第 %d 号舱（模块 %s 只有 %d 个舱），这行未计入"
                          % (nm, int(num(p.get("bay"), 0)) + 1, p.get("m"), nb))

    if not volley:
        for sy in ship["systems"]:
            st = sy["stats"]
            if any(k in st for k in ("单发伤害", "每轮", "弹药")):
                detail.append({"from": "武器数值（未接入 DPM）",
                               "text": sy["name"] + "：" + "、".join(
                                   "%s %s" % (k, v) for k, v in st.items())})
                break

    if unapplied:
        detail.append({"from": "未生效的效果",
                       "text": "、".join(sorted(unapplied)) + "（效果库里没有登记计算口径，目前只记名字、不参与计算）"})

    plane_dpm = sum(r["dpm"] for r in rows)
    if light:
        # 只给页面做「基础加成 + 舱位/合规」用：不算 DPM / EHP / 维修 / 舰载机输出
        dpm = ehp = repair = plane_dpm = 0.0
        for r in rows:
            r["dpm"] = 0.0
        weapon.update({"atk": 0.0, "air": 0.0, "siege": 0.0})
        for w in weapons:
            w["atk"] = w["air"] = 0.0
            if w["siege"] is not None:
                w["siege"] = 0.0
    # —— 系统结构值：和「结构值」用同一套算法 ——
    # 基数 × (1 + 整舰结构值加成% + 该系统内「系统结构值」节点/调校%)。
    # 装甲系统的基数就是舰船结构值基数，所以它的系统结构值恒等于舰船结构值。
    _hull_pct_all = num(agg.get("hull", 0), 0) + num(base.get("hull_bonus_pct"), 0)
    sys_rows = []
    for sy in ship["systems"]:
        row = {"id": sy["id"], "name": sy["name"], "slot": sy["slot"],
               **sys_used[sy["id"]]}
        _n2 = sy.get("norm") or {}
        _shb = num(_n2.get("syshull"), 0)
        _shc = num(_n2.get("syshull_calib"), 0)
        if _shb:
            _shp = (_hull_pct_all
                    + num(((sys_agg.get((sy.get("slot") or "").strip()) or {})).get("syshull"), 0)
                    + _shc)
            row["syshull"] = round(_shb * (1 + _shp / 100.0), 1)
        elif _shc:
            row["syshull_pct"] = round(_shc, 2)
        sys_rows.append(row)
    return {
        "ship": ship["name"], "size": ship["size"], "mod_ok": ship["mod_ok"],
        "ignored_slots": ignored, "tech": tech_total, "techcap": ship["tech_total"],
        "systems": sys_rows,
        "stats": {"armor": round(armor, 1), "shield": round(shield, 1), "hull": round(hull, 1),
                  "dur": round(dur, 2), "cd": round(cd, 2), "dmg": round(dmg, 1),
                  "volley": volley, "cycle": round(cycle, 2),
                  "lock": round(lock_t, 2), "spd": round(spd_t, 1), "eva": round(eva_total, 1),
                  "cruise": round(cruise_v, 1), "warp": round(warp_v, 1),
                  "acc": round(acc_univ + disp.get("acc", 0), 1),
                  "acc_small": round(agg.get("acc_small", 0) + disp.get("acc_small", 0), 1),
                  "acc_large": round(agg.get("acc_large", 0) + disp.get("acc_large", 0), 1),
                  "acc_plane": round(agg.get("acc_plane", 0) + disp.get("acc_plane", 0), 1),
                  "eva_missile": round(agg.get("eva_missile", 0), 1),
                  "eva_torp": round(agg.get("eva_torp", 0), 1),
                  "crit_rate": round(crit_show.get("crit_rate", 0) + agg.get("crit_rate", 0), 1),
                  "crit": round(num(base.get("crit")) + crit_show.get("crit", 0) + agg.get("crit", 0), 1),
                  "lockres": round(agg.get("lockres", 0), 1),
                  "warn": round(num(base.get("warn")) + agg.get("warn", 0), 1),
                  "repair_pct": round(agg.get("repair", 0), 1),
                  "move": round(agg.get("move", 0) + disp.get("move", 0), 1)},
        "dpm": round(dpm, 1), "ehp": round(ehp, 1), "repair": round(repair, 1),
        "weapon": weapon, "weapons": weapons,
        "planes": rows, "plane_dpm": round(plane_dpm, 1),
        "total_dpm": round(dpm + plane_dpm, 1),
        "launch": launched,
        "unapplied": sorted(unapplied), "violations": violations, "detail": detail,
    }
