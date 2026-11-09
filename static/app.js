/* ---------- 全局错误横幅 ---------- */
function showJsErr(msg) {
  let box = document.getElementById('jsErr');
  if (!box) return;
  box.textContent = '页面出错：' + msg;
  box.style.display = 'block';
}
window.addEventListener('error', ev => showJsErr((ev.message || 'unknown') + '  @ ' + (ev.filename || '').split('/').pop() + ':' + (ev.lineno || 0)));
window.addEventListener('unhandledrejection', ev => showJsErr(String((ev.reason && ev.reason.message) || ev.reason || 'unknown')));

const $ = s => document.querySelector(s);
const el = (t, cls, txt) => { const n = document.createElement(t); if (cls) n.className = cls;
  if (txt !== undefined) n.textContent = txt; return n; };
window.addEventListener('error', ev => {
  try { toast('脚本错误：' + (ev.message || '未知'), 'bad'); } catch (_) {}
});

const fmt = (v, d = 0) => (v === null || v === undefined || isNaN(v)) ? '—'
  : Number(v).toLocaleString('zh-CN', {minimumFractionDigits: d, maximumFractionDigits: d});

const SLOTS = ['A', 'B'];
const S = {
  bp: null, version: 0, token: localStorage.getItem('ft_token') || '', user: null, csrf: '',
  cur: 'A', sys: {}, data: {}, ent: 'ships', tab: 'sim',
  slots: {A: mk(), B: mk(), C: mk()},
};
/* 模块/舱位准入：按需求收紧为「只有超主力舰」。
   服务端 engine 的 mod_ok 用同一口径，两边必须一致。 */
function canMod(ship) {
  if (!ship) return false;
  if (typeof ship.mod_ok === 'boolean') return ship.mod_ok;
  return ship.kind === '超主力舰';
}
/* 统一舱位来源：系统 bay 表优先；没有就按 stats_norm 的
   bay_plane / bay_boat / bay_drone 兜底（老数据只把舱位写在 stats 文本里）。 */
const GROUP_RANK = { '小编组': 1, '中编组': 1, '中型编组': 1, '大编组': 2, '大型编组': 2 };
function normGroup(g) {
  const s = String(g || '').trim();
  if (!s) return '';
  if (s === '小编组' || s === '小型编组') return '中编组';
  if (s === '大型编组') return '大编组';
  return s;
}
// 舱位写了多个编组时按「任选其一」，取最宽松的那个
function groupOk(pg, allow) {
  const a = String(allow || '').split(/[,，/]/).map(normGroup).filter(Boolean);
  if (!a.length) return true;
  const p = normGroup(pg);
  if (!p) return true;
  return (GROUP_RANK[p] || 0) <= Math.max.apply(null, a.map(x => GROUP_RANK[x] || 0));
}

function sysBays(sy) {
  const own = ((sy && sy.bays) || []).filter(b => b && (+b.cap || 0) > 0);
  if (own.length) return own;
  let n = {};
  try { n = JSON.parse((sy && sy.stats_norm) || '{}') || {}; } catch (e) { n = {}; }
  const out = [];
  if (+n.bay_plane) out.push({kind: '战机', cap: +n.bay_plane});
  if (+n.bay_boat) out.push({kind: '护航艇', cap: +n.bay_boat});
  if (+n.bay_drone) out.push({kind: '无人机', cap: +n.bay_drone});
  return out;
}
function mk() { return {ship: null, noCarrier: false, modules: {}, alloc: {}, planes: [], carrierMods: undefined}; }

function toast(msg, kind = '') {
  const d = el('div', '', msg);
  if (kind === 'bad') d.style.borderLeftColor = 'var(--bad)';
  if (kind === 'good') d.style.borderLeftColor = 'var(--good)';
  $('#toast').appendChild(d); setTimeout(() => d.remove(), 2600);
}
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const o = Object.assign({headers: {'Content-Type': 'application/json'}}, opts);
  delete o.confirm; delete o._retry;
  /* 二次确认值可能是中文（账号名），HTTP 头只能 ASCII → 统一放 query */
  if (opts.confirm != null) {
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    path = path + sep + 'confirm=' + encodeURIComponent(String(opts.confirm));
  }
  if (S.token) o.headers.Authorization = 'Bearer ' + S.token;
  if (method !== 'GET' && S.csrf) o.headers['X-CSRF'] = S.csrf;
  if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
  let r = await fetch(path, o);
  let j = await r.json().catch(() => ({ok: false, error: 'bad response'}));
  /* 服务端要求确认但没带对：弹一次确认，带上 confirm 重试（只重试一次） */
  if (r.status === 409 && j && j.code === 'confirm' && opts.confirm == null && !opts._retry) {
    if (!confirm((j.error || '这个操作需要二次确认') + '\n\n继续吗？')) throw new Error('已取消');
    return api(path, Object.assign({}, opts, {confirm: j.confirm, _retry: 1}));
  }
  if (r.status === 401) {
    S.token = ''; try { localStorage.removeItem('ft_token'); } catch (e) {}
    S.user = null;
    goLogin('登录已过期，请重新登录');
  }
  if (!r.ok || j.ok === false) {
    if (j.code === 'must_change') { try { openPwdDlg(true); } catch (e) {} }
    throw new Error(j.error || ('HTTP ' + r.status));
  }
  return j;
}

/* ---------- 版本标签（超级管理员可发布） ---------- */
function renderVerTag() {
  const t = $('#verTag');
  if (!t) return;
  const p = S.pub || {};
  const isTop = !!(S.user && S.user.role === 'superadmin');
  const label = p.label || ('v' + (p.version || 0));
  const pending = Math.max(0, (p.version || 0) - (p.num || 0));
  t.textContent = '数据版本 ' + label + (isTop && pending ? ' · 未发布 ' + pending : '');
  t.classList.toggle('pending', !!isTop && pending > 0);
  const bits = [];
  if (p.at) bits.push('发布于 ' + p.at + (p.by ? '，操作人 ' + p.by : ''));
  if (p.note) bits.push('说明：' + p.note);
  if (isTop) bits.push(pending ? '还有 ' + pending + ' 处改动未发布，点这里发布' : '已是最新发布；点这里修改版本号');
  else if (!p.label) bits.push('管理员还没有正式发布过版本');
  t.title = bits.join('\n');
  t.style.cursor = isTop ? 'pointer' : '';
  t.onclick = isTop ? () => openVerDlg() : null;
}

function openVerDlg() {
  const p = S.pub || {};
  const d = $('#verDlg'); if (!d) return;
  $('#verLabel').value = p.label || ('v' + (p.version || 0));
  $('#verNote').value = '';
  $('#verDlgInfo').textContent = '当前内部计数 v' + (p.version || 0)
    + '；上次发布 ' + (p.label || '（无）') + (p.at ? ' · ' + p.at : '');
  d.showModal();
  setTimeout(() => $('#verLabel').select(), 50);
}

async function publishVer() {
  const label = ($('#verLabel').value || '').trim();
  if (!label) return toast('版本号不能为空', 'bad');
  try {
    const r = await api('/api/version/publish', {method: 'POST',
      body: {label: label, note: ($('#verNote').value || '').trim()}});
    S.pub = r.pub; renderVerTag();
    $('#verDlg').close();
    toast('已发布 ' + label, 'good');
  } catch (e) { toast('发布失败：' + e.message, 'bad'); }
}

/* ---------- 蓝图 ---------- */
const shipOf = id => (S.bp.ships || []).find(s => s.id === id);

async function loadBlueprints(silent) {
  try {
    const j = await api('/api/blueprints');
    S.bp = j; S.version = j.version; S.pub = j.pub || null;
    renderVerTag();
    SLOTS.forEach(k => { if (!S.slots[k].ship) S.slots[k].ship = j.ships[0].id; });
    S.sys[S.cur] = S.sys[S.cur] || (shipOf(S.slots[S.cur].ship) || {systems: []}).systems[0].id;
    renderEditor();
    SLOTS.forEach(recalc);
    if (!silent) toast('数据已刷新 v' + j.version, 'good');
  } catch (e) { toast('载入失败：' + e.message, 'bad'); setTimeout(() => loadBlueprints(true), 1500); }
}

/* 蓝图下拉：受「类型」与「找船」两个条件过滤；当前这条永远保留在列表里，避免选中的船被过滤掉 */
function fillShipSelect(sl, kind) {
  const sel = $('#shipSel');
  if (!sel) return;
  const q = (S.shipQ || '').trim().toLowerCase();
  const all = (S.bp && S.bp.ships) || [];
  /* 只按「船名」找船：ID 不参与搜索（避免输 cv3 之类把无关船带出来） */
  const hit = s => (!q || String(s.name || '').toLowerCase().indexOf(q) >= 0);
  const list = all.filter(s => (!kind || s.kind === kind) && (hit(s) || s.id === sl.ship));
  sel.innerHTML = '';
  // 只列舰船名称：不加分组（舰种）、不加尺寸、不写系统数量
  list.forEach(s => {
    const o = el('option', '', s.name);
    o.value = s.id; if (s.id === sl.ship) o.selected = true; sel.appendChild(o);
  });
  if (!list.length) {
    const o = el('option', '', '（没有匹配的蓝图）');
    o.value = ''; sel.appendChild(o);
  }
  const sf = $('#shipFilter');
  if (sf && sf.value !== (S.shipQ || '')) sf.value = S.shipQ || '';
  sel.onchange = () => {
    sl.ship = sel.value; sl.noCarrier = false; sl.modules = {}; sl.alloc = {};
    sl.carrierMods = undefined; sl.planes = [];
    S.sys[S.cur] = ((shipOf(sl.ship) || {}).systems || [{}])[0].id;
    renderEditor(); recalc(S.cur);
  };
}

/* 把「方案 / 蓝图 / 系统」写进地址栏，刷新或发给别人能回到同一处 */
function syncUrl() {
  try {
    const sl = S.slots[S.cur];
    const p = new URLSearchParams(location.search);
    if (sl && sl.ship) p.set('ship', sl.ship); else p.delete('ship');
    if (S.sys && S.sys[S.cur]) p.set('sys', S.sys[S.cur]); else p.delete('sys');
    p.set('slot', S.cur);
    /* 用状态而不是 nav.on：boot 期间 nav 还没切到目标页签 */
    p.set('tab', S.tab || 'sim');
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  } catch (e) {}
}

