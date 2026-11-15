-- ============================================================
-- 服务器 effects（节点效果库）补齐补丁
-- 生成：2026-11-15   适用：fleet-tool / data.db
--
-- 只做一件事：把「节点在用、但效果库里没有」的 18 条效果补进去。
--   · 只 INSERT OR IGNORE —— 有就跳过，不覆盖、不改名、不删除
--   · 不碰 nodes / ships / systems / modules 等任何其它表
--   · 字段只写 id/name/unit/note，节点名与节点效果一字不动
--
-- 执行（-bail：一有错就停，不会带病继续）：
--   cp /var/lib/fleet-tool/data.db /var/lib/fleet-tool/data.db.bak-$(date +%F)
--   sqlite3 -bail /var/lib/fleet-tool/data.db < effects_fix_2026-11-15.sql
--
-- 预期：执行前 33 条 → 执行后 51 条，最后一行打印 "effects=51"
-- 可重复执行：第二次跑不会有任何变化，也不会报错
-- ============================================================

-- 服务在跑时也能安全执行：拿不到写锁会等 15 秒，而不是立刻报 locked
PRAGMA busy_timeout=15000;

BEGIN IMMEDIATE;

-- 一、核心效果键（服务器缺 10 条，其中 cd 被 18 个节点引用）
INSERT OR IGNORE INTO effects(id,name,unit,note) VALUES
  ('cd',            '冷却缩减',        '%', ''),
  ('cd_up',         '冷却缩减（系统）', '%', ''),
  ('focus',         '锁定优先',        '',  ''),
  ('range',         '目标范围',        '',  ''),
  ('selfheal',      '自维修',          '%', ''),
  ('syshull',       '系统结构',        '%', ''),
  ('plane',         '舰载机伤害',      '%', ''),
  ('dmg_atk_pct',   '对舰伤害',        '%', ''),
  ('dmg_air_pct',   '防空伤害',        '%', ''),
  ('dmg_siege_pct', '攻城伤害',        '%', '');

-- 二、节点在用、但库里没有的自定义键（名字按节点名暂定，之后可在「数据管理 → 效果库」改名）
INSERT OR IGNORE INTO effects(id,name,unit,note) VALUES
  ('emw6jmd52', '预警',         '', '节点 pn_cv_msl_03 在用'),
  ('emwghilwl', '装填优化',     '', 'ship_1794665959915'),
  ('emwhk5ozs', '供弹机构强化', '', '供弹机构强化 / 炮管散热加强 共用'),
  ('emwhl5x9i', '辅助攻击雷达', '', 'ship_1794732899339'),
  ('emwhl6la9', '战场雷达强化', '', 'ship_1794732899339'),
  ('emwhl7syh', '弹药补充加速', '', 'ship_1794732899339'),
  ('emwhl8mbg', '机载武器维护', '', 'ship_1794732899339'),
  ('emwhlmeq3', '舰体仓库扩容', '', '多条舰船在用');

COMMIT;

-- 三、自检：这一行应输出 effects=51
SELECT 'effects=' || COUNT(*) FROM effects;
