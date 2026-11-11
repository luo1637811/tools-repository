# -*- coding: utf-8 -*-
"""建库 SQL 与种子数据（从 server.py 抽出，供 init_db 使用）。"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v INTEGER);
CREATE TABLE IF NOT EXISTS ships(
  id TEXT PRIMARY KEY, name TEXT, cls TEXT, kind TEXT, size TEXT, tech_total INTEGER,
  base TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS systems(
  id TEXT PRIMARY KEY, ship TEXT, slot TEXT, name TEXT, tech_cap INTEGER,
  stats TEXT, note TEXT, ord INTEGER, no_nodes INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS nodes(
  id TEXT PRIMARY KEY, sys TEXT, parent TEXT, label TEXT, max_lv INTEGER,
  cost INTEGER, costs TEXT, effect TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS modules(
  id TEXT PRIMARY KEY, ship TEXT, slot TEXT, name TEXT, mkind TEXT,
  cap INTEGER, allow_group TEXT, bonus TEXT, stats TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT, per_unit INTEGER, hangar TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS planes(
  id TEXT PRIMARY KEY, name TEXT, kind TEXT, pgroup TEXT, per_group INTEGER,
  base TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, pwd TEXT,
  role TEXT, name TEXT, squadron TEXT, phone TEXT, status TEXT, note TEXT,
  perms TEXT, scope TEXT DEFAULT 'all', org TEXT, perm_expire_at TEXT, alliance TEXT,
  must_change INTEGER DEFAULT 0, pwd_changed_at TEXT,
  created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS builds(
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, ship TEXT, name TEXT,
  modules TEXT, alloc TEXT, planes TEXT, note TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT, action TEXT,
  target TEXT, detail TEXT, kind TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user INTEGER, expire INTEGER);
CREATE TABLE IF NOT EXISTS attrs(id TEXT PRIMARY KEY, name TEXT, unit TEXT, note TEXT, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS effects(
  id TEXT PRIMARY KEY, name TEXT, unit TEXT, note TEXT);

CREATE TABLE IF NOT EXISTS seasons(
  id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
  started_at TEXT, ended_at TEXT, is_current INTEGER DEFAULT 0, note TEXT);
CREATE TABLE IF NOT EXISTS galaxies(
  id INTEGER PRIMARY KEY AUTOINCREMENT, season INTEGER NOT NULL,
  name TEXT NOT NULL, note TEXT, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS alliances(
  id INTEGER PRIMARY KEY AUTOINCREMENT, galaxy INTEGER NOT NULL,
  name TEXT NOT NULL, note TEXT, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS squads(
  id INTEGER PRIMARY KEY AUTOINCREMENT, alliance INTEGER NOT NULL,
  name TEXT NOT NULL, leader TEXT, note TEXT, ord INTEGER DEFAULT 0);
"""

EFFECTS_SEED = [
    ("dmg", "伤害提高", "%", "造成的伤害百分比"),
    ("acc", "命中提升", "%", "命中率百分比"),
    ("eva", "闪避提升", "%", "闪避率百分比"),
    ("cd", "冷却缩减", "%", "冷却时间缩短（也是百分比）"),
    ("armor", "护甲", "点", "物理减伤点数"),
    ("shield", "护盾", "点", "能量护盾点数"),
    ("hull", "结构", "点", "结构值点数"),
    ("repair", "维修量", "点", "每次修复量"),
    ("speed", "巡航速度", "%", "常规移动速度"), ("warp", "曲率速度", "%", "曲率移动速度"), ("move", "突防速度", "%", "缩短往复飞行时间"), ("cd_up", "冷却缩减（系统）", "%", ""), ("crit", "暴击伤害", "%", ""), ("critres", "抗暴", "%", ""), ("focus", "锁定优先", "", ""), ("formation", "阵型", "", ""), ("intc", "拦截率", "%", ""), ("lock", "锁定时间", "%", ""), ("range", "目标范围", "", ""), ("selfheal", "自维修", "%", ""), ("syshull", "系统结构", "%", ""), ("plane", "舰载机伤害", "%", "机库内舰载机输出"),
]