function renderEditor() {
  const sl = S.slots[S.cur];
  /* 自愈：本地记住的舰船如果已经被删掉/改名，自动退回第一艘，
     否则整页会停在「没有找到这条蓝图」的空状态。 */
  if (sl.ship && !shipOf(sl.ship) && (S.bp.ships || []).length) {
    sl.ship = S.bp.ships[0].id;
    S.sys[S.cur] = ((shipOf(sl.ship) || {}).systems || [])[0] ? shipOf(sl.ship).systems[0].id : '';
  }
  const ship = shipOf(sl.ship);
  const all = S.slots[S.cur].pick || '';
  const kindSel = $('#kindFilter');
  if (kindSel) {
    const kinds = ['全部', '主力舰', '超主力舰', '舰载机'];
    kindSel.innerHTML = '';
    kinds.forEach(k => {
      const o = el('option', '', k + '（' + (k === '全部' ? (S.bp.ships || []).length
        : (S.bp.ships || []).filter(s => (s.kind || '') === k).length) + '）');
      o.value = k; if (k === all) o.selected = true; kindSel.appendChild(o);
    });
    kindSel.onchange = () => {
      S.slots[S.cur].pick = kindSel.value === '全部' ? '' : kindSel.value;
      const list = (S.bp.ships || []).filter(s => !S.slots[S.cur].pick || s.kind === S.slots[S.cur].pick);
      if (list.length && !list.some(s => s.id === sl.ship)) {
        sl.ship = list[0].id; sl.alloc = {}; sl.modules = {};
        S.sys[S.cur] = (shipOf(sl.ship).systems[0] || {}).id;
      }
      renderEditor(); recalc(S.cur);
    };
  }
  fillShipSelect(sl, all);

  // 蓝图信息条：一眼看到这条船是什么、有几个系统、能不能装模块
  const info = $('#shipInfo');
  if (info) {
    info.innerHTML = '';
    if (!ship) {
      info.appendChild(el('div', 'viol', '⚠ 没有找到这条蓝图（可能刚被删了，点所在页面的「刷新」按钮（或按 Ctrl+F5））'));
    } else {
      const nds = (ship.systems || []).reduce((a, x) => a + (x.nodes || []).length, 0);
      const row = el('div', 'row muted');
      row.appendChild(el('span', 'chip', ship.kind || ship.size || '—'));
      row.appendChild(el('span', 'chip', ship.size || '—'));
      row.appendChild(el('span', 'chip', (ship.systems || []).length + ' 系统 / ' + nds + ' 节点'));
      row.appendChild(el('span', 'chip', '技术值上限 ' + (ship.tech_total || 0)));
      row.appendChild(el('span', 'chip', canMod(ship) ? '可装模块/舱位' : '无模块/舱位'));
      info.appendChild(row);
      if (!(ship.systems || []).length) {
        info.appendChild(el('div', 'viol',
          '⚠ 这条蓝图还没有系统数据。用「数据管理 → 问卷式录入」重建，或在「数据管理 → 系统」里给它加系统。'));
      }
    }
  }

  const box = $('#modSlots'); box.innerHTML = '';
  if (!ship) { renderSystems(); renderTree(); return; }
  if (!canMod(ship)) {
    sl.modules = {};
    if (ship.kind === '舰载机') {
      const mods = ship.modules || [];
      if (mods.length) {
        const t = el('table');
        const th = el('thead'), htr = el('tr');
        ['系统模块', '所属系统', '数值'].forEach(h => htr.appendChild(el('th', '', h)));
        th.appendChild(htr); t.appendChild(th);
        const tb = el('tbody');
        mods.forEach(m => {
          const tr = el('tr');
          tr.appendChild(el('td', '', m.name || m.id));
          tr.appendChild(el('td', 'muted', m.slot || ''));
          const kv = Object.entries(m.stats || {}).map(([a, b]) => a + ' ' + b).join('；')
            || m.note || '（未填）';
          tr.appendChild(el('td', 'muted', kv));
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        box.appendChild(el('div', 'muted', '舰载机的「系统模块」是固定的，下面是它自带的模块：'));
        box.appendChild(t);
      } else {
        box.appendChild(el('div', 'muted', '舰载机没有可切换的模块位。'));
      }
    } else {
      box.appendChild(el('div', 'muted', '本舰是「' + (ship.cls || ship.kind || ship.size) + '」，没有模块/舱位系统（只有超主力舰与巡洋舰、驱逐舰有）'));
    }
  } else {
    // 同一「系列」（M / A / B …，取槽位首字母）只能选一个模块
    const series = [...new Set(ship.modules.map(m => (m.slot || '').charAt(0)).filter(Boolean))].sort();
    series.forEach(letter => {
      const group = ship.modules.filter(m => (m.slot || '').charAt(0) === letter);
      const lab = el('label', 'row');
      lab.appendChild(el('span', '', letter + ' 系列'));
      const s2 = el('select');
      const none = el('option', '', '（不装）'); none.value = ''; s2.appendChild(none);
      group.forEach(m => {
        const bayTxt = (m.bays && m.bays.length)
          ? m.bays.map(b => (b.cap || 0) + ' ' + (b.kind || '舱')).join(' + ')
          : (m.mkind ? (m.cap || 0) + ' ' + (m.mkind || '').replace('搭载系统', '') : '');
        const o = el('option', '', (m.slot ? m.slot + ' · ' : '') + m.name + (bayTxt ? '（' + bayTxt + '）' : ''));
        o.value = m.id;
        if ((sl.modules || {})[letter] === m.id) o.selected = true;
        s2.appendChild(o);
      });
      s2.onchange = () => {
        sl.modules = sl.modules || {};
        if (s2.value) sl.modules[letter] = s2.value; else delete sl.modules[letter];
        recalc(S.cur); renderEditor(); renderSystems();
      };
      lab.appendChild(s2);
      box.appendChild(lab);
    });
  }
  renderSystems(); renderTree();
  syncUrl();
}

function renderSystems() {
  const ship = shipOf(S.slots[S.cur].ship);
  const st = $('#sysTabs'); st.innerHTML = '';
  if (!S.sys[S.cur] || !ship.systems.find(x => x.id === S.sys[S.cur]))
    S.sys[S.cur] = (ship.systems[0] || {}).id;
  ship.systems.forEach(sy => {
    const noPts = Number(sy.no_nodes) || !sy.nodes.length;
    const b = el('button', (sy.id === S.sys[S.cur] ? 'on' : '') + (noPts ? ' nopts' : ''),
      sy.name + (sy.slot ? ' ' + sy.slot : '') + (noPts ? ' · 无加点' : ' (' + sy.nodes.length + ')'));
    b.onclick = () => { S.sys[S.cur] = sy.id; renderSystems(); renderTree(); syncUrl(); };
    st.appendChild(b);
  });
}

function nodeById(id) {
  for (const sy of shipOf(S.slots[S.cur].ship).systems)
    for (const nd of sy.nodes) if (nd.id === id) return nd;
  return null;
}
function effName(k) {
  const e = ((S.bp && S.bp.effects) || []).find(x => x.id === k);
  return e ? (e.name + (e.unit ? '（' + e.unit + '）' : '')) : k;
}
function costOf(nd, lv) {
  // 逐级消耗：nodes.costs = [第1级, 第2级, ...]；没填就回退到统一 cost
  const arr = Array.isArray(nd.costs) ? nd.costs : null;
  if (arr && arr.length) return +arr[Math.min(lv, arr.length - 1)] || 0;
  return +nd.cost || 0;
}

function sysUsed(sy) {
  const sl = S.slots[S.cur] || mk();
  return sy.nodes.reduce((a, nd) => {
    let sum = 0;
    const lv = sl.alloc[nd.id] || 0;
    for (let i = 0; i < lv; i++) sum += costOf(nd, i);
    return a + sum;
  }, 0);
}

function sysActive(sy) {
  const sl = S.slots[S.cur] || mk();
  return sy.nodes.filter(nd => (sl.alloc[nd.id] || 0) > 0).length;
}

function aggEffects() {
  const ship = shipOf(S.slots[S.cur].ship);
  const alloc = S.slots[S.cur].alloc || {};
  const agg = {};
  if (!ship) return agg;
  (ship.systems || []).forEach(sy => (sy.nodes || []).forEach(nd => {
    const lv = Number(alloc[nd.id] || 0);
    if (!lv) return;
    let eff = nd.effect;
    if (typeof eff === 'string') { try { eff = JSON.parse(eff || '{}'); } catch (e) { eff = {}; } }
    Object.keys(eff || {}).forEach(k => { agg[k] = (agg[k] || 0) + Number(eff[k] || 0) * lv; });
  }));
  return agg;
}

/* 统一口径：护甲/护盾/通用闪避 = 基础 + 加点；锁定/冷却/突防 = 基础 ×（1-加成%）；其余 = 基础 ×（1+加成%） */
const ADD_RULE = { armor: 1, shield: 1, eva: 1 };
const SUB_RULE = { cd: 1, lock: 1, spd: 1 };
function effVal(key, baseVal, aggObj) {
  const b = Number(baseVal) || 0;
  const a = Number((aggObj || {})[key]) || 0;
  if (ADD_RULE[key]) return b + a;
  if (SUB_RULE[key]) return b * (1 - a / 100);
  return b * (1 + a / 100);
}

function fmtNum(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return (Math.round(n * 100) / 100).toString();
}


const PERM_LABEL = {
  sim_view: '舰船数据·看', sim_edit: '舰船数据·改',
  battle_view: '战报分析·看', battle_edit: '战报分析·改',
  data_view: '数据管理·看', data_edit: '数据管理·改', effects_edit: '效果库·改',
  roster_view: '人员档案·看', roster_edit: '人员档案·改', roster_pii: '人员档案·看明文',
  people_view: '人员管理·看', people_edit: '人员管理·改',
  audit_view: '操作日志·看全部', audit_self: '操作日志·只看自己', export: '导出',
};
const PERM_GROUPS = [
  {mod: '舰船数据', view: 'sim_view', edit: 'sim_edit'},
  {mod: '战报分析', view: 'battle_view', edit: 'battle_edit'},
  {mod: '数据管理', view: 'data_view', edit: 'data_edit', extra: [['effects_edit', '效果库']]},
  {mod: '人员档案', view: 'roster_view', edit: 'roster_edit', extra: [['roster_pii', '看明文']]},
  {mod: '人员管理', view: 'people_view', edit: 'people_edit'},
  {mod: '操作日志', view: 'audit_view', extra: [['audit_self', '只看自己']]},
  {mod: '导出', view: 'export'},
];
const ROLE_PERMS = {
  viewer: 'sim_view,battle_view',
  editor: 'sim_view,sim_edit,battle_view,battle_edit,data_view,data_edit,export',
};
const TAB_PERM = {sim: 'sim_view', battle: 'battle_view', data: 'data_view',
                  roster: 'roster_view', rosterM: 'roster_view',
                  audit: 'audit_view', people: 'people_view'};
function myPerms() {
  if (!S.user) return [];
  if (S.user.role === 'superadmin') return Object.keys(PERM_LABEL);
  if (S.user.role === 'admin') {
    // 管理员默认全权；被超级管理员减权后以服务端返回的 perms 为准
    const own = (S.user.perms || []).filter(k => PERM_LABEL[k]);
    return own.length ? own : Object.keys(PERM_LABEL);
  }
  return (S.user.perms || []).filter(k => PERM_LABEL[k]);
}
const PERM_IMPLIES = {sim_view: 'sim_edit', battle_view: 'battle_edit',
                     data_view: 'data_edit', roster_view: 'roster_edit',
                     people_view: 'people_edit'};
function can(p) {
  const mine = myPerms();
  if (mine.indexOf(p) >= 0) return true;
  const e = PERM_IMPLIES[p];
  return !!(e && mine.indexOf(e) >= 0);
}
function canEditOf(mod) { return can(mod + '_edit'); }
// 页签/面板的权限键：按钮用 data-perm（可与 data-tab 不同，如两个页签共用一个权限）
function permOf(node) {
  return node.dataset.perm || TAB_PERM[node.dataset.tab] ||
         TAB_PERM[(node.id || '').replace(/^tab-/, '')] ||
         (node.id || '').replace(/^tab-/, '');
}
function diag(msg) {
  const d = document.getElementById('diag');
  if (!d) return;
  const s = String(msg == null ? '' : msg);
  d.textContent = s;
  // 平时不显示；只有内容是报错/被拦截时才浮出来
  const bad = /ERR|BLOCKED|NO-EL|NO SUCH/i.test(s);
  d.classList.toggle('hide', !bad);
}
function allPanes() { return [...document.querySelectorAll('main > section')]; }
function applyPerms() {
  const have = myPerms();
  const btns = [...document.querySelectorAll('nav button')];
  btns.forEach(b => { b.style.display = can(permOf(b)) ? '' : 'none'; });
  allPanes().forEach(pn => pn.classList.toggle('hide', !can(permOf(pn))));
  let cur = btns.find(b => b.classList.contains('on')) || btns[0];
  if (cur && !can(permOf(cur))) {
    const first = btns.find(b => can(permOf(b)));
    if (first) first.click();
    else {
      btns.forEach(b => b.classList.remove('on'));
      allPanes().forEach(pn => pn.classList.add('hide'));
      toast('这个账号还没有任何模块权限，找管理员开通', 'bad');
    }
  }
  const hint = $('#permHint');
  if (hint) hint.textContent = S.user
    ? '当前账号：' + (S.user.name || S.user.username) + ' · 可访问 ' +
      (have.length ? have.map(k => PERM_LABEL[k]).join('、') : '（无）')
    : '';
  const bar = $('#permExpired');
  if (bar) {
    const ex = (S.user && S.user.perm_expired) || '';
    bar.classList.toggle('hide', !ex);
    if (ex) bar.textContent = '⚠ 你的权限已于 ' + ex + ' 到期：现在只能查看基础数据，'
      + '数据管理、人员管理、操作日志等已关闭。请让管理员续期后重新登录。';
  }
}

function applyBrand(t) {
  const el1 = $('#brandTitle');
  if (el1) el1.textContent = t;
  document.title = t + ' · 舰队工具';
}
async function loadSettings() {
  try {
    const r = await api('/api/settings');
    const t = (r.settings && r.settings.title) || '元空间';
    applyBrand(t);
    const btn = $('#brandEdit');
    if (btn) btn.style.display = (S.user && (S.user.role === 'admin' || S.user.role === 'superadmin')) ? '' : 'none';
  } catch (e) { /* 未登录也能读 */ }
}

function renderBaseAttrs() {
  const body = $('#baseAttrBody');
  if (!body) return;
  const ship = shipOf(S.slots[S.cur].ship);
  const tiles = $('#baTiles');
  const warn = $('#baWarn');
  const note = $('#baNote');
  if (!ship) {
    body.innerHTML = '<tr><td colspan="6" class="dim">先在左上角选一艘舰船</td></tr>';
    if (tiles) tiles.innerHTML = '';
    if (warn) warn.classList.add('hide');
    return;
  }
  const base = ship.base || {};
  const agg = aggEffects();
  const allBox = $('#baAll');
  if (allBox && !allBox.dataset.bound) {
    allBox.dataset.bound = '1';
    try { allBox.checked = localStorage.getItem('ft_baWeapon') === '1'; } catch (e) {}
    allBox.onchange = () => {
      try { localStorage.setItem('ft_baWeapon', allBox.checked ? '1' : '0'); } catch (e) {}
      renderBaseAttrs();
    };
  }
  const weaponOnly = !!(allBox && allBox.checked);
  const sysAggOf = (sy) => {
    const a = {}, alloc = (S.slots[S.cur] || {}).alloc || {};
    (sy.nodes || []).forEach(nd => {
      const lv = Number(alloc[nd.id] || 0);
      if (!lv) return;
      let eff = nd.effect;
      if (typeof eff === 'string') { try { eff = JSON.parse(eff || '{}'); } catch (e) { eff = {}; } }
      Object.keys(eff || {}).forEach(k => { a[k] = (a[k] || 0) + Number(eff[k] || 0) * lv; });
    });
    return a;
  };
  const sys = (ship.systems || []).map(sy => {
    let n = {};
    try { n = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { n = {}; }
    return { sy: sy, n: n, a: sysAggOf(sy),
      w: (n.dmg_atk !== undefined || n.dmg_air !== undefined || n.dmg_siege !== undefined) };
  });
  const hasWeapon = sys.some(x => x.w);
  const hasBay = sys.some(x => sysBays(x.sy).length > 0);
  const rows = sys.filter(x => !weaponOnly || x.w)
    .sort((a, b2) => (b2.w - a.w) || String(a.sy.slot || '').localeCompare(String(b2.sy.slot || '')));

  const COLS = [
    { k: 'slot', t: '槽位', w: 56 },
    { k: 'name', t: '系统', w: 176 },
    { k: 'kind', t: '类型', w: 56 },
    { k: 'bay', t: '舱位', w: 130, bay: 1 },
    { k: 'hull', t: '结构值', w: 100, num: 1 },
    { k: 'armor', t: '抵抗伤害', w: 92, num: 1 },
    { k: 'shield', t: '护盾值', w: 84, num: 1, pct: 1 },
    { k: 'eva', t: '通用闪避', w: 92, num: 1, pct: 1 },
    { k: 'speed', t: '巡航 / 曲率', w: 118, num: 1 },
    { k: 'spd', t: '突防速度', w: 86, num: 1 },
    { k: 'repair', t: '维修量', w: 86, num: 1 },
    { k: 'dmg_atk', t: '对舰', w: 94, num: 1, weapon: 1 },
    { k: 'dmg_air', t: '对空', w: 86, num: 1, weapon: 1 },
    { k: 'dmg_siege', t: '攻城', w: 86, num: 1, weapon: 1 }
  ].filter(c => (!c.weapon || hasWeapon) && (!c.bay || hasBay)
    && (c.k !== 'eva' || sys.some(x => Number(x.n.eva) || Number(x.a.eva))));

  const head = $('#baHead');
  if (head) {
    head.innerHTML = '<tr>' + COLS.map(c => '<th' + (c.w ? ' style="width:' + c.w + 'px"' : '') + ' class="' + (c.num ? 'num' : '') + '">' + c.t + '</th>').join('') + '</tr>';
  }
  const cellOf = (c, x) => {
    const n = x.n;
    if (c.k === 'slot') return '<td>' + mhEsc(x.sy.slot || '-') + '</td>';
    if (c.k === 'name') return '<td>' + mhEsc(x.sy.name) + '</td>';
    if (c.k === 'kind') return '<td>' + (x.w ? '<span class="tagw">武器</span>' : '<span class="tagf">功能</span>') + '</td>';
    if (c.k === 'bay') {
      const bs = sysBays(x.sy);
      if (!bs.length) return '<td class="dim">—</td>';
      return '<td class="bcell">' + bs.map(b => b.kind + ' ' + b.cap).join(' · ') + '</td>';
    }
    if (c.k === 'speed') {
      const cr = n.cruise === undefined ? undefined : effVal('speed', n.cruise, x.a);
      const wp = n.warp === undefined ? undefined : effVal('warp', n.warp, x.a);
      const a = fmtNum(cr), b2 = fmtNum(wp);
      if (a === '—' && b2 === '—') return '<td class="num dim">—</td>';
      return '<td class="num">' + a + (b2 === '—' ? '' : ' / ' + b2) + '</td>';
    }
    let v = n[c.k];
    if (c.k === 'spd' && v !== undefined) v = effVal('spd', v, { spd: Number(x.a.move) || 0 });
    if (v === undefined || v === null) {
      /* 命中/闪避这类没有系统基础值的：直接显示加点带来的百分点 */
      const g = Number(x.a[c.k]) || 0;
      if (g) return '<td class="num" title="只有加点加成">+' + fmtNum(g) + '%</td>';
      return '<td class="num dim">—</td>';
    }
    if (v !== undefined && v !== null && c.k !== 'spd') v = effVal(c.k, v, x.a);
    return '<td class="num">' + fmtNum(v) + (c.pct ? '%' : '') + '</td>';
  };
  body.innerHTML = rows.map(x => '<tr' + (x.w ? ' class="wrow"' : '') + '>' + COLS.map(c => cellOf(c, x)).join('') + '</tr>').join('')
    || '<tr><td colspan="' + COLS.length + '" class="dim">' + (weaponOnly ? '这艘船没有武器系统' : '这艘船还没有系统') + '</td></tr>';

  if (tiles) {
    const bHull = Number(base.hull) || 0;
    const bPct = (Number(base.hull_bonus_pct) || 0) + (Number(agg.hull) || 0);
    const hullFinal = bHull ? bHull * (1 + bPct / 100) : 0;
    const armor = (Number(base.armor) || 0) + (Number(agg.armor) || 0);
    const shield = (Number(base.shield) || 0) + (Number(agg.shield) || 0);
    const ws = sys.filter(x => x.w);
    const sum = k => ws.reduce((a, x) => a + (Number(x.n[k]) || 0), 0);
    const tile = (k, v, s2) => '<div class="basetile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s2 || '') + '</div></div>';
    tiles.innerHTML = [
      tile('结构值', hullFinal ? fmtNum(hullFinal) : '—',
        bHull ? (bPct ? fmtNum(bHull) + ' ×（1+' + (Math.round(bPct * 100) / 100) + '%）' : '来自系统') : '缺装甲系统数值'),
      tile('抵抗伤害 / 护盾', fmtNum(armor) + ' / ' + (base.shield !== undefined ? fmtNum(shield) + '%' : '—'), '物理减伤 / 能量减伤'),
      tile('巡航 / 曲率',
        fmtNum(effVal('speed', base.cruise, agg)) + ' / ' + fmtNum(effVal('warp', base.warp, agg)),
        (Number(agg.speed) || Number(agg.warp)) ? '已含加点加成' : 'jm'),
      tile('武器系统', ws.length + ' 个', ws.length ? ('对舰 ' + fmtNum(sum('dmg_atk')) + ' · 对空 ' + fmtNum(sum('dmg_air')) + ' · 攻城 ' + fmtNum(sum('dmg_siege'))) : '没有武器系统')
    ].join('');
  }
  if (warn) {
    const msgs = [];
    if (base.hull === undefined) msgs.push('缺少装甲系统数值（结构值 / 抵抗伤害）');
    if (!hasWeapon) msgs.push('没有武器系统，所以对舰 / 对空 / 攻城三列为空（靠舰载机输出时属正常）');
    warn.innerHTML = msgs.length ? ('⚠ ' + msgs.join('；') + '。缺的数据在「数据管理 → 系统」里补。') : '';
    warn.classList.toggle('hide', !msgs.length);
  }
  if (note) note.textContent = '共 ' + sys.length + ' 个系统（' + sys.filter(x => x.w).length + ' 个武器系统）' + (weaponOnly ? '，当前只看武器' : '');
}

/* 前置节点可以是多个（逗号分隔），满足任意一个即可加点 */
function parList(p) {
  return String(p == null ? '' : p).split(/[,，\s]+/).filter(Boolean);
}
function firstPar(p) {
  const a = parList(p);
  return a.length ? a[0] : '';
}
function parLabels(nodes, p) {
  const ids = parList(p);
  return ids.map(id => {
    const x = (nodes || []).filter(y => y.id === id)[0];
    return x ? x.label : id;
  }).filter(Boolean);
}

function treeCols(nodes) {
  const byId = {};
  nodes.forEach(n => { byId[n.id] = n; });
  const depthOf = n => {
    let d = 0, p = firstPar(n.parent), guard = 0;
    const seen = {};
    while (p && byId[p] && !seen[p] && guard++ < 30) { seen[p] = 1; d++; p = firstPar(byId[p].parent); }
    return d;
  };
  const codeOf = {};
  const walk = (parentId, prefix) => nodes
    .filter(n => firstPar(n.parent) === parentId)
    .forEach((n, k) => {
      const code = prefix ? prefix + '-' + (k + 1) : String(k + 1);
      codeOf[n.id] = code;
      walk(n.id, code);
    });
  walk('', '');
  nodes.forEach(n => { if (!codeOf[n.id]) codeOf[n.id] = '?'; });
  const cols = [];
  nodes.forEach(n => {
    const d = depthOf(n);
    (cols[d] = cols[d] || []).push({code: codeOf[n.id], node: n});
  });
  return cols.filter(c => c && c.length);
}

function renderTree() {
  renderBaseAttrs();
  const sl = S.slots[S.cur];
  const ship = shipOf(sl.ship);
  const sy = ship.systems.find(x => x.id === S.sys[S.cur]);
  const host = $('#tree'); host.innerHTML = '';
  if (!sy) { host.appendChild(el('div', 'muted', '这条船还没有系统数据，去「数据管理」加。')); return; }
  if (Number(sy.no_nodes) || !sy.nodes.length) {
    host.appendChild(el('div', 'muted',
      '「' + sy.name + '」没有可加点项 —— 它是纯被动/基础系统，不消耗技术值。'
      + '要给别的系统加点，点上面的系统页签；要给它加节点，去「数据管理 → 加点」新增一行（系统填 ' + sy.id + '）。'));
  }
  /* 横向分层：一层一列，和问卷里的结构一致 */
  const cols = treeCols(sy.nodes);
  if (cols.length) {
    const lane = el('div', 'wiz-lane');
    cols.forEach((col, ci) => {
      const box = el('div', 'wiz-col');
      box.appendChild(el('div', 'wiz-colhead', '第 ' + (ci + 1) + ' 层'));
      col.forEach(({code, node}) => box.appendChild(nodeCard(node, sl, sy, code)));
      lane.appendChild(box);
    });
    host.appendChild(lane);
  }

  const used = ship.systems.reduce((a, x) => a + sysUsed(x), 0);
  $('#techUsed').textContent = used;
  const capEl = $('#techCap');
  if (capEl) {
    capEl.textContent = ship.tech_total || 0;
    capEl.style.cursor = 'pointer';
    capEl.title = '点一下可以改「整舰技术值上限」';
    capEl.onclick = async () => {
      const v = prompt('变形技术值上限（' + ship.name + '，当前 ' + (ship.tech_total || 0) + '）', ship.tech_total || 0);
      if (v === null) return;
      const n = +v;
      if (!(n >= 0)) return toast('请输入一个不小于 0 的数字', 'bad');
      try {
        await api('/api/data/ships', { method: 'PUT', body: {
          id: ship.id, name: ship.name, cls: ship.cls, kind: ship.kind, size: ship.size,
          tech_total: n, base: ship.base, note: ship.note } });
        ship.tech_total = n;
        renderTree(); renderEditor();
        toast('变形技术值已改成 ' + n, 'good');
      } catch (e) { toast('保存失败：' + e.message, 'bad'); }
    };
  }
  $('#techBar').style.width = Math.min(100, used / Math.max(1, ship.tech_total) * 100) + '%';

  const chips = $('#sysChips'); chips.innerHTML = '';
  ship.systems.forEach(x => {
    const u = sysUsed(x);
    const act = x.nodes.filter(nd => (sl.alloc[nd.id] || 0) > 0).length;
    const cap = x.tech_cap || 0;
    const txt = x.nodes.length
      ? (x.name + ' 节点 ' + act + '/' + (cap || '—') + '　技术值 ' + u)
      : (x.name + ' · 无加点');
    const c = el('span', 'chip' + (cap && act > cap ? ' over' : ''), txt);
    chips.appendChild(c);
  });
}

function nodeCard(nd, sl, sy, code) {
  const lv = sl.alloc[nd.id] || 0;
  const parents = parList(nd.parent).map(id => sy.nodes.find(x => x.id === id)).filter(Boolean);
  const unlocked = !parents.length || parents.some(p => (sl.alloc[p.id] || 0) > 0);
  const d = el('div', 'node' + (unlocked ? '' : ' locked'));
  const top = el('div', 'nm');
  if (code) top.appendChild(el('span', 'wiz-code', code + ' '));
  top.appendChild(el('span', '', nd.label));
  top.appendChild(el('span', 'muted', lv + '/' + nd.max_lv));
  d.appendChild(top);
  if (!unlocked) {
    const pn = parents.length ? parents.map(p => p.label).join('」或「') : '前置';
    d.title = '这一项还点不了：需要先把「' + pn + '」中的任意一个点到至少 1 级';
    d.appendChild(el('div', 'lockhint', '🔒 先点「' + pn + '」任一个'));
  }
  // ---- 效果区：先给「当前获得」，再给「每级 / 满级」参考，最后给「再升一级要多少」 ----
  let ef = nd.effect;
  try { if (typeof ef === 'string' && ef.trim().startsWith('{')) ef = JSON.parse(ef); } catch (e) { ef = null; }
  const keys = (ef && typeof ef === 'object') ? Object.keys(ef) : [];
  const r2 = v => Math.round(v * 100) / 100;
  const sg = v => (v >= 0 ? '+' : '');
  const nameOf = k => effName(k);

  if (keys.length) {
    // ① 当前这一级实际给了多少
    const curParts = keys.map(k => {
      const v = Number(ef[k]) || 0;
      return nameOf(k) + ' ' + sg(r2(v * lv)) + r2(v * lv);
    });
    const fullParts = keys.map(k => {
      const v = Number(ef[k]) || 0;
      return nameOf(k) + ' ' + sg(r2(v * nd.max_lv)) + r2(v * nd.max_lv);
    });
    const perParts = keys.map(k => {
      const v = Number(ef[k]) || 0;
      return nameOf(k) + ' ' + sg(v) + v + '/级';
    });

    const cur = el('div', 'eff cur-gain' + (lv ? '' : ' zero'),
      lv ? ('当前获得：' + curParts.join('，')) : ('当前获得：无（0/' + nd.max_lv + ' 级）'));
    d.appendChild(cur);

    // 满级：有作者写的 note 就用 note（可能带「折算/待核」之类口径），否则按效果算
    // 已经点满时「当前获得」就等于满级值，这行就不再重复
    if (!(lv >= nd.max_lv && !nd.note)) {
      d.appendChild(el('div', 'eff', nd.note || (fullParts.join('，') + '（满级）')));
    }
    d.appendChild(el('div', 'eff muted', '每级 ' + perParts.join('，')));

    if (lv >= nd.max_lv) {
      d.appendChild(el('div', 'eff maxed', '已满级'));
    } else {
      const nextCost = costOf(nd, lv);
      const nextGain = keys.map(k => {
        const v = Number(ef[k]) || 0;
        return nameOf(k) + ' ' + sg(v) + v;
      }).join('，');
      d.appendChild(el('div', 'eff next-gain',
        '再升 1 级：' + nextGain + '（消耗 ' + nextCost + ' 技术值）'));
    }
    if (nd.note) d.title = nd.note;
  } else if (nd.note) {
    d.appendChild(el('div', 'eff', nd.note));
  }

  d.appendChild(el('div', 'eff muted', '消耗 ' + nd.cost + ' 技术值/级' +
    (Array.isArray(nd.costs) && nd.costs.length && nd.costs[0] !== nd.cost
      ? '（逐级：' + nd.costs.join(' / ') + '）' : '') +
    (parents.length ? ' · 需先点「' + parents.map(p => p.label).join('」或「') + '」' : '')));
  const st = el('div', 'stepper');
  const minus = el('button', '', '−'); minus.type = 'button';
  const plus = el('button', '', '+'); plus.type = 'button';
  minus.onclick = () => {
    const cur = sl.alloc[nd.id] || 0;
    if (cur > 0) { if (cur === 1) delete sl.alloc[nd.id]; else sl.alloc[nd.id] = cur - 1;
      renderTree(); recalc(S.cur); }
  };
  plus.onclick = () => {
    const cur = sl.alloc[nd.id] || 0;
    if (!unlocked) return toast('先点上一级「' + parents.map(p => p.label).join('」或「') + '」', 'bad');
    if (cur >= nd.max_lv) return;
    const delta = costOf(nd, cur);
    // 系统上限 = 该系统「最多能点几个节点」（已激活节点数），不是技术值
    if (cur === 0 && sy.tech_cap && sysActive(sy) >= sy.tech_cap)
      return toast('「' + sy.name + '」可用节点 ' + sy.tech_cap + ' 个，已点亮 ' + sysActive(sy)
        + ' 个（系统里共 ' + sy.nodes.length + ' 个）。先把不用的节点减到 0，再点新的。', 'bad');
    const ship = shipOf(sl.ship);
    const total = ship.systems.reduce((a, x) => a + sysUsed(x), 0);
    if (ship.tech_total && total + delta > ship.tech_total)
      return toast('变形技术值不够：还要 ' + delta + '，只剩 ' + (ship.tech_total - total), 'bad');
    sl.alloc[nd.id] = cur + 1; renderTree(); recalc(S.cur);
  };
  st.append(minus, el('span', 'lv', lv + ' / ' + nd.max_lv), plus);
  d.appendChild(st);
  return d;
}

/* ---------- 基础加成：按方案汇总（不做 DPM / EHP / 技术值 这类派生计算） ---------- */
function slotAgg(slotKey) {
  const sl = S.slots[slotKey];
  const agg = {};
  const ship = sl && shipOf(sl.ship);
  if (!ship) return agg;
  const alloc = sl.alloc || {};
  (ship.systems || []).forEach(sy => (sy.nodes || []).forEach(nd => {
    const lv = Number(alloc[nd.id] || 0);
    if (!lv) return;
    let eff = nd.effect;
    if (typeof eff === 'string') { try { eff = JSON.parse(eff || '{}'); } catch (e) { eff = {}; } }
    Object.keys(eff || {}).forEach(k => { agg[k] = (agg[k] || 0) + Number(eff[k] || 0) * lv; });
  }));
  return agg;
}

/* 一行一个基础加成项：key 用于取值，label/unit 用于显示 */
const CMP_ROWS = [
  { k: 'hull',       t: '结构值',   u: '点' },
  { k: 'armor',      t: '抵抗伤害', u: '点' },
  { k: 'shield',     t: '护盾值',   u: '%' },
  { k: 'eva',        t: '通用闪避', u: '%' },
  { k: 'cruise',     t: '巡航速度', u: 'jm' },
  { k: 'warp',       t: '曲率速度', u: 'jm' },
  { k: 'spd',        t: '突防速度', u: 's' },
  { k: 'repair',     t: '维修量',   u: '点' },
  { k: 'dmg_atk',    t: '对舰',     u: '/分' },
  { k: 'dmg_air',    t: '对空',     u: '/分' },
  { k: 'dmg_siege',  t: '攻城',     u: '/分' }
];

function slotBaseVals(slotKey) {
  const sl = S.slots[slotKey];
  const ship = sl && shipOf(sl.ship);
  if (!ship) return null;
  const base = ship.base || {};
  const agg = slotAgg(slotKey);
  const sum = { dmg_atk: 0, dmg_air: 0, dmg_siege: 0 };
  (ship.systems || []).forEach(sy => {
    let n = {};
    try { n = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { n = {}; }
    Object.keys(sum).forEach(k => { sum[k] += Number(n[k]) || 0; });
  });
  return {
    hull: (Number(base.hull) || 0) * (1 + ((Number(base.hull_bonus_pct) || 0) + (Number(agg.hull) || 0)) / 100),
    armor: effVal('armor', base.armor, agg),
    shield: effVal('shield', base.shield, agg),
    eva: effVal('eva', base.eva, agg),
    cruise: effVal('speed', base.cruise, agg),
    warp: effVal('warp', base.warp, agg),
    spd: effVal('spd', base.spd, { spd: Number(agg.move) || 0 }),
    repair: effVal('repair', base.repair, agg),
    dmg_atk: sum.dmg_atk,
    dmg_air: sum.dmg_air,
    dmg_siege: sum.dmg_siege
  };
}

/* ---------- 计算 ---------- */
let pend = {};
function recalc(key) {
  const sl = S.slots[key];
  if (!S.bp || !sl.ship) return;
  clearTimeout(pend[key]);
  pend[key] = setTimeout(async () => {
    try {
      const j = await api('/api/simulate', {method: 'POST',
        body: sl.noCarrier ? {planes_only: true, planes: sl.planes, light: true}
          : {ship: sl.ship, modules: sl.modules, alloc: sl.alloc, planes: sl.planes, light: true}});
      S.results = S.results || {}; S.results[key] = j.result;
      renderResults();
    } catch (e) { toast('计算失败：' + e.message, 'bad'); }
  }, 120);
}

function renderSlotTabs() {
  const t = $('#slotTabs'); t.innerHTML = '';
  SLOTS.forEach(k => {
    const b = el('button', k === S.cur ? 'on' : '', '方案 ' + k);
    b.onclick = () => { S.cur = k;
      if (!S.slots[k].ship) S.slots[k].ship = S.bp.ships[0].id;
      renderSlotTabs(); renderEditor(); renderResults(); renderPlanes(); };
    t.appendChild(b);
  });
}

function renderResults() {
  renderSlotTabs();
  const body = $('#cmpBody'); body.innerHTML = '';
  const onlyDiff = !!($('#abDiff') && $('#abDiff').checked);
  const valsBySlot = SLOTS.map(k => slotBaseVals(k));
  CMP_ROWS.forEach(row => {
    const v = valsBySlot.map(o => (o ? o[row.k] : null));
    if (onlyDiff && v[0] !== null && v[1] !== null && Math.abs(v[0] - v[1]) < 1e-9) return;
    const tr = el('tr');
    tr.appendChild(el('td', '', row.t + (row.u ? '（' + row.u + '）' : '')));
    const nums = v.filter(x => x !== null);
    const best = nums.length ? Math.max.apply(null, nums) : null;
    v.forEach(x => tr.appendChild(el('td', (x === best && x) ? 'best' : '',
      x === null ? '—' : fmt(x, (row.k === 'hull' ? 0 : 1)))));
    const d = (v[0] !== null && v[1] !== null) ? v[1] - v[0] : null;
    tr.appendChild(el('td', d === null ? '' : (d >= 0 ? 'diff-pos' : 'diff-neg'),
      d === null ? '—' : (d >= 0 ? '+' : '') + fmt(d, (row.k === 'hull' ? 0 : 1))));
    body.appendChild(tr);
  });

  $('#cmpNote').textContent = '对比的是「基础加成 · 系统提供 + 加点」的合计值：护甲 / 护盾 / 通用闪避按相加，'
    + '冷却 / 锁定 / 突防按减免，其余按基础 ×（1+加成%）。这一页不算 DPM、有效血量、技术值。'
    + (onlyDiff ? '（只看有差异：A、B 相同的行已隐藏）' : '（绿色是两者中较高的一侧）');
}

/* ---------- A / B 工具：复制、交换 ---------- */
function cloneSlot(s) { return JSON.parse(JSON.stringify(s)); }

function abCopy() {
  if (!S.slots || !S.slots.A) return;
  S.slots.B = cloneSlot(S.slots.A);
  S.cur = 'B';
  repaintAll();
  SLOTS.forEach(recalc);
  toast('已把方案 A 原样复制到 B（现在编辑的是 B）', 'good');
}

function abSwap() {
  if (!S.slots || !S.slots.A || !S.slots.B) return;
  const t = S.slots.A; S.slots.A = S.slots.B; S.slots.B = t;
  const sy = S.sys.A; S.sys.A = S.sys.B; S.sys.B = sy;
  repaintAll();
  SLOTS.forEach(recalc);
  toast('A 和 B 已对调', 'good');
}

/* ---------- 舰载机 ---------- */
function syncLaunchSlots(list, k) {
  const key = k || S.cur;
  const sl = S.slots[key];
  const keep = {};
  Object.entries(sl.modules || {}).forEach(([slot, v]) => {
    const arr = Array.isArray(v) ? v : [v];
    if (!arr.some(id => list.some(m => m.id === id))) keep[slot] = v;
  });
  if ((sl.carrierMods || []).length) keep['M1'] = sl.carrierMods.slice();
  sl.modules = keep;
}

function planeBP() {
  // 只列「蓝图里的舰载机」（ships.kind === '舰载机'），planes 表里的旧占位机型不列。
  // 数值优先取服务端归一的 planes 条目（kind 已按 战机/护航艇 修正）。
  const meta = {};
  ((S.bp && S.bp.planes) || []).forEach(p => { meta[p.id] = p; });
  const out = [];
  ((S.bp && S.bp.ships) || []).forEach(s => {
    if (s.kind !== '舰载机') return;
    const nSys = (s.systems || []).length;
    const nNd = (s.systems || []).reduce((a, x) => a + (x.nodes || []).length, 0);
    const m = meta[s.id];
    if (m) {
      out.push({ id: s.id, name: s.name,
        kind: m.kind || ((s.size === '护航艇') ? '护航艇' : '战机'),
        pgroup: m.pgroup || '', sysCount: nSys, nodeCount: nNd });
      return;
    }
    /* 这里不再算 DPM / EHP：舰载机只按舱位与编组选用，数值看「基础加成」 */
    out.push({ id: s.id, name: s.name,
      kind: (s.size === '护航艇') ? '护航艇' : '战机',
      pgroup: '', sysCount: nSys, nodeCount: nNd });
  });
  return out;
}


function renderPlanes() {
  const host = $('#planeSlots'); if (!host) return;
  try { renderPlanesInner(host); }
  catch (e) {
    host.innerHTML = '';
    const d = el('div', 'viol', '⚠ 组合页渲染失败：' + e.message + '（把这句话发给我就能定位）');
    host.appendChild(d);
  }
}

function renderPlanesInner(host) {
  host.innerHTML = '';
  if (!S.bp) {
    host.appendChild(el('div', 'viol', '⚠ 蓝图数据还没载入完成：点所在页面的「刷新」按钮（或按 Ctrl+F5）或按 Ctrl+F5 再来一次。'));
    return;
  }
  const bps = planeBP();

  // 首次进这一页：默认把母舰上所有搭载系统都勾上，免得空着像「选不了」
  SLOTS.forEach(k0 => {
    const sl0 = S.slots[k0];
    if (!sl0.noCarrier && sl0.ship && !sl0.carrierMods) {
      const sh0 = shipOf(sl0.ship);
      const lm0 = sh0 && canMod(sh0) ? (sh0.modules || []).filter(m => m.mkind) : [];
      sl0.carrierMods = lm0.map(m => m.id);
      if (lm0.length) { syncLaunchSlots(lm0, k0); setTimeout(() => recalc(k0), 0); }
    }
  });

  const curTag = el('div', 'row muted');
  curTag.appendChild(el('span', '', '下面两套方案都在这一页编辑：左边填完 A，再去右上角切到 B 填另一套；两套对比见表格。'));
  curTag.style.marginBottom = '8px';
  host.appendChild(curTag);

  SLOTS.forEach(k => {
    const sl = S.slots[k];
    const r = (S.results || {})[k] || {};
    const card = el('div', 'card');
    card.appendChild(el('h2', '', '方案 ' + k + ' · 母舰与舰载机'));

    const sel = el('select');
    sel.appendChild(new Option('（不带母舰 · 只看舰载机）', ''));
    (S.bp.ships || []).filter(x => x.kind !== '舰载机').forEach(x => {
      sel.appendChild(new Option(x.name + '（' + (x.kind || x.size) + '）', x.id));
    });
    sel.value = sl.noCarrier ? '' : (sl.ship || '');
    sel.onchange = () => {
      if (!sel.value) {
        sl.noCarrier = true; sl.carrierMods = []; sl.planes = []; sl.modules = {};
      } else {
        const sh = shipOf(sel.value);
        sl.noCarrier = false; sl.ship = sel.value; sl.alloc = {}; sl.planes = [];
        sl.carrierMods = (sh.modules || []).filter(m => m.mkind).map(m => m.id);
        sl.modules = {};
        syncLaunchSlots((sh.modules || []).filter(m => m.mkind), k);
        S.sys[k] = (sh.systems[0] || {}).id;
      }
      recalc(k); setTimeout(renderPlanes, 240);
    };
    const rowSel = el('label', 'row');
    rowSel.appendChild(el('span', '', '母舰'));
    rowSel.appendChild(sel);
    card.appendChild(rowSel);

    const ship = sl.noCarrier ? null : shipOf(sl.ship);
    if (ship && !canMod(ship)) {
      card.appendChild(el('div', 'muted', '▲ ' + (ship.cls || ship.kind) + '：只有超主力舰与巡洋舰、驱逐舰有模块/舱位，这条船不显示搭载系统。'));
    } else if (ship) {
      const lm = (ship.modules || []).filter(m => m.mkind);
      if (!lm.length) card.appendChild(el('div', 'muted', '这条船没有搭载类模块（去数据管理里加）。'));
      lm.forEach(m => {
        const lb = el('label', 'row');
        const ck = el('input'); ck.type = 'checkbox';
        ck.checked = (sl.carrierMods || []).includes(m.id);
        ck.onchange = () => {
          sl.carrierMods = sl.carrierMods || [];
          const letter = (m.slot || '').charAt(0);
          if (ck.checked) {
            // 同系列互斥：勾了就自动取消同 M / A / B 系列的其它模块
            const clash = sl.carrierMods.filter(id => {
              const om = (ship.modules || []).find(x => x.id === id);
              return om && om.slot && om.slot.charAt(0) === letter;
            });
            if (clash.length) {
              sl.carrierMods = sl.carrierMods.filter(id => !clash.includes(id));
              toast(letter + ' 系列只能选一个模块，已把 ' + clash.join('、') + ' 换掉', 'warn');
            }
            sl.carrierMods.push(m.id);
          }
          else sl.carrierMods = sl.carrierMods.filter(x => x !== m.id);
          sl.planes = (sl.planes || []).filter(x => sl.carrierMods.includes(x.m));
          syncLaunchSlots(lm, k);
          recalc(k); setTimeout(renderPlanes, 240);
        };
        lb.appendChild(ck);
        const bays = (m.bays && m.bays.length) ? m.bays
          : (m.mkind ? [{kind: (m.mkind || '').replace('搭载系统', ''), cap: m.cap,
                          allow_group: m.allow_group}] : []);
        lb.appendChild(el('span', '', ' ' + m.name + '　'
          + bays.map(b => (b.kind || '') + ' ' + (b.cap || 0) + ' 舱'
              + (b.allow_group ? '（' + b.allow_group + '）' : '')).join(' ＋ ')));
        card.appendChild(lb);
      });
    }

    const lchs = r.launch ? (Array.isArray(r.launch) ? r.launch : [r.launch]) : [];
    const cm = (sl.carrierMods || []).slice();
    const modOf = id => {
      for (const sh of (S.bp.ships || [])) {
        const m = (sh.modules || []).find(z => z.id === id);
        if (m) return m;
      }
      return null;
    };
    // 每个搭载系统按 bays 展开成若干「装载位」
    const holds = [];
    cm.forEach(id => {
      const m = modOf(id) || {name: id, bays: []};
      const bays = (m.bays && m.bays.length) ? m.bays
        : (m.mkind ? [{kind: (m.mkind || '').replace('搭载系统', ''), cap: m.cap,
                        allow_group: m.allow_group}] : []);
      bays.forEach((b, i) => {
        if ((b.kind || '') === '无人机') return;   // 无人机由系统自带，不占舱位、不进装载位
        holds.push({
          key: id + '#' + i, mid: id, bi: i, mod: m.name,
          kind: (b.kind || ''), cap: (b.cap || 0), allow: (b.allow_group || '')
        });
      });
    });

    // 舱位概览
    if (holds.length) {
      const chips = el('div', 'row');
      holds.forEach(h => {
        const l = lchs.find(z => z.id === h.mid && z.bay === h.bi);
        const used = l ? l.used : 0;
        const c = el('span', 'chip' + (h.cap && used > h.cap ? ' over' : ''),
          h.mod + ' · ' + h.kind + '舱　' + used + ' / ' + h.cap + ' 舱');
        chips.appendChild(c);
      });
      card.appendChild(chips);
    }
    // 系统自带的无人机：不占舱位、不需要选，只提示数量
    const shipNow = shipOf(S.slots[S.cur].ship);
    const drones = ((shipNow && shipNow.systems) || []).filter(sy => (+((sy.norm || {}).bay_drone) || 0) > 0);
    if (drones.length) {
      const dc = el('div', 'row');
      drones.forEach(sy => {
        dc.appendChild(el('span', 'chip',
          sy.name + ' · 自带无人机 ' + (+sy.norm.bay_drone) + ' 架（不占舱位）'));
      });
      card.appendChild(dc);
    }

    // 舱位表：一个舱位一行
    const tbl = el('table');
    const th = el('thead');
    const htr = el('tr');
    ['舱位', '舰载机蓝图', '架次', '占用'].forEach(t => htr.appendChild(el('th', '', t)));
    th.appendChild(htr); tbl.appendChild(th);
    const tb = el('tbody');

    if (!holds.length) {
      const tr0 = el('tr');
      const td0 = el('td', 'muted', (sl.noCarrier
        ? '当前是「不带母舰」模式，只看舰载机；切回母舰才会出现舱位。'
        : '这条母舰还没有可用的搭载舱位 —— 去「数据管理 → 模块」给它加一条带舱位的记录（或勾选上面的搭载系统）。'));
      td0.colSpan = 4;
      tr0.appendChild(td0); tb.appendChild(tr0);
    }

    // 一个舱位一行：舱位 → 选蓝图（只列同类，纯名字）→ 架次（加减）
    holds.forEach(h => {
      const tr = el('tr');
      tr.appendChild(el('td', '', h.mod + ' · ' + h.kind + ' ' + h.cap + ' 舱'));

      const cand = bps.filter(p => (!h.kind || !p.kind || p.kind === h.kind) && groupOk(p.pgroup, h.allow));
      const cur = (sl.planes || []).find(x => x.m === h.mid && (x.bay || 0) === h.bi);

      const ps = el('select');
      ps.appendChild(new Option('（不装）', ''));
      cand.forEach(p => {
        const o = new Option(p.name + (p.pgroup ? '（' + p.pgroup + '）' : ''), p.id);
        if (cur && cur.id === p.id) o.selected = true;
        ps.appendChild(o);
      });
      if (!cand.length) {
        ps.innerHTML = '';
        ps.appendChild(new Option('（没有 ' + h.kind + ' 类蓝图）', ''));
      }

      const cnt = { v: cur ? cur.count : 0 };
      const save = () => {
        const pid = ps.value, c = cnt.v;
        sl.planes = (sl.planes || []).filter(x => !(x.m === h.mid && (x.bay || 0) === h.bi));
        if (pid && c > 0) sl.planes.push({ id: pid, count: c, m: h.mid, bay: h.bi });
        recalc(k); setTimeout(renderPlanes, 220);
      };

      const st = el('div', 'stepper');
      const minus = el('button', '', '−'); minus.type = 'button';
      const lv = el('span', 'lv', String(cnt.v));
      const plus = el('button', '', '+'); plus.type = 'button';
      const capMax = h.cap || 99;
      minus.onclick = () => { if (cnt.v > 0) { cnt.v--; lv.textContent = cnt.v; save(); } };
      plus.onclick = () => {
        if (!ps.value) return toast('先选一个舰载机蓝图', 'bad');
        if (cnt.v >= capMax) return toast('这个舱只有 ' + capMax + ' 舱，装不下了', 'bad');
        cnt.v++; lv.textContent = cnt.v; save();
      };
      st.append(minus, lv, plus);

      ps.onchange = () => { if (ps.value && cnt.v === 0) { cnt.v = 1; lv.textContent = '1'; } save(); };

      tr.appendChild((() => { const td = el('td'); td.appendChild(ps); return td; })());
      tr.appendChild((() => { const td = el('td'); td.appendChild(st); return td; })());
      tr.appendChild(el('td', 'muted', h.cap ? (cnt.v + ' / ' + h.cap + ' 舱') : ''));
      tb.appendChild(tr);
    });

    tbl.appendChild(tb);
    card.appendChild(tbl);

    if (!cm.length && !sl.noCarrier) {
      card.appendChild(el('div', 'muted', '这条母舰没有可选的搭载系统（去「数据管理 → 模块」给它加一条带 bays 舱位的记录）。'));
    }

    if (!sl.noCarrier && !lchs.length && (sl.planes || []).length) {
      const warn = el('div', 'viol');
      warn.appendChild(el('div', '', '⚠ 勾选搭载系统之后，这些舰载机才会算进输出'));
      card.appendChild(warn);
    }
    if (sl.noCarrier) {
      card.appendChild(el('div', 'muted', '这一侧只算舰载机，不挂母舰。'));
    }
    if ((r.violations || []).length) {
      const v = el('div', 'viol');
      r.violations.forEach(t => v.appendChild(el('div', '', '⚠ ' + t)));
      card.appendChild(v);
    }
    host.appendChild(card);
  });

  const t2 = $('#planeCmp'); t2.innerHTML = '';
  SLOTS.forEach(k2 => {
    const rr = (S.results || {})[k2] || {};
    const s2 = S.slots[k2];
    const mods = (s2.carrierMods || []).map(id => {
      for (const sh of (S.bp.ships || [])) {
        const m = (sh.modules || []).find(x => x.id === id);
        if (m) return m.name;
      }
      return id;
    }).join(' + ') || '—';
    const pl = (s2.planes || []).map(x => {
      const bp = (S.bp.ships || []).find(z => z.id === x.id)
        || (S.bp.planes || []).find(z => z.id === x.id);
      return (bp ? bp.name : x.id) + '×' + x.count;
    }).join('、') || '—';
    const lch = rr.launch ? (Array.isArray(rr.launch) ? rr.launch : [rr.launch]) : [];
    const cap = lch.map(l => l.used + '/' + l.cap).join(' + ') || '—';
    const tr = el('tr');
    [['方案 ' + k2], [s2.noCarrier ? '（不带母舰）' : (rr.ship || '—')], [mods], [pl],
     [cap], [String((rr.violations || []).length)]]
      .forEach(([v]) => tr.appendChild(el('td', '', v)));
    t2.appendChild(tr);
  });
}

/* ---------- 数据管理 ---------- */
const ENT = {
  attrs: ['id', 'name', 'unit', 'note', 'ord'],
  ships: ['id', 'name', 'kind', 'cls', 'tech_total', 'note'],
  systems: ['id', 'ship', 'slot', 'name', 'tech_cap', 'ord', 'no_nodes', 'note'],
  nodes: ['id', 'sys', 'parent', 'label', 'max_lv', 'cost', 'note'],
  modules: ['id', 'ship', 'slot', 'name', 'mkind', 'cap', 'allow_group', 'note'],
  planes: ['id', 'name', 'kind', 'pgroup', 'note'],
  groups: ['id', 'name', 'per_unit', 'hangar', 'note'],
  effects: ['id', 'name', 'unit', 'note'],
};
function sysName(id) {
  if (!id) return '';
  const sp = ((S.bp && S.bp.ships) || []);
  for (const sh of sp) for (const sy of (sh.systems || [])) if (sy.id === id) return sy.name;
  return id;
}
function rowsOf(ent) {
  if (ent === 'effects') return (S.bp && S.bp.effects) || [];
  if (ent === 'attrs') return (S.bp && S.bp.attrs) || [];
  if (ent === 'ships') return S.bp.ships;
  if (ent === 'planes') return S.bp.planes;
  const out = [];
  for (const s of S.bp.ships) {
    if (ent === 'systems') out.push(...s.systems.map(x => Object.assign({_ship: s.name}, x)));
    if (ent === 'modules') out.push(...s.modules.map(x => Object.assign({_ship: s.name}, x)));
    if (ent === 'nodes') {
      for (const sy of s.systems)
        out.push(...sy.nodes.map(x => Object.assign({_ship: s.name, _sys: sy.name}, x)));
    }
  }
  return out;
}
function colsFor(ent) {
  if (ent === 'nodes') return ['_ship', '_sys'].concat(ENT.nodes);
  if (ent === 'systems' || ent === 'modules') return ['_ship'].concat(ENT[ent]);
  return ENT[ent];
}
function renderData() {
  if (!can('data_view')) return;
  const ent = S.ent;
  /* 舰船只走「问卷式录入」（会连带建系统/节点/模块），其余表才有「直接新增一行」 */
  const isShip = ent === 'ships';
  const canEditRow = can(ent === 'effects' ? 'effects_edit' : 'data_edit');
  const wizBtn = $('#wizBtn'); if (wizBtn) wizBtn.classList.toggle('hide', !isShip || !canEditRow);
  const newBtn = $('#newEnt'); if (newBtn) newBtn.classList.toggle('hide', isShip || !canEditRow);
  const cols = colsFor(ent);
  const head = $('#entHead'); head.innerHTML = '';
  cols.forEach(c => head.appendChild(el('th', '', c.replace('_', ''))));
  head.appendChild(el('th', '', '操作'));
  const body = $('#entBody'); body.innerHTML = '';
  const canEdit = canEditRow;
  const q = (S.entQ || '').trim().toLowerCase();
  rowsOf(ent).filter(row => {
    if (!q) return true;
    return cols.some(c => {
      const v = row[c];
      return v !== undefined && v !== null && String(v).toLowerCase().includes(q);
    });
  }).forEach(row => {
    const tr = el('tr');
    cols.forEach(c => {
      let v = row[c];
      if (v === undefined || v === null) v = '';
      if (typeof v === 'object') v = JSON.stringify(v);
      if (c === 'bonus' && (v === '{}' || v === '')) v = '（效果待填）';
      if (c === 'no_nodes') {
        const td0 = el('td', '');
        const ck = el('input'); ck.type = 'checkbox';
        ck.checked = !!Number(v); ck.disabled = !canEdit;
        ck.onchange = async () => {
          const cur = rowsOf(ent).find(x => x.id === row.id) || {};
          try {
            await api('/api/data/systems', { method: 'PUT', body: {
              id: row.id, ship: cur.ship, slot: cur.slot, name: cur.name,
              tech_cap: cur.tech_cap, ord: cur.ord, stats: cur.stats, note: cur.note,
              no_nodes: ck.checked ? 1 : 0 } });
            toast(ck.checked ? '已标为「无加点」' : '已允许加点', 'good');
            await loadBlueprints(true); renderData(); renderEditor();
          } catch (e) { ck.checked = !ck.checked; toast('保存失败：' + e.message, 'bad'); }
        };
        td0.appendChild(ck); tr.appendChild(td0); return;
      }
      tr.appendChild(el('td', '', String(v).slice(0, 40)));
    });
    const td = el('td');
    if (canEdit) {
      const b = el('button', 'btn ghost', '改');
      b.onclick = () => (ent === 'ships' ? wizStart(row.id) : openEnt(row));
      const d = el('button', 'btn danger', '删'); d.style.marginLeft = '6px';
      d.onclick = () => delEnt(row.id);
      td.append(b, d);
    }
    tr.appendChild(td); body.appendChild(tr);
  });
  const hint = (ent === 'effects')
    ? '效果库 = 加点节点的效果名。name 显示给用户看，unit 可留空；'
      + '改名/加单位后，所有引用它的节点会自动用新名字。删掉某个效果前，先把引用它的节点改掉。'
    : (ent === 'modules')
    ? '模块的 bonus/stats 已清空，点「改」按 {"dmg":15,"cd":20} 这类写法填；空着就只算舱位。'
    : '';
  $('#dataNote').textContent = canEdit
    ? '共 ' + rowsOf(ent).length + ' 条；' + hint + '改完立即生效，所有在线页面自动刷新。'
    : '只读：用 admin 登录后才能改数据。';
}

const FIELD_LABEL = {
  id: 'ID（唯一，建议英文/拼音）', ship: '所属舰船', sys: '所属系统', parent: '前置节点',
  slot: '槽位（M1/A1/B1…，主力舰留空）', name: '名称', cls: '舰型', kind: '舰种',
  size: '尺寸', tech_total: '变形技术值', pgroup: '编组', base: '基础属性（数值表）',
  stats: '系统数值（键值表）', note: '备注', tech_cap: '可用节点数（能点亮几个）',
  ord: '显示顺序', no_nodes: '该系统中没有加点', label: '节点名', max_lv: '级数上限',
  cost: '每级消耗技术值', costs: '逐级消耗（逗号分隔，可空）', effect: '加点效果',
  mkind: '搭载种类', cap: '舱位数', allow_group: '编组限制', bays: '舱位列表',
  bonus: '模块加成', per_unit: '每架占位', hangar: '机库要求', unit: '单位'
};
const JSON_KEYS = {ships: ['base'], systems: ['stats'], modules: ['stats'], planes: ['base']};
function shipOpts() { return ((S.bp && S.bp.ships) || []).map(x => [x.id, x.name + '（' + (x.kind || '') + '）']); }
function sysOpts() {
  const out = [];
  ((S.bp && S.bp.ships) || []).forEach(sh => (sh.systems || []).forEach(sy => out.push([sy.id, sh.name + ' / ' + sy.name])));
  return out;
}
function nodeOpts(sysId) {
  const out = [['', '（无，作为根节点）']];
  ((S.bp && S.bp.ships) || []).forEach(sh => (sh.systems || []).forEach(sy => {
    if (sysId && sy.id !== sysId) return;
    (sy.nodes || []).forEach(nd => out.push([nd.id, (sy.name || '') + ' / ' + nd.label]));
  }));
  return out;
}
function effOpts() { return ((S.bp && S.bp.effects) || []).map(e => [e.id, e.name]); }

function fBox(host, k, t) {
  const wrap = el('label', 'fld');
  wrap.appendChild(el('span', '', FIELD_LABEL[k] || k));
  const c = el('div', 'fldc');
  c.dataset.k = k; c.dataset.t = t;
  wrap.appendChild(c); host.appendChild(wrap);
  return c;
}
function fText(host, k, v, type) {
  const c = fBox(host, k, type || 'text');
  const inp = el('input'); inp.type = type || 'text';
  inp.value = v === undefined || v === null ? '' : v;
  c.appendChild(inp);
  return inp;
}
function fSel(host, k, v, opts) {
  const c = fBox(host, k, 'select');
  const sl = el('select');
  opts.forEach(([val, txt]) => { const o = el('option', '', txt); o.value = val; sl.appendChild(o); });
  sl.value = v === undefined || v === null ? '' : v;
  c.appendChild(sl);
  return sl;
}
function fCheck(host, k, v) {
  const c = fBox(host, k, 'check');
  const ck = el('input'); ck.type = 'checkbox'; ck.checked = !!Number(v);
  c.appendChild(ck);
  return ck;
}
function fJson(host, k, v) {
  const c = fBox(host, k, 'json');
  const ta = el('textarea'); ta.spellcheck = false;
  ta.style.minHeight = '64px';
  ta.value = JSON.stringify(v || {}, null, 0);
  c.appendChild(ta);
  return ta;
}
function fKV(host, k, obj, opts) {
  const c = fBox(host, k, 'kv');
  const list = el('div');
  const add = (kk, vv) => {
    const row = el('div', 'kvrow');
    const sel = el('select');
    opts().forEach(([val, txt]) => { const o = el('option', '', txt); o.value = val; sel.appendChild(o); });
    sel.value = kk || '';
    const num = el('input'); num.type = 'number'; num.step = '0.1'; num.value = vv === undefined ? 0 : vv;
    num.style.width = '80px';
    const del = el('button', 'btn ghost', '×'); del.type = 'button';
    del.onclick = () => row.remove();
    row.append(sel, num, del);
    list.appendChild(row);
  };
  Object.keys(obj || {}).forEach(kk => add(kk, obj[kk]));
  c.appendChild(list);
  const btn = el('button', 'btn ghost', '＋ 加一条'); btn.type = 'button';
  btn.onclick = () => add(opts()[0] ? opts()[0][0] : '', 0);
  c.appendChild(btn);
}
function fBays(host, k, arr) {
  const c = fBox(host, k, 'bays');
  const list = el('div');
  const add = (b) => {
    const row = el('div', 'kvrow');
    const kd = el('select');
    [['战机', '战机'], ['护航艇', '护航艇'], ['', '不限种类']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; kd.appendChild(o); });
    kd.value = b && b.kind || '';
    const cp = el('input'); cp.type = 'number'; cp.value = b && b.cap || 0; cp.style.width = '70px';
    const al = el('select');
    [['', '不限编组'], ['中编组', '仅中编组'], ['大编组', '仅大编组']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; al.appendChild(o); });
    al.value = b && b.allow_group || '';
    const del = el('button', 'btn ghost', '×'); del.type = 'button'; del.onclick = () => row.remove();
    row.append(kd, cp, al, del);
    list.appendChild(row);
  };
  (arr || []).forEach(add);
  c.appendChild(list);
  const btn = el('button', 'btn ghost', '＋ 加一个舱位'); btn.type = 'button';
  btn.onclick = () => add({kind: '战机', cap: 1, allow_group: ''});
  c.appendChild(btn);
}

function openEnt(row) {
  S.editing = row || null;
  const ent = S.ent;
  const isNew = !row;
  $('#entTitle').textContent = (isNew ? '新增 ' : '修改 ') + ent + (row ? ' · ' + row.id : '');
  const host = $('#entFields'); host.innerHTML = '';
  const val = (k) => row ? (row[k] === undefined || row[k] === null ? '' : row[k]) : '';

  if (ent === 'ships') {
    fText(host, 'id', val('id'), 'text').disabled = !isNew;
    fText(host, 'name', val('name'));
    fSel(host, 'kind', val('kind') || '主力舰', [['主力舰', '主力舰'], ['超主力舰', '超主力舰'], ['舰载机', '舰载机']]);
    fSel(host, 'cls', val('cls') || '巡洋舰', [['巡洋舰', '巡洋舰'], ['驱逐舰', '驱逐舰'], ['护卫舰', '护卫舰'], ['航空母舰', '航空母舰'], ['战列巡洋舰', '战列巡洋舰'], ['战机', '战机'], ['护航艇', '护航艇']]);
    fSel(host, 'pgroup', val('pgroup'), [['', '（无）'], ['中编组', '中编组'], ['大编组', '大编组']]);
    fSel(host, 'cmd_type', val('cmd_type'), [['', '（非舰载机）'], ['往复式', '往复式'], ['独立式', '独立式']]);
    fText(host, 'tech_total', val('tech_total'), 'number');
    fJson(host, 'base', row ? row.base : {armor: 0, shield: 0, hull: 1000, dur: 5, cyc: 1, per: 1, cd: 10, ammo: 1, atk: 1, dmg: 100, repair: 0});
    fText(host, 'note', val('note'));
  } else if (ent === 'systems') {
    fText(host, 'id', val('id'), 'text').disabled = !isNew;
    fSel(host, 'ship', val('ship'), shipOpts());
    fText(host, 'slot', val('slot'));
    fText(host, 'name', val('name'));
    fText(host, 'tech_cap', val('tech_cap'), 'number');
    fText(host, 'ord', val('ord'), 'number');
    fCheck(host, 'no_nodes', val('no_nodes'));
    fJson(host, 'stats', row ? row.stats : {});
    fText(host, 'note', val('note'));
  } else if (ent === 'nodes') {
    fText(host, 'id', val('id'), 'text').disabled = !isNew;
    fSel(host, 'sys', val('sys'), sysOpts());
    fText(host, 'parent', val('parent'));   /* 可填多个前置节点 id，用逗号分隔：满足其一即可 */
    fText(host, 'label', val('label'));
    fText(host, 'max_lv', val('max_lv'), 'number');
    fText(host, 'cost', val('cost'), 'number');
    const cs = el('div');
    const cbox = fBox(host, 'costs', 'costs');
    const cin = el('input'); cin.type = 'text';
    let cv = row ? row.costs : '';
    if (Array.isArray(cv)) cv = cv.join(',');
    try { if (typeof cv === 'string' && cv.trim().startsWith('[')) cv = JSON.parse(cv).join(','); } catch (e) {}
    cin.value = cv || '';
    cbox.appendChild(cin);
    fKV(host, 'effect', row ? row.effect : {dmg: 2}, effOpts);
    fText(host, 'note', val('note'));
  } else if (ent === 'modules') {
    fText(host, 'id', val('id'), 'text').disabled = !isNew;
    fSel(host, 'ship', val('ship'), shipOpts());
    fText(host, 'slot', val('slot'));
    fText(host, 'name', val('name'));
    fSel(host, 'sys', val('sys'), [['', '（不挂系统）']].concat(sysOpts()));
    fSel(host, 'mkind', val('mkind'), [['', '（普通模块）'], ['战机搭载系统', '战机搭载系统'], ['护航艇搭载系统', '护航艇搭载系统']]);
    fText(host, 'cap', val('cap'), 'number');
    fSel(host, 'allow_group', val('allow_group'), [['', '不限'], ['中编组', '仅中编组'], ['大编组', '仅大编组']]);
    fBays(host, 'bays', row ? row.bays : []);
    fKV(host, 'bonus', row ? row.bonus : {}, effOpts);
    fJson(host, 'stats', row ? row.stats : {});
    fText(host, 'note', val('note'));
  } else if (ent === 'planes') {
    fText(host, 'id', val('id'), 'text').disabled = !isNew;
    fText(host, 'name', val('name'));
    fSel(host, 'kind', val('kind'), [['战机', '战机'], ['护航艇', '护航艇']]);
    fSel(host, 'pgroup', val('pgroup'), [['', '（无）'], ['中编组', '中编组'], ['大编组', '大编组']]);
    fJson(host, 'base', row ? row.base : {});
    fText(host, 'note', val('note'));
  } else if (ent === 'effects') {
    fText(host, 'id', val('id'), 'text').disabled = !isNew;
    fText(host, 'name', val('name'));
    fText(host, 'unit', val('unit'));
    fText(host, 'note', val('note'));
  } else if (ent === 'attrs') {
    fText(host, 'id', val('id'), 'text').disabled = !isNew;
    fText(host, 'name', val('name'));
    fText(host, 'unit', val('unit'));
    fText(host, 'ord', val('ord'), 'number');
    fText(host, 'note', val('note'));
  } else {
    ENT[ent].forEach(k => fText(host, k, val(k)));
  }
  $('#entJson').value = row ? JSON.stringify(row, null, 2) : '';
  $('#entDlg').showModal();
}

function readEnt() {
  const obj = {};
  $('#entFields').querySelectorAll('[data-k]').forEach(c => {
    const k = c.dataset.k, t = c.dataset.t;
    if (t === 'check') obj[k] = c.querySelector('input').checked ? 1 : 0;
    else if (t === 'select') obj[k] = c.querySelector('select').value;
    else if (t === 'json') {
      const raw = c.querySelector('textarea').value.trim() || '{}';
      try { obj[k] = JSON.parse(raw); } catch (e) { throw new Error((FIELD_LABEL[k] || k) + ' 的 JSON 写错了：' + e.message); }
    } else if (t === 'kv') {
      const o = {};
      c.querySelectorAll('.kvrow').forEach(r => {
        const kk = r.querySelector('select').value;
        const vv = Number(r.querySelector('input').value);
        if (kk) o[kk] = vv;
      });
      obj[k] = o;
    } else if (t === 'bays') {
      const arr = [];
      c.querySelectorAll('.kvrow').forEach(r => {
        const sels = r.querySelectorAll('select');
        arr.push({kind: sels[0].value, cap: Number(r.querySelector('input').value) || 0, allow_group: sels[1].value});
      });
      obj[k] = arr;
    } else if (k === 'costs') {
      const raw = c.querySelector('input').value.trim();
      obj[k] = raw;
    } else if (c.querySelector('input') && c.querySelector('input').type === 'number') {
      const v = c.querySelector('input').value;
      obj[k] = v === '' ? 0 : Number(v);
    } else {
      obj[k] = c.querySelector('input') ? c.querySelector('input').value : '';
    }
  });
  return obj;
}

async function submitEnt(ev) {
  ev.preventDefault();
  let obj;
  try { obj = readEnt(); }
  catch (e) { toast(e.message, 'bad'); return; }
  if (!obj.id) { toast('ID 不能空', 'bad'); return; }
  if (S.ent === 'nodes' && obj && obj.sys) {
    const sy = ((S.bp && S.bp.systems) || []).find(x => x.id === obj.sys);
    if (sy && Number(sy.no_nodes)) {
      toast('「' + sy.name + '」被标为无加点，先在「系统」表里取消勾选再建节点', 'bad');
      return;
    }
  }
  try {
    const r = await api('/api/data/' + S.ent, {method: 'PUT', body: obj});
    $('#entDlg').close();
    toast(r && r.action === '无变化' ? '内容没变，已跳过（不写日志）' : '已保存', 'good');
    await loadBlueprints(true); renderData();
  } catch (e) { toast('保存失败：' + e.message, 'bad'); }
}

async function delEnt(id) {
  if (!askConfirm(id, '删除 ' + S.ent + ' / ' + id)) return;
  try { await api('/api/data/' + S.ent + '/' + encodeURIComponent(id), {method: 'DELETE', confirm: id});
    toast('已删除', 'good'); await loadBlueprints(true); renderData(); }
  catch (e) { toast('删除失败：' + e.message, 'bad'); }
}

async function exportJson() {
  try {
    const j = await api('/api/export');
    const blob = new Blob([JSON.stringify(j, null, 2)], {type: 'application/json'});
    const a = el('a'); a.href = URL.createObjectURL(blob);
    a.download = 'fleet-data-v' + j.version + '.json'; a.click();
    toast('已导出', 'good');
  } catch (e) { toast(e.message, 'bad'); }
}

/* ---------- 人员 ---------- */
function goLogin(msgText) {
  const next = encodeURIComponent(location.pathname + location.search);
  if (msgText) try { sessionStorage.setItem('ft_flash', msgText); } catch (e) {}
  location.replace('/login.html?next=' + next);
}

async function quitOthers() {
  if (!confirm('其它设备上的登录会全部失效，本机保持登录。\n\n继续？')) return;
  try {
    const r = await api('/api/logout_others', { method: 'POST' });
    const n = (r && r.closed) || 0;
    toast(n ? '已退出其它设备上的 ' + n + ' 个登录' : '其它设备本来就没有登录', n ? 'good' : '');
  } catch (e) { toast('操作失败：' + e.message, 'bad'); }
}

async function doLogout(msg) {
  try { await api('/api/logout', {method: 'POST'}); } catch (e) {}
  S.token = ''; try { localStorage.removeItem('ft_token'); } catch (e) {}
  S.user = null;
  goLogin(msg || '已退出登录');
}

function whoami() {
  const w = $('#who'); w.innerHTML = '';
  const rl = $('#regLink'); if (rl) rl.style.display = S.user ? 'none' : '';
  if (!S.user) { w.appendChild(el('span', 'muted', '未登录')); return; }
  const ROLE_CN = {superadmin: '超级管理员', admin: '管理员', editor: '编辑', viewer: '只读'};
  w.appendChild(el('span', 'pill ' + S.user.role, ROLE_CN[S.user.role] || S.user.role));
  w.appendChild(el('span', 'muted', ' ' + (S.user.name || S.user.username)));
  const pw = el('button', 'btn ghost', '改密码'); pw.style.marginLeft = '8px';
  pw.onclick = () => openPwdDlg(false);
  w.appendChild(pw);
  const b = el('button', 'btn ghost', '退出'); b.style.marginLeft = '8px';
  b.onclick = () => doLogout('已退出登录');
  w.appendChild(b);

  /* 只在登录后出现：和「改密码 / 退出」并排，不再挤在登录链接旁边 */
  w.appendChild(el('span', 'hdrsep'));
  const qo = el('button', 'btn ghost sm', '退出其它设备');
  qo.id = 'quitOthers';
  qo.title = '让其它设备上的登录全部失效，本机保持登录';
  qo.onclick = quitOthers;
  w.appendChild(qo);
  applyPerms();
}
async function login() {
  try {
    const j = await api('/api/login', {method: 'POST',
      body: {username: $('#lu').value.trim(), password: $('#lp').value}});
    S.token = j.token; S.user = j.user; localStorage.setItem('ft_token', j.token);
    whoami();
  loadSettings();
  applyPerms();
  const baAll = $('#baAll');
  if (baAll) {
    baAll.checked = localStorage.getItem('ft_baAll') === '1';
    baAll.onchange = () => { localStorage.setItem('ft_baAll', baAll.checked ? '1' : '0'); renderBaseAttrs(); };
  }

  const be = $('#brandEdit');
  if (be) be.onclick = async () => {
    const cur = ($('#brandTitle') || {}).textContent || '';
    const t = prompt('页面标题（最多 60 字）', cur);
    if (t === null) return;
    const v = t.trim();
    if (!v) return toast('标题不能空', 'bad');
    try {
      await api('/api/settings', { method: 'PUT', body: { title: v } });
      applyBrand(v);
      toast('标题已改', 'good');
    } catch (e) { toast('保存失败：' + e.message, 'bad'); }
  };
 await loadUsers(); renderData();
    S.user = j.user; whoami(); applyPerms();
    toast('欢迎，' + (j.user.name || j.user.username), 'good');
  } catch (e) { toast('登录失败：' + e.message, 'bad'); }
}
async function loadUsers(q) {
  if (!can('people_view')) return;
  try { const j = await api('/api/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
    S.users = j.users; renderUsers(); }
  catch (e) { toast('读取失败：' + e.message, 'bad'); }
}
function renderUsers() {
  $('#loginCard').classList.add('hide'); $('#peopleBody').classList.remove('hide');
  const canEdit = can('people_edit');
  $('#addUserBtn').disabled = !canEdit;
  $('#auditBtn').classList.toggle('hide', !canEdit);
  const b = $('#userBody'); b.innerHTML = '';
  (S.users || []).forEach(u => {
    const tr = el('tr');
    [['username'], ['name'], ['role'], ['squadron'], ['phone'], ['status'], ['updated_at']].forEach(([k]) => {
      if (k === 'role') {
        const td = el('td'); td.appendChild(el('span', 'pill ' + u.role,
          {superadmin: '超级管理员', admin: '管理员', editor: '编辑', viewer: '只读'}[u.role] || u.role));
        tr.appendChild(td);
      } else tr.appendChild(el('td', '', u[k] || ''));
    });
    const td = el('td');
    if (canEdit) {
      const e = el('button', 'btn ghost', '改'); e.onclick = () => openUserDlg(u);
      const d = el('button', 'btn danger', '删'); d.style.marginLeft = '6px';
      d.onclick = () => delUser(u);
      td.append(e, d);
    }
    tr.appendChild(td); b.appendChild(tr);
  });
  $('#userNote').textContent = '共 ' + (S.users || []).length + ' 条；' +
    (canEdit ? '管理员可增删改。' : '当前角色只读。');
}
function openUserDlg(u) {
  S.editing = u || null;
  const f = $('#userForm');
  $('#dlgTitle').textContent = u ? '修改人员 · ' + u.username : '新增人员';
  f.username.value = u ? u.username : ''; f.username.disabled = !!u;
  f.password.value = ''; f.name.value = u ? u.name : '';
  f.role.value = u ? u.role : 'viewer';
  const supOpt = f.role.querySelector('option[value=superadmin]');
  if (supOpt) supOpt.disabled = !(S.user && S.user.role === 'superadmin');
  f.role.dataset.fixed = (f.role.value === 'admin' || f.role.value === 'superadmin') ? '1' : '0'; f.squadron.value = u ? u.squadron : '';
  f.phone.value = u ? u.phone : ''; f.status.value = u ? u.status : '在职';
  f.note.value = u ? u.note : '';
  renderPermBox();
  if (f.scope) f.scope.value = (u && u.scope) || 'all';
  if (f.org) f.org.value = (u && u.org) || '';
  if (f.alliance) f.alliance.value = (u && u.alliance) || '';
  if (f.perm_expire_at) f.perm_expire_at.value = (u && u.perm_expire_at) || '';
  syncPermBox(u);
  bindScopeBox();
  f.role.onchange = () => {
    const r = f.role.value;
    f.role.dataset.fixed = (r === 'admin' || r === 'superadmin') ? '1' : '0';
    syncPermBox(null, r);
    // 普通角色的预设：切角色就把勾选换成对应的一套（仍可手动改）
    const preset = ROLE_PERMS[r];
    if (preset) {
      const keys = preset.split(',');
      document.querySelectorAll('#permBox input').forEach(cb => {
        if (!cb.disabled) cb.checked = keys.indexOf(cb.value) >= 0;
      });
    }
  };
  $('#userDlg').showModal();
}
// 权限矩阵：7 组，每组「看 / 改」勾选框（按 PERM_GROUPS 生成，只渲染一次）
function renderPermBox() {
  const box = $('#permBox'); if (!box || box.dataset.built === '1') return;
  box.innerHTML = '';
  PERM_GROUPS.forEach(g => {
    const row = el('div', 'permrow');
    row.appendChild(el('span', 'permmod', g.mod));
    const mk = (key, label) => {
      const lb = el('label', 'permcb');
      const cb = el('input'); cb.type = 'checkbox'; cb.value = key;
      lb.appendChild(cb); lb.appendChild(document.createTextNode(' ' + label));
      row.appendChild(lb);
    };
    if (g.view) mk(g.view, '看');
    if (g.edit) mk(g.edit, '改');
    (g.extra || []).forEach(([k, lb]) => mk(k, lb));
    box.appendChild(row);
  });
  box.dataset.built = '1';
}
// 角色 → 权限框状态：admin 恒全勾且置灰，其余可自由勾
function syncPermBox(u, roleOverride) {
  renderPermBox();
  const role = roleOverride || (u && u.role) || $('#userForm').role.value;
  const iAmTop = !!(S.user && S.user.role === 'superadmin');
  // 超级管理员恒全权、不可勾选；管理员的权限只有超级管理员能改
  const fixed = (role === 'superadmin') || (role === 'admin' && !iAmTop);
  const have = fixed ? Object.keys(PERM_LABEL) : (u ? (u.perms || []) : ['sim_view']);
  document.querySelectorAll('#permBox input').forEach(cb => {
    cb.checked = have.indexOf(cb.value) >= 0;
    cb.disabled = fixed;
  });
  const hint = document.getElementById('permHintBox');
  if (hint) {
    if (role === 'superadmin') hint.textContent = '超级管理员恒为全权（15 项），不能单独勾选。';
    else if (fixed) hint.textContent = '管理员默认拥有全部权限；只有超级管理员能调整管理员的权限。';
    else if (role === 'admin') hint.textContent = '你在调整管理员的权限：取消勾选后保存，该管理员会立刻失去对应能力（全不勾 = 恢复全权）。';
    else if (u && u.perm_expired) hint.textContent = '这个账号的权限已到期（只剩登录能力），改「权限到期」或重新勾选后保存即可恢复。';
    else hint.textContent = '「看」= 能打开该模块；「改」= 能新增/修改/删除。改动保存后对方刷新页面生效。';
  }
}
function boxPerms() {
  return [...document.querySelectorAll('#permBox input:checked')].map(cb => cb.value).join(',');
}
// 高危操作二次确认：要求输入目标名，服务端还会校验 X-Confirm
function askConfirm(expect, tip) {
  const v = prompt((tip || '这个操作不可恢复') + '\n请输入「' + expect + '」确认（点取消=放弃）');
  if (v === null) return false;
  if (v.trim() !== String(expect)) { toast('输入不一致，已取消', 'bad'); return false; }
  return true;
}
// 数据范围：勾选联动（选「本组织」才需要填组织，选「本联合体」才需要填联合体）
const SCOPE_TIP = {
  all: '不加限制：能看全部人员的档案。',
  org: '只看本组织的人员（用下面的「所属组织」来比）。',
  alliance: '只看本联合体的人员（用下面的「所属联合体」来比）。',
  self: '只看自己这一条档案（按登录账号绑定的游戏 ID）。'
};
function bindScopeBox() {
  const f = $('#userForm');
  const box = document.getElementById('scopeBox');
  if (!box) return;
  const radios = [...box.querySelectorAll('input[name=scope]')];
  const hint = document.getElementById('scopeHint');
  const paint = () => {
    const v = (f.scope && f.scope.value) || 'all';
    radios.forEach(r => { if (r.parentElement) r.parentElement.classList.toggle('on', r.checked); });
    if (f.org) { f.org.disabled = (v !== 'org'); f.org.style.opacity = f.org.disabled ? .45 : 1; }
    if (f.alliance) { f.alliance.disabled = (v !== 'alliance'); f.alliance.style.opacity = f.alliance.disabled ? .45 : 1; }
    if (hint) hint.textContent = SCOPE_TIP[v] || '';
  };
  radios.forEach(r => { r.onchange = paint; });
  paint();
}
async function submitUser(ev) {
  ev.preventDefault();
  const f = $('#userForm');
  const data = {username: f.username.value.trim(), password: f.password.value,
    name: f.name.value.trim(), role: f.role.value, squadron: f.squadron.value.trim(),
    phone: f.phone.value.trim(), status: f.status.value, note: f.note.value.trim(),
    perms: boxPerms(),
    scope: (f.scope && f.scope.value) || 'all',
    org: (f.org && f.org.value.trim()) || '',
    alliance: (f.alliance && f.alliance.value.trim()) || '',
    perm_expire_at: (f.perm_expire_at && f.perm_expire_at.value) || ''};
  try {
    const j = S.editing ? await api('/api/users/' + S.editing.id, {method: 'PUT', body: data})
                        : await api('/api/users', {method: 'POST', body: data});
    $('#userDlg').close();
    toast(j && j.changed === false ? '内容没变，已跳过（不写日志）' : '已保存', 'good');
    await loadUsers($('#uq').value.trim());
  } catch (e) { toast('失败：' + e.message, 'bad'); }
}
async function delUser(u) {
  if (!askConfirm(u.username, '删除账号 ' + u.username + ' 后不可恢复')) return;
  try { await api('/api/users/' + u.id, {method: 'DELETE', confirm: u.username}); toast('已删除', 'good');
    await loadUsers($('#uq').value.trim()); }
  catch (e) { toast('失败：' + e.message, 'bad'); }
}
async function loadAudit() {
  const body = document.getElementById('auditBody');
  const note = document.getElementById('auditNote');
  if (!body) return;
  if (!can('audit_view') && !can('audit_self')) {
    body.innerHTML = '<tr><td colspan="6" class="muted">没有「操作日志」权限。</td></tr>';
    if (note) note.textContent = '';
    return;
  }
  try {
    const kind = (document.getElementById('auditKind') || {}).value || '';
    const q = (S.auditQ || '').trim();
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (q) qs.set('q', q);
    qs.set('limit', '500');
    const j = await api('/api/audit?' + qs.toString());
    S.audit = j.audit || [];
    S.auditTotal = j.total || S.audit.length;
    body.innerHTML = '';
    S.audit.forEach(a => {
      const tr = document.createElement('tr');
      [a.ts, a.actor, a.action, a.kind || '', a.target, a.detail].forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v || '';
        if (i === 0) td.className = 'idcell';
        if (i === 3) td.className = 'muted';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    if (!S.audit.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">'
        + ((q || kind) ? '没有符合筛选条件的记录。' : '还没有操作记录。') + '</td></tr>';
    }
    if (note) note.textContent = '显示 ' + S.audit.length + ' 条 / 共 ' + S.auditTotal + ' 条'
      + (q || kind ? '（已按条件筛选）' : '') + '，新的在上面。';
    loadAuditStats();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function loadAuditStats() {
  const stat = document.getElementById('auditStat');
  const bar = document.getElementById('auditGovBar');
  if (!stat) return;
  try {
    const j = await api('/api/audit/stats');
    const s = j.stats || {};
    const kinds = (s.kinds || []).filter(k => k.k).map(k => k.k + ' ' + k.n).join(' · ');
    stat.textContent = '共 ' + s.total + ' 条'
      + (s.oldest ? '，最早 ' + s.oldest.slice(0, 10) : '')
      + ' · 保留 ' + s.days + ' 天 / 上限 ' + s.max + ' 条'
      + ' · 归档 ' + (s.archives || []).length + ' 个文件'
      + ' · 库 ' + s.db_kb + ' KB'
      + ' · 数据 v' + s.version + '（结构 v' + s.schema + '）'
      + (kinds ? ' · ' + kinds : '');
    if (bar) bar.classList.toggle('hide', !j.can_prune);
    const d = document.getElementById('auditDays');
    const m = document.getElementById('auditMax');
    if (d) d.value = s.days;
    if (m) m.value = s.max;
    S.auditStats = s;
  } catch (e) {
    stat.textContent = '统计失败：' + e.message;
  }
}

async function saveAuditPolicy() {
  const d = Number((document.getElementById('auditDays') || {}).value || 0);
  const m = Number((document.getElementById('auditMax') || {}).value || 0);
  if (!(d >= 1)) return toast('保留天数要 ≥ 1', 'bad');
  if (!(m >= 100)) return toast('条数上限要 ≥ 100', 'bad');
  try {
    const j = await api('/api/settings', {method: 'PUT', body: {audit_days: d, audit_max: m}});
    toast(j.changed ? '已保存：保留 ' + d + ' 天 / 上限 ' + m + ' 条' : '策略没变，已跳过', 'ok');
    loadAuditStats();
  } catch (e) { toast(e.message, 'bad'); }
}

async function pruneAuditNow() {
  const d = Number((document.getElementById('auditDays') || {}).value || 0);
  const m = Number((document.getElementById('auditMax') || {}).value || 0);
  if (!confirm('会先把超范围的记录追加到 logs\\audit-YYYYMM.jsonl，再从库里删除。\n\n保留 ' + d
    + ' 天 / 上限 ' + m + ' 条，确定执行？')) return;
  try {
    const j = await api('/api/audit/prune', {
      method: 'POST', body: {days: d, max: m, confirm: '清理日志'}});
    if (j.deleted) {
      toast('已清理 ' + j.deleted + ' 条，归档 ' + (j.archives || []).join('、'), 'ok');
    } else {
      toast('不用清理：' + (j.reason || '都在保留范围内'), 'ok');
    }
    loadAudit();
  } catch (e) { toast(e.message, 'bad'); }
}

function exportAuditCsv() {
  const rows = S.audit || [];
  if (!rows.length) return toast('当前没有可导出的记录', 'bad');
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = ['时间,操作人,动作,类型,对象,备注'];
  rows.forEach(a => {
    lines.push([a.ts, a.actor, a.action, a.kind, a.target, a.detail].map(esc).join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const pad = n => (n < 10 ? '0' + n : '' + n);
  a.download = 'audit-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  toast('已导出 ' + rows.length + ' 条', 'ok');
}

/* ---------- 问卷式录入 ---------- */
const EFFECTS = [['armor', '物理护甲 +N'], ['shield', '能量护盾 +N%'], ['hull', '结构值 +N%'],
  ['dmg', '伤害 +N%'], ['acc', '命中 +N%'], ['eva', '闪避 +N%'],
  ['freq', '频率（缩短持续）+N%'], ['cd', '冷却 -N%'], ['repair', '维修效果 +N%'],
  ['plane', '舰载机 +N%']];
const BASE_FIELDS = [['armor', '物理护甲', 0], ['shield', '能量护盾', 0], ['hull', '结构值', 1000],
  ['dur', '持续时间(s)', 5], ['cyc', '工作次数', 1], ['per', '每次次数', 1],
  ['cd', '冷却时间(s)', 10], ['ammo', '弹药数', 1], ['atk', '攻击次数', 1],
  ['dmg', '单发伤害', 100], ['repair', '维修量', 0]];
const W_STEPS = ['基本信息', '系统', '系统基础值', '加点', '模块', '确认'];
S.wizKindDefault = '主力舰';

let WIZ = null;
function wizStart(editId) {
  if (!S.user || S.user.role !== 'admin') return toast('先用 admin 登录', 'bad');
  /* 只接受「字符串 id」，其它（事件对象、undefined）一律当作新建 */
  if (typeof editId === 'string' && editId) return wizEdit(editId);
  WIZ = {step: 0, ship: {id: '', name: '', cls: '主力舰', kind: '主力舰', size: '大型舰船', cmd_type: '', tech_total: 100, base: {}},
    systems: [], nodes: [], modules: [], editIdx: -1,
    dSys: {name: '', slot: '', tech_cap: 5, bayF: '', bayC: '', bayG: ''},
  editSys: -1,
    dNode: {sysIdx: '0', label: '', max_lv: 5, cost: 2, costs: '', effect: 'dmg', val: 3, parent: '', parent2: ''},
    dMod: {slot: '', name: '', dmg: 10, sysIdx: '', bays: [], bayKind: '战机', bayCap: '', bayAllow: ''}};
  BASE_FIELDS.forEach(([k, , d]) => WIZ.ship.base[k] = d);
  $('#wizDlg').showModal();
  wizRender();
}
function wIn(parent, label, obj, key, type, opts, unit) {
  const l = el('label', 'row');
  const sp = el('span', '', label);
  if (unit) sp.appendChild(el('i', 'u', unit));
  l.appendChild(sp);
  let inp;
  if (type === 'select') {
    inp = el('select');
    (opts || []).forEach(([v, t]) => { const o = el('option', '', t); o.value = v;
      if (obj[key] === v) o.selected = true; inp.appendChild(o); });
    inp.onchange = () => { obj[key] = inp.value; };
  } else {
    inp = el('input');
    inp.type = type === 'number' ? 'number' : 'text';
    if (type === 'number') { inp.min = 0; inp.step = 'any'; inp.placeholder = '0'; }
    inp.value = obj[key] === undefined || obj[key] === null ? '' : obj[key];
    /* 数值 0 不预填成“0”：留空 + 灰色 0 占位，填了才落数，改了直接替换 */
    if (type === 'number') inp.value = Number(inp.value) ? inp.value : '';
    inp.oninput = () => { obj[key] = type === 'number' ? (inp.value === '' ? 0 : +inp.value) : inp.value; };
  }
  l.appendChild(inp); parent.appendChild(l); return inp;
}
/* —— 节点编辑的三个入口（横向结构里就地展开）—— */
function wizStartNewNode(si, parentCode) {
  WIZ.editIdx = -1;
  WIZ.nodeDraft = {sysIdx: si, parent: parentCode || ''};
  Object.assign(WIZ.dNode, {sysIdx: String(si), label: '', parent: parentCode || '', parent2: '',
    effect: WIZ.dNode.effect || 'dmg', cost: 2, costs: '', max_lv: 5, val: 3});
  wizRender();
}
function wizStartEditNode(idx) {
  const n = WIZ.nodes[idx];
  if (!n) return;
  WIZ.editIdx = idx;
  WIZ.nodeDraft = null;
  const pl = parList(n.parent);
  Object.assign(WIZ.dNode, {sysIdx: String(n.sysIdx), label: n.label, max_lv: n.max_lv,
    cost: n.cost, costs: n.costs || '', effect: n.effect, val: n.val,
    parent: pl[0] || '', parent2: pl[1] || ''});
  wizRender();
}
function wizSaveNode(si, x, isDraft) {
  if (!(WIZ.dNode.label || '').trim()) return toast('节点名不能空', 'bad');
  if (!WIZ.dNode.effect) return toast('先给这个节点选一个效果', 'bad');
  const base = {sysIdx: +WIZ.dNode.sysIdx, label: WIZ.dNode.label.trim(),
    cost: +WIZ.dNode.cost || 1, max_lv: +WIZ.dNode.max_lv || 1,
    costs: (WIZ.dNode.costs || '').trim(), effect: WIZ.dNode.effect,
    val: +WIZ.dNode.val || 0,
    parent: [WIZ.dNode.parent, WIZ.dNode.parent2].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(',')};
  if (isDraft) WIZ.nodes.push(base);
  /* 改已有节点时保留 _id/_note/_eff，否则会被当成新节点、老行还留在库里 */
  else WIZ.nodes[WIZ.editIdx] = Object.assign({}, WIZ.nodes[WIZ.editIdx], base);
  WIZ.editIdx = -1; WIZ.nodeDraft = null; WIZ.dNode.label = '';
  wizRender();
}
function wizDelNode(si, x) {
  const kids = WIZ.nodes.filter(y => parList(y.parent).indexOf(x.code) >= 0);
  if (kids.length && !confirm('有 ' + kids.length + ' 个节点把它当前置，删掉后这些引用会一并去掉，继续？')) return;
  WIZ.nodes.forEach(y => {
    const rest = parList(y.parent).filter(c => c !== x.code);
    if (rest.length !== parList(y.parent).length) y.parent = rest.join(',');
  });
  WIZ.nodes = WIZ.nodes.filter((y, k) => k !== x.idx);
  WIZ.editIdx = -1; WIZ.nodeDraft = null;
  wizRender();
}
function wizRender() {
  const st = WIZ.step;
  $('#wizTitle').textContent = (WIZ.edit ? '修改舰船 · ' + (WIZ.ship.name || '') + ' · ' : '问卷式录入 · ') + W_STEPS[st];
  $('#wizStep').textContent = '第 ' + (st + 1) + ' 步 / 共 ' + W_STEPS.length + ' 步' +
    (WIZ.edit ? '　（改完在第 6 步点「保存修改」，只动这一艘船）' : '　（系统会逐条问，答完就载入数据库）');
  const b = $('#wizBody'); b.innerHTML = '';
  $('#wizPrev').classList.toggle('hide', st === 0);
  $('#wizSkip').classList.toggle('hide', st === 0 || st >= 5);
  $('#wizNext').textContent = st === 5 ? (WIZ.edit ? '保存修改' : '载入数据库') : '下一步';
  $('#wizClose').classList.toggle('hide', st !== 5);

  if (st === 0) {
    const c = el('div');
    wIn(c, '名称', WIZ.ship, 'name', 'text');
    const kindSel = wIn(c, '舰种', WIZ.ship, 'kind', 'select',
      [['主力舰', '主力舰（巡洋舰 / 驱逐舰 / 护卫舰）'],
       ['超主力舰', '超主力舰（航空母舰 / 战列巡洋舰）'],
       ['舰载机', '舰载机（战机 / 护航艇）']]);
    kindSel.onchange = () => {
      WIZ.ship.kind = kindSel.value;
      WIZ.ship.size = ''; WIZ.ship.cls = ''; WIZ.ship.pgroup = '';
      wizRender();
    };
    const kind = WIZ.ship.kind || '主力舰';
    const SIZES = {
      '超主力舰': [['超大型舰船', '超大型舰船']],
      '主力舰': [['巡洋舰', '巡洋舰'], ['驱逐舰', '驱逐舰'], ['护卫舰', '护卫舰']],
      '舰载机': [['战机', '战机'], ['护航艇', '护航艇']],
    }[kind];
    if (kind === '超主力舰') WIZ.ship.size = '超大型舰船';
    if (!SIZES.some(([v]) => v === WIZ.ship.size)) WIZ.ship.size = SIZES[0][0];
    // 只有舰载机需要自己选尺寸；主力舰的尺寸=舰型，超主力舰固定超大型舰船
    if (kind === '舰载机') {
      const sizeSel = wIn(c, '尺寸', WIZ.ship, 'size', 'select', SIZES);
      sizeSel.onchange = () => {
        WIZ.ship.size = sizeSel.value;
        WIZ.ship.cls = WIZ.ship.size;
        wizRender();
      };
    }
    const CLS = {
      '主力舰': [['巡洋舰', '巡洋舰'], ['驱逐舰', '驱逐舰'], ['护卫舰', '护卫舰']],
      '超主力舰': [['航空母舰', '航空母舰'], ['战列巡洋舰', '战列巡洋舰']],
      '舰载机': [['战机', '战机'], ['护航艇', '护航艇']],
    }[kind];
    if (kind === '舰载机') WIZ.ship.cls = WIZ.ship.size;
    if (kind === '主力舰') WIZ.ship.size = WIZ.ship.cls;
    if (!CLS.some(([v]) => v === WIZ.ship.cls)) WIZ.ship.cls = CLS[0][0];
    const clsSel = wIn(c, '舰型', WIZ.ship, 'cls', 'select',
      (kind === '超主力舰' || kind === '主力舰') ? CLS : [[WIZ.ship.cls, WIZ.ship.cls]]);
    clsSel.value = WIZ.ship.cls;
    clsSel.disabled = (kind === '舰载机');
    clsSel.onchange = () => {
      WIZ.ship.cls = clsSel.value;
      if (WIZ.ship.kind === '主力舰') WIZ.ship.size = WIZ.ship.cls;
      wizRender();
    };
    if (kind === '舰载机' && WIZ.ship.cls === '战机') {
      if (WIZ.ship.pgroup !== '大编组' && WIZ.ship.pgroup !== '中编组') WIZ.ship.pgroup = '中编组';
      wIn(c, '战机编组（中编组可进大/中机库，大编组只进大机库）', WIZ.ship, 'pgroup', 'select',
        [['中编组', '中编组'], ['大编组', '大编组']]);
    }
    if (kind === '舰载机') {
      if (WIZ.ship.cmd_type !== '往复式' && WIZ.ship.cmd_type !== '独立式') WIZ.ship.cmd_type = '往复式';
      const cmdSel = wIn(c, '指挥系统类型（往复式要填突防速度，独立式不用）', WIZ.ship, 'cmd_type', 'select',
        [['往复式', '往复式'], ['独立式', '独立式']]);
      cmdSel.onchange = () => { WIZ.ship.cmd_type = cmdSel.value; wizRender(); };
    } else {
      WIZ.ship.cmd_type = '';
    }
    wIn(c, '备注（可选）', WIZ.ship, 'note', 'text');
    wIn(c, '变形技术值', WIZ.ship, 'tech_total', 'number');
    b.appendChild(c);
    b.appendChild(el('div', 'muted',
      '模块/舱位：超主力舰全都有；主力舰里只有巡洋舰、驱逐舰能带舱位，护卫舰没有，第 5 步会自动跳过。'
      + ' ID 由系统按名称自动生成，不用你填。'));
  } else if (st === 1) {
    const list = el('div', 'card2');
    if (!WIZ.systems.length) list.appendChild(el('div', 'muted', '还没加系统。'));
    WIZ.systems.forEach((s, i) => {
      const row = el('div', 'row');
      row.appendChild(el('span', '', (i + 1) + '. ' + s.name + (s.slot ? '（' + s.slot + ' · 模块槽位）' : '')
        + ' · 可用节点 ' + (s.tech_cap || '不限')
        + ((s.bays && s.bays.length) ? ' · 舱位 ' + s.bays.map(b => b.kind + ' ' + b.cap).join(' + ') : '')));
      /* 系统的节点数要从 WIZ.nodes 里按 sysIdx 数 —— 问卷里的系统对象本身不挂 nodes */
      const ncnt = WIZ.nodes.filter(n => String(n.sysIdx) === String(i)).length;
      row.appendChild(el('span', 'muted', '节点 ' + ncnt + ' 条'
        + (s.tech_cap && ncnt > s.tech_cap ? '（超出 ' + (ncnt - s.tech_cap) + ' 条）' : '')));
      const ed = el('button', 'btn ghost', '编辑'); ed.type = 'button';
      ed.onclick = () => {
        Object.assign(WIZ.dSys, {name: s.name, slot: s.slot, tech_cap: s.tech_cap,
          bayF: (s.bays || []).filter(b => b.kind === '战机').map(b => b.cap)[0] || '',
          bayC: (s.bays || []).filter(b => b.kind === '护航艇').map(b => b.cap)[0] || '',
          bayG: ((s.bays || [])[0] || {}).allow_group || ''});
        WIZ.editSys = i; wizRender();
      };
      const del = el('button', 'btn ghost', '删'); del.type = 'button';
      del.onclick = () => {
        if (ncnt && !confirm('「' + s.name + '」下还有 ' + ncnt + ' 条节点，删了会一起没，确定？')) return;
        WIZ.systems.splice(i, 1);
        WIZ.nodes = WIZ.nodes.filter(n => String(n.sysIdx) !== String(i))
          .map(n => ({...n, sysIdx: (+n.sysIdx > +i) ? String(+n.sysIdx - 1) : n.sysIdx}));
        WIZ.editSys = -1; wizRender();
      };
      row.append(ed, del);
      list.appendChild(row);
    });
    b.appendChild(list);
    const f = el('div', 'card2');
    f.appendChild(el('div', 'muted', WIZ.editSys >= 0 ? '正在修改第 ' + (WIZ.editSys + 1) + ' 个系统：' : '再加一个系统：'));
    wIn(f, '系统名', WIZ.dSys, 'name', 'text');
    if (canMod(WIZ.ship)) {
      wIn(f, '槽位（M1/A1/B4/B1，可空）', WIZ.dSys, 'slot', 'text');
      f.appendChild(el('div', 'muted', '这个槽位提供舱位吗？（模块就是系统，加成在上面「加点」里填，这里只管能装几架）'));
      wIn(f, '战机舱能装几架（0=没有）', WIZ.dSys, 'bayF', 'number');
      wIn(f, '护航艇舱能装几架（0=没有）', WIZ.dSys, 'bayC', 'number');
      wIn(f, '编组限制', WIZ.dSys, 'bayG', 'select',
        [['', '不限'], ['中编组', '仅中编组'], ['大编组', '仅大编组']]);
    } else {
      f.appendChild(el('div', 'muted', '本舰不带舱位，系统没有槽位（槽位只给超主力舰与巡洋舰、驱逐舰用）。'));
    }
    wIn(f, '该系统节点上限（能点几个节点）', WIZ.dSys, 'tech_cap', 'number');
    const add = el('button', 'btn', WIZ.editSys >= 0 ? '保存修改' : '加进列表'); add.type = 'button';
    add.onclick = () => {
      if (!WIZ.dSys.name.trim()) return toast('系统名不能空', 'bad');
      const bf = +WIZ.dSys.bayF || 0, bc = +WIZ.dSys.bayC || 0, bg = WIZ.dSys.bayG || '';
      const bays = [];
      if (bf) bays.push({kind: '战机', cap: bf, allow_group: bg});
        if (bc) bays.push({kind: '护航艇', cap: bc, allow_group: ''});
      const rec = {name: WIZ.dSys.name.trim(), slot: WIZ.dSys.slot.trim(),
        tech_cap: +WIZ.dSys.tech_cap || 0, bays: bays};
      if (WIZ.editSys >= 0) {
        Object.assign(WIZ.systems[WIZ.editSys], rec);
        WIZ.editSys = -1;
      } else {
        WIZ.systems.push(Object.assign({stats: {}, nodes: []}, rec));
      }
      WIZ.dSys.name = ''; WIZ.dSys.slot = ''; wizRender();
    };
    f.appendChild(add); b.appendChild(f);
  } else if (st === 2) {
    const head = el('div', 'muted');
    head.innerHTML = '舰船本身没有基础属性：<b>结构值 / 抵抗伤害 / 护盾 / 速度</b> 都由系统提供；'
      + '<b>对舰 / 对空 / 攻城</b> 只有「武器」类系统才有。这里填的是<b>系统基础值</b>，加点收益在第 4 步。';
    b.appendChild(head);

    if (!WIZ.systems.length) {
      const tip = el('div', 'card2');
      tip.appendChild(el('div', 'muted', '还没有系统。先在上一步「系统」里加几个（例如：装甲系统、动力系统、武器系统）。'));
      b.appendChild(tip);
    }

    const FUNC_FIELDS = [
      ['hull', '结构值', '点'], ['armor', '抵抗伤害', '点'], ['shield', '护盾值', '%'],
      ['cruise', '巡航速度', 'jm'], ['warp', '曲率速度', 'jm'], ['spd', '突防速度', ''],
      ['eva', '通用闪避', '%'],
      ['repair_bonus_pct', '维修加成', '%']
    ];
    /* 按系统类型裁剪：只显示这个系统真正会提供的数值项。
       装甲类 → 结构值/抵抗伤害/护盾值/维修加成；动力类 → 巡航/曲率/突防/闪避；
       能源类 → 能量输出/储能；其余（指挥/信息/搭载…）不提供船体数值，只留模块名。 */
    const SYS_FIELD_GROUPS = {
      armor: ['hull', 'armor', 'shield', 'repair_bonus_pct'],
      drive: ['cruise', 'warp', 'spd', 'eva']
    };
    const funcFieldsFor = (sy) => {
      const nm = String(sy.name || '');
      const raw = sy.raw || {};
      const has = ks => ks.some(k => Number(raw[k]) > 0);
      let keys = [];
      if (/装甲|护甲/.test(nm) || has(SYS_FIELD_GROUPS.armor)) keys = keys.concat(SYS_FIELD_GROUPS.armor);
      else if (/维修/.test(nm)) keys = keys.concat(['repair_bonus_pct']);
      if (/动力|引擎/.test(nm) || has(SYS_FIELD_GROUPS.drive)) keys = keys.concat(SYS_FIELD_GROUPS.drive);
      const map = {};
      FUNC_FIELDS.forEach(f => { map[f[0]] = f; });
      return keys.filter(k => map[k]).map(k => map[k]);
    };
    const WEP_FIELDS = [
      ['dmg_atk', '对舰', '/分'], ['dmg_air', '对空', '/分'], ['dmg_siege', '攻城', '/分'],
      ['dmg', '单发伤害', '点'], ['ammo_atk', '弹药数×攻击次数', ''],
      ['dur', '持续时间', 's'], ['cd', '冷却时间', 's'], ['lock', '锁定时间', 's'],
      ['warn', '预警', '%'], ['cyc', '工作次数', '次'], ['repair', '维修量', '点']
    ];

    WIZ.systems.forEach((sy, si) => {
      if (!sy.raw) sy.raw = {};
      if (sy.is_weapon === undefined) sy.is_weapon = false;
      const card = el('div', 'card2');
      const title = el('div', 'wiz-head');
      title.appendChild(el('b', '', '系统 ' + (si + 1) + '：' + (sy.name || '（未命名）')));
      const typeSel = el('select');
      [['0', '功能系统（结构 / 护甲 / 动力…）'], ['1', '武器系统（对舰 / 对空 / 攻城）']].forEach(([v, t]) => {
        const o = el('option', '', t); o.value = v; typeSel.appendChild(o);
      });
      typeSel.value = sy.is_weapon ? '1' : '0';
      typeSel.onchange = () => { sy.is_weapon = typeSel.value === '1'; wizRender(); };
      title.appendChild(typeSel);
      card.appendChild(title);

      const fields = sy.is_weapon ? WEP_FIELDS : funcFieldsFor(sy);
      if (!sy.is_weapon && !fields.length) {
        card.appendChild(el('div', 'muted',
          '这个系统不提供船体基础数值：结构值 / 抵抗伤害 / 护盾值来自「装甲系统」，巡航 / 曲率 / 突防 / 闪避来自「动力系统」。'
          + '能源系统的能量输出、储能同样不计入船体基础值，所以这里也不填。只填下面的模块名即可。'));
      } else {
        const grid = el('div', 'wiz-grid2');
        fields.forEach(([k, label, unit]) => {
          /* 不预置 0：留空显示灰色 0 占位，填了才落数 */
          wIn(grid, label, sy.raw, k, 'number', null, unit);
        });
        card.appendChild(grid);
      }

      // 模块名（可选，只对「一系统一模块」的写法有意义）
      wIn(card, '模块名（可选）', sy, 'module', 'text');
      b.appendChild(card);
    });

    const tail = el('div', 'muted');
    tail.innerHTML = '输入框按系统类型自动裁剪：只有「装甲系统」和「动力系统」需要填船体数值，其余系统只填模块名。'
      + '<b>结构值</b>最终会按「基础值 ×（1 + 加点收益%）」算；'
      + '武器系统的「对舰 / 对空 / 攻城」是每分钟的预估输出；单发 / 弹药数×攻击次数 / 持续 / 冷却 / 工作次数只做记录与展示，不参与任何计算。';
    b.appendChild(tail);
  } else if (st === 3) {
    if (!WIZ.systems.length) {
      b.appendChild(el('div', 'muted', '先回上一步加系统，加点必须挂在某个系统下。'));
    } else {
      const mkEffect = async () => {
        const nm = prompt('新效果叫什么？（中文名，例如「暴击伤害」）');
        if (!nm) return;
        const id = 'e' + Date.now().toString(36);
        try {
          await api('/api/data/effects', { method: 'PUT', body: { id, name: nm, unit: '', note: nm } });
          await loadBlueprints(true);
          WIZ.dNode.effect = id;
          toast('已加入效果库：' + nm, 'good');
          wizRender();
        } catch (e) { toast('保存失败：' + e.message, 'bad'); }
      };

      // —— 节点：横向结构（一层一列，点卡片就地展开编辑）——
      const treeCard = el('div', 'card2');
      treeCard.appendChild(el('div', 'muted',
        '横向结构：从左往右是第 1 层 → 第 2 层 → 第 3 层（对应 1 → 1-1 → 1-1-1）。'
        + '点卡片就在原地展开编辑，不用去下面找表单；「＋ 根节点」在系统标题右边。'));

      /* 节点效果统一口径：只列这 21 项（顺序固定），老节点用到的其它效果仍能正确显示 */
      const NODE_EFFECT_IDS = ['dmg', 'freq', 'acc', 'acc_small', 'acc_large', 'acc_plane',
        'armor', 'crit_rate', 'crit', 'eff7587', 'eva', 'eva_missile', 'eva_torp',
        'lock', 'lockres', 'hull', 'move', 'repair', 'shield', 'warp', 'speed'];
      const effOptions = () => {
        const all = ((S.bp && S.bp.effects) || []);
        const byId = {};
        all.forEach(e => { byId[e.id] = e; });
        const list = NODE_EFFECT_IDS.filter(k => byId[k]).map(k => [k, byId[k].name]);
        const extra = all.filter(e => NODE_EFFECT_IDS.indexOf(e.id) < 0)
          .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
        extra.forEach(e => list.push([e.id, (e.name || e.id) + '（自定义）']));
        const cur = (WIZ.dNode && WIZ.dNode.effect) || '';
        if (cur && cur !== '__custom__' && !byId[cur]) list.push([cur, '（效果已不存在：' + cur + '）']);
        return list;
      };

      const nodeCardEl = (si, x) => {
        const isDraft = !!x.draft;
        const n = isDraft ? WIZ.dNode : WIZ.nodes[x.idx];
        if (!n) return el('div', 'muted', '（这条节点不见了）');
        const editing = isDraft || WIZ.editIdx === x.idx;
        const card = el('div', 'wiz-node' + (editing ? ' sel' : ''));
        card.appendChild(el('div', 'wiz-code',
          isDraft ? '新节点' : (x.code === '?' ? '未挂到树上' : '第 ' + x.code + ' 位')));
        if (!editing) {
          card.appendChild(el('div', 'wiz-title', n.label || '（未命名）'));
          card.appendChild(el('div', 'wiz-meta', effName(n.effect) + ' +' + n.val + '/级'));
          card.appendChild(el('div', 'wiz-meta',
            '每级 ' + n.cost + (n.costs ? '（逐级 ' + n.costs + '）' : '') + ' · 上限 ' + n.max_lv + ' 级'));
          const acts = el('div', 'wiz-acts');
          const kid = el('button', 'btn sm ghost', '＋子节点'); kid.type = 'button';
          kid.onclick = (ev) => { ev.stopPropagation(); wizStartNewNode(si, x.code); };
          const del = el('button', 'btn sm danger', '删'); del.type = 'button';
          del.onclick = (ev) => { ev.stopPropagation(); wizDelNode(si, x); };
          acts.append(kid, del);
          card.appendChild(acts);
          card.onclick = () => wizStartEditNode(x.idx);
          return card;
        }
        const f = el('div', 'wiz-form');
        wIn(f, '节点名', WIZ.dNode, 'label', 'text');
        wIn(f, '每级消耗', WIZ.dNode, 'cost', 'number');
        wIn(f, '逐级消耗（逗号分隔，可空，例 1,2,3）', WIZ.dNode, 'costs', 'text');
        wIn(f, '级数上限', WIZ.dNode, 'max_lv', 'number');
        const treeNow = wizTree(si).filter(y => y.idx !== WIZ.editIdx);
        const pOpts = [['', '（无，作为根节点）']].concat(treeNow.map(y => [y.code, y.code + '　' + y.node.label]));
        const parSel = wIn(f, '前置节点 1', WIZ.dNode, 'parent', 'select', pOpts);
        parSel.onchange = () => { WIZ.dNode.parent = parSel.value; };
        const parSel2 = wIn(f, '前置节点 2（可选，满足其一即可）', WIZ.dNode, 'parent2', 'select', pOpts);
        parSel2.onchange = () => { WIZ.dNode.parent2 = parSel2.value; };
        const effSel = wIn(f, '效果', WIZ.dNode, 'effect', 'select', effOptions());
        effSel.value = WIZ.dNode.effect || 'dmg';
        effSel.onchange = () => {
          if (effSel.value === '__custom__') {
            const nm = prompt('这个节点加的是什么效果？（中文名，例：暴击伤害）');
            if (!nm) { effSel.value = WIZ.dNode.effect || 'dmg'; return; }
            const key = 'e' + Date.now().toString(36);
            WIZ.dNode.effect = key;
            api('/api/data/effects', {method: 'PUT', body: {id: key, name: nm, unit: '', note: nm}})
              .then(() => loadBlueprints(true))
              .then(() => { toast('已加入效果库：' + nm, 'good'); wizRender(); })
              .catch(e => toast('保存失败：' + e.message, 'bad'));
          } else if (effSel.value) { WIZ.dNode.effect = effSel.value; }
        };
        const bNew = el('button', 'btn sm ghost', '＋ 新建效果'); bNew.type = 'button';
        bNew.onclick = mkEffect;
        f.appendChild(bNew);
        /* 自定义效果（不在固定 21 项里的）允许删除；被节点用时提示会一起失效 */
        const curEff = WIZ.dNode.effect || '';
        const isCustom = curEff && NODE_EFFECT_IDS.indexOf(curEff) < 0 &&
          ((S.bp && S.bp.effects) || []).some(e => e.id === curEff);
        if (isCustom) {
          const used = WIZ.nodes.filter(y => y.effect === curEff).length;
          const bDel = el('button', 'btn sm danger', '删这个效果'); bDel.type = 'button';
          bDel.onclick = async () => {
            if (!confirm('删除效果「' + effName(curEff) + '」？' + (used ? '\n当前有 ' + used + ' 个节点在用它，删掉后会变成未知效果。' : ''))) return;
            try {
              await api('/api/data/effects/' + encodeURIComponent(curEff), {method: 'DELETE', confirm: curEff});
              await loadBlueprints(true);
              if (WIZ.dNode.effect === curEff) WIZ.dNode.effect = 'dmg';
              toast('已删除效果', 'good');
              wizRender();
            } catch (e) { toast('删除失败：' + e.message, 'bad'); }
          };
          f.appendChild(bDel);
        }
        wIn(f, '每级数值', WIZ.dNode, 'val', 'number');
        const acts = el('div', 'wiz-acts');
        const save = el('button', 'btn sm', isDraft ? '加进列表' : '保存'); save.type = 'button';
        save.onclick = () => wizSaveNode(si, x, isDraft);
        const cancel = el('button', 'btn sm ghost', '取消'); cancel.type = 'button';
        cancel.onclick = () => { WIZ.editIdx = -1; WIZ.nodeDraft = null; wizRender(); };
        acts.appendChild(save);
        if (isDraft) acts.appendChild(cancel);
        else {
          const del = el('button', 'btn sm danger', '删'); del.type = 'button';
          del.onclick = () => wizDelNode(si, x);
          acts.appendChild(del);
        }
        f.appendChild(acts);
        card.appendChild(f);
        return card;
      };

      WIZ.systems.forEach((sys, si) => {
        const box = el('div', 'card2');
        box.style.marginTop = '10px';
        const head = el('div', 'wiz-head');
        head.appendChild(el('span', 'wiz-sysname', '【' + sys.name + '】可用节点 ' + (sys.tech_cap || '不限')));
        const addRoot = el('button', 'btn sm', '＋ 根节点'); addRoot.type = 'button';
        addRoot.onclick = () => wizStartNewNode(si, '');
        head.appendChild(addRoot);
        box.appendChild(head);
        const rows = wizTree(si);
        const draftHere = !!(WIZ.nodeDraft && String(WIZ.nodeDraft.sysIdx) === String(si));
        const draftDepth = draftHere
          ? (WIZ.nodeDraft.parent ? WIZ.nodeDraft.parent.split('-').length : 0) : -1;
        if (!rows.length && !draftHere) {
          box.appendChild(el('div', 'muted', '这个系统还没有节点，点右上角「＋ 根节点」开始。'));
        }
        const byDepth = {};
        rows.forEach(x => {
          const d = x.code === '?' ? 0 : x.code.split('-').length - 1;
          (byDepth[d] = byDepth[d] || []).push(x);
        });
        const depths = Object.keys(byDepth).map(Number);
        const maxD = Math.max(-1, ...depths, draftDepth);
        if (maxD >= 0) {
          const lane = el('div', 'wiz-lane');
          for (let d = 0; d <= maxD; d++) {
            const col = el('div', 'wiz-col');
            col.appendChild(el('div', 'wiz-colhead', '第 ' + (d + 1) + ' 层'));
            (byDepth[d] || []).forEach(x => col.appendChild(nodeCardEl(si, x)));
            if (d === draftDepth) col.appendChild(nodeCardEl(si, {code: '', draft: true}));
            lane.appendChild(col);
          }
          box.appendChild(lane);
        }
        treeCard.appendChild(box);
      });
      b.appendChild(treeCard);
    }
  } else if (st === 4) {
    if (!canMod(WIZ.ship)) {
      b.appendChild(el('div', 'muted',
        '「' + (WIZ.ship.kind || '未选舰种') + '」没有模块槽位，这一步跳过 —— 点「下一步」直接进确认页。'));
    } else {
      const slots = WIZ.systems.map((sy, i) => ({sy, i})).filter(x => x.sy.slot);
      b.appendChild(el('div', 'muted',
        '模块就是系统：它的加成已经在上一步「加点」里填过，这里只确认「这个槽位能装几架战机 / 几架护航艇」。'));
      if (!slots.length) {
        b.appendChild(el('div', 'muted',
          '这次录入的系统都没有槽位 —— 回第 2 步给要用作模块的系统填个槽位（M1/A1/B4…），或者直接点「下一步」。'));
      }
      const summary = () => {
        const g = WIZ.systems.filter(x => (x.bays || []).length);
        return g.length
          ? '当前提供舱位的系统：' + g.map(x => x.name + '（' + x.bays.map(b => b.kind + ' ' + b.cap).join(' + ') + '）').join('；')
          : '当前没有任何系统提供舱位。';
      };
      const sumLine = el('div', 'muted', summary());

      const lane = el('div', 'wiz-lane');
      slots.forEach(({sy}) => {
        const box = el('div', 'wiz-col');
        box.appendChild(el('div', 'wiz-colhead', sy.name));
        const card = el('div', 'wiz-node sel static');
        const f = el('div', 'wiz-form');

        const slotLine = el('label', 'row');
        slotLine.appendChild(el('span', '', '槽位'));
        const slotInp = el('input');
        slotInp.type = 'text';
        slotInp.placeholder = 'M1 / A1 / B4';
        slotInp.value = sy.slot || '';
        slotInp.oninput = () => { sy.slot = slotInp.value.trim().toUpperCase(); refresh(); };
        slotLine.appendChild(slotInp);
        f.appendChild(slotLine);

        const capLine = (kind) => {
          const line = el('label', 'row');
          line.appendChild(el('span', '', kind + '舱'));
          const inp = el('input');
          inp.type = 'number'; inp.min = 0; inp.step = 1; inp.placeholder = '0';
          const cur = ((sy.bays || []).filter(b => b.kind === kind).map(b => b.cap)[0]) || '';
          inp.value = cur || '';
          inp.oninput = () => {
              const g = (kind === '战机') ? (((sy.bays || [])[0] || {}).allow_group || '') : '';
            const n = +inp.value || 0;
            sy.bays = (sy.bays || []).filter(b => b.kind !== kind);
            if (n) sy.bays.push({kind: kind, cap: n, allow_group: g});
            refresh();
          };
          line.appendChild(inp);
          return line;
        };
        f.appendChild(capLine('战机'));
        f.appendChild(capLine('护航艇'));

        const gLine = el('label', 'row');
        gLine.appendChild(el('span', '', '编组限制'));
        const sel = el('select');
        [['', '不限'], ['中编组', '仅中编组'], ['大编组', '仅大编组']]
          .forEach(([v, t]) => { const o = el('option', '', t); o.value = v; sel.appendChild(o); });
        sel.value = ((sy.bays || [])[0] || {}).allow_group || '';
        sel.onchange = () => { (sy.bays || []).forEach(b => b.allow_group = sel.value); };
        gLine.appendChild(sel);
        f.appendChild(gLine);

        card.appendChild(f);
        const sum = el('div', 'wiz-meta', '');
        card.appendChild(sum);
        const refresh = () => {
          sum.textContent = (sy.bays || []).length
            ? '合计 ' + sy.bays.map(b => b.kind + ' ' + b.cap).join(' + ')
            : '这个槽位还没有舱位';
          sumLine.textContent = summary();
        };
        refresh();
        box.appendChild(card);
        lane.appendChild(box);
      });
      b.appendChild(lane);
      b.appendChild(sumLine);
    }
  } else {
    const chk = el('div', 'card2');
    chk.appendChild(el('div', '', '核对一遍，没问题点「保存并写入」：'));
    const tbl0 = el('table');
    const th0 = el('thead'); const tr0 = el('tr');
    ['类别', '内容'].forEach(t => tr0.appendChild(el('th', '', t)));
    th0.appendChild(tr0); tbl0.appendChild(th0);
    const tb0 = el('tbody');
    const put = (k, v) => { const tr = el('tr'); tr.appendChild(el('td', '', k)); tr.appendChild(el('td', '', v)); tb0.appendChild(tr); };
    put('舰船', (WIZ.ship.name || '（未填）') + ' · ' + (WIZ.ship.kind || '?') + ' · ' + (WIZ.ship.cls || '?') + ' · ' + (WIZ.ship.size || '?') + ' · 变形技术值 ' + (WIZ.ship.tech_total || 0));
    WIZ.systems.forEach((sy, i) => put('系统 ' + (i + 1), sy.name + (sy.slot ? '（槽位 ' + sy.slot + '）' : '') + ' · 可用节点 ' + (sy.tech_cap || '不限')));
    WIZ.nodes.forEach((n, i) => {
      const sy = WIZ.systems[+n.sysIdx];
      put('加点 ' + (i + 1), (sy ? sy.name : '?') + ' / ' + n.label + ' · 每级 ' + n.cost
        + (n.costs ? '（逐级 ' + n.costs + '）' : '') + ' · 上限 ' + n.max_lv + ' 级 · '
        + effName(n.effect) + ' +' + n.val + (n.parent ? ' · 前置「' + n.parent + '」' : ''));
    });
    WIZ.systems.filter(x => x.slot).forEach((sy, k) => put('模块 ' + (k + 1),
      sy.slot + ' ' + sy.name + ' · ' + ((sy.bays && sy.bays.length)
        ? sy.bays.map(b => b.kind + ' ' + b.cap + ' 舱' + (b.allow_group ? '（' + b.allow_group + '）' : '')).join(' + ')
        : '无舱位') + ' · 加成见该系统加点'));
    put('基础属性', Object.keys(WIZ.ship.base || {}).filter(k => WIZ.ship.base[k] !== '').map(k => k + '=' + WIZ.ship.base[k]).join('，') || '（未填）');
    tbl0.appendChild(tb0); chk.appendChild(tbl0); b.appendChild(chk);
    const p = el('pre');
    p.style.cssText = 'background:#0b0f14;border:1px solid var(--line);border-radius:8px;'
      + 'padding:10px;max-height:320px;overflow:auto;font:12px/1.45 Consolas,monospace;color:#cfe3ff';
    p.textContent = JSON.stringify(wizPayload(), null, 2);
    b.appendChild(p);
  }
}
function wizTree(sysIdx) {
  const list = WIZ.nodes.map((n, i) => ({ n, i }))
    .filter(x => String(x.n.sysIdx) === String(sysIdx));
  /* 前置指向的节点不存在（被删/改了层级）时自动丢掉这条前置，避免出现「孤儿」 */
  const ids = {};
  list.forEach(x => { ids[x.n._id || ('#' + x.i)] = 1; });
  const codesNow = {};
  const collect = (p, prefix) => list.filter(x => firstPar(x.n.parent) === p)
    .forEach((x, k) => { const c = prefix ? prefix + '-' + (k + 1) : String(k + 1); codesNow[c] = 1; collect(c, c); });
  collect('', '');
  list.forEach(x => {
    const ps = parList(x.n.parent);
    if (!ps.length) return;
    /* parent 里存的是 code；code 不在本系统树里且也不是根（''）→ 视为失效 */
    const ok = ps.filter(c => codesNow[c] || c === '');
    if (ok.length !== ps.length) x.n.parent = ok.join(',');
  });
  const out = [];
  const kids = (p) => list.filter(x => firstPar(x.n.parent) === p);
  const walk = (p, prefix) => {
    kids(p).forEach((x, k) => {
      const code = prefix ? prefix + '-' + (k + 1) : String(k + 1);
      out.push({ code, idx: x.i, node: x.n });
      walk(code, code);
    });
  };
  walk('', '');
  // 父节点被删掉的孤儿也列出来，避免“消失”
  list.forEach(x => { if (!out.some(o => o.idx === x.i)) out.push({ code: '?', idx: x.i, node: x.n }); });
  return out;
}
function wizPayload() {
  const sid = WIZ.ship.id || ('ship_' + Date.now());
  /* 编辑模式沿用原 id；新建模式按序号生成 */
  const sids = WIZ.systems.map((s, i) => s._id || ('sys_' + sid + '_' + i));
  const systems = WIZ.systems.map((s, i) => {
    const num = {};
    Object.keys(s.raw || {}).forEach(k => {
      const v = Number(s.raw[k]);
      if (isFinite(v) && v !== 0) num[k] = v;
    });
    const stats = Object.assign({}, s._stats || {});
    if (s.module) stats['模块'] = s.module; else delete stats['模块'];
    return {id: sids[i], ship: sid, slot: s.slot, name: s.name,
      tech_cap: s.tech_cap, stats: stats,
      stats_norm: Object.keys(num).length ? JSON.stringify(num) : '',
      is_weapon: s.is_weapon ? 1 : 0,
      note: s._note || '', ord: s._ord || (i + 1), no_nodes: s._no_nodes || 0};
  });
  /* 把第一个武器系统的参数抄进 base，只作存档展示（页面不再用它算 DPM） */
  const firstW = WIZ.systems.find(s => s.is_weapon && s.raw);
  if (firstW) {
    /* 工作次数（cyc）只做记录，不写进 base */
    ['dmg', 'dur', 'cd', 'lock', 'warn', 'repair'].forEach(k => {
      const v = Number(firstW.raw[k]);
      if (isFinite(v) && v > 0) WIZ.ship.base[k] = v;
    });
    /* 弹药数×攻击次数已合并成一格：原样记到 ammo，atk 记 1（不参与计算） */
    const aa = Number(firstW.raw.ammo_atk);
    if (isFinite(aa) && aa > 0) { WIZ.ship.base.ammo = aa; WIZ.ship.base.atk = 1; }
  }
  /* 突防速度由功能系统（动力/引擎）提供，取第一个填了值的 */
  const spdSys = WIZ.systems.find(s => Number((s.raw || {}).spd) > 0);
  if (spdSys) WIZ.ship.base.spd = Number(spdSys.raw.spd);
  const nids = WIZ.nodes.map((n, i) => n._id || ('n_' + sid + '_' + i));
  const byCode = {};
  WIZ.systems.forEach((s, si) => wizTree(si).forEach(o => { byCode[si + '|' + o.code] = nids[o.idx]; }));
  const nodes = WIZ.nodes.map((n, i) => {
    const sy = systems[n.sysIdx] || systems[0];
    const costs = (n.costs || '').split(/[,，\s]+/).map(x => Number(x)).filter(x => x > 0);
    const pcodes = parList(n.parent);
    /* 保留原效果里的其它键（一个节点可能带 cd_up 这类第二效果），只覆盖当前编辑的那一项 */
    const eff = {};
    if (n._eff) Object.keys(n._eff).forEach(k => { if (k !== (n._effKey || '')) eff[k] = n._eff[k]; });
    if (n.effect) eff[n.effect] = n.val;
    return {id: nids[i], sys: sy ? sy.id : '',
      parent: pcodes.map(c => byCode[n.sysIdx + '|' + c] || '').filter(Boolean).join(','),
      label: n.label, max_lv: n.max_lv, cost: n.cost,
      costs: costs.length ? JSON.stringify(costs) : '',
      effect: eff,
      note: n._note || (n.effect ? (effName(n.effect) + ' +' + n.val + '/级') : '')};
  });
  const modules = WIZ.systems.map((sy, i) => ({sy, i}))
    .filter(x => x.sy.slot)
    .map(({sy, i}, k) => {
      const bays = (sy.bays || []).map(b => ({kind: b.kind, cap: +b.cap || 0, allow_group: b.allow_group || ''}));
      const cap = bays.reduce((a, b) => a + b.cap, 0);
      const old = sy._mod || {};
      return {
        id: old.id || ('mod_' + sid + '_' + k), ship: sid,
        slot: sy.slot, sys: systems[i] ? systems[i].id : '',
        name: sy.name,
        mkind: bays.length ? (bays[0].kind + '搭载系统') : (old.mkind || ''),
        cap: cap,
        allow_group: bays.map(b => b.allow_group).filter(Boolean).join(','),
        bays: bays.length ? JSON.stringify(bays) : '',
        bonus: (old.bonus && typeof old.bonus === 'object') ? old.bonus : {},
        stats: bays.length ? {舱位: bays.map(b => b.kind + ' ' + b.cap).join(' + ')} : (old.stats || {}),
        note: old.note || '随系统自动生成'};
    });
  return {
    ship: {id: sid, name: (WIZ.ship.name || '').trim() || sid, cls: WIZ.ship.cls,
      kind: WIZ.ship.kind || '', size: WIZ.ship.size, pgroup: WIZ.ship.pgroup || '',
      cmd_type: WIZ.ship.cmd_type || '',
      tech_total: +WIZ.ship.tech_total || 0,
      base: WIZ.ship.base, note: WIZ.ship.note || '问卷录入'},
    systems, nodes, modules};
}
/* 把「修改」也接到问卷上：先把这艘船的系统/节点/模块铺回 WIZ，再走同一套保存 */
function wizEdit(id) {
  /* 容错：蓝图可能还没载入、或这艘船刚被重命名/重建。先按字符串比对，
     找不到就重新拉一次蓝图再试，避免一进来就报「找不到这艘船」卡住。 */
  const list = ((S.bp && S.bp.ships) || []);
  const hit = list.find(s => String(s.id) === String(id));
  if (hit) return wizEditOpen(hit);
  toast('正在重新载入蓝图…', 'good');
  return loadBlueprints(true).then(() => {
    const l2 = ((S.bp && S.bp.ships) || []);
    const s2 = l2.find(s => String(s.id) === String(id));
    if (s2) return wizEditOpen(s2);
    toast('找不到这艘船（id=' + id + '）：重新载入后共 ' + l2.length
      + ' 艘仍没有它，请按 Ctrl+F5 强刷页面再试', 'bad');
  }).catch(e => toast('载入蓝图失败：' + e.message, 'bad'));
}
function wizEditOpen(sh) {
  WIZ = {step: 0, edit: true, editIdx: -1,
    ship: {id: sh.id, name: sh.name, kind: sh.kind, cls: sh.cls, size: sh.size,
      pgroup: sh.pgroup || '', cmd_type: sh.cmd_type || '', tech_total: +sh.tech_total || 0,
      base: Object.assign({}, sh.base || {}), note: sh.note || ''},
    systems: [], nodes: [], modules: [], editSys: -1,
    dSys: {name: '', slot: '', tech_cap: 5, bayF: '', bayC: '', bayG: ''},
    dNode: {sysIdx: '0', label: '', max_lv: 5, cost: 2, costs: '', effect: 'dmg', val: 3, parent: '', parent2: ''},
    dMod: {slot: '', name: '', dmg: 10, sysIdx: '', bays: [], bayKind: '战机', bayCap: '', bayAllow: ''},
    orig: {systems: [], nodes: [], modules: []}};
  (sh.systems || []).forEach((sy, si) => {
    const mod = (sh.modules || []).find(m => m.slot === sy.slot && (m.sys === sy.id || m.name === sy.name));
    let raw = {};
    try { raw = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { raw = {}; }
    /* 旧数据把弹药数、攻击次数分开存：合并口径读回来时乘成一项，避免编辑后丢失 */
    if (raw.ammo_atk === undefined && (Number(raw.ammo) || Number(raw.atk))) {
      raw.ammo_atk = (Number(raw.ammo) || 0) * (Number(raw.atk) || 1);
    }
    WIZ.systems.push({_id: sy.id, _stats: sy.stats || {}, _note: sy.note || '',
      _ord: sy.ord || (si + 1), _no_nodes: sy.no_nodes || 0, _mod: mod || null,
      name: sy.name, slot: sy.slot || '', tech_cap: +sy.tech_cap || 0,
      raw: raw,
      is_weapon: !!(sy.is_weapon || (raw.dmg_atk !== undefined || raw.dmg_air !== undefined || raw.dmg_siege !== undefined)),
      module: (sy.stats && sy.stats['模块']) || '',
      bays: (sy.bays || []).map(b => ({kind: b.kind, cap: +b.cap || 0, allow_group: b.allow_group || ''}))});
    WIZ.orig.systems.push(sy.id);
    if (mod) WIZ.orig.modules.push(mod.id);
    const push = n => {
      const ks = Object.keys(n.effect || {});
      const ek = ks[0] || '';
      WIZ.nodes.push({_id: n.id, _note: n.note || '', _eff: n.effect || {}, _effKey: ek,
        sysIdx: si, label: n.label,
        max_lv: +n.max_lv || 1, cost: +n.cost || 0, costs: (n.costs || []).join(','),
        effect: ek, val: Number((n.effect || {})[ek] || 0), parent: ''});
      WIZ.orig.nodes.push(n.id);
    };
    const codeById = {};
    const walk = (pid, prefix) => (sy.nodes || []).filter(n => firstPar(n.parent) === pid).forEach((n, k) => {
      const code = prefix ? prefix + '-' + (k + 1) : String(k + 1);
      const before = WIZ.nodes.length;
      push(n);
      WIZ.nodes[before].parent = prefix;
      codeById[n.id] = code;
      walk(n.id, code);
    });
    walk('', '');
    /* 双前置：把另外那些前置 id 也换成 code */
    (sy.nodes || []).forEach(n => {
      const ids = parList(n.parent);
      if (ids.length < 2) return;
      const at = WIZ.nodes.findIndex(y => y._id === n.id);
      if (at < 0) return;
      WIZ.nodes[at].parent = ids.map(id => codeById[id] || '').filter(Boolean).join(',');
    });
    (sy.nodes || []).forEach(n => { if (!WIZ.nodes.some(x => x._id === n.id)) push(n); });
  });
  $('#wizDlg').showModal();
  wizRender();
}
async function wizSave() {
  const p = wizPayload();
  const btn = $('#wizNext'); btn.disabled = true;
  try {
    await api('/api/data/ships', {method: 'PUT', body: p.ship});
    for (const s of p.systems) await api('/api/data/systems', {method: 'PUT', body: s});
    for (const n of p.nodes) await api('/api/data/nodes', {method: 'PUT', body: n});
    const withMod = canMod(p.ship);
    if (withMod) {
      for (const m of p.modules) await api('/api/data/modules', {method: 'PUT', body: m});
    }
    /* 编辑模式：把这次删掉的旧行一起清掉（先删节点，再删模块，最后删系统） */
    if (WIZ.edit) {
      const keepN = new Set(p.nodes.map(x => x.id));
      const keepM = new Set(p.modules.map(x => x.id));
      const keepS = new Set(p.systems.map(x => x.id));
      for (const id of WIZ.orig.nodes) if (!keepN.has(id)) await api('/api/data/nodes/' + encodeURIComponent(id), {method: 'DELETE', confirm: id});
      if (withMod) for (const id of WIZ.orig.modules) if (!keepM.has(id)) await api('/api/data/modules/' + encodeURIComponent(id), {method: 'DELETE', confirm: id});
      for (const id of WIZ.orig.systems) if (!keepS.has(id)) await api('/api/data/systems/' + encodeURIComponent(id), {method: 'DELETE', confirm: id});
    }
    toast((WIZ.edit ? '已保存：' : '已载入：') + '1 条舰船 / ' + p.systems.length + ' 个系统 / '
      + p.nodes.length + ' 条加点 / ' + p.modules.length + ' 个模块', 'good');
    $('#wizDlg').close();
    await loadBlueprints(true); renderData(); renderEditor();
  } catch (e) { toast('保存失败：' + e.message, 'bad'); }
  finally { btn.disabled = false; }
}

/* ---------- 批量数值维护 ---------- */
S.auShip = ''; S.auQ = '';
function auRows(all) {
  const out = [];
  for (const s of S.bp.ships) {
    if (S.auShip && s.id !== S.auShip) continue;
    for (const sy of s.systems) for (const nd of sy.nodes)
      out.push({ship: s, sys: sy, nd});
  }
  let rows = out;
  const sc = $('#auShowChecked');
  if (!(sc && sc.checked)) rows = rows.filter(r => !r.nd.checked_at);
  if (all) return rows;
  const q = (S.auQ || '').trim();
  if (q) rows = rows.filter(r => (r.ship.name + r.sys.name + r.nd.label + (r.nd.note || '')).indexOf(q) >= 0);
  if ($('#auPending').checked) rows = rows.filter(r => /待核|折算/.test(r.nd.note || ''));
  return rows;
}
function renderAudit() {
  if (!can('audit_view')) return;
  if (!S.bp) return;
  const sel = $('#auShip');
  if (sel.options.length !== S.bp.ships.length + 1) {
    sel.innerHTML = '';
    sel.appendChild(new Option('全部舰船（' + S.bp.ships.length + '）', ''));
    S.bp.ships.forEach(s => sel.appendChild(new Option(s.name + '（' + (s.size || '') + '）', s.id)));
  }
  sel.value = S.auShip || '';
  const rows = auRows(false);
  const head = $('#auHead'); head.innerHTML = '';
  ['舰船', '系统', '节点', '效果键', '最大级', '消耗/级', '逐级消耗（逗号分隔，可空）', '每级值', '备注', '已核']
    .forEach(t => head.appendChild(el('th', '', t)));
  const body = $('#auBody'); body.innerHTML = '';
  const tdOf = x => { const d = el('td'); d.appendChild(x); return d; };
  const numIn = (id, k, v, step) => {
    const i = el('input'); i.type = 'number'; i.min = '0'; i.step = step || '1';
    i.value = (v === undefined || v === null) ? '' : v; i.style.width = '68px';
    i.dataset.id = id; i.dataset.k = k; return i;
  };
  rows.forEach(r => {
    const tr = el('tr');
    tr.appendChild(el('td', '', r.ship.name));
    tr.appendChild(el('td', '', r.sys.name));
    tr.appendChild(el('td', '', r.nd.label));
    const keys = Object.keys(r.nd.effect || {});
    tr.appendChild(el('td', 'muted', keys.join(' / ') || '(无)'));
    tr.appendChild(tdOf(numIn(r.nd.id, 'max_lv', r.nd.max_lv)));
    tr.appendChild(tdOf(numIn(r.nd.id, 'cost', r.nd.cost)));
    const ci = el('input'); ci.type = 'text'; ci.style.width = '150px';
    ci.placeholder = '如 2,3,4,5,6';
    ci.value = Array.isArray(r.nd.costs) ? r.nd.costs.join(',') : (r.nd.costs || '');
    ci.dataset.id = r.nd.id; ci.dataset.k = 'costs';
    tr.appendChild(tdOf(ci));
    const tdV = el('td');
    if (!keys.length) tdV.appendChild(document.createTextNode('—'));
    keys.forEach(k => { tdV.appendChild(numIn(r.nd.id, 'eff:' + k, r.nd.effect[k], '0.1')); tdV.appendChild(document.createTextNode(' ')); });
    tr.appendChild(tdV);
    tr.appendChild(el('td', 'muted', (r.nd.note || '').slice(0, 60)));
    tr.appendChild(el('td', 'muted', r.nd.checked_at
      ? (r.nd.checked_at.slice(5, 16) + ' · ' + (r.nd.checked_by || ''))
      : '—'));
    body.appendChild(tr);
  });
  const allN = auRows(true).length;
  const doneN = (S.bp.ships || []).reduce((a, s2) => a + s2.systems.reduce(
    (b, sy2) => b + sy2.nodes.filter(nd2 => nd2.checked_at).length, 0), 0);
  $('#auNote').textContent = '显示 ' + rows.length + ' 条 / 共 ' + allN + ' 条'
    + (doneN ? ' · 已核 ' + doneN + ' 条（勾「显示已核」可查看时间与操作人）' : '')
    + ' · 保存后该行自动归档，不再出现在待核列表';
}
function stamp() {   /* 本地时间 yyyy-mm-dd hh:mm:ss，与库里 ts 同格式 */
  const d = new Date(), p2 = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
    + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
}
async function saveAudit() {
  if (!(S.user && (S.user.role === 'admin' || S.user.role === 'superadmin'))) return toast('用管理员账号登录才能改', 'bad');
  const edits = {};
  document.querySelectorAll('#auBody input').forEach(inp => {
    if (inp.type === 'checkbox') return;
    if (inp.dataset.k === 'costs') {
      const arr = inp.value.split(/[,，\s]+/).filter(x => x !== '').map(Number);
      (edits[inp.dataset.id] = edits[inp.dataset.id] || {})[inp.dataset.k] = arr;
      return;
    }
    (edits[inp.dataset.id] = edits[inp.dataset.id] || {})[inp.dataset.k] = inp.value === '' ? null : +inp.value;
  });
  const byId = {};
  S.bp.ships.forEach(s => s.systems.forEach(sy => sy.nodes.forEach(nd => { byId[nd.id] = nd; })));
  let n = 0;
  try {
    for (const id of Object.keys(edits)) {
      const nd = byId[id]; if (!nd) continue;
      const eff = Object.assign({}, nd.effect || {});
      const body = {id: nd.id, sys: nd.sys, parent: nd.parent || '', label: nd.label,
        note: nd.note || '', max_lv: nd.max_lv, cost: nd.cost, effect: eff,
        checked_at: stamp(), checked_by: (S.user && S.user.username) || ''};
      let changed = false;
      for (const k of Object.keys(edits[id])) {
        const v = edits[id][k]; if (v === null) continue;
        if (k === 'max_lv' && v !== nd.max_lv) { body.max_lv = v; changed = true; }
        else if (k === 'cost' && v !== nd.cost) { body.cost = v; changed = true; }
        else if (k === 'costs') { body.costs = v; changed = true; }
        else if (k.indexOf('eff:') === 0 && v !== nd.effect[k.slice(4)]) { eff[k.slice(4)] = v; changed = true; }
      }
      if (!changed) continue;
      await api('/api/data/nodes/' + nd.id, {method: 'PUT', body});
      n++;
    }
    toast(n ? '已保存 ' + n + ' 条，已归档（不再出现在待核列表）' : '没有改动', n ? 'good' : '');
    if (n) { await loadBlueprints(true); renderAudit(); }
  } catch (e) { toast('保存失败：' + e.message, 'bad'); }
}
function exportNodeCsv() {
  const rows = auRows(true);
  const lines = ['舰船,系统,节点,效果键,每级值,最大级,消耗,备注'];
  rows.forEach(r => {
    const keys = Object.keys(r.nd.effect || {});
    const k = keys[0] || '';
    const v = keys.length ? r.nd.effect[k] : '';
    lines.push([r.ship.name, r.sys.name, r.nd.label, k, v, r.nd.max_lv, r.nd.cost,
      (r.nd.note || '').replace(/[,\r\n]/g, ' ')].join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = '批量数值维护.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- 实时 ---------- */
let STREAM_RETRY = null;
async function connectStream() {
  // 先换一张一次性 ticket，再连 SSE（token 不再出现在 URL 里）
  let tk = '';
  try {
    const r = await api('/api/stream_ticket', {method: 'POST'});
    tk = r.ticket || '';
  } catch (e) {
    $('#liveTag').textContent = '实时 · 未连接';
    if (STREAM_RETRY) clearTimeout(STREAM_RETRY);
    STREAM_RETRY = setTimeout(connectStream, 5000);
    return;
  }
  const es = new EventSource('/api/stream?ticket=' + encodeURIComponent(tk));
  es.addEventListener('version', ev => {
    const v = +ev.data;
    $('#liveTag').textContent = '实时 · v' + v;
    if (v !== S.version && S.bp) { S.version = v; loadBlueprints(true); }
  });
  es.onopen = () => {
    $('#liveTag').textContent = '实时 · 已连接';
    const off = document.getElementById('offline');
    if (off) off.classList.add('hide');
  };
  es.onerror = () => {
    $('#liveTag').textContent = '实时 · 重连中';
    const off = document.getElementById('offline');
    if (off) off.classList.remove('hide');
  };
}


/* ---------- 人员档案（查询 / 详情管理） ---------- */
const MEM_KEYS = ['id', 'name', 'org', 'faction', 'alliance', 'squad', 'phone', 'wechat', 'qq',
  'links', 'rating', 'note'];
const MH_LABEL = {
  name: '名称', org: '组织', faction: '隶属', alliance: '联合体', squad: '小队',
  links: '关联账号', rating: '评级', phone: '电话', wechat: '微信', qq: 'QQ', note: '备注',
  __create__: '建档', __delete__: '删除', __import__: '导入', __init__: '基线'
};
const mhLabel = k => MH_LABEL[k] || k;

async function fetchMembers(q, field, limit) {
  const qs = new URLSearchParams({q: q || '', field: field || 'all', limit: String(limit || 200)});
  return api('/api/members?' + qs.toString());
}

function memEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
}
function memHl(v, kw) {
  const t = memEsc(v);
  if (!kw) return t;
  const k = memEsc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return t.replace(new RegExp(k, 'gi'), m => '<mark>' + m + '</mark>');
}
function memDash(v, kw) {
  return (v === null || v === undefined || v === '') ? '<span class="muted">—</span>' : memHl(v, kw);
}

// mode='q' 查询页（无序号列之外，多「详情」）；mode='m' 档案管理（多「改 / 删」）
function fillMemTable(tbody, rows, mode, kw) {
  tbody.innerHTML = '';
  const cols = mode === 'q' ? 11 : 13;
  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', 'muted', kw ? '没有匹配的记录，换个关键字试试' : '没有数据');
    td.colSpan = cols; td.style.textAlign = 'center'; td.style.padding = '18px';
    tr.appendChild(td); tbody.appendChild(tr);
    return;
  }
  rows.forEach((r, i) => {
    const tr = el('tr');
    if (mode === 'q') tr.onclick = () => openMemDlg(r, false);
    if (mode === 'q') {
      tr.appendChild(el('td', 'muted', String(i + 1)));
      const tdId = el('td', 'idcell'); tdId.innerHTML = memHl(r.id, kw); tr.appendChild(tdId);
      const cells = [r.name, r.org, r.faction, r.alliance, r.squad, r.links, r.rating, r.updated_at];
      const rateIdx = 6;
      cells.forEach((v, ci) => {
        const td = el('td');
        if (ci === rateIdx && v) td.className = 'rate';
        const long = v && String(v).length > 26;
        if (long) td.className = 'ellip';
        td.innerHTML = memDash(v, kw);
        if (long) td.title = String(v);
        tr.appendChild(td);
      });
    } else {
      const cells = [r.id, r.name, r.org, r.faction, r.alliance, r.squad,
        r.phone, r.wechat, r.qq, r.links, r.rating, r.updated_at];
      cells.forEach(v => tr.appendChild(el('td', '', (v === null || v === undefined || v === '') ? '—' : v)));
    }
    const td = el('td');
    const bh = el('button', 'btn ghost', '轨迹');
    bh.onclick = ev => { ev.stopPropagation(); openHistory(r.id, r.name || r.id); };
    td.appendChild(bh);
    if (mode === 'q') {
      const b1 = el('button', 'btn ghost', '详情');
      b1.onclick = ev => { ev.stopPropagation(); openMemDlg(r, false); };
      td.appendChild(b1);
      const b2 = el('button', 'btn ghost', '复制 ID');
      b2.onclick = async ev => {
        ev.stopPropagation();
        try {
          await navigator.clipboard.writeText(r.id);
          toast('已复制 ' + r.id, 'good');
        } catch (e) { prompt('手动复制：', r.id); }
      };
      td.appendChild(b2);
    } else {
      const b1 = el('button', 'btn ghost', '改');
      b1.onclick = () => openMemDlg(r, true);
      td.appendChild(b1);
      const b2 = el('button', 'btn ghost', '删');
      b2.onclick = async () => {
        if (!askConfirm(r.id, '删除档案「' + (r.name || r.id) + '」')) return;
        try {
          await api('/api/members/' + encodeURIComponent(r.id), {method: 'DELETE', confirm: r.id});
          toast('已删除', 'good'); loadRosterAdmin();
        } catch (e) { toast('删除失败：' + e.message, 'bad'); }
      };
      td.appendChild(b2);
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
}

function memSummary(r) {
  return '共 ' + r.total + ' 条' + (r.total > r.rows.length ? '，显示前 ' + r.rows.length + ' 条' : '');
}

function rosterShowEmpty(on) {
  const wrap = $('#mfWrap'), empty = $('#mfEmpty');
  if (wrap) wrap.classList.toggle('hide', on);
  if (empty) empty.classList.toggle('hide', !on);
}

async function loadRosterQuery() {
  const body = $('#mfBody'); if (!body) return;
  const note = $('#mfNote'), foot = $('#mfFoot');
  const kw = $('#mfQ').value.trim();
  if (!kw) {                      // 没输关键字：一条都不显示
    body.innerHTML = '';
    rosterShowEmpty(true);
    note.textContent = '输入关键字后查询';
    if (foot) foot.textContent = '';
    return;
  }
  note.textContent = '查询中…';
  try {
    const r = await fetchMembers(kw, $('#mfField').value, 200);
    rosterShowEmpty(false);
    fillMemTable(body, r.rows, 'q', kw);
    note.textContent = memSummary(r);
    if (foot) foot.textContent = r.rows.length ? '点任意一行看详情' : '';
  } catch (e) {
    rosterShowEmpty(true);
    note.textContent = '查询失败：' + e.message;
  }
}

async function loadRosterAdmin() {
  const body = $('#mmBody'); if (!body) return;
  const note = $('#mmNote'); note.textContent = '加载中…';
  try {
    const r = await fetchMembers($('#mmQ').value.trim(), 'all', 200);
    fillMemTable(body, r.rows, 'm');
    note.textContent = memSummary(r);
  } catch (e) { note.textContent = '加载失败：' + e.message; }
}

function openMemDlg(row, editable) {
  const f = $('#memForm'); const r = row || {};
  const HIDE_IN_QUERY = ['phone', 'wechat', 'qq', 'note'];
  MEM_KEYS.forEach(k => {
    const inp = f.elements[k]; if (!inp) return;
    inp.value = (r[k] === null || r[k] === undefined) ? '' : r[k];
    inp.disabled = !editable;
    const row = inp.closest('.row');
    if (row) row.style.display = (!editable && HIDE_IN_QUERY.indexOf(k) >= 0) ? 'none' : '';
  });
  $('#memOk').style.display = editable ? '' : 'none';
  $('#memTitle').textContent = editable ? (r.id ? '修改人员档案 · ' + (r.name || r.id) : '新增人员档案') : '人员详情 · ' + (r.name || r.id);
  $('#memDlg').showModal();
}

async function saveMem() {
  const f = $('#memForm'); const data = {};
  MEM_KEYS.forEach(k => { const inp = f.elements[k]; if (inp) data[k] = inp.value.trim(); });
  if (!data.id) { toast('ID 必填', 'bad'); return false; }
  try {
    const r = await api('/api/members', {method: 'PUT', body: data});
    toast(r && r.changed === 0 ? '内容没变，已跳过（不写日志）' : '已保存', 'good');
    loadRosterAdmin(); loadRosterQuery(); loadRecent();
    return true;
  } catch (e) { toast('保存失败：' + e.message, 'bad'); return false; }
}

let HIST_ID = '';
let HIST_FIELD = '';

function mhEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
}

function mhTime(t) {      // 今年的记录省年份，跨年补上，避免「11-07」看不出哪一年
  const s = String(t || '');
  const y = s.slice(0, 4), md = s.slice(5, 10), hm = s.slice(11, 16);
  if (!md) return s;
  return (y && y !== String(new Date().getFullYear()) ? y + '-' + md : md) + (hm ? ' ' + hm : '');
}

let HIST_OFFSET = 0, HIST_TOTAL = 0, HIST_COUNTS = {}, HIST_ROWS = [];

async function openHistory(id, title) {
  HIST_ID = String(id || ''); HIST_FIELD = '';
  HIST_OFFSET = 0; HIST_TOTAL = 0; HIST_COUNTS = {}; HIST_ROWS = [];
  const dlg = $('#histDlg'); if (!dlg) return;
  $('#histTitle').textContent = '变更轨迹 · ' + (title || id);
  $('#histSub').textContent = 'ID ' + HIST_ID + ' · 加载中…';
  $('#histBody').innerHTML = '';
  $('#histNote').textContent = '';
  const chips = $('#histChips');
  if (chips) {
    [...chips.querySelectorAll('button')].forEach(b => b.classList.toggle('on', !b.dataset.f));
  }
  dlg.showModal();
  await loadHistory();
}

async function loadHistory(append) {
  const body = $('#histBody'); if (!body) return;
  const more = $('#histMore');
  if (!append) { HIST_OFFSET = 0; HIST_ROWS = []; body.innerHTML = '<div class="muted" style="padding:10px 0">加载中…</div>'; }
  const qs = new URLSearchParams({limit: '200', offset: String(HIST_OFFSET)});
  if (HIST_FIELD) qs.set('fields', HIST_FIELD);
  try {
    const r = await api('/api/members/' + encodeURIComponent(HIST_ID) + '/history?' + qs.toString());
    const rows = r.rows || [];
    HIST_COUNTS = r.counts || {};
    HIST_TOTAL = r.total || rows.length;
    const who = (r.member && r.member.name) ? r.member.name + '（' + HIST_ID + '）' : HIST_ID;
    $('#histSub').textContent = who + (r.member && r.member.org ? ' · ' + r.member.org : '')
      + (r.pii === false ? ' · 敏感字段已打码' : '');
    mhChips(HIST_COUNTS);
    if (!rows.length && !append) {
      body.innerHTML = '<div class="empty"><b>还没有变更记录</b><p>'
        + (HIST_FIELD ? '这个字段没有变更过。' : '这之后对该档案的修改会逐条记在这里。') + '</p></div>';
      $('#histNote').textContent = '';
      if (more) more.classList.add('hide');
      return;
    }
    HIST_ROWS = append ? HIST_ROWS.concat(rows) : rows;
    HIST_OFFSET = HIST_ROWS.length;
    body.innerHTML = mhRender(HIST_ROWS);
    mhBind(body);
    const init = HIST_ROWS.filter(x => x.field === '__init__').length;
    $('#histNote').textContent = '共 ' + HIST_TOTAL + ' 条变更'
      + (init ? '（含 ' + init + ' 条建档基线）' : '')
      + ' · 已显示 ' + HIST_ROWS.length
      + ' · 2026-11-07 之前只有操作日志、没有字段明细';
    if (more) {
      more.classList.toggle('hide', !r.more);
      more.textContent = '加载更多（还有 ' + Math.max(0, HIST_TOTAL - HIST_ROWS.length) + ' 条）';
    }
  } catch (e) {
    body.innerHTML = '<div class="empty"><b>加载失败</b><p>' + mhEsc(e.message) + '</p></div>';
  }
}

function mhChips(counts) {
  const chips = $('#histChips'); if (!chips) return;
  let total = 0;
  Object.keys(counts || {}).forEach(k => { if (k !== '__init__') total += counts[k]; });
  [...chips.querySelectorAll('button')].forEach(b => {
    const f = b.dataset.f || '';
    if (!b.dataset.lbl) b.dataset.lbl = b.textContent.trim();
    const n = f ? (counts[f] || 0) : total;
    b.textContent = b.dataset.lbl + (n ? ' · ' + n : '');
    b.disabled = !!f && !n;
    b.title = f ? (n ? '只看「' + b.dataset.lbl + '」的变更' : '这个字段没有变更记录') : '看全部字段';
    b.classList.toggle('on', (HIST_FIELD || '') === f);
  });
}

function mhRender(rows) {
  const groups = [];
  rows.forEach(x => {
    const last = groups[groups.length - 1];
    if (last && last.batch === x.batch) last.items.push(x);
    else groups.push({batch: x.batch, ts: x.ts, actor: x.actor, items: [x]});
  });
  const FOLD = 4;
  let html = '';
  groups.forEach((g, gi) => {
    const cnt = g.items.length;
    html += '<div class="histgrp"><div class="histhead">'
      + '<span class="ht">' + mhEsc(mhTime(g.ts)) + '</span>'
      + '<span class="ha2">' + mhEsc(g.actor || '—') + '</span>'
      + (cnt > 1 ? '<span class="hbadge">' + cnt + ' 项</span>' : '')
      + '</div>';
    g.items.forEach((it, idx) => {
      const o = it.old_val === '' ? '<span class="hempty">（空）</span>' : '<span class="ho">' + mhEsc(it.old_val) + '</span>';
      const n = it.new_val === '' ? '<span class="hempty">（空）</span>' : '<span class="hn">' + mhEsc(it.new_val) + '</span>';
      const txt = mhLabel(it.field) + '：' + (it.old_val === '' ? '（空）' : it.old_val) + ' → ' + (it.new_val === '' ? '（空）' : it.new_val);
      html += '<div class="histitem' + (idx >= FOLD ? ' fold hide' : '') + '" data-txt="' + mhEsc(txt) + '" title="点击复制这条变更">'
        + '<span class="hf">' + mhEsc(mhLabel(it.field)) + '</span>'
        + o + '<span class="ha">→</span>' + n + '</div>';
    });
    if (cnt > FOLD) {
      html += '<button class="btn sm ghost histfold" data-g="' + gi + '">展开其余 ' + (cnt - FOLD) + ' 项</button>';
    }
    html += '</div>';
  });
  return html;
}

function mhBind(root) {
  root.querySelectorAll('.histitem').forEach(el => {
    el.onclick = () => {
      const t = el.dataset.txt || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(() => toast('已复制：' + t, 'good')).catch(() => toast(t, ''));
      } else { toast(t, ''); }
    };
  });
  root.querySelectorAll('.histfold').forEach(b => {
    b.onclick = () => {
      const grp = b.closest('.histgrp');
      const folded = grp.querySelectorAll('.histitem.fold.hide');
      if (folded.length) {
        folded.forEach(x => x.classList.remove('hide'));
        b.textContent = '收起';
      } else {
        grp.querySelectorAll('.histitem.fold').forEach(x => x.classList.add('hide'));
        b.textContent = '展开其余 ' + grp.querySelectorAll('.histitem.fold').length + ' 项';
      }
    };
  });
}

async function loadRecent() {
  const body = $('#rcBody'); if (!body) return;
  const note = $('#rcNote');
  if (note) note.textContent = '加载中…';
  try {
    const days = ($('#rcDays') || {}).value || '7';
    const r = await api('/api/member_history?days=' + encodeURIComponent(days) + '&limit=100');
    const rows = r.rows || [];
    body.innerHTML = '';
    if (!rows.length) {
      const tr = el('tr');
      const td = el('td', 'muted', '这段时间没有人员档案变更');
      td.colSpan = 6; td.style.textAlign = 'center'; td.style.padding = '14px';
      tr.appendChild(td); body.appendChild(tr);
    }
    rows.forEach(x => {
      const tr = el('tr');
      tr.appendChild(el('td', 'muted', mhTime(x.ts)));
      tr.appendChild(el('td', '', x.actor || '—'));
      const nm = x.mname ? (x.mname + '（' + x.member_id + '）') : x.member_id;
      const tdN = el('td', 'idcell'); tdN.textContent = nm; tr.appendChild(tdN);
      tr.appendChild(el('td', '', mhLabel(x.field)));
      tr.appendChild(el('td', 'muted', x.old_val === '' ? '（空）' : x.old_val));
      tr.appendChild(el('td', '', x.new_val === '' ? '（空）' : x.new_val));
      tr.onclick = () => openHistory(x.member_id, x.mname || x.member_id);
      body.appendChild(tr);
    });
    if (note) {
      note.textContent = '共 ' + rows.length + ' 条（最多显示 100 条）'
        ;
    }
  } catch (e) { if (note) note.textContent = '加载失败：' + e.message; }
}

function bindHistory() {
  const dlg = $('#histDlg');
  if (dlg) {
    const c = $('#histClose'); if (c) c.onclick = () => dlg.close();
    const chips = $('#histChips');
    if (chips) {
      chips.onclick = ev => {
        const b = ev.target.closest('button[data-f]'); if (!b) return;
        HIST_FIELD = b.dataset.f || '';
        [...chips.querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b));
        loadHistory();
      };
    }
  }
  const rc = $('#rcReload'); if (rc) rc.onclick = () => loadRecent();
  const rd = $('#rcDays'); if (rd) rd.onchange = () => loadRecent();
}

function bindRoster() {
  const go = $('#mfGo'); if (go) go.onclick = loadRosterQuery;
  const cl = $('#mfClear'); if (cl) cl.onclick = () => {
    $('#mfQ').value = ''; $('#mfField').value = 'all';
    $('#mfBody').innerHTML = ''; rosterShowEmpty(true);
    $('#mfNote').textContent = '输入关键字后查询';
    const foot = $('#mfFoot'); if (foot) foot.textContent = '';
    $('#mfQ').focus();
  };
  const q = $('#mfQ'); if (q) q.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); loadRosterQuery(); } };
  const mg = $('#mmGo'); if (mg) mg.onclick = loadRosterAdmin;
  const mr = $('#memReload'); if (mr) mr.onclick = () => {
    loadRosterAdmin();
    if (($('#mfQ') || {}).value && ($('#mfQ').value || '').trim()) loadRosterQuery();
    toast('已刷新', 'good');
  };
  const mn = $('#memNew'); if (mn) mn.onclick = () => openMemDlg(null, true);
  const mq = $('#mmQ'); if (mq) mq.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); loadRosterAdmin(); } };
  const f = $('#memForm');
  if (f) {
    f.onsubmit = async ev => {
      ev.preventDefault();
      const sub = ev.submitter;
      if (sub && sub.value === 'cancel') { $('#memDlg').close(); return; }
      if (await saveMem()) $('#memDlg').close();
    };
  }
}

/* ---------- 战报分析 ---------- */
const bnum = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
S.battles = S.battles || [];
S.brows = S.brows || [];
S.curBattle = null;
S.bfMine = '__all';
S.bfFoe = '__all';

const KIND_ORDER = ['超主力舰', '主力舰', '舰载机', '未登记'];
function shipKind(name) {
  const list = (S.bp && S.bp.ships) || [];
  const s = list.find(x => x.name === name || x.id === name);
  return (s && s.kind) || '未登记';
}
function fleetOf(r) { return r.fleet || (r.side === '我方' ? '我方' : '敌方'); }
function dmgOf(r) { return bnum(r.dmg_struct) + bnum(r.dmg_sys); }
function aliveN(r) {
  const n = r.alive_n;
  if (n === null || n === undefined || n === '') return (r.alive === '是' ? (bnum(r.qty) || 1) : 0);
  return bnum(n);
}
function bRowsOf(bid) { return S.brows.filter(r => r.battle === bid); }

// 无「战报·改」权限时：隐藏新增/批量粘贴/保存，禁用明细输入，隐藏删除
function applyBattleReadonly() {
  const ro = !can('battle_edit');
  ['batNew', 'browPaste', 'bmSave'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hide', ro);
  });
  document.querySelectorAll('#browBody input, #browBody select, .metagrid input, .metagrid textarea')
    .forEach(el => { el.disabled = ro; });
  document.querySelectorAll('#batBody button, #browBody button').forEach(b => {
    if (b.textContent.trim() === '删') b.classList.toggle('hide', ro);
  });
}

function renderBattles() {
  applyBattleReadonly();
  const tb = $('#batBody');
  tb.innerHTML = '';
  if (!S.battles.length) {
    tb.innerHTML = '<tr><td colspan="10" class="muted">还没有战报，点右上角「新增战报」。</td></tr>';
    $('#batNote').textContent = '';
    return;
  }
  S.battles.forEach(b => {
    const rows = bRowsOf(b.id);
    let mine = 0, foe = 0;
    const foes = new Set();
    rows.forEach(r => {
      if (r.side === '我方') mine += dmgOf(r);
      else { foe += dmgOf(r); foes.add(fleetOf(r)); }
    });
    const ratio = foe > 0 ? fmt(mine / foe, 2) : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="idcell">${memEsc(b.id)}</td><td>${memEsc(b.date) || '—'}</td>
      <td>${memEsc(b.opponent) || '—'}</td><td>${foes.size ? foes.size + ' 支' : '—'}</td>
      <td>${memEsc(b.mode) || '—'}</td><td>${memEsc(b.duration) || '—'}</td>
      <td>${mine ? mine.toLocaleString() : '—'}</td><td>${foe ? foe.toLocaleString() : '—'}</td>
      <td>${ratio}</td><td></td>`;
    const ops = tr.lastElementChild;
    const b1 = document.createElement('button'); b1.className = 'btn ghost sm'; b1.textContent = '查看';
    b1.onclick = () => { if (!confirmLeaveDraft()) return; S.curBattle = b.id; S.bfMine = '__all'; S.bfFoe = '__all'; renderBattleDetail(); };
    const b3 = document.createElement('button'); b3.className = 'btn ghost sm danger'; b3.textContent = '删';
    b3.onclick = async () => {
      if (!askConfirm(b.id, `删除战报 ${b.id} 及其 ${rows.length} 条明细`)) return;
      await api('/api/battles/' + encodeURIComponent(b.id), {method: 'DELETE', confirm: b.id});
      if (S.curBattle === b.id) S.curBattle = null;
      await loadBattles();
    };
    ops.append(b1, b3);
    tr.ondblclick = () => { if (!confirmLeaveDraft()) return; S.curBattle = b.id; S.bfMine = '__all'; S.bfFoe = '__all'; renderBattleDetail(); };
    tb.appendChild(tr);
  });
  $('#batNote').textContent = `共 ${S.battles.length} 场战报、${S.brows.length} 条明细。`;
}

/* ---------- 战报明细：表格内联编辑 ---------- */
const B_SIDES = ['我方', '敌方'];
const B_NUMS = ['qty', 'dmg_struct', 'dmg_sys', 'dmg_air', 'repair', 'taken'];

function fleetDatalist(rows) {
  const dl = $('#fleetNames');
  if (!dl) return;
  const names = [...new Set(rows.map(fleetOf))];
  ['我方主队', '我方二队', '敌方1队', '敌方2队'].forEach(n => { if (names.indexOf(n) < 0) names.push(n); });
  dl.innerHTML = names.map(n => `<option value="${memEsc(n)}"></option>`).join('');
}

function tdOf(el) { const td = document.createElement('td'); td.appendChild(el); return td; }

function browRowEl(r) {
  const tr = document.createElement('tr');
  tr.dataset.battle = S.curBattle;
  if (r && r.id) tr.dataset.id = r.id; else tr.classList.add('draft');

  const sideSel = document.createElement('select');
  sideSel.dataset.k = 'side';
  B_SIDES.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sideSel.appendChild(o); });
  sideSel.value = (r && r.side) || '我方';
  tr.appendChild(tdOf(sideSel));

  const fleetIn = document.createElement('input');
  fleetIn.dataset.k = 'fleet'; fleetIn.setAttribute('list', 'fleetNames');
  fleetIn.value = r ? fleetOf(r) : (sideSel.value === '我方' ? '我方主队' : '敌方1队');
  tr.appendChild(tdOf(fleetIn));

  const shipIn = document.createElement('input');
  shipIn.dataset.k = 'ship'; shipIn.setAttribute('list', 'shipNames');
  shipIn.value = (r && r.ship) || '';
  tr.appendChild(tdOf(shipIn));

  const kindTd = document.createElement('td');
  kindTd.className = 'kcell';
  const setKind = () => {
    const k = shipIn.value ? shipKind(shipIn.value) : '—';
    kindTd.textContent = k;
    kindTd.classList.toggle('warn', k === '未登记');
  };
  setKind();
  tr.appendChild(kindTd);

  B_NUMS.forEach(k => {
    const inp = document.createElement('input');
    inp.className = 'num'; inp.dataset.k = k; inp.type = 'number'; inp.min = '0';
    inp.step = (k === 'qty') ? '1' : 'any';
    const v = r ? r[k] : '';
    inp.value = (v === 0 || v || v === '0') ? String(bnum(v)) : '';
    tr.appendChild(tdOf(inp));
  });

  const aliveWrap = document.createElement('div');
  aliveWrap.className = 'alivewrap';
  const aliveIn = document.createElement('input');
  aliveIn.className = 'num'; aliveIn.dataset.k = 'alive_n';
  aliveIn.type = 'number'; aliveIn.step = '1'; aliveIn.min = '0';
  const qtag = document.createElement('span');
  qtag.className = 'qtag';
  const initAlive = r
    ? (r.alive_n === null || r.alive_n === undefined || r.alive_n === ''
        ? (r.alive === '是' ? bnum(r.qty) : 0)
        : bnum(r.alive_n))
    : null;
  aliveIn.value = (initAlive === null) ? '' : String(initAlive);
  aliveWrap.appendChild(aliveIn);
  aliveWrap.appendChild(qtag);
  const aliveTd = document.createElement('td');
  aliveTd.appendChild(aliveWrap);
  tr.appendChild(aliveTd);
  const paintAlive = () => {
    const qEl = tr.querySelector('[data-k="qty"]');
    const q = qEl ? bnum(qEl.value) : 0;
    aliveIn.max = String(q);
    qtag.textContent = '/' + q;
  };
  paintAlive();

  const noteIn = document.createElement('input');
  noteIn.dataset.k = 'note'; noteIn.placeholder = '可不填';
  noteIn.value = (r && r.note) || '';
  tr.appendChild(tdOf(noteIn));

  const opsTd = document.createElement('td');
  const del = document.createElement('button');
  del.className = 'btn ghost sm danger'; del.textContent = '删'; del.title = '删除这一行';
  del.onclick = () => deleteBrow(tr);
  opsTd.appendChild(del);
  tr.appendChild(opsTd);

  tr.addEventListener('input', ev => { if (ev.target && ev.target.dataset.k === 'qty') paintAlive(); });
  tr.addEventListener('change', () => { saveBrow(tr); });
  shipIn.addEventListener('input', setKind);
  sideSel.addEventListener('change', () => {
    if (!fleetIn.value || fleetIn.value === '我方主队' || fleetIn.value === '敌方1队') {
      fleetIn.value = sideSel.value === '我方' ? '我方主队' : '敌方1队';
    }
  });
  return tr;
}

function collectBrow(tr) {
  const g = k => { const el = tr.querySelector('[data-k="' + k + '"]'); return el ? String(el.value).trim() : ''; };
  const q = bnum(g('qty'));
  const rawAlive = g('alive_n');
  const an = rawAlive === '' ? null : bnum(rawAlive);
  const alive = an === null ? '' : (q > 0 && an >= q ? '是' : (an === 0 ? '否' : ''));
  return {
    battle: tr.dataset.battle, side: g('side'), fleet: g('fleet'), ship: g('ship'),
    qty: g('qty'), dmg_struct: g('dmg_struct'), dmg_sys: g('dmg_sys'), dmg_air: g('dmg_air'),
    repair: g('repair'), taken: g('taken'), alive: alive, alive_n: rawAlive, note: g('note')
  };
}

function afterBrowChange() {
  const rows = bRowsOf(S.curBattle);
  fillFleetSelects(rows);
  renderBattles();
  renderBattleKinds(rows);
  renderBattleStats();
  $('#browNote').textContent = `本场共 ${rows.length} 条明细、${[...new Set(rows.map(fleetOf))].length} 支舰队。改动即时保存。`;
}

async function saveBrow(tr) {
  if (!S.curBattle) return;
  const body = collectBrow(tr);
  const empty = !body.ship && !bnum(body.qty) && !bnum(body.dmg_struct) && !bnum(body.dmg_sys)
    && !bnum(body.dmg_air) && !bnum(body.repair) && !bnum(body.taken);
  if (empty) return;
  try {
    if (tr.dataset.id) body.id = Number(tr.dataset.id);
    const j = await api('/api/battle_rows', {method: 'PUT', body: body});
    const row = j.row;
    tr.dataset.id = row.id;
    tr.classList.remove('draft');
    const anEl = tr.querySelector('[data-k="alive_n"]');
    if (anEl) anEl.value = (row.alive_n === null || row.alive_n === undefined) ? '' : String(row.alive_n);
    const i = S.brows.findIndex(x => String(x.id) === String(row.id));
    if (i >= 0) S.brows[i] = row; else S.brows.push(row);
    afterBrowChange();
    tr.classList.add('saved');
    setTimeout(() => tr.classList.remove('saved'), 900);
  } catch (e) {
    toast('保存失败：' + (e && e.message ? e.message : e), 'bad');
  }
}

async function deleteBrow(tr) {
  if (!confirm('删除这一行明细？')) return;
  const id = tr.dataset.id;
  if (id) {
    try {
      await api('/api/battle_rows/' + id, {method: 'DELETE'});
    } catch (e) {
      toast('删除失败：' + (e && e.message ? e.message : e), 'bad');
      return;
    }
    S.brows = S.brows.filter(x => String(x.id) !== String(id));
  }
  tr.remove();
  afterBrowChange();
  if (!bRowsOf(S.curBattle).length) renderBattleDetail();
}

function hasDraft() {
  const rows = [...document.querySelectorAll('#browBody tr.draft')];
  return rows.some(tr => {
    const b = collectBrow(tr);
    return !!(b.ship || b.note || bnum(b.qty) || bnum(b.dmg_struct) || bnum(b.dmg_sys)
      || bnum(b.dmg_air) || bnum(b.repair) || bnum(b.taken));
  });
}

function confirmLeaveDraft() {
  if (!hasDraft()) return true;
  return confirm('明细表里还有没保存的行，切走就丢了。继续？');
}

function addBrow(side) {
  if (!S.curBattle) { toast('先在上面选一场战报', 'bad'); return; }
  const tb = $('#browBody');
  const ph = tb.querySelector('tr.placeholder');
  if (ph) ph.remove();
  const tr = browRowEl(null);
  const sd = tr.querySelector('[data-k="side"]');
  if (sd) sd.value = side === '敌方' ? '敌方' : '我方';
  const fl = tr.querySelector('[data-k="fleet"]');
  if (fl) fl.value = side === '敌方' ? '敌方1队' : '我方主队';
  tb.appendChild(tr);
  const ship = tr.querySelector('[data-k="ship"]');
  if (ship) ship.focus();
}

function renderBattleDetail() {
  const card = $('#batDetailCard');
  if (!S.curBattle) { card.classList.add('hide'); return; }
  card.classList.remove('hide');
  const b = S.battles.find(x => x.id === S.curBattle);
  $('#batTitle').textContent = b ? `战报 ${b.id}${b.opponent ? ' × ' + b.opponent : ''}` : '战报详情';

  const setv = (id, v) => { const el = $(id); if (el) el.value = (v === null || v === undefined) ? '' : v; };
  setv('#bmDate', b && b.date);
  setv('#bmOpponent', b && b.opponent);
  setv('#bmMode', b && b.mode);
  setv('#bmDuration', b && b.duration);
  setv('#bmNote', b && b.note);

  const rows = bRowsOf(S.curBattle);
  fleetDatalist(S.brows);
  const tb = $('#browBody');
  tb.innerHTML = '';
  rows.forEach(r => tb.appendChild(browRowEl(r)));
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.className = 'placeholder';
    tr.innerHTML = '<td colspan="13" class="muted">还没有明细，点右上「＋ 我方一行」/「＋ 敌方一行」直接在表格里填。</td>';
    tb.appendChild(tr);
  }
  $('#browNote').textContent = `本场共 ${rows.length} 条明细、${[...new Set(rows.map(fleetOf))].length} 支舰队。改动即时保存。`;

  fillFleetSelects(rows);
  renderBattleKinds(rows);
}

async function saveBatMeta() {
  if (!S.curBattle) { toast('先选一场战报', 'bad'); return; }
  const g = id => { const el = $(id); return el ? el.value.trim() : ''; };
  const body = {
    id: S.curBattle, date: g('#bmDate'), opponent: g('#bmOpponent'),
    mode: g('#bmMode'), duration: g('#bmDuration'), note: g('#bmNote')
  };
  try {
    const j = await api('/api/battles', {method: 'PUT', body: body});
    const nb = j.battle || body;
    const i = S.battles.findIndex(x => x.id === nb.id);
    if (i >= 0) S.battles[i] = nb; else S.battles.push(nb);
    renderBattles();
    $('#batTitle').textContent = `战报 ${nb.id}${nb.opponent ? ' × ' + nb.opponent : ''}`;
    toast('战报信息已保存', 'ok');
  } catch (e) {
    toast('保存失败：' + (e && e.message ? e.message : e), 'bad');
  }
}

async function deleteBat() {
  if (!S.curBattle) return;
  if (!askConfirm(S.curBattle, '删除战报 ' + S.curBattle + ' 及它的全部明细')) return;
  try {
    await api('/api/battles/' + S.curBattle, {method: 'DELETE', confirm: S.curBattle});
  } catch (e) {
    toast('删除失败：' + (e && e.message ? e.message : e), 'bad');
    return;
  }
  S.curBattle = null;
  await loadBattles();
}

function fillFleetSelects(rows) {
  const build = (sel, side, cur) => {
    const names = [...new Set(rows.filter(r => r.side === side).map(fleetOf))];
    sel.innerHTML = '';
    const o0 = document.createElement('option'); o0.value = '__all';
    o0.textContent = names.length ? '全部（' + names.length + ' 支）' : '全部';
    sel.appendChild(o0);
    names.forEach(n => {
      const o = document.createElement('option'); o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
    sel.value = names.indexOf(cur) >= 0 ? cur : '__all';
    if (sel.value === '__all') cur = '__all';
    sel.onchange = () => {
      if (side === '我方') S.bfMine = sel.value; else S.bfFoe = sel.value;
      renderBattleKinds();
    };
    return sel.value;
  };
  S.bfMine = build($('#bfMine'), '我方', S.bfMine);
  S.bfFoe = build($('#bfFoe'), '敌方', S.bfFoe);
}

function renderBattleKinds(rowsIn) {
  const rows = rowsIn || bRowsOf(S.curBattle);
  const pick = (side, keep) => rows.filter(r => r.side === side && (keep === '__all' || fleetOf(r) === keep));
  const mine = pick('我方', S.bfMine);
  const foe = pick('敌方', S.bfFoe);

  const acc = new Map();
  const bump = (kind, side, r) => {
    if (!acc.has(kind)) acc.set(kind, { mine: { d: 0, t: 0, q: 0, a: 0 }, foe: { d: 0, t: 0, q: 0, a: 0 } });
    const o = acc.get(kind)[side];
    o.d += dmgOf(r); o.t += bnum(r.taken); o.q += bnum(r.qty); o.a += aliveN(r);
  };
  mine.forEach(r => bump(shipKind(r.ship), 'mine', r));
  foe.forEach(r => bump(shipKind(r.ship), 'foe', r));

  const tb = $('#bkindBody');
  tb.innerHTML = '';
  if (!acc.size) {
    tb.innerHTML = '<tr><td colspan="9" class="muted">这一场还没有明细。</td></tr>';
    $('#bkindNote').textContent = '';
    return;
  }
  const fmt = v => v ? Math.round(v).toLocaleString() : '—';
  const survPct = o => (o.q ? Math.round(o.a / o.q * 100) + '%' : '—');
  const survCls = o => (o.q ? (o.a / o.q >= 0.5 ? 'good' : 'bad') : '');
  [...acc.entries()]
    .sort((x, y) => KIND_ORDER.indexOf(x[0]) - KIND_ORDER.indexOf(y[0]))
    .forEach(([kind, o]) => {
      const ratio = o.foe.d > 0 ? fmt(o.mine.d / o.foe.d, 2)
        : (o.mine.d > 0 ? '∞' : '—');
      const cls = o.foe.d > 0 ? (o.mine.d / o.foe.d >= 1 ? 'good' : 'bad') : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="kcell">${memEsc(kind)}</td>
        <td>${fmt(o.mine.d)}</td><td>${fmt(o.foe.d)}</td>
        <td class="${cls}">${ratio}</td>
        <td>${fmt(o.mine.t)}</td><td>${fmt(o.foe.t)}</td>
        <td>${o.mine.q || '—'}</td><td>${o.foe.q || '—'}</td>
        <td class="${survCls(o.mine)}">${survPct(o.mine)}</td>`;
      tb.appendChild(tr);
    });

  const sum = side => acc.size ? [...acc.values()].reduce((a, o) => a + o[side].d, 0) : 0;
  const md = sum('mine'), fd = sum('foe');
  $('#bkindNote').textContent = `所选组合合计：我方 ${Math.round(md).toLocaleString()} / 敌方 ${Math.round(fd).toLocaleString()}`
    + (fd > 0 ? `，总交换比 ${(md / fd).toFixed(2)}` : '')
    + '。存活率 = 存活数量 ÷ 数量合计（同一行可以只死一部分）。'
    + '分舰种看才有意义——超主力舰单价远高于舰载机，混在一起的平均值会被带偏。';
}

function renderBattleStats() {
  const tb = $('#bstatsBody');
  const map = new Map();
  S.brows.forEach(r => {
    if (r.side !== '我方' || !r.ship) return;
    const k = r.ship;
    if (!map.has(k)) map.set(k, { ship: k, kind: shipKind(k), battles: new Set(), dmg: 0, alive: 0, qty: 0 });
    const o = map.get(k);
    o.battles.add(r.battle);
    o.dmg += dmgOf(r);
    o.qty += bnum(r.qty) || 1;
    o.alive += aliveN(r);
  });
  tb.innerHTML = '';
  if (!map.size) {
    tb.innerHTML = '<tr><td colspan="6" class="muted">还没有我方明细。</td></tr>';
    return;
  }
  [...map.values()].sort((x, y) => y.dmg - x.dmg).forEach(o => {
    const n = o.battles.size;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${memEsc(o.ship)}</td><td class="kcell">${memEsc(o.kind)}</td><td>${n}</td>
      <td>${o.dmg.toLocaleString()}</td><td>${(o.dmg / n).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
      <td>${o.qty ? (o.alive / o.qty * 100).toFixed(0) + '%' : '—'}</td>`;
    tb.appendChild(tr);
  });
  applyBattleReadonly();
}

async function loadBattles() {
  const note = document.getElementById('batNote');
  if (note) note.textContent = '加载中…';
  try {
    const j = await api('/api/battles');
    S.battles = j.battles || [];
    S.brows = j.rows || [];
    renderBattles();
    renderBattleDetail();
    renderBattleStats();
    fillShipNames();
    if (note) note.textContent = '已载入 ' + S.battles.length + ' 场战报、' + S.brows.length + ' 条明细';
  } catch (e) {
    if (note) note.textContent = '加载失败：' + (e && e.message ? e.message : e);
    throw e;
  }
}

function fillShipNames() {
  const dl = $('#shipNames');
  const list = (S.bp && S.bp.ships) || [];
  if (!dl || !list.length) return;
  dl.innerHTML = list.map(s => `<option value="${memEsc(s.name)}">${memEsc(s.kind || '')}</option>`).join('');
}

function nextBattleId() {
  const nums = S.battles.map(b => {
    const m = /^B(\d+)$/.exec(String(b.id || ''));
    return m ? Number(m[1]) : 0;
  });
  const n = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  return 'B' + String(n).padStart(3, '0');
}

async function newBattle() {
  const body = {
    id: nextBattleId(), date: new Date().toISOString().slice(0, 10),
    opponent: '', mode: '舰队战', duration: '', note: ''
  };
  try {
    const j = await api('/api/battles', {method: 'PUT', body: body});
    S.curBattle = j.battle.id;
    S.bfMine = '__all'; S.bfFoe = '__all';
    await loadBattles();
    const f = $('#bmOpponent');
    if (f) f.focus();
    toast('已新建 ' + j.battle.id + '，先在下面填对手，再逐行加明细', 'ok');
  } catch (e) {
    toast('新建失败：' + (e && e.message ? e.message : e), 'bad');
  }
}

function bindBattle() {
  $('#batNew').onclick = () => newBattle();
  $('#batReload').onclick = () => {
  if (!confirmLeaveDraft()) return;      /* 有没保存的明细行先问一句，避免刷新吞掉 */
  loadBattles().catch(e => toast(String(e.message || e), 'bad'));
};
  const a1 = $('#browAdd'); if (a1) a1.onclick = () => addBrow('我方');
  const a2 = $('#browAddFoe'); if (a2) a2.onclick = () => addBrow('敌方');
  const ap = $('#browPaste'); if (ap) ap.onclick = () => openBrowPaste();
  const bm = $('#bmSave'); if (bm) bm.onclick = () => saveBatMeta();
  const bd = $('#batDel'); if (bd) bd.onclick = () => deleteBat();
}

/* ---------- 批量粘贴明细（从游戏里复制一段，直接贴成多行） ---------- */
const TSV_COLS = ['阵营', '舰队', '舰船', '数量', '结构伤害', '系统伤害', '对空', '维修', '承受', '存活数', '备注'];

function openBrowPaste() {
  const dlg = document.getElementById('tsvDlg');
  if (!dlg) return;
  if (!S.curBattle) return toast('先在上面选一场战报，再批量粘贴', 'bad');
  const t = document.getElementById('tsvText'); if (t) t.value = '';
  const n = document.getElementById('tsvNote');
  if (n) n.textContent = '列顺序：' + TSV_COLS.join(' / ')
    + '（制表符分隔；只要前 5 列也能用，后面空着按 0 算；首行如果是表头会自动跳过）';
  dlg.showModal();
}

function tsvSplit(line) {
  if (line.indexOf('\t') >= 0) return line.split('\t');
  return line.split(/\s{2,}/);
}

async function applyBrowPaste() {
  const box = document.getElementById('tsvText');
  const txt = (box && box.value || '').trim();
  if (!txt) return toast('先把内容贴进框里', 'bad');
  if (!S.curBattle) return toast('先选一场战报', 'bad');
  const rows = [];
  txt.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const c = tsvSplit(line).map(x => (x || '').trim());
    if (/^(阵营|side)$/i.test(c[0] || '')) return;
    const side = (c[0] || '').indexOf('敌') >= 0 ? '敌方' : '我方';
    const n = i => { const v = parseFloat((c[i] || '').replace(/[^\d.\-]/g, '')); return isNaN(v) ? 0 : v; };
    const qty = n(3);
    // 第 10 列既接受数字（存活几架），也接受「是 / 否」
    const rawAlive = (c[9] || '').replace(/\s/g, '');
    let aliveN = null;
    if (/^(是|y|yes|√|1)$/i.test(rawAlive)) aliveN = qty;
    else if (/^(否|n|no|×|0)$/i.test(rawAlive)) aliveN = 0;
    else if (rawAlive !== '') aliveN = n(9);
    rows.push({
      battle: S.curBattle, side: side,
      fleet: c[1] || (side === '我方' ? '我方主队' : '敌方1队'),
      ship: c[2] || '',
      qty: qty, dmg_struct: n(4), dmg_sys: n(5), dmg_air: n(6),
      repair: n(7), taken: n(8),
      alive_n: aliveN,
      alive: aliveN === null ? '' : (qty && aliveN >= qty ? '是' : (aliveN === 0 ? '否' : '')),
      note: c[10] || ''
    });
  });
  const use = rows.filter(r => r.ship);
  if (!use.length) return toast('没解析出有效行（第 3 列要是舰船名）', 'bad');
  let ok = 0, bad = 0;
  for (const r of use) {
    try { await api('/api/battle_rows', { method: 'PUT', body: r }); ok++; } catch (e) { bad++; }
  }
  const dlg = document.getElementById('tsvDlg');
  if (dlg) dlg.close();
  await loadBattles();
  toast('粘贴导入 ' + ok + ' 行' + (bad ? '，失败 ' + bad + ' 行' : '') +
        (rows.length > use.length ? '，跳过 ' + (rows.length - use.length) + ' 行（没有舰船名）' : ''),
        bad ? 'warn' : 'good');
}


/* ---------- 绑定 ---------- */
function showTab(tab) {
  const cur = document.querySelector('nav button.on');
  if (cur && cur.dataset.tab === 'battle' && tab !== 'battle' && !confirmLeaveDraft()) return;
  const btns = [...document.querySelectorAll('nav button')];
  const b = btns.find(x => x.dataset.tab === tab);
  if (!b) { diag('showTab ' + tab + ': NO SUCH BUTTON'); return; }
  diag('click ' + tab + ' | perm=' + permOf(b) + ' | can=' + can(permOf(b)));
  if (!can(permOf(b))) { diag('click ' + tab + ' BLOCKED: no perm ' + permOf(b)); return; }
  S.tab = tab;
  btns.forEach(x => x.classList.toggle('on', x === b));
  const panes = [...document.querySelectorAll('main > section')];
  panes.forEach(pn => pn.classList.toggle('hide', pn.id !== 'tab-' + tab));
  const pb = document.getElementById('tab-' + tab);
  diag('click ' + tab + ' | panes=' + panes.length + ' | pane=' + (pb ? 'yes' : 'NO-EL') +
       ' | hidden=' + (pb ? pb.classList.contains('hide') : '?'));
  if (tab === 'sim') renderPlanes();
  if (tab === 'data') { renderData(); renderAudit(); }
  if (tab === 'roster') loadRosterQuery();
  if (tab === 'rosterM') loadRosterAdmin();
  if (tab === 'people' && S.user) { loadUsers(); loadPwdReqs(); }
  if (tab === 'audit') loadAudit();
  if (tab === 'battle') {
    loadBattles()
      .then(() => diag('battle: loaded ' + S.battles.length + ' battles / ' + S.brows.length + ' rows'))
      .catch(e => diag('battle LOAD ERR: ' + (e && e.message ? e.message : e)));
  }
  /* 把当前页签写进地址栏：刷新 / 收藏 / 发链接都能回到这一页 */
  try {
    const u = new URL(location.href);
    u.searchParams.set('tab', tab);
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  } catch (e) {}
}

/* 用事件委托绑定：即使按钮被重建或 onclick 被覆盖也仍然有效 */
document.addEventListener('click', ev => {
  const t = ev.target;
  const b = t && t.closest ? t.closest('nav button') : null;
  if (!b) return;
  diag('raw click tab=' + b.dataset.tab);
  showTab(b.dataset.tab);
}, true);

$('#resetAlloc').onclick = () => {
  const ship = shipOf(S.slots[S.cur].ship);
  const sy = ship.systems.find(x => x.id === S.sys[S.cur]);
  if (sy) sy.nodes.forEach(nd => delete S.slots[S.cur].alloc[nd.id]);
  renderTree(); recalc(S.cur);
};
$('#saveBuild').onclick = async () => {
  if (!S.user) return toast('先登录再保存方案', 'bad');
  const sl = S.slots[S.cur];
  const name = prompt('方案名称', '方案 ' + S.cur); if (!name) return;
  try { await api('/api/builds', {method: 'POST', body: {ship: sl.ship, name,
    modules: sl.modules, alloc: sl.alloc, planes: sl.planes}}); toast('已保存', 'good'); }
  catch (e) { toast('保存失败：' + e.message, 'bad'); }
};
bindRoster();
bindHistory();
bindBattle();
(function bindPermUi() {
  renderPermBox();
})();
$('#entSel').onchange = e => { S.ent = e.target.value; renderData(); };
$('#entQ').oninput = e => { S.entQ = e.target.value; renderData(); };
$('#auShip').onchange = e => { S.auShip = e.target.value; renderAudit(); };
$('#auQ').oninput = e => { S.auQ = e.target.value; renderAudit(); };
$('#auPending').onchange = () => renderAudit();
{ const sc = $('#auShowChecked'); if (sc) sc.onchange = () => renderAudit(); }
$('#auSave').onclick = saveAudit;
$('#auCsv').onclick = exportNodeCsv;
$('#auCsv').classList.toggle('hide', !can('export'));

$('#newEnt').onclick = () => {
  if (S.ent === 'ships') return toast('舰船请用「问卷式录入舰船」：它会连带把系统、节点、模块一起建好', 'bad');
  openEnt(null);
};
$('#expJson').onclick = exportJson;
$('#expJson').classList.toggle('hide', !can('export'));
$('#entForm').onsubmit = submitEnt;
/* 注意：不要直接写 onclick = wizStart —— 浏览器会把 PointerEvent 当第一个参数传进去，
   被误判成「要编辑的 id」，于是弹「找不到这艘船 id=[object PointerEvent]」。 */
$('#wizBtn').onclick = () => wizStart();
$('#wizPrev').onclick = () => { if (WIZ && WIZ.step > 0) { WIZ.step--; wizRender(); } };
$('#wizSkip').onclick = () => { if (WIZ && WIZ.step < 5) { WIZ.step++; wizRender(); } };
$('#wizClose').onclick = () => $('#wizDlg').close();
/* 任何一步都能退出：填过东西才确认一句，什么都没填就直接关 */
function wizQuit() {
  if (!WIZ) { $('#wizDlg').close(); return; }
  const touched = (WIZ.ship && (WIZ.ship.name || '').trim())
    || (WIZ.systems || []).length || (WIZ.nodes || []).length || (WIZ.modules || []).length;
  if (touched && !confirm('退出后，这一轮填的内容都不保存（数据库不会变）。确定退出吗？')) return;
  $('#wizDlg').close();
}
$('#wizExit').onclick = wizQuit;
/* ESC / 点遮罩关掉之后，把半成品状态清掉，免得下次「下一步」读旧数据 */
$('#wizDlg').addEventListener('close', () => { WIZ = null; });
$('#wizNext').onclick = () => {
  if (!WIZ) return;
  if (WIZ.step === 5) return wizSave();
  if (WIZ.step === 0 && !(WIZ.ship.name || '').trim()) return toast('先填舰船名称', 'bad');
  WIZ.step++; wizRender();
};
$('#loginBtn').onclick = login;
$('#lp').onkeydown = e => { if (e.key === 'Enter') login(); };
$('#searchBtn').onclick = () => loadUsers($('#uq').value.trim());
/* ---------- 改密码 / 重置申请 ---------- */
let PWD_FORCED = false;

function openPwdDlg(force) {
  const d = $('#pwdDlg');
  PWD_FORCED = false;
  const f = $('#pwdForm');
  f.reset();
  $('#pwdTitle').textContent = force ? '请先设置新密码' : '修改密码';
  $('#pwdHint').textContent = force
    ? (S.user && S.user.must_change
        ? '管理员已为你重置密码，这是一次性临时密码。设置新密码后才能继续使用系统。'
        : '请设置新密码。')
    : '改完之后旧密码立即失效，其他设备需要重新登录。';
  $('#pwdCancel').classList.toggle('hide', !!force);
  const quit = $('#pwdQuit');
  quit.classList.toggle('hide', !force);
  quit.onclick = () => {
    if (!force || confirm('不设置新密码就直接退出登录？下次登录还要先改密码。')) doLogout('已退出登录');
  };
  $('#pwdCancel').onclick = () => { try { d.close(); } catch (e) {} };
  d.showModal();
  PWD_FORCED = !!force;
  setTimeout(() => { try { f.old.focus(); } catch (e) {} }, 30);
  d.oncancel = ev => {
    if (!PWD_FORCED) return;                 // 自助改密：ESC 直接关掉，不填也能退
    ev.preventDefault();                     // 强制改密：ESC 不关窗，退出只能点「退出登录」
  };
}

async function submitPwd(ev) {
  ev.preventDefault();
  const f = $('#pwdForm');
  const oldv = f.old.value, nw = f.new.value, ag = f.again.value;
  if (nw !== ag) { toast('两次输入的新密码不一样', 'bad'); return; }
  if (nw.length < 6) { toast('新密码至少 8 位', 'bad'); return; }
  try {
    const j = await api('/api/me/password', {method: 'POST', body: {old: oldv, new: nw}});
    S.user = j.user || S.user;
    if (S.user) S.user.must_change = 0;
    $('#pwdDlg').close();
    toast('密码已更新', 'good');
    if (PWD_FORCED) { PWD_FORCED = false; location.reload(); }
  } catch (e) { toast('改密失败：' + e.message, 'bad'); }
}

async function loadPwdReqs() {
  if (!can('people_view')) return;
  const body = $('#pwdReqBody'); if (!body) return;
  let list = [];
  try { list = (await api('/api/pwd/requests')).requests || []; }
  catch (e) { $('#pwdReqNote').textContent = '读取失败：' + e.message; return; }
  body.innerHTML = '';
  const stTag = st => ({'待处理': 'warn', '已批准': 'good', '已驳回': 'bad'})[st] || '';
  const pend = list.filter(r => (r.status || '') === '待处理');
  list = pend;   // 审批完的（已批准/已驳回）不再列出，历史去「操作日志」看
  if (!pend.length) {
    const tr = el('tr');
    const td = el('td', 'muted', '暂无待处理的申请。');
    td.colSpan = 7;
    tr.appendChild(td);
    body.appendChild(tr);
  }
  list.forEach(r => {
    const tr = el('tr');
    tr.appendChild(el('td', '', String(r.id)));
    tr.appendChild(el('td', '', r.username || ''));
    tr.appendChild(el('td', '', (r.note || '') + (r.reason ? '｜' + r.reason : '')));
    const td = el('td'); td.appendChild(el('span', 'pill ' + stTag(r.status), r.status)); tr.appendChild(td);
    tr.appendChild(el('td', '', r.created_at || ''));
    tr.appendChild(el('td', '', r.handled_by || ''));
    const op = el('td');
    if (r.status === '待处理') {
      const ok = el('button', 'btn', '批准');
      ok.onclick = async () => {
        const pw = prompt('给 ' + r.username + ' 的临时密码（至少 8 位，登录后会被强制修改）', 'tmp' + Math.random().toString(36).slice(2, 8));
        if (pw === null) return;
        if (pw.trim().length < 6) return toast('临时密码至少 8 位', 'bad');
        try { await api('/api/pwd/requests/' + r.id + '/approve', {method: 'POST', body: {password: pw.trim()}});
          toast('已批准：' + r.username + ' 的临时密码是 ' + pw.trim(), 'good'); loadPwdReqs();
        } catch (e) { toast('失败：' + e.message, 'bad'); }
      };
      const no = el('button', 'btn ghost', '驳回'); no.style.marginLeft = '6px';
      no.onclick = async () => {
        const note = prompt('驳回理由（会记进日志）', '信息对不上');
        if (note === null) return;
        try { await api('/api/pwd/requests/' + r.id + '/reject', {method: 'POST', body: {note}});
          toast('已驳回', 'good'); loadPwdReqs();
        } catch (e) { toast('失败：' + e.message, 'bad'); }
      };
      op.append(ok, no);
    }
    tr.appendChild(op);
    body.appendChild(tr);
  });
  $('#pwdReqNote').textContent = '待处理 ' + pend.length + ' 条。审批完的申请不再显示；批准后临时密码只显示这一次，请转告本人。';
}

$('#addUserBtn').onclick = () => openUserDlg(null);
$('#auditBtn').onclick = () => showTab('audit');
$('#userForm').onsubmit = submitUser;
$('#pwdForm').onsubmit = submitPwd;
$('#pwdReqBtn').onclick = loadPwdReqs;

/* ---- 操作日志页签 ---- */
(function bindAuditTab() {
  const ak = document.getElementById('auditKind');
  if (ak) ak.onchange = () => loadAudit();
  const sp = document.getElementById('auditSavePolicy');
  if (sp) sp.onclick = saveAuditPolicy;
  const pn = document.getElementById('auditPrune');
  if (pn) pn.onclick = pruneAuditNow;
  const ex = document.getElementById('auditExport');
  if (ex) ex.onclick = exportAuditCsv;
  const rl = document.getElementById('auditReload');
  if (rl) rl.onclick = () => loadAudit();
  const q = document.getElementById('auditQ');
  if (!q) return;
  let t = 0;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => { S.auditQ = q.value; loadAudit(); }, 220);
  };
})();


/* ---- 舰船搜索：过滤 + 清空 + 回车跳到第一条匹配 + 「/」聚焦 ---- */
(function bindShipFilter() {
  const sf = document.getElementById('shipFilter');
  if (!sf) return;
  const clr = document.getElementById('shipClear');
  const hit = document.getElementById('shipHit');

  function refresh() {
    S.shipQ = sf.value;
    const sl = S.slots[S.cur];
    fillShipSelect(sl, (sl && sl.pick) || '');
    const sel = document.getElementById('shipSel');
    const n = sel ? [...sel.options].filter(o => o.value).length : 0;
    const q = (sf.value || '').trim();
    if (clr) clr.classList.toggle('hide', !q);
    if (hit) {
      hit.textContent = q ? (n ? '匹配 ' + n : '无匹配') : '';
      hit.style.color = (q && !n) ? '#f87171' : '';
    }
  }

  function firstMatch() {
    const q = (sf.value || '').trim().toLowerCase();
    if (!q) return null;
    const sel = document.getElementById('shipSel');
    if (!sel) return null;
    return [...sel.options].find(o => o.value && (o.textContent || '').toLowerCase().indexOf(q) >= 0) || null;
  }

  sf.addEventListener('input', refresh);
  sf.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const o = firstMatch();
      const sel = document.getElementById('shipSel');
      if (o && sel) {
        if (o.value !== S.slots[S.cur].ship) { sel.value = o.value; sel.onchange(); }
        sf.blur();
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      sf.value = ''; refresh();
    }
  });
  if (clr) clr.onclick = () => { sf.value = ''; refresh(); sf.focus(); };
  document.addEventListener('keydown', ev => {
    const tag = (ev.target && ev.target.tagName) || '';
    if (ev.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault(); sf.focus(); sf.select();
    }
  });
  refresh();
})();

/* ---- A/B 工具 ---- */
(function bindAbTools() {
  const c = document.getElementById('abCopy');
  if (c) c.onclick = () => { try { abCopy(); } catch (e) { toast('复制失败：' + e.message, 'bad'); } };
  const s = document.getElementById('abSwap');
  if (s) s.onclick = () => { try { abSwap(); } catch (e) { toast('交换失败：' + e.message, 'bad'); } };
  const d = document.getElementById('abDiff');
  if (d) d.onchange = () => renderResults();
})();

/* ---- 批量粘贴对话框 ---- */
(function bindTsv() {
  const c = document.getElementById('tsvCancel');
  if (c) c.onclick = () => { const d = document.getElementById('tsvDlg'); if (d) d.close(); };
  const g = document.getElementById('tsvGo');
  if (g) g.onclick = () => applyBrowPaste();
})();

(async function boot() {
  if (!S.token) { goLogin(); return; }
  /* 先把地址栏的页签记下来：后面 renderEditor() 会调 syncUrl() 重写地址栏，
     不提前捕获的话，刷新后会被改回默认的「舰船数据」。 */
  const wantTabBoot = (new URLSearchParams(location.search).get('tab') || '').trim();
  if (wantTabBoot) S.tab = wantTabBoot;
  try {
    const j = await api('/api/me');
    S.user = j.user;
    S.csrf = j.csrf || '';
  } catch (e) {
    S.token = ''; localStorage.removeItem('ft_token');
    goLogin('登录已过期，请重新登录');
    return;
  }
  whoami();
  if (S.user && Number(S.user.must_change)) { openPwdDlg(true); return; }
  renderSlotTabs();
  await loadBlueprints(true);
  // 地址栏还原：?slot=b&ship=xxx&sys=yyy —— 收藏或发给别人能回到同一处
  try {
    const p = new URLSearchParams(location.search);
    const ss = (p.get('slot') || '').trim().toUpperCase();
    if (SLOTS.indexOf(ss) >= 0) S.cur = ss;
    const sShip = p.get('ship');
    const sl = S.slots[S.cur];
    if (sShip && sl && shipOf(sShip)) {
      sl.ship = sShip;
      sl.alloc = {};
      sl.modules = {};
      sl.planes = [];
      sl.carrierMods = undefined;
    }
    const sSys = p.get('sys');
    if (sSys) S.sys[S.cur] = sSys;
    renderSlotTabs();
    renderEditor();
    SLOTS.forEach(recalc);
  } catch (e) {}
  renderPlanes(); renderData();
  connectStream();
  if (S.user && can('people_view')) { loadUsers(); loadPwdReqs(); }
  markBase();
  refreshBuilds();
  diag('boot | role=' + (S.user && S.user.role) + ' | perms=' + myPerms().join(',') +
       ' | sections=' + document.querySelectorAll('main > section').length +
       ' | battlePane=' + (document.getElementById('tab-battle') ? 'yes' : 'NO-EL'));
  if (wantTabBoot) {
    const tb = [...document.querySelectorAll('nav button')].find(b => b.dataset.tab === wantTabBoot);
    if (tb && can(permOf(tb))) setTimeout(() => tb.click(), 0);
    else S.tab = 'sim';   /* 没这个页签或没权限：回默认 */
  }
})();

/* ================= 已存方案 · 撤销 · 离开提醒 ================= */
S.builds = []; S.undo = []; S.dirty = false; S.base = '';

function markBase() { try { S.base = JSON.stringify(S.slots); S.dirty = false; } catch (e) {} }

function snap() {
  try {
    const cur = JSON.stringify(S.slots);
    const top = S.undo[S.undo.length - 1];
    if (cur !== top) {
      S.undo.push(cur);
      if (S.undo.length > 60) S.undo.shift();
    }
    setTimeout(() => {
      try { S.dirty = (JSON.stringify(S.slots) !== S.base); } catch (e) {}
    }, 0);
  } catch (e) {}
}

function repaintAll() {
  try { renderSlotTabs(); } catch (e) {}
  try { renderEditor(); } catch (e) {}
  try { renderSystems(); } catch (e) {}
  try { renderTree(); } catch (e) {}
  try { renderPlanes(); } catch (e) {}
  try { recalc(S.cur); } catch (e) {}
}

function undoStep() {
  if (!S.undo.length) return toast('没有可撤销的改动', 'warn');
  const prev = S.undo.pop();
  try { S.slots = JSON.parse(prev); } catch (e) { return; }
  S.dirty = true;
  repaintAll();
  toast('已撤销一步', 'warn');
}

async function refreshBuilds() {
  const sel = $('#buildSel');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '';
  sel.appendChild(el('option', '', '（已存方案）'));
  if (!S.user) {
    const o = el('option', '', '登录后可载入方案'); o.value = ''; sel.appendChild(o);
    return;
  }
  try {
    const j = await api('/api/builds');
    S.builds = j.builds || [];
    if (!S.builds.length) {
      const o = el('option', '', '还没有保存过方案'); o.value = ''; sel.appendChild(o);
      return;
    }
    S.builds.forEach(b => {
      const o = el('option', '', b.name + ' · ' + (b.ship || '')); o.value = String(b.id);
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
  } catch (e) {
    const o = el('option', '', '读取失败：' + e.message); o.value = ''; sel.appendChild(o);
  }
}

function applyBuild(b) {
  const sl = S.slots[S.cur];
  const P = v => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return null; }
  };
  sl.ship = b.ship || sl.ship;
  sl.modules = P(b.modules) || {};
  sl.alloc = P(b.alloc) || {};
  sl.planes = P(b.planes) || [];
  S.sys[S.cur] = '';
  S.undo = [];
  markBase();
  repaintAll();
  toast('已载入方案「' + b.name + '」到当前这一套', 'good');
}

$('#loadBuild').onclick = () => {
  const id = $('#buildSel').value;
  if (!id) return toast('先在下拉里选一个已存方案', 'warn');
  const b = (S.builds || []).find(x => String(x.id) === String(id));
  if (!b) return toast('这条方案不在当前列表里，刷新一下再试', 'bad');
  if (S.dirty && !confirm('当前改动还没保存，确定用已存方案覆盖吗？')) return;
  applyBuild(b);
};

$('#delBuild').onclick = async () => {
  const id = $('#buildSel').value;
  if (!id) return toast('先在下拉里选一个已存方案', 'warn');
  if (!confirm('删除这条已存方案？不影响当前页面上的编辑。')) return;
  try { await api('/api/builds/' + id, {method: 'DELETE'}); toast('已删除', 'good'); refreshBuilds(); }
  catch (e) { toast('删除失败：' + e.message, 'bad'); }
};

$('#undoBtn').onclick = undoStep;

['click', 'change', 'input'].forEach(ev => {
  document.addEventListener(ev, e => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#tab-sim') && !t.closest('#buildSel') && !t.closest('#loadBuild') && !t.closest('#delBuild')) snap();
  }, true);
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    e.preventDefault(); undoStep();
  }
});

window.addEventListener('beforeunload', e => {
  if (!S.dirty) return;
  e.preventDefault(); e.returnValue = '';
});

$('#saveBuild').addEventListener('click', () => { setTimeout(() => { markBase(); refreshBuilds(); }, 300); });
$('#loginBtn').addEventListener('click', () => { setTimeout(refreshBuilds, 600); });


/* 版本发布弹窗（幂等绑定） */
(function bindVerDlg() {
  const d = $('#verDlg'); if (!d) return;
  $('#verCancel').onclick = () => d.close();
  $('#verOk').onclick = () => publishVer();
  $('#verLabel').addEventListener('keydown', e => { if (e.key === 'Enter') publishVer(); });
})();

/* 轨迹抽屉：加载更多 / 复制 ID（幂等绑定） */
(function bindHistExtras() {
  const more = document.getElementById('histMore');
  if (more && !more.dataset.bound) { more.dataset.bound = '1'; more.onclick = () => loadHistory(true); }
  const cid = document.getElementById('histCopyId');
  if (cid && !cid.dataset.bound) {
    cid.dataset.bound = '1';
    cid.onclick = () => {
      if (!HIST_ID) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(HIST_ID).then(() => toast('已复制档案 ID：' + HIST_ID, 'good')).catch(() => {});
      } else { toast('档案 ID：' + HIST_ID, ''); }
    };
  }
})();
