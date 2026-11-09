# -*- coding: utf-8 -*-
"""纯计算：舰船/模块/舱位校验与指标计算（不碰 HTTP、不碰数据库）。"""
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


def simulate(ship, sel, alloc, bundle, plane_sel, light=False):
    global EFF, EFF_UNIT
    with conn() as _c:
        EFF = {r["id"]: r["name"] for r in _c.execute("SELECT id,name FROM effects")}
        EFF_UNIT = {r["id"]: (r["unit"] or "") for r in _c.execute("SELECT id,unit FROM effects")}
    """ship 是 load_bundle 里的对象（含 systems/modules）。"""
    base = ship["base"]
    agg = dict(dmg=0, cd=0, acc=0, eva=0, freq=0, armor=0, shield=0, hull=0, repair=0, plane=0)
    detail, ignored, violations = [], [], []
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

    tech_total = 0
    sys_used = {}
    for sy in ship["systems"]:
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
            for k, v in nd["effect"].items():
                agg[k] = agg.get(k, 0) + v * lv
            parts = []
            for k, v in nd["effect"].items():
                if not v:
                    continue
                nm = EFF.get(k, k)
                un = EFF_UNIT.get(k, "")
                if lv > 1:
                    parts.append(f"{nm} 每级+{round(v, 2)}{un} × {lv} 级 = +{round(v * lv, 2)}{un}")
                else:
                    parts.append(f"{nm} +{round(v, 2)}{un}")
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
    if tech_total > ship["tech_total"]:
        violations.append(f"技术值 {tech_total} 超出整舰上限 {ship['tech_total']}")

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
            allow = [norm_group(g) for g in str(bay.get("allow_group") or "").split(",") if g.strip()]
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
                d = pb["base"]["dpm"] * (1 + agg.get("plane", 0) / 100) * count
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
            d = drone_pl["base"]["dpm"] * (1 + agg.get("plane", 0) / 100) * dn
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

    plane_dpm = sum(r["dpm"] for r in rows)
    if light:
        # 只给页面做「基础加成 + 舱位/合规」用：不算 DPM / EHP / 维修 / 舰载机输出
        dpm = ehp = repair = plane_dpm = 0.0
        for r in rows:
            r["dpm"] = 0.0
    return {
        "ship": ship["name"], "size": ship["size"], "mod_ok": ship["mod_ok"],
        "ignored_slots": ignored, "tech": tech_total, "techcap": ship["tech_total"],
        "systems": [{"id": sy["id"], "name": sy["name"], "slot": sy["slot"],
                     **sys_used[sy["id"]]} for sy in ship["systems"]],
        "stats": {"armor": round(armor, 1), "shield": round(shield, 1), "hull": round(hull, 1),
                  "dur": round(dur, 2), "cd": round(cd, 2), "dmg": round(dmg, 1),
                  "volley": volley, "cycle": round(cycle, 2),
                  "lock": round(lock_t, 2), "spd": round(spd_t, 1), "eva": round(eva_total, 1),
                  "cruise": round(cruise_v, 1), "warp": round(warp_v, 1),
                  "acc": round(acc_univ, 1), "acc_small": round(agg.get("acc_small", 0), 1),
                  "acc_large": round(agg.get("acc_large", 0), 1),
                  "acc_plane": round(agg.get("acc_plane", 0), 1),
                  "eva_missile": round(agg.get("eva_missile", 0), 1),
                  "eva_torp": round(agg.get("eva_torp", 0), 1),
                  "crit_rate": round(agg.get("crit_rate", 0), 1),
                  "crit": round(num(base.get("crit")) + agg.get("crit", 0), 1),
                  "lockres": round(agg.get("lockres", 0), 1),
                  "warn": round(num(base.get("warn")) + agg.get("warn", 0), 1),
                  "repair_pct": round(agg.get("repair", 0), 1),
                  "move": round(agg.get("move", 0), 1)},
        "dpm": round(dpm, 1), "ehp": round(ehp, 1), "repair": round(repair, 1),
        "weapon": _weapon_totals(ship),
        "planes": rows, "plane_dpm": round(plane_dpm, 1),
        "total_dpm": round(dpm + plane_dpm, 1),
        "launch": launched,
        "violations": violations, "detail": detail,
    }