EFFECTS_CANON = [
    # 节点效果统一口径（顺序即下拉顺序）：id, 名称, 单位
    ("dmg", "伤害", "%"),
    ("freq", "频率", "%"),
    ("acc", "通用命中", "%"),
    ("acc_small", "小型命中", "%"),
    ("acc_large", "大型命中", "%"),
    ("acc_plane", "舰载机命中", "%"),
    ("armor", "物理护甲", "点"),
    ("crit_rate", "暴击率", "%"),
    ("crit", "暴击伤害", "%"),
    ("eff7587", "策略", ""),
    ("eva", "通用闪避", "%"),
    ("eva_missile", "导弹闪避", "%"),
    ("eva_torp", "鱼雷闪避", "%"),
    ("lock", "锁定", "%"),
    ("lockres", "反锁定", "%"),
    ("hull", "结构", "点"),
    ("move", "突防速度", "%"),
    ("repair", "维修量", "点"),
    ("shield", "能量护盾", "点"),
    ("warp", "曲率速度", "%"),
    ("speed", "巡航速度", "%"),
]


ATTRS_SEED = [
    ("armor", "物理护甲", "点", "船体对物理伤害的减免基数"),
    ("shield", "能量护盾", "%", "减免能量伤害"),
    ("hull", "结构值", "点", "血量基础值"),
    ("dur", "持续时间", "s", "单次工作持续多久"),
    ("cyc", "工作次数·次数", "次", "分项，自动乘出合计"),
    ("per", "工作次数·每次次数", "次", "分项，自动乘出合计"),
    ("cyc_total", "工作次数（合计）", "n×n", "次数 × 每次次数"),
    ("cd", "冷却时间", "s", "两次工作之间的间隔"),
    ("lock", "锁定时间", "s", "武器锁定目标所需时间"),
    ("ammo", "弹药数", "发", "分项，自动乘出合计"),
    ("atk", "攻击次数", "次", "分项，自动乘出合计"),
    ("ammo_atk", "弹药×攻击（合计）", "n×n", "弹药数 × 攻击次数"),
    ("warn", "预警", "%", "提前锁定和保持锁定能力"),
    ("dmg", "单发伤害", "点", "每发基础伤害"),
    ("repair", "维修量", "点", "每次维修恢复量"),
    ("intercept", "拦截率", "%", "拦截鱼雷、导弹概率"),
    ("cruise", "巡航速度", "jm", "航行状态下的速度"),
    ("warp", "曲率速度", "jm", "曲率航行下的速度"),
]

# ---------------------------------------------------------------- seed data
SHIPS = [
    ("cv3000", "CV3000级-快速航空母舰", "航母", "超大型", 153,
     dict(armor=120, shield=0, hull=292257, dur=6.0, cyc=2, per=2, cd=18.0,
          ammo=0, atk=0, dmg=0, repair=0),
     "超大型母舰，可装模块（载机/火炮/装甲/动力/能源/指挥/无人机/导弹）"),
    ("sunwhale", "太阳鲸-武装战略航空母舰", "航母", "超大型", 120,
     dict(armor=300, shield=1800, hull=9000, dur=6.0, cyc=2, per=4, cd=18.0,
          ammo=12, atk=3, dmg=120, repair=0), "超大型母舰，可装搭载系统"),
    ("nebula", "星云级战列巡洋舰", "主力舰", "大型", 90,
     dict(armor=260, shield=1200, hull=5200, dur=5.5, cyc=2, per=3, cd=16.0,
          ammo=12, atk=3, dmg=110, repair=0), "大型舰：不显示模块（规则：仅超大型可改装）"),
    ("destroyer", "驱逐舰", "主力舰", "大型", 60,
     dict(armor=200, shield=900, hull=4200, dur=5.0, cyc=2, per=3, cd=14.0,
          ammo=10, atk=3, dmg=90, repair=0), "大型舰，不可改装"),
    ("frigate", "护卫艇", "护卫艇", "小型", 40,
     dict(armor=120, shield=400, hull=2600, dur=5.0, cyc=3, per=2, cd=15.0,
          ammo=8, atk=3, dmg=60, repair=0), "小型艇"),
    ("scout", "侦察艇", "护卫艇", "小型", 30,
     dict(armor=40, shield=200, hull=1200, dur=4.0, cyc=2, per=3, cd=12.0,
          ammo=6, atk=2, dmg=35, repair=0), "小型艇"),
]

# (id, ship, slot, name, tech_cap, stats, note, ord)
SYSTEMS = [
    ("sys_cv_air", "cv3000", "M1", "综合舰载机搭载平台", 5,
     dict(大型战机机库=5, 护航艇坞舱=3), "载机系统：两种机库分开计舱", 1),
    ("sys_cv_gun", "cv3000", "A1", "龙式火炮系统", 5,
     dict(单发伤害=8505, 每轮=1299, 弹药=649), "主炮", 2),
    ("sys_cv_armor", "cv3000", "", "装甲系统", 4,
     dict(结构=292257, 抵抗=120, 物理减伤="15%", 能量减伤="30%"), "生存", 3),
    ("sys_cv_power", "cv3000", "", "动力系统", 4,
     dict(巡航=400, 曲率=2000, 巡航加速=1200), "机动", 4),
    ("sys_cv_energy", "cv3000", "", "能源系统", 4,
     dict(能源输出=400, 储能=2000), "供能（截图未展开）", 5),
    ("sys_cv_cmd", "cv3000", "", "后排指挥系统", 3,
     dict(打击更新=10, 移速=10, 战略打击=30), "指挥位", 6),
    ("sys_cv_uav", "cv3000", "B4", "无人机作战系统", 5,
     dict(战机伤害=9000, 对舰=0, 对空=360, 战斗无人机=3), "无人机", 7),
    ("sys_cv_missile", "cv3000", "B1", "导弹防御系统", 5,
     dict(单发=1200, 每轮=210, 弹药=70), "防空", 8),
    ("sys_sy_air", "sunwhale", "M1", "护航艇坞舱", 5,
     dict(护航艇坞舱=5), "只收护航艇", 1),
]

# (id, sys, parent, label, max_lv, cost, effect, note)
NODES = [
    ("cv_air_eva", "sys_cv_air", None, "闪避", 5, 2, {"eva": 2.0}, "每级 +2% 闪避"),
    ("cv_air_freq", "sys_cv_air", None, "频率", 5, 2, {"cd": 2.0}, "缩短单次工作时间"),
    ("cv_air_dmg", "sys_cv_air", None, "伤害", 5, 2, {"dmg": 3.0}, "舰载机伤害"),
    ("cv_air_sys", "sys_cv_air", "cv_air_eva", "系统结构", 3, 3, {"hull": 5.0}, "系统血量"),
    ("cv_gun_acc", "sys_cv_gun", None, "命中", 5, 2, {"acc": 2.5}, "火炮命中"),
    ("cv_gun_freq", "sys_cv_gun", None, "频率", 5, 2, {"cd": 2.0}, "射速"),
    ("cv_gun_dmg", "sys_cv_gun", None, "伤害", 5, 2, {"dmg": 3.0}, "火炮伤害"),
    ("cv_gun_warn", "sys_cv_gun", "cv_gun_acc", "预警", 3, 3, {"acc": 1.5}, "提前量"),
    ("cv_arm_res1", "sys_cv_armor", None, "抵抗", 5, 1, {"armor": 10}, "物理减伤"),
    ("cv_arm_res2", "sys_cv_armor", None, "抵抗 II", 5, 1, {"shield": 5.0}, "能量减伤"),
    ("cv_arm_struct", "sys_cv_armor", None, "结构", 5, 2, {"hull": 6.0}, "结构值"),
    ("cv_arm_crit", "sys_cv_armor", "cv_arm_res1", "抗暴", 3, 2, {"hull": 3.0}, "抗暴击"),
    ("cv_arm_heal", "sys_cv_armor", "cv_arm_res2", "受维修", 3, 2, {"repair": 10.0}, "受修效率"),
    ("cv_pow_eva", "sys_cv_power", None, "闪避", 5, 20, {"eva": 4.0}, "每级 +4% 闪避（贵）"),
    ("cv_pow_norm", "sys_cv_power", None, "常规", 5, 2, {"cd": 1.5}, "常规航速"),
    ("cv_pow_warp", "sys_cv_power", None, "曲率", 5, 2, {"cd": 1.5}, "曲率航速"),
    ("cv_eng_out", "sys_cv_energy", None, "输出", 4, 2, {"dmg": 1.0}, "能源输出"),
    ("cv_cmd_upd", "sys_cv_cmd", None, "打击更新", 3, 10, {"acc": 4.0}, "更新打击目标"),
    ("cv_cmd_spd", "sys_cv_cmd", None, "移速", 3, 10, {"cd": 2.0}, "编队移速"),
    ("cv_cmd_strike", "sys_cv_cmd", "cv_cmd_upd", "战略打击", 1, 30, {"dmg": 8.0}, "一发战略打击"),
    ("cv_uav_dmg", "sys_cv_uav", None, "伤害", 5, 1, {"dmg": 2.0}, "无人机伤害"),
    ("cv_uav_freq", "sys_cv_uav", None, "频率", 5, 1, {"cd": 2.0}, "出击频率"),
    ("cv_uav_acc", "sys_cv_uav", None, "命中", 5, 2, {"acc": 2.0}, "无人机命中"),
    ("cv_msl_acc", "sys_cv_missile", None, "命中", 5, 2, {"acc": 2.5}, "拦截命中"),
    ("cv_msl_dmg", "sys_cv_missile", None, "伤害", 5, 2, {"dmg": 3.0}, "拦截伤害"),
    ("cv_msl_freq", "sys_cv_missile", None, "频率", 5, 2, {"cd": 2.0}, "拦截频率"),
    ("cv_msl_warn", "sys_cv_missile", "cv_msl_acc", "预警", 3, 3, {"acc": 1.5}, "预警"),
    ("sy_air_freq", "sys_sy_air", None, "频率", 5, 2, {"cd": 2.0}, "出击频率"),
    ("sy_air_dmg", "sys_sy_air", None, "伤害", 5, 2, {"dmg": 3.0}, "舰载机伤害"),
    ("sy_air_eva", "sys_sy_air", None, "闪避", 5, 2, {"eva": 2.0}, "母舰闪避"),
]

# (id, ship, slot, name, mkind, cap, allow_group, bonus, stats, note)
MODULES = [
    ("mod_cv_air", "cv3000", "M1", "综合舰载机搭载平台", "搭载系统", 5, "",
     dict(plane=8), dict(舱位="5 战机 + 3 护航艇"), "一个模块两个舱"),
    ("mod_cv_gun", "cv3000", "A1", "龙式火炮增益", "", 0, "",
     dict(dmg=12, acc=5, freq=5), dict(伤害="+12%"), "主炮强化"),
    ("mod_cv_uav", "cv3000", "B4", "无人机增益", "", 0, "",
     dict(dmg=10), dict(无人机伤害="+10%"), "无人机强化"),
    ("mod_cv_msl", "cv3000", "B1", "导弹拦截增益", "", 0, "",
     dict(acc=8, dmg=6), dict(拦截="+8% 命中"), "防空强化"),
    ("mod_sy_air", "sunwhale", "M1", "护航艇搭载系统", "护航艇搭载系统", 5, "",
     dict(plane=10), dict(舱位=5, 机型="护航艇"), "5 舱，只收护航艇"),
    ("mod_sy_gun", "sunwhale", "A1", "综合武器库", "", 0, "",
     dict(dmg=15, acc=5, freq=5), dict(伤害="+15%"), "主炮强化"),
]

# (id, name, kind, pgroup, per_group, base, note)
PLANES = [
    ("pl_corvette", "护航艇", "护航艇", "", 1, dict(dpm=600, ehp=500), "1 组 1 艘"),
    ("pl_fight_s", "战斗机（小编组）", "战机", "小编组", 3, dict(dpm=900, ehp=600), "1 组 3 架"),
    ("pl_torp_s", "鱼雷机（小编组）", "战机", "小编组", 3, dict(dpm=2200, ehp=700), "1 组 3 架"),
    ("pl_fight_l", "战斗机（大编组）", "战机", "大编组", 6, dict(dpm=1500, ehp=900), "1 组 6 架"),
    ("pl_torp_l", "鱼雷机（大编组）", "战机", "大编组", 6, dict(dpm=3600, ehp=1100), "1 组 6 架"),
    ("pl_uav", "战斗无人机", "无人机", "", 1, dict(dpm=1200, ehp=300), "无人机系统自带"),
]

USERS = [
    ("admin", "admin123", "admin", "管理员", "总部", "13800000000", "在职", "超级管理员"),
    ("editor", "editor123", "editor", "编辑员", "一大区", "13800000001", "在职", "可改人员信息"),
    ("viewer", "viewer123", "viewer", "只读用户", "二大区", "13800000002", "在职", "只能查询"),
]
