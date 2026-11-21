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
function hasBaySys(ship) {
  return ((ship && ship.systems) || []).some(sy =>
    ((sy.bays || []).length) ||
    (+((sy.norm || {}).bay_plane) || 0) || (+((sy.norm || {}).bay_boat) || 0) ||
    (+((sy.norm || {}).bay_drone) || 0));
}

function canMod(ship) {
  if (!ship) return false;
  if (typeof ship.mod_ok === 'boolean') return ship.mod_ok;
  return ship.kind === '超主力舰';
}

/* 浏览器密码管理器会把登录页保存的账号填进页面第一个文本框（就是「找船」那一格），
   值正好等于当前账号时按「没填」处理 —— 否则一进页面就被过滤成只剩一艘船。 */
function isAccountFilled(v, u) {
  const t = String(v || '').trim().toLowerCase();
  if (!t || !u) return false;
  return t === String(u.name || '').trim().toLowerCase()
      || t === String(u.username || '').trim().toLowerCase();
}

/* 母舰上所有「带舱位」的搭载位：模块（mkind）+ 系统（新数据把 bays 直接写在系统上）
   两者都用 id 标识，勾选 / 载荷都用同一个列表 */
function carrierModsOf(ship) {
  const out = (((ship && ship.modules) || []).filter(m => m.mkind)).map(m => m.id);
  ((ship && ship.systems) || []).forEach(sy => {
    if (sysHasBayJs(sy) && !out.includes(sy.id)) out.push(sy.id);
  });
  return out;
}
/* 按 id 找搭载位：先模块后系统（新数据没有模块，舱位挂在系统上） */
function holderOf(ship, id) {
  if (!ship || !id) return null;
  return ((ship.modules || []).find(m => m.id === id))
      || ((ship.systems || []).find(sy => sy.id === id)) || null;
}
/* 搭载位的舱位列表：bays 优先；没有就按 mkind / stats_norm 的 bay_* 合成 */
function baysOfHolder(h) {
  if (!h) return [];
  if (Array.isArray(h.bays) && h.bays.length) return h.bays;
  if (h.mkind) return [{kind: (h.mkind || '').replace('搭载系统', ''), cap: h.cap,
                        allow_group: h.allow_group}];
  const n = h.norm || {};
  const out = [];
  if (+(n.bay_plane) > 0) out.push({kind: '战机', cap: +n.bay_plane, allow_group: ''});
  if (+(n.bay_boat) > 0) out.push({kind: '护航艇', cap: +n.bay_boat, allow_group: ''});
  return out;
}

/* 勾选状态自愈：
   - 第一次进「舰载机组合」→ 全勾上，免得空着像「选不了」；
   - 已经在勾了，问卷里又新加了舱位 → 只把新冒出来的自动勾上，手动取消过的保持不动。
   返回 true 表示勾选变了（调用方要重算）。 */
function seedCarrierMods(sl, ship) {
  const all = carrierModsOf(ship);
  const seen = sl._modSeen || null;
  sl._modSeen = all.slice();
  const before = (sl.carrierMods || []).slice();
  let cur = before.filter(id => all.includes(id));
  if (seen === null) cur = all.slice();
  else all.forEach(id => { if (!seen.includes(id) && !cur.includes(id)) cur.push(id); });
  const changed = cur.length !== before.length || cur.some((id, i) => id !== before[i]);
  sl.carrierMods = cur;
  return changed;
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
function groupOk(pg, allow, kind) {
  if (kind && String(kind) !== '战机') return true;   /* 护航艇 / 无人机没有大、中编组之分 */
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

/* 舱位卡上怎么称呼「编组限制」：只有战机分大 / 中编组，护航艇、无人机没这个说法。 */
/* 系统的舱位：新数据写在 systems.bays 上，旧数据只落在对应 modules.bays 里，两边都认 */
function wizBaysOf(sy, mod) {
  const pick = b => ({kind: b.kind || '', cap: +b.cap || 0, allow_group: b.allow_group || ''});
  const own = (sy && sy.bays) || [];
  if (own.length) return own.map(pick);
  const mb = (mod && mod.bays) || [];
  return Array.isArray(mb) ? mb.map(pick) : [];
}
/* 系统 → 它对应的模块行（唯一口径，别再各处各写一套）。
   先按 sys 精确匹配；老数据的 modules.sys 是 NULL（server.py:489 才补的列），
   退到「同船 + 同槽位」（槽位每条船唯一）；最后才比名字（模块名不一定等于系统名）。 */
function modOfSys(sh, sy) {
  if (!sh || !sy) return null;
  const list = (sh.modules || []).filter(m => !m.ship || String(m.ship) === String(sh.id || ''));
  return list.find(m => m.sys && m.sys === sy.id)
    || list.find(m => m.slot && sy.slot && m.slot === sy.slot)
    || list.find(m => m.name && m.name === sy.name)
    || null;
}
function bayGroupText(kind, allow) {
  if (String(kind || '') !== '战机') return '不分编组';
  const g = String(allow || '').split(/[,，/]/).map(x => x.trim()).filter(Boolean)[0] || '';
  return g || '不限';
}
function mk() { return {ship: null, noCarrier: false, modules: {}, alloc: {}, planes: [],
  palloc: {}, psys: {}, carrierMods: undefined}; }

let _toastLast = '', _toastAt = 0;
function toast(msg, kind = '') {
  const now = Date.now();
  if (msg === _toastLast && now - _toastAt < 6000) return;   /* 403 风暴时不刷屏 */
  _toastLast = msg; _toastAt = now;
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
    const err = new Error(j.error || ('HTTP ' + r.status));
    err.status = r.status;
    err.code = j.code || '';
    err.perm = (r.status === 403);          /* 权限不足，调用方据此停止重试 */
    throw err;
  }
  return j;
}

/* ---------- 版本标签（超级管理员可发布） ---------- */
function renderVerTag() {
  const t = $('#verTag');
  if (!t) return;
  const p = S.pub || {};
  const isTop = !!(S.user && S.user.role === 'superadmin');
  if (!isTop) {                       /* 版本号是排障信息，只给超管看 */
    t.classList.add('hide');
    t.textContent = '';
    return;
  }
  t.classList.remove('hide');
  const label = p.label || ('v' + (p.version || 0));
  const pending = Math.max(0, (p.version || 0) - (p.num || 0));
  var fe = String(window.__APP_VER || '').replace(/^\d{4}-\d{2}-\d{2}\./, '.');
  t.textContent = '数据版本 ' + label + (isTop && pending ? ' · 未发布 ' + pending : '')
    + (fe ? ' · 前端 ' + fe : '');
  t.title = '前端 app.js ' + (window.__APP_VER || '');
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
/* 只在「这条船还在不在库里」时用：含弃用船（弃用的船仍能正常计算） */
const shipAnyOf = id => ((S.bp.shipsAll || S.bp.ships || []).find(s => s.id === id));

async function loadBlueprints(silent) {
  try {
    const j = await api('/api/blueprints');
    S.bp = j; S.version = j.version; S.pub = j.pub || null;
    /* 弃用/重复的旧船不进选船下拉；数据管理里仍然看得到（shipsAll） */
    S.bp.shipsAll = (j.ships || []).slice();
    S.bp.ships = (j.ships || []).filter(s => !(+s.deprecated || 0));
    renderVerTag();
    const allIds = new Set((j.ships || []).map(x => x.id));
    const firstShip = (j.ships || []).find(x => !(+x.deprecated || 0)) || (j.ships || [])[0];
    SLOTS.forEach(k => {
      const sl = S.slots[k];
      /* 这条船被删掉了（含启动时去重删掉的重复船）：换成第一艘可用的，别让后面每次计算都报错 */
      if (!sl.ship || !allIds.has(sl.ship)) {
        sl.ship = firstShip ? firstShip.id : '';
        sl.noCarrier = false; sl.modules = {}; sl.alloc = {}; sl.planes = [];
        if (S.results) delete S.results[k];
      }
      if (!sl.ship) sl.ship = '';
    });
    const _sh0 = S.slots[S.cur] && shipOf(S.slots[S.cur].ship);
    const _sy0 = ((_sh0 && _sh0.systems) || [])[0];
    S.sys[S.cur] = S.sys[S.cur] || (_sy0 ? _sy0.id : '');
    renderEditor();
    SLOTS.forEach(recalc);
    if (!silent) toast('数据已刷新 v' + j.version, 'good');
  } catch (e) {
    if (e && e.perm) {
      /* 没权限就别每 1.5 秒重试（会刷出一屏「载入失败」），提示一次后停掉实时流 */
      S.dead = true;
      if (!S.permWarned) {
        S.permWarned = true;
        toast('没有「舰船数据·看」权限，请联系管理员续期', 'bad');
      }
      try { if (STREAM_ES) STREAM_ES.close(); } catch (e2) {}
      const sec = document.getElementById('tab-sim');
      if (sec && !document.getElementById('simNoPerm')) {
        const dn = document.createElement('div');
        dn.id = 'simNoPerm';
        dn.className = 'card';
        dn.innerHTML = '<div class="empty" style="padding:22px">当前账号没有「舰船数据·看」权限。'
          + '权限到期或被收回时会看到这个提示，管理员续期后重新登录即可。</div>';
        sec.insertBefore(dn, sec.firstChild);
      }
      return;
    }
    const st = (e && e.status) || 0;
    S.loadTries = (S.loadTries || 0) + 1;
    if (st >= 400 && st < 500) {           /* 4xx 是确定性错误，重试只会刷屏 */
      if (!S.loadWarned) { S.loadWarned = true; toast('载入失败：' + e.message, 'bad'); }
      return;
    }
    if (S.loadTries > 3) {                 /* 连续 3 次失败就停手，别再弹 */
      if (!S.loadWarned) { S.loadWarned = true; toast('载入失败：' + e.message, 'bad'); }
      return;
    }
    toast('载入失败：' + e.message + '（第 ' + S.loadTries + ' 次重试）', 'bad');
    setTimeout(() => loadBlueprints(true), 1500 * S.loadTries);
  }
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
  if (sf && isAccountFilled(sf.value, S.user)) { sf.value = ''; S.shipQ = ''; }
  if (sf && sf.value !== (S.shipQ || '')) sf.value = S.shipQ || '';
  sel.onchange = () => {
    sl.ship = sel.value; sl.noCarrier = false; sl.modules = {}; sl.alloc = {};
    sl.carrierMods = undefined; sl.planes = [];
    S.sys[S.cur] = ((((shipOf(sl.ship) || {}).systems || [])[0]) || {}).id || '';
    renderEditor(); recalc(S.cur); syncUrl();
  };
}

/* 把「方案 / 蓝图 / 系统」写进地址栏，刷新或发给别人能回到同一处 */
function syncUrl() {
  if (S.booting) return;   /* boot 期间不许改写地址栏，否则 ?ship= 会被冲成第一艘 */
  try {
    const sl = S.slots[S.cur];
    const p = new URLSearchParams(location.search);
    if (sl && sl.ship) p.set('ship', sl.ship); else p.delete('ship');
    if (S.sys && S.sys[S.cur]) p.set('sys', S.sys[S.cur]); else p.delete('sys');
    p.set('slot', S.cur);
    /* 用状态而不是 nav.on：boot 期间 nav 还没切到目标页签 */
    p.set('tab', S.tab || 'sim');
    history.replaceState(null, '', location.pathname + '?' + p.toString());
    try {
      localStorage.setItem('ft_lastSel', JSON.stringify({
        slot: S.cur, ship: (sl && sl.ship) || '', sys: (S.sys && S.sys[S.cur]) || ''
      }));
      /* A/B 两套方案各自选的舰船也记住，刷新后切槽位不会掉回第一艘 */
      localStorage.setItem('ft_slots', JSON.stringify(SLOTS.map(k => ({
        k: k, ship: (S.slots[k] && S.slots[k].ship) || '', sys: (S.sys && S.sys[k]) || ''
      }))));
    } catch (e2) {}
  } catch (e) {}
}

function renderEditor() {
  const sl = S.slots[S.cur];
  /* 自愈：本地记住的舰船如果已经被删掉/改名，自动退回第一艘，
     否则整页会停在「没有找到这条蓝图」的空状态。 */
  if (sl.ship && !shipOf(sl.ship) && (S.bp.ships || []).length) {
    try { toast('原来选的舰船已不存在（' + sl.ship + '），已切到第一艘', 'warn'); } catch (e) {}
    sl.ship = S.bp.ships[0].id;
    const _fs = ((shipOf(sl.ship) || {}).systems || [])[0];
    S.sys[S.cur] = _fs ? _fs.id : '';
  }
  const ship = shipOf(sl.ship) || { id: '', name: '', systems: [], base: {}, tech_total: 0, kind: '', cls: '', size: '' };
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
        S.sys[S.cur] = ((((shipOf(sl.ship) || {}).systems || [])[0]) || {}).id || '';
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
      box.appendChild(el('div', 'muted', '本舰是「' + (ship.cls || ship.kind || ship.size) + '」，没有模块槽位（模块槽只给超主力舰；舱位由系统提供，与舰种无关）'));
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
  if (!S.sys[S.cur] || !(ship.systems || []).find(x => x.id === S.sys[S.cur]))
    S.sys[S.cur] = (((ship.systems || [])[0]) || {}).id || '';
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
/* 内置效果的「单位」以语义为准，不受效果库里手填的单位影响：
   结构/护盾/闪避/伤害/命中… 一律 %，护甲/维修 是 点，速度类 jm、突防 s。
   自定义效果仍用效果库里的 unit。 */
const UNIT_OF = {
  hull: '%', shield: '%', eva: '%', eva_missile: '%', eva_torp: '%',
  dmg: '%', dmg_atk_pct: '%', dmg_air_pct: '%',
  crit: '%', crit_rate: '%', cd: '%', freq: '%', dur: '%', cast: '%',
  acc: '%', acc_plane: '%', acc_small: '%', acc_large: '%',
  speed: '%', warp: '%', move: '%', lock: '%', intc: '%', critres: '%',
  armor: '点', hull_pt: '点',          /* 物理护甲/额外结构值 = 点 */
  repair: '%', heal: '%'                /* 维修量效果 = %（加到维修量上的比例） */
  /* 注意：cruise / warp / spd 是「系统基础值」字段（jm、s），不是节点效果键，故不在此表 */
};
/* 名字里若已自带「（%）/(点)」这类后缀，就拆出来当单位，避免「结构（%）（点）」 */
function splitNameUnit(name, unit) {
  const nm = String(name == null ? '' : name).trim();
  const m = nm.match(/[（(]\s*([^）)]{0,10})\s*[）)]\s*$/);
  if (m) return { base: nm.replace(/[（(]\s*[^）)]{0,10}\s*[）)]\s*$/, '').trim(), unit: m[1].trim() };
  return { base: nm, unit: String(unit == null ? '' : unit).trim() };
}
function effName(k) {
  const e = ((S.bp && S.bp.effects) || []).find(x => x.id === k);
  if (!e) return k;
  const su = splitNameUnit(e.name, e.unit);
  const unit = UNIT_OF[k] || su.unit || '';
  return su.base + (unit ? '（' + unit + '）' : '');
}
/* 效果名称：先查效果库（自定义效果也在库里），再回退内置中文名，最后原样显示键 */
function effMeta(k) {
  const e = ((S.bp && S.bp.effects) || []).find(x => x.id === k);
  const su = splitNameUnit((e && e.name) || EFF_CN[k] || k, (e && e.unit) || '');
  return { name: su.base || k, unit: UNIT_OF[k] || su.unit || '' };
}
function effLabel(k) { return effMeta(k).name; }
function effUnit(k) { return effMeta(k).unit; }
function costOf(nd, lv) {
  // 逐级消耗：nodes.costs = [第1级, 第2级, ...]；没填就回退到统一 cost
  const arr = Array.isArray(nd.costs) ? nd.costs : null;
  if (arr && arr.length) return +arr[Math.min(lv, arr.length - 1)] || 0;
  return +nd.cost || 0;
}

/* 第二参 sl：给舰载机自身的系统树复用（它有自己的 alloc），不传就是当前方案 */
function sysUsed(sy, sl0) {
  const sl = sl0 || S.slots[S.cur] || mk();
  return sy.nodes.reduce((a, nd) => {
    let sum = 0;
    const lv = sl.alloc[nd.id] || 0;
    for (let i = 0; i < lv; i++) sum += costOf(nd, i);
    return a + sum;
  }, 0);
}

function sysActive(sy, sl0) {
  const sl = sl0 || S.slots[S.cur] || mk();
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
    Object.keys(eff || {}).forEach(k => { agg[k] = (agg[k] || 0) + nodeLvAmt(nd, k, lv, eff[k]); });
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
  data_view: '数据管理·看', data_edit: '数据管理·改',
  season_view: '赛季历程·看', season_edit: '赛季历程·改', effects_edit: '效果库·改',
  roster_query: '人员查询·看', roster_view: '人员档案·看', roster_edit: '人员档案·改',
  people_view: '人员管理·看', people_edit: '人员管理·改',
  audit_view: '操作日志·看全部', audit_self: '操作日志·只看自己', export: '导出',
};
const PERM_GROUPS = [
  {mod: '舰船数据', view: 'sim_view', edit: 'sim_edit'},
  {mod: '战报分析', view: 'battle_view', edit: 'battle_edit'},
  {mod: '数据管理', view: 'data_view', edit: 'data_edit', extra: [['effects_edit', '效果库']]},
  {mod: '赛季历程', view: 'season_view', edit: 'season_edit'},
  {mod: '人员查询', view: 'roster_query'},
  {mod: '人员档案', view: 'roster_view', edit: 'roster_edit'},
  {mod: '人员管理', view: 'people_view', edit: 'people_edit'},
  {mod: '操作日志', view: 'audit_view', extra: [['audit_self', '只看自己']]},
  {mod: '导出', view: 'export'},
];
const ROLE_PERMS = {
  viewer: 'sim_view,battle_view',
  editor: 'sim_view,sim_edit,battle_view,battle_edit,data_view,data_edit,season_view,season_edit,export',
};
const TAB_PERM = {sim: 'sim_view', battle: 'battle_view', data: 'data_view',
                  roster: 'roster_query', rosterM: 'roster_view',
                  audit: 'audit_view', people: 'people_view', season: 'season_view', posts: ''};
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
                     roster_query: 'roster_view',
                     people_view: 'people_edit'};
function can(p) {
  if (!p) return !!S.user;            // 没标注权限的页面/按钮：登录即可看
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
    const flag = !!(S.user && S.user.perm_expired);
    bar.classList.toggle('hide', !flag);
    if (flag) {
      const raw = S.user.perm_expire_at || '';
      const day = (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw))
        ? '（到期日 ' + raw.slice(0, 10) + '）' : '';
      bar.textContent = '⚠ 权限已到期' + day
        + '：现在只能查看基础数据，数据管理、人员管理、操作日志等已关闭。'
        + '请让管理员续期后重新登录。';
    }
  }
}

function applyBrand(t) {
  const el1 = $('#brandTitle');
  if (el1) el1.textContent = t;
  document.title = t + ' · 舰船工具';
}
async function loadSettings() {
  try {
    const r = await api('/api/settings');
    const t = (r.settings && r.settings.title) || '追毫中枢';
    applyBrand(t);
    const btn = $('#brandEdit');
    if (btn) btn.style.display = (S.user && (S.user.role === 'admin' || S.user.role === 'superadmin')) ? '' : 'none';
  } catch (e) { /* 未登录也能读 */ }
}

/* ---------- 系统类型：一份定义，基础加成表与问卷共用 ----------
   类型的唯一来源是 systems.sys_kind（数据管理 → 系统 里那一列）。
   以前基础加成表只分「武器 / 功能」两档：装甲、动力、维修、搭载…全折进「功能」，
   看不出这一行到底是什么系统、提供哪些数值。现在按 sys_kind 拆成具体类型，
   每类只在自己的标签上说清提供什么（例如结构值 / 抵抗伤害只认装甲系统）。
   老数据（3 艘早期船共 9 个系统）没填 sys_kind：基础加成表按 stats_norm 的键、再按系统名
   推断一个类型来显示（只显示，不回写数据库）；问卷打开时会把推断结果放进内存，保存才落库。
   要真正定死，去「数据管理 → 系统」把 sys_kind 补上。 */
const SYS_KINDS = ['武器', '装甲', '动力', '能源', '指挥', '维修', '搭载', '仓储', '辅助', '其他'];
const SYS_KIND_META = {
  '武器': { tag: '武器', cls: 'tagw', label: '武器系统（对舰 / 对空）',
    tip: '武器系统：提供 对舰 / 对空' },
  '装甲': { tag: '装甲', cls: 'tagk tk-armor',
    label: '装甲系统（结构值 / 抵抗 / 护盾 / 受维修）',
    tip: '装甲系统：提供 结构值 / 抵抗伤害 / 护盾值 / 受维修加成（只有这一类有这四项）' },
  '动力': { tag: '动力', cls: 'tagk tk-drive',
    label: '动力系统（巡航 / 曲率 / 突防 / 闪避）',
    tip: '动力系统：提供 巡航 / 曲率 / 突防速度 / 通用闪避' },
  '维修': { tag: '维修', cls: 'tagk tk-repair', label: '维修系统（单次维修量 / 工作次数 / 冷却）',
    tip: '维修系统：单次维修量 × 工作次数 × 60÷(持续+冷却) × 设备数 × 系数，再乘（1+调校%）；'
      + '锁定时间是记录项，不参与计算' },
  '能源': { tag: '能源', cls: 'tagk', label: '能源系统',
    tip: '能源系统：能量输出 / 储能，不提供船体数值' },
  '指挥': { tag: '指挥', cls: 'tagk', label: '指挥系统',
    tip: '指挥系统：指挥值，不提供船体数值' },
  '搭载': { tag: '搭载', cls: 'tagk tk-bay', label: '搭载系统',
    tip: '搭载系统：提供 舱位（战机 / 护航艇 / 无人机）' },
  '仓储': { tag: '仓储', cls: 'tagk', label: '仓储', tip: '仓储：仓储量' },
  '辅助': { tag: '辅助', cls: 'tagk', label: '辅助系统',
    tip: '辅助系统：探测 / 支援类，不提供船体数值' },
  '其他': { tag: '其他', cls: 'tagk', label: '其他', tip: '其他：还没分类的系统' }
};
/* 名字兜底只在 sys_kind 空着时才用；装甲 / 动力 排在武器前面，
   「装甲系统」「动力系统」这类名字不会被后面的 /炮/ 之类抢走。 */
const SYS_KIND_BY_NAME = [
  ['装甲', /装甲/], ['动力', /动力|引擎|推进/], ['维修', /维修/],
  ['指挥', /指挥/], ['能源', /能源|供电|储能/], ['仓储', /仓储|货舱/],
  ['搭载', /搭载|坞舱|机库/], ['武器', /武器|火炮|舰炮|炮|导弹|鱼雷|轰炸/],
  ['辅助', /辅助|探测|雷达|信息/]
];
/* 一个系统的类型：sys_kind 优先；空着才看数值、再看名字，最后算「其他」。
   n 是已经解析好的 stats_norm（基础加成表里现成就有，问卷里是 sy.raw）。 */
function sysKindOf(sy, n) {
  sy = sy || {};
  const k = String(sy.sys_kind || '').trim();
  if (SYS_KINDS.indexOf(k) >= 0) return k;
  let d = n;
  if (!d) {
    if (sy.norm && typeof sy.norm === 'object') d = sy.norm;
    else if (sy.raw && typeof sy.raw === 'object') d = sy.raw;
    else if (sy.stats_norm) { try { d = JSON.parse(sy.stats_norm) || {}; } catch (e) { d = {}; } }
  }
  d = d || {};
  if (d.hull !== undefined || d.armor !== undefined || d.shield !== undefined) return '装甲';
  if (d.repair !== undefined) return '维修';
  if (d.dmg_atk !== undefined || d.dmg_air !== undefined || d.weapons
    || (d.dmg !== undefined && d.ammo !== undefined)) return '武器';
  if (d.cruise !== undefined || d.warp !== undefined || d.spd !== undefined
    || d.eva !== undefined || d.eva_pct !== undefined) return '动力';
  if (d.cargo !== undefined) return '仓储';
  if (d.bay_plane !== undefined || d.bay_boat !== undefined || d.bay_drone !== undefined) return '搭载';
  const nm = String(sy.name || '');
  for (let i = 0; i < SYS_KIND_BY_NAME.length; i++) {
    if (SYS_KIND_BY_NAME[i][1].test(nm)) return SYS_KIND_BY_NAME[i][0];
  }
  return '其他';
}
/* 类型标签：表里那个「类型」格，也是全站唯一的一处（问卷下拉复用同一个 META） */
function sysKindTag(sy, n) {
  const k = sysKindOf(sy, n);
  const m = SYS_KIND_META[k] || SYS_KIND_META['其他'];
  const guess = !String((sy || {}).sys_kind || '').trim();
  return '<span class="' + m.cls + '" title="' + mhEsc(m.tip
    + (guess ? '（这一行没填系统类型，按数值 / 名字推断）' : '')) + '">' + m.tag + '</span>';
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
      Object.keys(eff || {}).forEach(k => { a[k] = (a[k] || 0) + nodeLvAmt(nd, k, lv, eff[k]); });
    });
    return a;
  };
  const sys = (ship.systems || []).map(sy => {
    let n = {};
    try { n = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { n = {}; }
    return { sy: sy, n: n, a: sysAggOf(sy),
      w: (n.dmg_atk !== undefined || n.dmg_air !== undefined
        || !!weaponSixOf(n) || !!weaponListOf(n)) };
  });
  const hasWeapon = sys.some(x => x.w);
  /* 只在这艘船确实装了模块时，才显示「舱位」这类模块相关内容 */
  const _slCur = S.slots[S.cur] || {};
  const _chosen = _slCur.modules || {};
  const hasMod = !!Object.keys(_chosen).length;
  /* 超主力：槽位没装模块时整行隐藏；A1 / M1 作为基础槽始终保留 */
  const _isSuper = (ship.kind || '') === '超主力舰';
  const _keepSlot = (sl) => {
    const u = String(sl || '').toUpperCase();
    return u === 'A1' || u === 'M1';
  };
  const _hasCand = {};
  (ship.modules || []).forEach(m => { const L = (m.slot || '').charAt(0).toUpperCase(); if (L) _hasCand[L] = 1; });
  /* 该槽位「自己」是否装了模块：必须模块的 slot 与本行 slot 完全一致（M1 ≠ M2） */
  const _slotLoaded = (sl) => {
    const u = String(sl || '').toUpperCase();
    const L = u.charAt(0);
    if (!u || !L || !_chosen[L]) return false;
    const mid = _chosen[L];
    const m = (ship.modules || []).find(x => String(x.id) === String(mid));
    return !!(m && String(m.slot || '').toUpperCase() === u);
  };
  const _slotShown = (sl) => {
    if (!_isSuper) return true;
    const u = String(sl || '').toUpperCase();
    const L = u.charAt(0);
    if (!L || !_hasCand[L]) return true;      // 不是可替换槽位（装甲/动力/能源/指挥）
    if (_keepSlot(u)) return true;            // A1 / M1 作为基础槽永远保留
    return _slotLoaded(u);                    // 其它槽位：它自己装了才显示
  };
  /* 已装模块提供的舱位（模块本身就是系统，槽位名要与本行一致） */
  const modBaysOf = (slotName) => {
    const u = String(slotName || '').toUpperCase();
    const L = u.charAt(0);
    const mid = L ? _chosen[L] : '';
    if (!mid) return [];
    const m = (ship.modules || []).find(x => String(x.id) === String(mid));
    if (!m || String(m.slot || '').toUpperCase() !== u) return [];
    const bays = (m.bays && m.bays.length) ? m.bays
      : (m.mkind ? [{ kind: (m.mkind || '').replace('搭载系统', ''), cap: m.cap, allow_group: m.allow_group }] : []);
    return bays.map(b => ({ kind: b.kind || '', cap: +b.cap || 0, src: '模块' }));
  };
  /* 表里真正会显示出来的舱位（超主力舰的可替换槽位没装模块就不算） */
  const dispBays = (x) => {
    let bs = sysBays(x.sy).concat(modBaysOf(x.sy.slot));
    if (_isSuper && !_slotLoaded(x.sy.slot)) bs = bs.filter(b => (b.kind || '') === '无人机');
    return bs;
  };
  /* 一行只有在「有基础值」「有加点加成」「有舱位」时才出现：
     整行都是「—」的系统没有信息量，留着只会让人以为漏填了。
     舱位相关的键不算「基础值」，否则没装模块的搭载平台会留一行空壳。 */
  const BAY_KEYS = { bay_plane: 1, bay_boat: 1, bay_drone: 1 };
  const rowHas = (x) => {
    const n = x.n || {}, a = x.a || {};
    if (Object.keys(n).some(k => !BAY_KEYS[k] && n[k] !== undefined && n[k] !== null && n[k] !== '')) return true;
    if (Object.keys(a).some(k => Number(a[k]))) return true;
    return !!dispBays(x).length;
  };
  const rowsAll = sys.filter(x => (!weaponOnly || x.w) && _slotShown(x.sy.slot))
    .sort((a, b2) => (b2.w - a.w) || String(a.sy.slot || '').localeCompare(String(b2.sy.slot || '')));
  const rows = rowsAll.filter(rowHas);
  const hasBay = rows.some(x => dispBays(x).length);

  const COLS = [
    { k: 'slot', t: '槽位', w: 56 },
    { k: 'name', t: '系统', w: 176 },
    { k: 'kind', t: '类型', w: 56 },
    { k: 'bay', t: '舱位', w: 130, bay: 1 },
    { k: 'hull', t: '系统结构值', w: 110, num: 1 },
    { k: 'armor', t: '抵抗伤害', w: 92, num: 1 },
    { k: 'shield', t: '护盾值', w: 84, num: 1, pct: 1 },
    { k: 'eva', t: '通用闪避', w: 92, num: 1, pct: 1 },
    { k: 'speed', t: '巡航 / 曲率', w: 118, num: 1 },
    { k: 'spd', t: '突防速度', w: 86, num: 1 },
    { k: 'unit', t: '维修单位', w: 84 },
    { k: 'repair', t: '维修量', w: 86, num: 1 },
    { k: 'dmg_atk', t: '对舰', w: 94, num: 1, weapon: 1 },
    { k: 'dmg_air', t: '对空', w: 86, num: 1, weapon: 1 },
  ].filter(c => {
    if (c.weapon && !hasWeapon) return false;
    if (c.bay && !hasBay) return false;
    if (c.k === 'slot' || c.k === 'name' || c.k === 'kind') return true;
    if (c.k === 'speed') return rows.some(x => x.n.cruise !== undefined || x.n.warp !== undefined
      || Number(x.a.speed) || Number(x.a.warp));
    if (c.k === 'spd') return rows.some(x => x.n.spd !== undefined || Number(x.a.move));
    /* 该列在所有可见行里既没基础值也没加成 → 不显示 */
    return rows.some(x => x.n[c.k] !== undefined || Number(x.a[c.k]));
  });

  /* 「其他加成」列：本表没单列的加成键（命中 / 暴击 / 锁定 / 自定义效果…），有就显示 */
  const EXTRA_USED = { hull:1, armor:1, shield:1, eva:1, speed:1, warp:1, spd:1, move:1,
    repair:1, dmg_atk:1, dmg_air:1, dmg:1 };
  const extraOf = (x) => Object.keys(x.a || {}).filter(k => !EXTRA_USED[k] && Number(x.a[k]));
  /* 系统自带的暴击（向导弹里填的「自带暴击率 / 自带暴击伤害」）不挂在节点上，
     这里单独取出来，保证填了就能在表里看见，没生效也说清原因 */
  const ownCritOf = (x) => {
    const r = Number(x.n.crit_rate) || 0, d = Number(x.n.crit) || 0;
    if (!(r > 0 || d > 0)) return null;
    return { r: r, d: d, mul: (r > 0 && d > 0) ? 1 + (r / 100) * (d / 100) : 1 };
  };
  /* 武器列：按公式现算（与 sysDmgSum / 引擎同口径，含本系统加点与自带暴击） */
  const weaponCellOf = (x, k) => {
    const six = weaponSixOf(x.n);
    const multi = weaponListOf(x.n);
    if (!six && !multi) return undefined;
    const aa = x.a || {};
    const famA = {};
    Object.keys(aa).forEach(kk => {
      if (kk.indexOf('dmg_') !== 0) return;
      if (kk === 'dmg_atk_pct' || kk === 'dmg_air_pct') return;
      famA[kk.slice(4)] = Number(aa[kk]) || 0;
    });
    const cdR = (Number(aa.cd) || 0) + (Number(aa.freq) || 0);
    const w2 = multi ? weaponSum2(x.n, cdR, famA) : null;
    const b2 = w2 || weaponBase2(x.n, six, cdR);
    const base = (k === 'dmg_air') ? b2[1] : b2[0];
    const oc = ownCritOf(x);
    const v = base * (1 + (Number(aa.dmg) || 0) / 100) * (1 + (Number(aa[k + '_pct']) || 0) / 100)
      * (oc ? oc.mul : 1);
    return Math.round(v * 10) / 10;
  };
  if (rows.some(x => extraOf(x).length || ownCritOf(x))) COLS.push({ k: '__extra', t: '其他加成', w: 190 });

  const head = $('#baHead');
  if (head) {
    head.innerHTML = '<tr>' + COLS.map(c => '<th' + (c.w ? ' style="width:' + c.w + 'px"' : '') + ' class="' + (c.num ? 'num' : '') + '">' + c.t + '</th>').join('') + '</tr>';
  }
  const cellOf = (c, x) => {
    const n = x.n;
    if (c.k === 'slot') return '<td>' + mhEsc(x.sy.slot || '-') + '</td>';
    if (c.k === 'name') return '<td>' + mhEsc(x.sy.name) + '</td>';
    if (c.k === 'kind') return '<td>' + sysKindTag(x.sy, x.n) + '</td>';
    if (c.k === 'bay') {
      const bs = dispBays(x);
      if (!bs.length) return '<td class="dim">—</td>';
      return '<td class="bcell">' + bs.map(b => b.kind + ' ' + b.cap
        + (b.src === '模块' ? '（模块）' : '')).join(' · ') + '</td>';
    }
    if (c.k === '__extra') {
      const ks = extraOf(x);
      const oc = ownCritOf(x);
      const bits = ks.map(k => effLabel(k) + ' +' + fmtNum(x.a[k]) + (effUnit(k) || '%'));
      if (oc) {
        /* 只给一个「暴击系数」：具体两格数值在录入页已经写清，表里不复述 */
        if (!(oc.r > 0 && oc.d > 0)) bits.push('暴击系数（只填了一格，不生效）');
        else if (!x.w) bits.push('暴击系数（×' + fmtNum(oc.mul) + '）· 没填对舰 / 对空，暂不生效');
        else bits.push('暴击系数（×' + fmtNum(oc.mul) + '）');
      }
      if (!bits.length) return '<td class="dim">—</td>';
      return '<td class="bcell">' + bits.join(' · ') + '</td>';
    }
    if (c.k === 'speed') {
      const cr = n.cruise === undefined ? undefined : effVal('speed', n.cruise, x.a);
      const wp = n.warp === undefined ? undefined : effVal('warp', n.warp, x.a);
      const a = fmtNum(cr), b2 = fmtNum(wp);
      if (a === '—' && b2 === '—') return '<td class="num dim">—</td>';
      return '<td class="num">' + a + (b2 === '—' ? '' : ' / ' + b2) + '</td>';
    }
    if (c.weapon) {
      /* 武器列：文档值按加点放大，没存档就现算一格 */
      const wv = weaponCellOf(x, c.k);
      if (wv !== undefined) return '<td class="num">' + fmtNum(wv) + '</td>';
    }
    /* 维修单位是文字（无人机 / 维修设备），不能走下面按数字加成的通用分支 */
    if (c.k === 'unit') {
      const u3 = n.unit;
      return '<td' + (u3 ? '' : ' class="dim"') + '>' + (u3 ? mhEsc(u3) : '—') + '</td>';
    }
    let v = n[c.k];
    /* 维修量：按「单次 × 工作量 × 60÷周期 × 设备数 × 调校」现算，不直接显示存档值 */
    if (c.k === 'repair') {
      const rd = repairDpmOf(n, (Number(x.a.cd) || 0) + (Number(x.a.freq) || 0));
      if (rd) v = rd; else if (v !== undefined && v !== null) v = undefined;
    }
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
    || '<tr><td colspan="' + COLS.length + '" class="dim">'
      + (weaponOnly ? '这艘船没有武器系统'
        : (rowsAll.length ? '这些系统还没有基础值，也没有加点' : '这艘船还没有系统'))
      + '</td></tr>';

  if (tiles) {
    const st = sysTotals(ship, (S.slots[S.cur] || {}).alloc);
    const pick = (k, v) => (st.has[k] ? st.sum[k] : (Number(v) || 0));
    const armor = pick('armor', base.armor) + (Number(agg.armor) || 0);
    const shield = pick('shield', base.shield) + (Number(agg.shield) || 0);
    const ws = sys.filter(x => x.w);
    const wsum = sysDmgSum(ship, (S.slots[S.cur] || {}).alloc);
    const sum = k => wsum[k];
    const tile = (k, v, s2) => '<div class="basetile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s2 || '') + '</div></div>';
    tiles.innerHTML = [
      tile('抵抗伤害 / 护盾', fmtNum(armor) + ' / ' + ((st.has.shield || base.shield !== undefined) ? fmtNum(shield) + '%' : '—'), '物理减伤 / 能量减伤'),
      tile('巡航 / 曲率',
        fmtNum(effVal('speed', pick('cruise', base.cruise), agg)) + ' / ' + fmtNum(effVal('warp', pick('warp', base.warp), agg)),
        (Number(agg.speed) || Number(agg.warp)) ? '已含加点加成' : 'jm'),
      tile('武器系统', ws.length + ' 个', ws.length ? ('对舰 ' + fmtNum(sum('dmg_atk')) + ' · 对空 ' + fmtNum(sum('dmg_air'))) : '没有武器系统'),
    ].concat((function () {
      /* 舰载机：只在真的有搭载时才出现；战机 / 护航艇各一块，只给加成后的结果，不写公式 */
      const pt = planeTotals(S.cur);
      const out = [];
      ['战机', '护航艇'].forEach(kind => {
        const rs = pt.rows.filter(r => r.kind === kind);
        if (!rs.length) return;
        const c = rs.reduce((a, r) => a + r.count, 0)
          , d = rs.reduce((a, r) => a + r.dpm, 0);
        out.push(tile(kind, c + ' 架', 'DPM ' + fmtNum(d)));
      });
      return out;
    })()).join('');
  }
  renderBaPlanes();
  if (warn) {
    const msgs = [];
    if (base.hull === undefined) msgs.push('缺少装甲系统数值（结构值 / 抵抗伤害）');
    if (!hasWeapon) msgs.push('没有武器系统，所以对舰 / 对空两列为空（靠舰载机输出时属正常）');
    warn.innerHTML = msgs.length ? ('⚠ ' + msgs.join('；') + '。缺的数据在「数据管理 → 系统」里补。') : '';
    warn.classList.toggle('hide', !msgs.length);
  }
  if (note) {
    note.textContent = '共 ' + sys.length + ' 个系统（' + sys.filter(x => x.w).length + ' 个武器系统）'
      + (rows.length < rowsAll.length ? '，只列出有数值的 ' + rows.length + ' 个' : '')
      + (weaponOnly ? '，当前只看武器' : '');
  }
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

/* ---------- 网格树（只读原型）：按前置层级排成列，SVG 画前置连线 ---------- */
const TREE_ICONS = {
  dmg: '💥', dmg_cannon: '💥', dmg_rail: '⚡', dmg_pulse: '⚛', dmg_plasma: '🔥',
  dmg_missile: '🚀', dmg_torpedo: '🐟', dmg_drone: '🛩', dmg_atk_pct: '📈',
  repair: '🔧', repair_bonus_pct: '🔧', freq: '⏱', cd: '⏱', dur: '🕒', lock: '🔒',
  acc: '🎯', acc_small: '🎯', acc_large: '🎯', acc_plane: '✈', warn: '⚠',
  armor: '🛡', shield: '🔵', hull: '❤', syshull: '🧱', eva: '💨', eva_missile: '💨', eva_torp: '💨',
  speed: '🚀', warp: '🌌', crit: '✦', crit_rate: '✦', critres: '◇',
  move: '🕹', plane: '✈', cargo: '📦', intc: '🛰', intc_torp: '🛰', range: '📡', lockres: '🔒'
};

function treeEffKey(nd) {
  let ef = nd && nd.effect;
  if (typeof ef === 'string') { try { ef = JSON.parse(ef || '{}'); } catch (e) { ef = null; } }
  return (ef && typeof ef === 'object') ? (Object.keys(ef)[0] || '') : '';
}

function treeIconOf(nd) {
  const k = treeEffKey(nd);
  return TREE_ICONS[k] || (nd && nd.label ? String(nd.label).slice(0, 1) : '◆');
}

function treeGridCard(nd, sl, sy, code) {
  const lv = sl.alloc[nd.id] || 0;
  const parents = parList(nd.parent).map(id => sy.nodes.find(x => x.id === id)).filter(Boolean);
  const unlocked = !parents.length || parents.some(p => (sl.alloc[p.id] || 0) > 0);
  const maxed = nd.max_lv > 0 && lv >= nd.max_lv;
  const capN = Number(sy.tech_cap) || 0;
  const activeN = sysActive(sy, sl);
  const capped = capN > 0 && lv === 0 && activeN >= capN;
  const invalid = lv > 0 && !unlocked;
  const d = el('div', 'tnode' + (unlocked ? '' : ' locked') + (maxed ? ' maxed' : '')
    + (capped ? ' capped' : '') + (invalid ? ' invalid' : ''));
  d.title = (nd.label || code || '') + '　' + lv + ' / ' + nd.max_lv
    + (parents.length ? '\n前置：' + parents.map(p => p.label).join(' 或 ') : '')
    + (nd.note ? '\n' + nd.note : '')
    + (capped ? '\n可用节点已满：' + activeN + ' / ' + capN + '（先把某个节点减到 0）' : '')
    + (invalid ? '\n⚠ 前置还没点，这一点现在不计入' : '');
  if (perLvOf(nd, treeEffKey(nd))) {
    const b = el('span', 'tbadge', '橙');
    b.title = '分段成长：逐级数值不同';
    d.appendChild(b);
  }
  d.appendChild(el('div', 'ticon', treeIconOf(nd)));
  d.appendChild(el('div', 'tname', nd.label || code || ''));
  d.appendChild(el('div', 'tlv', lv + ' / ' + nd.max_lv + (unlocked ? '' : ' · 🔒')));
  if (!unlocked) {
    d.onclick = () => toast('先点「' + parents.map(p => p.label).join('」或「') + '」任一个', 'bad');
  } else {
    const stp = el('div', 'tstep');
    const bM = el('button', '', '−'); bM.type = 'button';
    const bP = el('button', '', '+'); bP.type = 'button';
    bM.onclick = (ev) => {
      ev.stopPropagation();
      const cur = sl.alloc[nd.id] || 0;
      if (cur <= 0) return;
      if (cur === 1) delete sl.alloc[nd.id]; else sl.alloc[nd.id] = cur - 1;
      renderTree(); recalc(S.cur);
    };
    bP.onclick = (ev) => {
      ev.stopPropagation();
      const cur = sl.alloc[nd.id] || 0;
      /* 前置：按当前加点实时判断（渲染后加点可能变了） */
      const pars = parList(nd.parent).map(x => sy.nodes.find(y => y.id === x)).filter(Boolean);
      if (pars.length && !pars.some(x => (sl.alloc[x.id] || 0) > 0)) {
        return toast('先点「' + pars.map(x => x.label).join('」或「') + '」任一个', 'bad');
      }
      if (cur >= nd.max_lv) { toast('这个节点已经满级了', ''); return; }
      /* 可用节点：系统最多点亮 N 个节点（lv>0 的个数），不是技术值 */
      if (cur === 0 && capN > 0 && activeN >= capN) {
        return toast('「' + sy.name + '」可用节点 ' + capN + ' 个，已点亮 ' + activeN
          + ' 个。先把不用的节点减到 0，再点新的。', 'bad');
      }
      /* 变形技术值（未填上限就不拦） */
      const shp = shipOf(sl.ship);
      if (shp && Number(shp.tech_total) > 0) {
        const total = (shp.systems || []).reduce((a, x) => a + sysUsed(x, sl), 0);
        const delta = costOf(nd, cur);
        if (total + delta > Number(shp.tech_total)) {
          return toast('变形技术值不够：还要 ' + delta + '，只剩 ' + (Number(shp.tech_total) - total), 'bad');
        }
      }
      sl.alloc[nd.id] = cur + 1;
      renderTree(); recalc(S.cur);
    };
    stp.appendChild(bM);
    stp.appendChild(el('span', '', String(lv)));
    stp.appendChild(bP);
    d.appendChild(stp);
  }
  return d;
}

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

function calibBox(sy, sl) {
  let norm = sy.norm;
  if (!norm) { try { norm = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { norm = {}; } }
  const cal = norm._calib;
  if (!cal || (!cal.name && !cal.text)) return null;
  if (typeof cal.on !== 'boolean') cal.on = false;
  if (cal.pct === undefined || cal.pct === null || cal.pct === '') {
    const m0 = /(?:伤害|结构值)(?:提高|提升|增加)?\s*(\d+(?:\.\d+)?)\s*%/.exec(cal.text || '');
    cal.pct = m0 ? Number(m0[1]) : 0;
  }
  if (cal.adv === undefined || cal.adv === null || cal.adv === '') cal.adv = 0;
  const box = el('div', 'calbox');
  const head = el('div', 'calh');
  head.appendChild(el('b', '', '系统调校'));
  if (cal.name) head.appendChild(document.createTextNode('（' + cal.name + '）'));
  box.appendChild(head);
  const lab = document.createElement('label');
  lab.className = 'calchk';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!cal.on;
  cb.onchange = () => { cal.on = cb.checked; saveCalib(sy, norm, cal); };
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode(' 启用加成（不勾就不参与计算）'));
  box.appendChild(lab);
  const row = el('div', 'calrow');
  const mkNum = (label, key) => {
    const wrap2 = el('label', 'row');
    wrap2.appendChild(el('span', '', label));
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.min = '0';
    inp.value = (cal[key] === undefined || cal[key] === null) ? '' : cal[key];
    inp.onchange = () => {
      const v = Number(inp.value);
      cal[key] = isFinite(v) ? v : 0;
      saveCalib(sy, norm, cal);
    };
    wrap2.appendChild(inp);
    return wrap2;
  };
  row.appendChild(mkNum('本系统加成%', 'pct'));
  row.appendChild(mkNum('进阶加成%', 'adv'));
  box.appendChild(row);
  return box;
}

function saveCalib(sy, norm, cal) {
  norm._calib = cal;
  sy.norm = norm;
  const body = {
    id: sy.id, ship: sy.ship || (S.slots[S.cur] || {}).ship, slot: sy.slot,
    name: sy.name, tech_cap: sy.tech_cap, sys_kind: sy.sys_kind,
    is_weapon: sy.is_weapon, stats: sy.stats, bays: sy.bays,
    stats_norm: JSON.stringify(norm)
  };
  api('/api/data/systems', { method: 'PUT', body: body }).then(() => {
    toast('系统调校已保存', 'good');
    renderTree(); renderEditor();
  }).catch(e => toast('保存失败：' + e.message, 'bad'));
}

function treeGridEl(sy, sl) {
  const cols = treeCols(sy.nodes);
  const outer = el('div', 'tgouter');
  const bar = el('div', 'tghint');
  const bL = el('button', 'btn ghost tiny', '◀'); bL.type = 'button'; bL.title = '向左'; 
  const bR = el('button', 'btn ghost tiny', '▶'); bR.type = 'button'; bR.title = '向右'; 
  bar.appendChild(bL); bar.appendChild(bR);
  const _capN = Number(sy.tech_cap) || 0;
  const _actN = sysActive(sy, sl);
  const _capTxt = _capN
    ? ' · 可用节点 ' + _actN + '/' + _capN
      + (_actN > _capN ? '（超出 ' + (_actN - _capN) + '）' : (_actN >= _capN ? '（已满）' : ''))
    : '';
  bar.appendChild(el('span', 'dim' + (_capN && _actN > _capN ? ' capbad' : ''),
    '共 ' + Math.max(1, cols.length) + ' 层：可拖动 / 滚轮横向查看' + _capTxt));
  outer.appendChild(bar);
  const wrap = el('div', 'tgridwrap');
  outer.appendChild(wrap);
  const grid = el('div', 'tgrid');
  grid.style.gridTemplateColumns = 'repeat(' + Math.max(1, cols.length) + ', minmax(112px, 126px))';
  const cardOf = {};
  cols.forEach((col, ci) => col.forEach(({ code, node }, ri) => {
    const c = treeGridCard(node, sl, sy, code);
    c.style.gridColumn = String(ci + 1);
    c.style.gridRow = String(ri + 1);
    c.dataset.nid = node.id;
    cardOf[node.id] = c;
    grid.appendChild(c);
  }));
  wrap.appendChild(grid);
  const slide = (dx) => { wrap.scrollLeft += dx; if (wrap._redraw) wrap._redraw(); };
  bL.onclick = () => slide(-170);
  bR.onclick = () => slide(170);
  wrap.addEventListener('wheel', (e) => {
    if (wrap.scrollWidth <= wrap.clientWidth + 2) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      wrap.scrollLeft += e.deltaY; e.preventDefault();
      if (wrap._redraw) wrap._redraw();
    }
  }, { passive: false });
  /* 按住空白处拖动（卡片上的点击/按钮不受影响） */
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, .calbox')) return;
    if (wrap.scrollWidth <= wrap.clientWidth + 2) return;
    drag = { x: e.clientX, left: wrap.scrollLeft };
    wrap.classList.add('dragging');
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    wrap.scrollLeft = drag.left - (e.clientX - drag.x);
    if (wrap._redraw) wrap._redraw();
  });
  const endDrag = () => { drag = null; wrap.classList.remove('dragging'); };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointerleave', endDrag);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tgridlines');
  wrap.appendChild(svg);

  /* 系统调校（武器系统：本系统武器伤害%；装甲系统：整舰结构值%） */
  const calBox = calibBox(sy, sl);
  if (calBox) wrap.appendChild(calBox);

  /* 汇总：本系统加成效果（只读原型，按当前加点直接算） */
  const box = el('div', 'tgridsum');
  box.appendChild(el('b', '', '本系统加成效果'));
  const sums = {};
  let usedPts = 0, active = 0;
  sy.nodes.forEach(n => {
    const lv = sl.alloc[n.id] || 0;
    if (!lv) return;
    active++;
    for (let i = 0; i < lv; i++) usedPts += costOf(n, i);
    let ef = n.effect;
    if (typeof ef === 'string') { try { ef = JSON.parse(ef || '{}'); } catch (e) { ef = null; } }
    if (!ef || typeof ef !== 'object') return;
    Object.keys(ef).forEach(k => {
      const v = Number(ef[k]) || 0;
      const amt = (typeof nodeLvAmt === 'function')
        ? nodeLvAmt(n, k, lv, v) : v * lv;
      sums[k] = (sums[k] || 0) + (Number(amt) || 0);
    });
  });
  const keys = Object.keys(sums).filter(k => sums[k]);
  if (!keys.length) {
    box.appendChild(el('div', 'muted', active ? '已点 ' + active + ' 个节点（' + usedPts + ' 技术值），但没有可汇总的数值效果。' : '尚未激活任何技能'));
  } else {
    keys.forEach(k => {
      const v = Math.round(sums[k] * 100) / 100;
      box.appendChild(el('div', '', (typeof effName === 'function' ? effName(k) : k) + ' +' + v));
    });
    box.appendChild(el('div', 'muted', '共 ' + active + ' 个节点点亮、消耗 ' + usedPts + ' 技术值'));
  }
  wrap.appendChild(box);

  const draw = () => {
    const wr = wrap.getBoundingClientRect();
    svg.setAttribute('width', String(grid.scrollWidth + 10));
    svg.setAttribute('height', String(grid.scrollHeight + 10));
    let d = '';
    sy.nodes.forEach(n => {
      const c = cardOf[n.id];
      if (!c) return;
      const cr = c.getBoundingClientRect();
      const cx = cr.left - wr.left + wrap.scrollLeft;
      const cy = cr.top - wr.top + wrap.scrollTop + cr.height / 2;
      parList(n.parent).filter(pid => cardOf[pid]).forEach(pid => {
        const pr = cardOf[pid].getBoundingClientRect();
        const px = pr.right - wr.left + wrap.scrollLeft;
        const py = pr.top - wr.top + wrap.scrollTop + pr.height / 2;
        const mx = px + Math.max(12, (cx - px) / 2);
        d += 'M ' + px.toFixed(1) + ' ' + py.toFixed(1) + ' H ' + mx.toFixed(1)
          + ' V ' + cy.toFixed(1) + ' H ' + cx.toFixed(1) + ' ';
      });
    });
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d || 'M 0 0');
    svg.appendChild(path);
  };
  wrap._redraw = draw;
  requestAnimationFrame(draw);
  setTimeout(draw, 80);
  return outer;
}

function renderTree() {
  renderBaseAttrs();
  renderPlaneTrees();
  const sl = S.slots[S.cur];
  const ship = shipOf(sl.ship) || { id: '', name: '', systems: [], base: {}, tech_total: 0, kind: '', cls: '', size: '' };
  const sy = (ship.systems || []).find(x => x.id === S.sys[S.cur]);
  const host = $('#tree');
  /* 每次重绘都会重建 DOM，横向滚动位置会被浏览器重置为 0
     → 在第 2 层点一下「+」就被甩回第 1 层。
     这里在同一「方案 + 舰船 + 系统」下记住并还原 scrollLeft/scrollTop。 */
  const laneKey = S.cur + '|' + (sl.ship || '') + '|' + (S.sys[S.cur] || '');
  const prevLane = host.querySelector('.wiz-lane');
  const prevGrid = host.querySelector('.tgridwrap');
  const prevScroller = prevGrid || prevLane;
  const keep = host.dataset.laneKey === laneKey && prevScroller;
  const keepLeft = keep ? prevScroller.scrollLeft : 0;
  const keepTop = keep ? prevScroller.scrollTop : 0;
  host.innerHTML = '';
  if (!sy) { host.appendChild(el('div', 'muted', '这条船还没有系统数据，去「数据管理」加。')); return; }
  /* 无加点项的纯被动系统：留空，不显示任何提示 */
  /* 横向分层：一层一列，列内按录入顺序往下排（与「数据管理 → 加点」里的顺序一致） */
  const cols = treeCols(sy.nodes);
  if (cols.length) {
    host.appendChild(treeGridEl(sy, sl));
    host.dataset.laneKey = laneKey;
    const gw = host.querySelector('.tgridwrap');
    if (gw) {
      gw.scrollLeft = keepLeft; gw.scrollTop = keepTop;
      if (gw._redraw) gw._redraw();
      /* 重绘后内容宽度可能还在变（连 SVG 一起），下一帧再校准一次，避免点数一变就回弹 */
      requestAnimationFrame(() => {
        gw.scrollLeft = keepLeft; gw.scrollTop = keepTop;
        if (gw._redraw) gw._redraw();
      });
    }
  }

  const used = ship.systems.reduce((a, x) => a + sysUsed(x), 0);
  $('#techUsed').textContent = used;
  const capEl = $('#techCap');
  if (capEl) {
    capEl.textContent = (Number(ship.tech_total) || 0) || '未填';
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
  /* 上限没填（=0）时不要把进度条拉满：显示空条并提示去填；超出上限时变红 */
  const _cap = Number(ship.tech_total) || 0;
  const _bar = $('#techBar');
  if (_bar) {
    _bar.style.width = _cap ? (Math.min(100, used / _cap * 100) + '%') : '0%';
    _bar.classList.toggle('over', !!_cap && used > _cap);
    _bar.title = _cap
      ? (used > _cap ? ('已点 ' + used + '，超出上限 ' + _cap) : '')
      : '整舰技术值上限还没填（点上面的「未填」可以设置；不影响加点计算）';
  }

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
  const capN = Number(sy.tech_cap) || 0;
  const activeN = sysActive(sy, sl);
  const capped = capN > 0 && lv === 0 && activeN >= capN;
  const invalid = lv > 0 && !unlocked;
  const d = el('div', 'node' + (unlocked ? '' : ' locked') + (capped ? ' capped' : '')
    + (invalid ? ' invalid' : ''));
  const top = el('div', 'nm');
  if (code) top.appendChild(el('span', 'wiz-code', code + ' '));
  top.appendChild(el('span', '', nd.label));
  top.appendChild(el('span', 'muted', lv + '/' + nd.max_lv));
  d.appendChild(top);
  if (capped) d.title = '可用节点已满：' + activeN + ' / ' + capN + '（先把某个节点减到 0 再点新节点）';
  if (invalid) d.title = '⚠ 前置还没点，这一点现在不计入';
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
    if (cur === 0 && sy.tech_cap && sysActive(sy, sl) >= sy.tech_cap)
      return toast('「' + sy.name + '」可用节点 ' + sy.tech_cap + ' 个，已点亮 ' + sysActive(sy, sl)
        + ' 个（系统里共 ' + sy.nodes.length + ' 个）。先把不用的节点减到 0，再点新的。', 'bad');
    const ship = shipOf(sl.ship) || { id: '', name: '', systems: [], base: {}, tech_total: 0, kind: '', cls: '', size: '' };
    const total = ship.systems.reduce((a, x) => a + sysUsed(x, sl), 0);
    if (ship.tech_total && total + delta > ship.tech_total)
      return toast('变形技术值不够：还要 ' + delta + '，只剩 ' + (ship.tech_total - total), 'bad');
    sl.alloc[nd.id] = cur + 1; renderTree(); recalc(S.cur);
  };
  st.append(minus, el('span', 'lv', lv + ' / ' + nd.max_lv), plus);
  d.appendChild(st);
  return d;
}

/* ---------- 每级数组 + 六字段：与 engine._lv_amt / _weapon_out 同口径 ---------- */
/* 节点的 per_lv：可以写成 [2,2,2,3,3]（单效果节点），也可以写成 {键: [...]}（一个节点挂多种效果） */
function perLvOf(nd, k) {
  let pv = nd && nd.per_lv;
  if (typeof pv === 'string') { try { pv = JSON.parse(pv || 'null'); } catch (e) { pv = null; } }
  if (!pv) return null;
  if (Array.isArray(pv)) return pv;
  if (typeof pv === 'object' && Array.isArray(pv[k])) return pv[k];
  return null;
}
/* 点到第 lv 级一共加了多少：有数组就逐级求和（level 超过数组长度时按末项继续外推），
   没有数组就是老口径「每级 v × lv」 */
function nodeLvAmt(nd, k, lv, v) {
  const val = (v === undefined || v === null) ? (Number((nd && nd.effect || {})[k]) || 0) : (Number(v) || 0);
  const arr = perLvOf(nd, k);
  const L = Math.max(0, Math.floor(Number(lv) || 0));
  if (!arr || !arr.length) return val * L;
  let sum = 0;
  for (let i = 0; i < L; i++) sum += (i < arr.length ? (Number(arr[i]) || 0) : (Number(arr[arr.length - 1]) || 0));
  return sum;
}
/* 六字段：单发 / 弹药 / 攻击次数 / 持续 / 冷却 / 门数。填齐就能现算，填不齐就返回 null 走存档三行 */
function weaponSixOf(n) {
  n = n || {};
  const dmg = +n.dmg || 0, ammo = +n.ammo || 0, atk = +n.atk || 0;
  const volley = (ammo && atk) ? ammo * atk : (+n.ammo_atk || 0);
  if (!dmg || !volley || !((+n.dur || 0) || (+n.cd || 0))) return null;
  return { dmg: dmg, volley: volley, guns: +n.guns || 1 };
}
/* 命中率 / 协同效率：支持 0.15 与 15 两种写法，缺省 0.8 / 100% */
function wepHitOf(o) {
  const v = (o.aa_hit === undefined || o.aa_hit === null || o.aa_hit === '') ? 0.8 : Number(o.aa_hit);
  return v > 1 ? v / 100 : v;
}
function wepCoopOf(o) {
  const v = (o.aa_coop === undefined || o.aa_coop === null || o.aa_coop === '') ? 100 : Number(o.aa_coop);
  return v > 1 ? v / 100 : v;
}
/* 两路基础值：对舰扣族护甲，对空 × 命中率 × 协同效率 */
function weaponBase2(n, six, cdRed) {
  const cyc = Math.max(0.5, (+n.dur || 0) + (+n.cd || 0) * (1 - (+cdRed || 0) / 100) + (+n.pen || 0));
  const shot = six.dmg * six.volley / cyc * 60 * six.guns;
  return [Math.max(0, six.dmg - 10) * six.volley / cyc * 60 * six.guns,
    shot * wepHitOf(n) * wepCoopOf(n)];
}
/* 一个系统挂多把武器（新数据：stats_norm.weapons[]）时返回数组，否则 null */
function weaponListOf(n) {
  const wl = n && n.weapons;
  return Array.isArray(wl) && wl.length ? wl : null;
}
/* 系统调校加成：问卷里勾了「启用加成」才算，返回百分数（如 5） */
/* 装甲系统调校：勾选后给整舰结构值加成（与 engine 的 _calib_hull_pct 同口径） */
function calibHullPctOf(ship) {
  let pct = 0;
  (((ship || {}).systems) || []).forEach(sy => {
    let n = sy.norm;
    if (!n) { try { n = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { n = {}; } }
    const cal = n._calib;
    if (!cal || !cal.on) return;
    const isArmor = n.hull !== undefined || sy.sys_kind === '装甲' || /装甲/.test(sy.name || '');
    if (isArmor) pct += Number(cal.pct) || 0;
  });
  return pct;
}

function calibPctOf(cal) {
  if (!cal || !cal.on) return 0;
  return Number(cal.pct) || 0;  /* 进阶加成(adv)暂不参与计算 */
}

/* 维修系统：分钟维修量 = 单次 × 工作量 × 60÷(持续+冷却) × 设备数 × k ×（1 + 调校%） */
function repairDpmOf(n, cdRed) {
  if (!n) return 0;
  const one = Number(n.repair) || 0;
  if (!one) return 0;
  const dur = Number(n.dur) || 0, cd = Number(n.cd) || 0;
  const cyc = Math.max(0.5, dur + cd * (1 - (Number(cdRed) || 0) / 100));
  const vol = Number(n.volley) > 0 ? Number(n.volley)
    : ((Number(n.ammo) || 0) * (Number(n.atk) || 0)) || 1;
  const guns = Number(n.guns) || 1;
  const k = Number(n.k) || 1;
  /* 与引擎同口径：先把「每台每分钟」向下取整，再乘台数 */
  const perGun = Math.floor(one * (1 + calibPctOf(n._calib) / 100) * vol * 60 / cyc * k);
  return perGun * guns;
}
/* 多武器两路现算：与 engine._weapon_out 的 weapons 分支同口径
   周期 = 持续 + 冷却 + 突防；对舰扣族护甲，对空 × 命中率 × 协同效率；
   再乘族加成（系统调校 + 整舰 + 节点里的 dmg_<族>），最后整系统求和对舰 / 对空。 */
function weaponSum2(n, cdRed, famAdd) {
  const wl = weaponListOf(n);
  if (!wl) return null;
  const fam0 = n.fam_bonus || {};
  let atk = 0, air = 0;
  wl.forEach(w => {
    const dmg = +w.dmg || 0;
    const dmgA = Number(w.dmg_air) > 0 ? Number(w.dmg_air) : dmg;
    const vol = +w.volley || ((+w.ammo || 0) * (+w.atk || 0));
    /* 对舰单发为 0 的纯防空武器也要算对空，不能整把跳过 */
    if (!vol || (!dmg && !dmgA)) return;
    const dur = +w.dur || 0, cd = +w.cd || 0, pen = +w.pen || 0;
    const cyc = Math.max(0.5, dur + cd * (1 - (+cdRed || 0) / 100) + pen);
    /* 门数 0 = 这把武器不装（文档里副炮常常是 0 门），不能按 1 门算 */
    const g = (w.guns === undefined || w.guns === null) ? 1 : (+w.guns || 0);
    if (!g) return;
    const k = w.k === undefined ? 1 : (Number(w.k) || 1);
    const arm = w.armor === undefined ? 10 : (Number(w.armor) || 0);
    const cm = 1 + calibPctOf(n._calib) / 100;   /* 系统调校作用于基础伤害（单发） */
    const fb = 1 + ((Number(fam0[w.family]) || 0) + (Number((famAdd || {})[w.family]) || 0)) / 100;
    if (dmg > 0) {
      atk += Math.max(0, dmg * cm - arm) * vol / cyc * 60 * g * k * fb + (Number(w.atk_add) || 0);
    }
    /* 对空单发可以和对舰不同：没填 dmg_air 才沿用对舰单发 */
    air += dmgA * cm * vol / cyc * 60 * g * k * fb * wepHitOf(w) * wepCoopOf(w);
  });
  return [atk, air];
}
/* 节点里的「dmg_<武器族>」加成（如 脉冲炮伤害 +15%）：按族累加成 {pulse: 15} */
function famAddOf(nodes, alloc) {
  const fam = {};
  (nodes || []).forEach(nd => {
    const lv = Number((alloc || {})[nd.id] || 0);
    if (!lv) return;
    let e = nd.effect;
    if (typeof e === 'string') { try { e = JSON.parse(e || '{}'); } catch (x) { e = {}; } }
    Object.keys(e || {}).forEach(k => {
      if (k.indexOf('dmg_') !== 0) return;
      if (k === 'dmg_atk_pct' || k === 'dmg_air_pct') return;
      const f = k.slice(4);
      fam[f] = (fam[f] || 0) + nodeLvAmt(nd, k, lv, e[k]);
    });
  });
  return fam;
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
    Object.keys(eff || {}).forEach(k => { agg[k] = (agg[k] || 0) + nodeLvAmt(nd, k, lv, eff[k]); });
  }));
  return agg;
}

/* 结构值 / 抵抗伤害 / 护盾 以「系统数值」为准：ships.base 只是旧副本，可能没跟着系统更新 */
function sysCdRedOf(sy, alloc) {
  let r = 0;
  (sy.nodes || []).forEach(nd => {
    const lv = Number((alloc || {})[nd.id] || 0);
    if (!lv) return;
    let eff = nd.effect;
    if (typeof eff === 'string') { try { eff = JSON.parse(eff || '{}'); } catch (e) { eff = {}; } }
    r += nodeLvAmt(nd, 'cd', lv, (eff || {}).cd) + nodeLvAmt(nd, 'freq', lv, (eff || {}).freq);
  });
  return r;
}
function sysTotals(ship, alloc) {
  /* 舰船自身没有基础属性，下面 8 项全部来自系统数值（含「加力引擎」这类提供闪避的系统） */
  const KEYS = ['hull', 'armor', 'shield', 'eva', 'cruise', 'warp', 'spd', 'repair'];
  const sum = {}, has = {};
  KEYS.forEach(k => { sum[k] = 0; has[k] = 0; });
  ((ship && ship.systems) || []).forEach(sy => {
    let n = {};
    try { n = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { n = {}; }
    KEYS.forEach(k => {
      if (n[k] === undefined || n[k] === null || n[k] === '') return;
      let v = Number(n[k]) || 0;
      /* 维修量按公式现算（单次 × 工作量 × 60÷周期 × 设备数 × 调校） */
      if (k === 'repair') { const rd = repairDpmOf(n, sysCdRedOf(sy, alloc)); if (!rd) return; v = rd; }
      sum[k] += v;
      has[k] = 1;
    });
  });
  return { sum: sum, has: has };
}

/* 一行一个基础加成项：key 用于取值，label/unit 用于显示 */
const CMP_ROWS = [
  { k: 'hull',       t: '舰船结构值', u: '点' },
  { k: 'armor',      t: '抵抗伤害', u: '点' },
  { k: 'shield',     t: '护盾值',   u: '%' },
  { k: 'eva',        t: '通用闪避', u: '%' },
  { k: 'cruise',     t: '巡航速度', u: 'jm' },
  { k: 'warp',       t: '曲率速度', u: 'jm' },
  { k: 'spd',        t: '突防速度', u: 's' },
  { k: 'repair',     t: '维修量',   u: '点' },
  { k: 'dmg_atk',    t: '对舰',     u: '/分' },
  { k: 'dmg_air',    t: '对空',     u: '/分' }
];

/* 对舰/对空 = 该系统页面上的基础值 ×（1 + 该系统的伤害加成%）
   要点：只对「基础值」与「加成」做计算，不引入周期/冷却等换算；
   伤害节点挂在哪个系统上，就只抬哪个系统的三行（装甲系统的伤害节点不会串到武器上）。 */
/* 暴击期望倍率 = 1 + [Σ(概率×暴伤) + 全局暴伤×概率之和]/10000（与 engine._crit_mul 同口径）
    录入层只支持两种格式，界面上也按这两种引导：
    ① 成对：同一节点同时写「暴击率 + 暴击伤害」= 「30% 概率额外造成 50% 暴击伤害」→ 30 与 50 相乘；
    ② 单独暴伤：节点只写「暴击伤害」= 全局暴伤，加在同一系统的所有概率上（没有概率时不生效）。
    旧公式 (Σ概率)×(Σ暴伤) 在两条各自带暴伤的概率效果并存时会高估：0.2×0.3 + 0.1×0.8 = 0.14，
    旧算法 (0.2+0.1)×(0.3+0.8) = 0.33。不做多系统连乘。 */
function critMulOfPairs(pairs) {
  let both = 0, pAll = 0, cdOrphan = 0;
  (pairs || []).forEach(p => {
    const a = +p[0] || 0, b = +p[1] || 0;
    pAll += a;
    if (a && b) both += a * b; else if (b) cdOrphan += b;
  });
  return 1 + (both + cdOrphan * pAll) / 10000;
}
function critTotals(ship, alloc) {
  let rate = 0, dmg = 0;
  ((ship && ship.systems) || []).forEach(sy => (sy.nodes || []).forEach(nd => {
    const lv = Number((alloc || {})[nd.id] || 0);
    if (!lv) return;
    let e = nd.effect;
    if (typeof e === 'string') { try { e = JSON.parse(e || '{}'); } catch (x) { e = {}; } }
    e = e || {};
    rate += nodeLvAmt(nd, 'crit_rate', lv, e.crit_rate);
    dmg += nodeLvAmt(nd, 'crit', lv, e.crit);
  }));
  return { rate: rate, dmg: dmg };
}
function critPairsOf(ship, alloc) {
  const out = [];
  ((ship && ship.systems) || []).forEach(sy => (sy.nodes || []).forEach(nd => {
    const lv = Number((alloc || {})[nd.id] || 0);
    if (!lv) return;
    let e = nd.effect;
    if (typeof e === 'string') { try { e = JSON.parse(e || '{}'); } catch (x) { e = {}; } }
    e = e || {};
    if ('crit_rate' in e || 'crit' in e) {
      out.push([nodeLvAmt(nd, 'crit_rate', lv, e.crit_rate), nodeLvAmt(nd, 'crit', lv, e.crit)]);
    }
  }));
  return out;
}
function critMulOf(ship, alloc) {
  return critMulOfPairs(critPairsOf(ship, alloc));
}

function sysDmgSum(ship, alloc) {
  const out = { dmg_atk: 0, dmg_air: 0 };
  ((ship && ship.systems) || []).forEach(sy => {
    let n = {};
    try { n = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { n = {}; }
    const six = weaponSixOf(n);
    const multi = weaponListOf(n);
    if (!six && !multi && n.dmg_atk === undefined && n.dmg_air === undefined) return;
    let pct = 0, pAtk = 0, pAir = 0, cdRed = 0;
    (sy.nodes || []).forEach(nd => {
      const lv = Number((alloc || {})[nd.id] || 0);
      if (!lv) return;
      let e = nd.effect;
      if (typeof e === 'string') { try { e = JSON.parse(e || '{}'); } catch (x) { e = {}; } }
      e = e || {};
      pct += nodeLvAmt(nd, 'dmg', lv, e.dmg);
      pAtk += nodeLvAmt(nd, 'dmg_atk_pct', lv, e.dmg_atk_pct);
      pAir += nodeLvAmt(nd, 'dmg_air_pct', lv, e.dmg_air_pct);
      cdRed += nodeLvAmt(nd, 'cd', lv, e.cd) + nodeLvAmt(nd, 'freq', lv, e.freq);
    });
    const m = 1 + pct / 100;
    const crOwn = Number(n.crit_rate) || 0, cdOwn = Number(n.crit) || 0;
    const cmOwn = (crOwn > 0 && cdOwn > 0) ? 1 + (crOwn / 100) * (cdOwn / 100) : 1;
    const famA = multi ? famAddOf(sy.nodes, alloc) : null;
    const w2 = multi ? weaponSum2(n, cdRed, famA) : null;
    const b2 = w2 || (six ? weaponBase2(n, six, cdRed)
      : [Number(n.dmg_atk) || 0, Number(n.dmg_air) || 0]);
    out.dmg_atk += b2[0] * m * (1 + pAtk / 100) * cmOwn;
    out.dmg_air += b2[1] * m * (1 + pAir / 100) * cmOwn;
  });
  const cm = critMulOf(ship, alloc);
  if (cm > 1) { out.dmg_atk *= cm; out.dmg_air *= cm; }
  out.dmg_atk = Math.round(out.dmg_atk * 10) / 10;
  out.dmg_air = Math.round(out.dmg_air * 10) / 10;
  return out;
}

function slotBaseVals(slotKey) {
  const sl = S.slots[slotKey];
  const ship = sl && shipOf(sl.ship);
  if (!ship) return null;
  const base = ship.base || {};
  const agg = slotAgg(slotKey);
  /* 对舰/对空：逐系统按各自周期现算，各系统 持续/冷却/突防 不同，不能全局乘一个系数 */
  const sum = sysDmgSum(ship, sl.alloc);
  const st = sysTotals(ship, (S.slots[S.cur] || {}).alloc);
  const pick = (k, v) => (st.has[k] ? st.sum[k] : (Number(v) || 0));
  return {
    hull: (Number(pick('hull', base.hull)) || 0)
      * (1 + ((Number(agg.hull) || 0) + calibHullPctOf(ship)) / 100),   /* 节点加成 + 装甲系统调校 */
    armor: effVal('armor', pick('armor', base.armor), agg),
    shield: effVal('shield', pick('shield', base.shield), agg),
    eva: effVal('eva', pick('eva', base.eva), agg),
    cruise: effVal('speed', pick('cruise', base.cruise), agg),
    warp: effVal('warp', pick('warp', base.warp), agg),
    spd: effVal('spd', pick('spd', base.spd), { spd: Number(agg.move) || 0 }),
    repair: effVal('repair', pick('repair', base.repair), agg),
    dmg_atk: sum.dmg_atk,
    dmg_air: sum.dmg_air
  };
}

/* 舰载机合计：与 engine.simulate 同一条公式
   DPM = 单架基础 dpm × 架次 ×（1 + 舰载机伤害加成% / 100）
   母舰系统的基础加成（结构/护甲/闪避…）不作用到舰载机上，只有 plane 这个键生效。 */
/* 只有「带舱位」的系统，加成才会作用到舰载机上 */
function sysHasBayJs(sy) {
  if (!sy) return false;
  if ((sy.bays || []).length) return true;
  const n = sy.norm || sy.stats_norm || {};
  return (+n.bay_plane || 0) + (+n.bay_boat || 0) + (+n.bay_drone || 0) > 0;
}
/* 母舰侧：只统计「带舱位系统」的 plane / dmg / crit / crit_rate */
function bayAggBySlot(sl) {
  const out = {};
  const ship = shipOf((sl || {}).ship);
  if (!ship) return out;
  const al = (sl || {}).alloc || {};
  (ship.systems || []).forEach(sy => {
    if (!sysHasBayJs(sy)) return;
    const key = (sy.slot || '').trim();
    const o = out[key] || (out[key] = { plane: 0, dmg: 0, crit: 0, crit_rate: 0 });
    (sy.nodes || []).forEach(nd => {
      const lv = Math.max(0, Math.min(+al[nd.id] || 0, +nd.max_lv || 0));
      if (lv <= 0) return;
      const pars = String(nd.parent || "").split(/[,，]/).map(x => x.trim()).filter(Boolean);
      if (pars.length && !pars.some(pp => (+al[pp] || 0) > 0)) return;
      const eff = nd.effect || {};
      Object.keys(eff || {}).forEach(k => {
        o[k] = (+o[k] || 0) + nodeLvAmt(nd, k, lv, eff[k]);
      });
    });
  });
  return out;
}
function bayAggFor(key) {
  const out = { plane: 0, dmg: 0, crit: 0, crit_rate: 0 };
  const sl = S.slots[key] || {};
  const ship = shipOf(sl.ship);
  if (!ship) return out;
  const al = sl.alloc || {};
  (ship.systems || []).forEach(sy => {
    if (!sysHasBayJs(sy)) return;
    (sy.nodes || []).forEach(nd => {
      let lv = Math.max(0, Math.min(+al[nd.id] || 0, +nd.max_lv || 0));
      if (lv <= 0) return;
      const pars = String(nd.parent || "").split(/[,，]/).map(x => x.trim()).filter(Boolean);
      if (pars.length && !pars.some(pp => (+al[pp] || 0) > 0)) return;
      const eff = nd.effect || {};
      Object.keys(eff || {}).forEach(k => {
        out[k] = (+out[k] || 0) + nodeLvAmt(nd, k, lv, eff[k]);
      });
    });
  });
  return out;
}
/* 母舰侧：按槽位收集「概率×暴伤」对，供 critMulOfPairs 用（与 bayAggBySlot 同筛选口径） */
function bayPairsBySlot(sl) {
  const out = {};
  const ship = shipOf((sl || {}).ship);
  if (!ship) return out;
  const al = (sl || {}).alloc || {};
  (ship.systems || []).forEach(sy => {
    if (!sysHasBayJs(sy)) return;
    const key = (sy.slot || '').trim();
    (sy.nodes || []).forEach(nd => {
      const lv = Math.max(0, Math.min(+al[nd.id] || 0, +nd.max_lv || 0));
      if (lv <= 0) return;
      const pars = String(nd.parent || "").split(/[,，]/).map(x => x.trim()).filter(Boolean);
      if (pars.length && !pars.some(pp => (+al[pp] || 0) > 0)) return;
      const eff = nd.effect || {};
      if ('crit_rate' in eff || 'crit' in eff) {
        (out[key] = out[key] || []).push([nodeLvAmt(nd, 'crit_rate', lv, eff.crit_rate), nodeLvAmt(nd, 'crit', lv, eff.crit)]);
      }
    });
  });
  return out;
}
/* 舰载机自身加点：同型号多架共用一套，存在 sl.palloc[机型 id] 里 */
function pallocOf(sl, pid) {
  sl.palloc = sl.palloc || {};
  return sl.palloc[pid] || (sl.palloc[pid] = {});
}
/* 这一架机「自己的」系统节点加成：只用它自己 ships 记录里的系统节点（与 engine.simulate 同口径） */
function planeOwnAgg(pid, sl) {
  const out = { plane: 0, dmg: 0, crit: 0, crit_rate: 0 };
  const ps = shipOf(pid);
  if (!ps) return out;
  /* 起点是这架机 base.bonus 里写死的自身加成（与 engine 的 _own 同口径） */
  const pf = ((S.bp && S.bp.planes) || []).find(z => z.id === pid) || {};
  let pbase = {};
  try { pbase = typeof pf.base === 'string' ? (JSON.parse(pf.base) || {}) : (pf.base || {}); } catch (e) { pbase = {}; }
  const bb = pbase.bonus || {};
  Object.keys(bb || {}).forEach(k => { out[k] = (+out[k] || 0) + (+bb[k] || 0); });
  const al = pallocOf(sl, pid);
  (ps.systems || []).forEach(sy => (sy.nodes || []).forEach(nd => {
    const lv = Math.max(0, Math.min(+al[nd.id] || 0, +nd.max_lv || 0));
    if (lv <= 0) return;
    let eff = nd.effect;
    if (typeof eff === 'string') { try { eff = JSON.parse(eff || '{}'); } catch (e) { eff = {}; } }
    const pars = String(nd.parent || '').split(/[,，]/).map(x => x.trim()).filter(Boolean);
    if (pars.length && !pars.some(pp => (+al[pp] || 0) > 0)) return;
    Object.keys(eff || {}).forEach(k => {
      out[k] = (+out[k] || 0) + nodeLvAmt(nd, k, lv, eff[k]);
    });
  }));
  return out;
}
/* 这一架机「自己的」概率×暴伤对：base.bonus 一条 + 每个自身节点一条 */
function planeOwnPairs(pid, sl) {
  const out = [];
  const pf = ((S.bp && S.bp.planes) || []).find(z => z.id === pid) || {};
  let pbase = {};
  try { pbase = typeof pf.base === 'string' ? (JSON.parse(pf.base) || {}) : (pf.base || {}); } catch (e) { pbase = {}; }
  const bb = pbase.bonus || {};
  if ('crit_rate' in bb || 'crit' in bb) out.push([+bb.crit_rate || 0, +bb.crit || 0]);
  const ps = shipOf(pid);
  if (!ps) return out;
  const al = pallocOf(sl, pid);
  (ps.systems || []).forEach(sy => (sy.nodes || []).forEach(nd => {
    const lv = Math.max(0, Math.min(+al[nd.id] || 0, +nd.max_lv || 0));
    if (lv <= 0) return;
    let eff = nd.effect;
    if (typeof eff === 'string') { try { eff = JSON.parse(eff || '{}'); } catch (e) { eff = {}; } }
    eff = eff || {};
    const pars = String(nd.parent || '').split(/[,，]/).map(x => x.trim()).filter(Boolean);
    if (pars.length && !pars.some(pp => (+al[pp] || 0) > 0)) return;
    if ('crit_rate' in eff || 'crit' in eff) out.push([nodeLvAmt(nd, 'crit_rate', lv, eff.crit_rate), nodeLvAmt(nd, 'crit', lv, eff.crit)]);
  }));
  return out;
}
/* 舰载机单架 DPM：优先完整系统制，退回历史 dpm 字段（与 engine.plane_dpm 同口径） */
function planeBaseDpm(base, cdReduce) {
  base = base || {};
  const dmg = +base.dmg || 0, ammo = +base.ammo || 0, atk = +base.atk || 1;
  let dur = +base.dur || 0, cdv = +base.cd || 0;
  if (dmg && ammo && (dur || cdv)) {
    cdv = cdv * (1 - (+cdReduce || 0) / 100);
    return dmg * ammo * atk / Math.max(0.5, dur + cdv) * 60;
  }
  return +base.dpm || 0;
}
function planeTotals(key) {
  const sl = S.slots[key] || mk();
  const pool = (S.bp && S.bp.planes) || [];
  const bySlot = bayAggBySlot(sl);
  const byPairs = bayPairsBySlot(sl);
  const rows = (sl.planes || []).filter(x => (Number(x.count) || 0) > 0).map(x => {
    const pf = pool.find(z => z.id === x.id) || {};
    let base = {};
    try { base = typeof pf.base === 'string' ? (JSON.parse(pf.base) || {}) : (pf.base || {}); } catch (e) { base = {}; }
    const shp = shipOf(sl.ship) || { modules: [] };
    const mod = holderOf(shp, x.m) || {};
    const car = bySlot[(mod.slot || '').trim()] || { plane: 0, dmg: 0, crit: 0, crit_rate: 0 };
    const own = planeOwnAgg(x.id, sl);
    const ownPct = own.plane + own.dmg;
    const carPct = (+car.plane || 0) + (+car.dmg || 0);
    const pct = carPct + ownPct;
    const cm = critMulOfPairs((byPairs[(mod.slot || '').trim()] || []).concat(planeOwnPairs(x.id, sl)));
    const c = Number(x.count) || 0;
    const ownCd = (+own.cd || 0) + (+own.freq || 0);
    const carCd = (+car.cd || 0) + (+car.freq || 0);
    const per = planeBaseDpm(base, ownCd + carCd) * (1 + pct / 100) * cm;
    return { id: x.id, name: pf.name || x.id, kind: pf.kind || '', m: x.m, bay: x.bay,
      count: c, per: per, carPct: carPct, ownPct: ownPct, pct: pct, critMul: cm,
      dpm: per * c };
  });
  return {
    count: rows.reduce((a, r) => a + r.count, 0),
    dpm: rows.reduce((a, r) => a + r.dpm, 0),
    bonus: rows.length ? (rows[0].pct || 0) : 0, rows: rows
  };
}
/* ---------- 舰载机自身加点 / 基础加成里的战机·护航艇 ---------- */
/* 加点区：为已搭载的舰载机渲染「它自己的系统树」，alloc 按型号存 sl.palloc（同型号多架共用一套） */
function renderPlaneTrees() {
  const host = $('#planeTrees');
  if (!host) return;
  host.innerHTML = '';
  const sl = S.slots[S.cur];
  if (!sl) return;
  const models = [];
  (sl.planes || []).forEach(x => {
    const c = Number(x.count) || 0;
    if (c <= 0) return;
    let m = models.find(z => z.id === x.id);
    if (!m) {
      const pf = ((S.bp && S.bp.planes) || []).find(z => z.id === x.id) || {};
      m = { id: x.id, name: pf.name || x.id, kind: pf.kind || '', count: 0 };
      models.push(m);
    }
    m.count += c;
  });
  if (!models.length) return;
  const head = el('div', 'planeblock-head');
  head.appendChild(el('b', '', '舰载机自身加点'));
  head.appendChild(el('span', 'muted', '　同型号多架共用一套；只算这架机自己的系统，母舰系统加成在「基础加成」里另算'));
  host.appendChild(head);
  models.forEach(m => host.appendChild(planeTreeBlock(m, sl)));
}

function planeTreeBlock(m, sl) {
  const ps = shipOf(m.id);
  const wrap = el('div', 'planeblock');
  const head = el('div', 'pb-head');
  head.appendChild(el('b', '', '舰载机：' + m.name));
  if (m.kind) head.appendChild(el('span', 'chip', m.kind));
  head.appendChild(el('span', 'chip', m.count + ' 架（共用这套加点）'));
  const own = planeOwnAgg(m.id, sl);
  const ownPct = own.plane + own.dmg;
  head.appendChild(el('span', 'muted', '自身加成 ' + (ownPct ? '+' + fmtNum(ownPct) + '%' : '未加')));
  wrap.appendChild(head);
  if (!ps || !(ps.systems || []).length) {
    wrap.appendChild(el('div', 'muted', '这架机在「数据管理」里还没有系统，先给它建系统 / 加点节点。'));
    return wrap;
  }
  const syslist = (ps.systems || []).filter(sy => (sy.nodes || []).length);
  if (!syslist.length) {
    wrap.appendChild(el('div', 'muted', '这架机的系统还没有加点项。'));
    return wrap;
  }
  sl.psys = sl.psys || {};
  let curId = sl.psys[m.id];
  if (!syslist.some(sy => sy.id === curId)) curId = syslist[0].id;
  sl.psys[m.id] = curId;
  const al = pallocOf(sl, m.id);
  const proxy = { alloc: al, ship: m.id };
  const tabs = el('div', 'systabs');
  syslist.forEach(sy => {
    const act = sy.nodes.filter(nd => (+al[nd.id] || 0) > 0).length;
    const b = el('button', sy.id === curId ? 'on' : '', sy.name + ' ' + act + '/' + sy.nodes.length);
    b.onclick = () => { sl.psys[m.id] = sy.id; renderPlaneTrees(); };
    tabs.appendChild(b);
  });
  const sy = syslist.find(x => x.id === curId);
  const lane = el('div', 'wiz-lane');
  treeCols(sy.nodes).forEach((col, ci) => {
    const box = el('div', 'wiz-col');
    box.appendChild(el('div', 'wiz-colhead', '第 ' + (ci + 1) + ' 层'));
    col.forEach(({ code, node }) => box.appendChild(nodeCard(node, proxy, sy, code)));
    lane.appendChild(box);
  });
  wrap.appendChild(tabs);
  wrap.appendChild(lane);
  const used = ps.systems.reduce((a, x) => a + sysUsed(x, proxy), 0);
  wrap.appendChild(el('div', 'muted', '这套加点消耗 ' + used + ' 技术值'
    + (ps.tech_total ? '（整机上限 ' + ps.tech_total + '）' : '')));
  return wrap;
}

/* 基础加成：战机 / 护航艇 两块，只显示加成后的结果 */
function renderBaPlanes() {
  const host = $('#baPlanes');
  if (!host) return;
  host.innerHTML = '';
  const pt = planeTotals(S.cur);
  ['战机', '护航艇'].forEach(kind => {
    const rows = pt.rows.filter(r => r.kind === kind);
    if (!rows.length) return;
    const box = el('div', 'planeblock');
    const head = el('div', 'pb-head');
    head.appendChild(el('b', '', kind));
    head.appendChild(el('span', 'chip', rows.reduce((a, r) => a + r.count, 0) + ' 架'));
    box.appendChild(head);
    const tbl = el('table', 'tbl planebase-tbl');
    const thead = el('thead'); const htr = el('tr');
    ['型号', '架次', '单架 DPM', '编队 DPM', '自身 / 母舰'].forEach(t => htr.appendChild(el('th', '', t)));
    thead.appendChild(htr); tbl.appendChild(thead);
    const tb = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      tr.appendChild(el('td', '', r.name));
      tr.appendChild(el('td', 'num', String(r.count)));
      tr.appendChild(el('td', 'num', fmtNum(r.per)));
      tr.appendChild(el('td', 'num', fmtNum(r.dpm)));
      tr.appendChild(el('td', 'muted', (r.ownPct ? '+' + fmtNum(r.ownPct) + '%' : '—')
        + ' / ' + (r.carPct ? '+' + fmtNum(r.carPct) + '%' : '—')));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.appendChild(tbl);
    host.appendChild(box);
  });
}
/* ---------- 计算 ---------- */
let pend = {};
function recalc(key) {
  const sl = S.slots[key];
  if (!S.bp || !sl.ship) return;
  if (!shipAnyOf(sl.ship)) {          /* 船已经被删：先换一艘，再算，避免反复弹「blueprint not found」 */
    const first = ((S.bp.ships || [])[0]) || null;
    sl.ship = first ? first.id : '';
    sl.noCarrier = false; sl.modules = {}; sl.alloc = {}; sl.planes = [];
    if (!sl.ship) return;
    if (key === S.cur) renderEditor();
  }
  clearTimeout(pend[key]);
  pend[key] = setTimeout(async () => {
    try {
      /* 舰载机的自身加点按型号存在 sl.palloc，提交时按型号展开到每条搭载记录（同型号多架共用一套） */
      const planes = (sl.planes || []).map(x => Object.assign({}, x,
        {alloc: Object.assign({}, (sl.palloc || {})[x.id] || {})}));
      const j = await api('/api/simulate', {method: 'POST',
        body: sl.noCarrier ? {planes_only: true, planes: planes, light: true}
          : {ship: sl.ship, modules: sl.modules, alloc: sl.alloc, planes: planes, light: true}});
      S.results = S.results || {}; S.results[key] = j.result;
      renderResults();
    } catch (e) {
      if (e && e.status === 400 && /blueprint not found/.test(e.message || '')) {
        /* 服务端说这条船不在了（别人删的 / 刚被去重）：刷新列表并换一艘 */
        toast('这艘船已经从库里删掉了，已自动换一艘重新计算', 'bad');
        await loadBlueprints(true);
        return;
      }
      toast('计算失败：' + e.message, 'bad');
    }
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

/* ---------- 属性存在性：有基础值或有加成，才算这艘船有这项 ---------- */
function slotPresence(slotKey) {
  const sl = S.slots[slotKey];
  const ship = sl && shipOf(sl.ship);
  const has = {};
  if (!ship) return has;
  const alloc = sl.alloc || {};
  (ship.systems || []).forEach(sy => {
    let n = {};
    try { n = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { n = {}; }
    Object.keys(n).forEach(k => { has[k] = 1; });
    (sy.nodes || []).forEach(nd => {
      const lv = Number(alloc[nd.id] || 0);
      if (!lv) return;
      let e = nd.effect;
      if (typeof e === 'string') { try { e = JSON.parse(e || '{}'); } catch (x) { e = {}; } }
      Object.keys(e || {}).forEach(k => { has[k] = 1; });
    });
  });
  return has;
}

/* 效果键 → 中文名（新加的效果若不在表里，直接显示键名，保证看得见） */
const EFF_CN = {
  dmg: '伤害', dmg_atk_pct: '对舰伤害', dmg_air_pct: '防空伤害',
  cd: '冷却缩减', freq: '频率', dur: '持续缩短', cast: '持续缩短',
  acc: '通用命中', acc_plane: '舰载机命中', acc_small: '小型命中', acc_large: '大型命中',
  crit: '暴击伤害', crit_rate: '暴击率', critres: '抗暴', lock: '锁定时间缩减', lockeff_pct: '锁敌效率',
  eva: '通用闪避', eva_missile: '导弹闪避', intc: '拦截率', focus: '锁定优先',
  range: '目标范围', selfheal: '自维修', syshull: '系统结构', shield: '护盾', armor: '护甲',
  hull: '结构', repair: '维修', speed: '巡航', warp: '曲率',
  move: '突防速度', spd: '突防速度',          /* move=加成%，spd=基础值(s)，展示层同名但单位不同 */
  cd_up: '冷却延长', heal: '维修', dmg_bonus: '伤害'
};
const CMP_SRC = {
  hull: ['hull'], armor: ['armor'], shield: ['shield'], eva: ['eva'],
  cruise: ['cruise', 'speed'], warp: ['warp'], spd: ['spd', 'move'], repair: ['repair'],
  dmg_atk: ['dmg_atk', 'dmg', 'dmg_atk_pct'], dmg_air: ['dmg_air', 'dmg', 'dmg_air_pct']
};
const CMP_USED = {};
Object.keys(CMP_SRC).forEach(k => CMP_SRC[k].forEach(s => { CMP_USED[s] = 1; }));

function renderResults() {
  renderSlotTabs();
  const body = $('#cmpBody'); body.innerHTML = '';
  const onlyDiff = !!($('#abDiff') && $('#abDiff').checked);
  const valsBySlot = SLOTS.map(k => slotBaseVals(k));
  const presBySlot = SLOTS.map(k => slotPresence(k));
  const aggsBySlot = SLOTS.map(k => slotAgg(k) || {});
  CMP_ROWS.forEach(row => {
    const srcs = CMP_SRC[row.k] || [row.k];
    /* 基础值与加成都没有 → 这行不显示 */
    if (!presBySlot.some(p => srcs.some(s => p[s]))) return;
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

  /* 舰载机：A/B 各自搭载不同，单列 3 行，避免「换了飞机但差值 0」 */
  const pls = SLOTS.map(k => planeTotals(k));
  if (pls.some(p => p.count)) {
    [['舰载机 架次', 'count', 0], ['舰载机 DPM', 'dpm', 1]].forEach(([label, k, dec]) => {
      const v = pls.map(p => p[k] || 0);
      if (onlyDiff && Math.abs(v[0] - v[1]) < 1e-9) return;
      const tr = el('tr', 'prow');
      tr.appendChild(el('td', '', label));
      const best = Math.max.apply(null, v);
      v.forEach(x => tr.appendChild(el('td', (x === best && x) ? 'best' : '', fmt(x, dec))));
      const d = v[1] - v[0];
      tr.appendChild(el('td', d === 0 ? '' : (d > 0 ? 'diff-pos' : 'diff-neg'),
        (d > 0 ? '+' : '') + fmt(d, dec)));
      body.appendChild(tr);
    });
  }

  $('#cmpNote').textContent = '对比这两套方案在同一艘船上的基础值与最终数值：加点带来的加成都已经算进对舰 / 对空等数字里，'
    + '不再单列成「加成 · xxx」行；逐条加成明细看左栏「本系统加成效果」（只列当前选中系统）。'
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
  if ((sl.carrierMods || []).length) {
    /* 只有「模块」要进 modules（系统自带舱位由引擎自动接上），否则会报「模块 X 不在模块表里」 */
    const sh0 = shipOf(sl.ship);
    const mids = sl.carrierMods.filter(id => ((sh0 && sh0.modules) || []).some(m => m.id === id));
    if (mids.length) keep['M1'] = mids;
  }
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
    /* 这里不算 EHP：舰船数据板块只给 DPM；舰载机只按舱位与编组选用 */
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

  // 勾选状态自愈：第一次进来全勾上；问卷里后加的舱位也自动勾上（见 seedCarrierMods）
  SLOTS.forEach(k0 => {
    const sl0 = S.slots[k0];
    if (sl0.noCarrier || !sl0.ship) return;
    const sh0 = shipOf(sl0.ship);
    if (!sh0 || !canMod(sh0)) return;
    if (seedCarrierMods(sl0, sh0)) {
      syncLaunchSlots((sh0.modules || []).filter(m => m.mkind), k0);
      setTimeout(() => recalc(k0), 0);
    }
  });

  /* 母舰本身没有舱位（模块和系统都没有 bays）的方案，不进「舰载机组合」；卡片保留，全都没舱位时给一句说明 */
  const visSlots = SLOTS.filter(k0 => {
    const sl0 = S.slots[k0];
    if (sl0.noCarrier || !sl0.ship) return true;
    const sh0 = shipOf(sl0.ship);
    return !!(sh0 && carrierModsOf(sh0).length);
  });
  const skipSlots = SLOTS.filter(k0 => visSlots.indexOf(k0) < 0);
  const pcard = $('#planeCard');
  if (pcard) pcard.style.display = '';
  if (!visSlots.length) {
    const t0 = $('#planeCmp'); if (t0) t0.innerHTML = '';
    const tb0 = t0 && t0.closest('table'); if (tb0) tb0.style.display = 'none';
    const names = SLOTS.map(k0 => {
      const sl0 = S.slots[k0];
      if (sl0.noCarrier) return k0 + '：不带母舰';
      const sh0 = sl0.ship && shipOf(sl0.ship);
      return k0 + '：' + ((sh0 && sh0.name) || sl0.ship || '未选');
    }).join(' / ');
    const hb = el('div', 'muted', '当前两套方案的母舰都没有搭载舱位（' + names + '），所以这里没有可配的舰载机。'
      + '左上角「蓝图」换成 CV3000 / 太阳鲸 / 猎兵级 这类带舱位的船，再来配。');
    hb.style.padding = '10px 12px';
    hb.style.border = '1px dashed var(--line)';
    hb.style.borderRadius = '8px';
    host.appendChild(hb);
    return;
  }

  const curTag = el('div', 'row muted');
  curTag.appendChild(el('span', '', '下面两套方案都在这一页编辑：左边填完 A，再去右上角切到 B 填另一套；两套对比见表格。'));
  curTag.style.marginBottom = '8px';
  host.appendChild(curTag);

  visSlots.forEach(k => {
    const sl = S.slots[k];
    const r = (S.results || {})[k] || {};
    const card = el('div', 'card');
    card.appendChild(el('h2', '', '方案 ' + k + ' · 母舰与舰载机'));

    const sel = el('select');
    sel.appendChild(new Option('（不带母舰 · 只看舰载机）', ''));
    (S.bp.ships || []).filter(x => x.kind !== '舰载机' && carrierModsOf(x).length).forEach(x => {
      sel.appendChild(new Option(x.name + '（' + (x.kind || x.size) + '）', x.id));
    });
    sel.value = sl.noCarrier ? '' : (sl.ship || '');
    sel.onchange = () => {
      if (!sel.value) {
        sl.noCarrier = true; sl.carrierMods = []; sl.planes = []; sl.modules = {};
      } else {
        const sh = shipOf(sel.value);
        sl.noCarrier = false; sl.ship = sel.value; sl.alloc = {}; sl.planes = [];
        sl.carrierMods = carrierModsOf(sh);
        sl.modules = {};
        syncLaunchSlots(carrierModsOf(sh).map(id => holderOf(sh, id)).filter(Boolean), k);
        S.sys[k] = (((sh.systems || [])[0]) || {}).id || '';
      }
      recalc(k); setTimeout(renderPlanes, 240);
    };
    const rowSel = el('label', 'row');
    rowSel.appendChild(el('span', '', '母舰'));
    rowSel.appendChild(sel);
    card.appendChild(rowSel);

    const ship = sl.noCarrier ? null : shipOf(sl.ship);
    const holders = ship ? carrierModsOf(ship).map(id => holderOf(ship, id)).filter(Boolean) : [];
    if (ship && !holders.length) { sl.carrierMods = []; sl.planes = []; host.appendChild(card); return; }
    /* 换过母舰之后，把旧母舰留下的勾选/载荷清掉，避免冒出「模块 X 只有 0 个舱」这种幽灵行 */
    sl.carrierMods = (sl.carrierMods || []).filter(id => holders.some(m => m.id === id));
    sl.planes = (sl.planes || []).filter(pp => sl.carrierMods.includes(pp.m));
    if (ship) {
      holders.forEach(m => {
        const lb = el('label', 'row');
        const ck = el('input'); ck.type = 'checkbox';
        ck.checked = (sl.carrierMods || []).includes(m.id);
        ck.onchange = () => {
          sl.carrierMods = sl.carrierMods || [];
          const letter = (m.slot || '').charAt(0);
          if (ck.checked) {
            // 同系列互斥：勾了就自动取消同 M / A / B 系列的其它搭载位（模块和系统一起算）
            if (letter) {
              const clash = sl.carrierMods.filter(id => {
                const om = holderOf(ship, id);
                return om && om.slot && om.slot.charAt(0) === letter;
              });
              if (clash.length) {
                sl.carrierMods = sl.carrierMods.filter(id => !clash.includes(id));
                toast(letter + ' 系列只能选一个搭载位，已把 ' + clash.join('、') + ' 换掉', 'warn');
              }
            }
            sl.carrierMods.push(m.id);
          }
          else sl.carrierMods = sl.carrierMods.filter(x => x !== m.id);
          sl.planes = (sl.planes || []).filter(x => sl.carrierMods.includes(x.m));
          syncLaunchSlots(holders, k);
          recalc(k); setTimeout(renderPlanes, 240);
        };
        lb.appendChild(ck);
        const bays = baysOfHolder(m);
        const isSys = !((ship.modules || []).some(z => z.id === m.id));
        lb.appendChild(el('span', '', ' ' + m.name + (isSys ? '（系统自带舱位）' : '') + '　'
          + bays.map(b => (b.kind || '') + ' ' + (b.cap || 0) + ' 舱'
              + (b.allow_group ? '（' + b.allow_group + '）' : '')).join(' ＋ ')));
        card.appendChild(lb);
      });
    }

    const lchs = r.launch ? (Array.isArray(r.launch) ? r.launch : [r.launch]) : [];
    const modOf = id => holderOf(ship || shipOf(sl.ship), id);
    const cm = (sl.carrierMods || []).filter(id => modOf(id));
    // 每个搭载位按 bays 展开成若干「装载位」
    const holds = [];
    cm.forEach(id => {
      const m = modOf(id);
      if (!m) return;
      const bays = baysOfHolder(m);
      if (!bays.length) return;   /* 没有舱位的搭载位整条跳过，不再造空行 */
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
      const _lmN = holders.length;
      const td0 = el('td', 'muted', (sl.noCarrier
        ? '当前是「不带母舰」模式，只看舰载机；切回母舰才会出现舱位。'
        : (!ship
            ? '先在上面选一条母舰。'
            : (_lmN ? '这条母舰有 ' + _lmN + ' 个搭载位，先把上面那个勾上，舱位就出来了。'
                    : '这条母舰还没有可用的搭载舱位 —— 舱位可以写在模块上，也可以直接写在系统上（问卷第 3 步）。'))));
      td0.colSpan = 4;
      tr0.appendChild(td0); tb.appendChild(tr0);
    }

    // 一个舱位一行：舱位 → 选蓝图（只列同类，纯名字）→ 架次（加减）
    holds.forEach(h => {
      const tr = el('tr');
      tr.appendChild(el('td', '', h.mod + ' · ' + h.kind + ' ' + h.cap + ' 舱'));

      const cand = bps.filter(p => (!h.kind || !p.kind || p.kind === h.kind) && groupOk(p.pgroup, h.allow, h.kind));
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
        if (pid && c > 0) sl.planes.push({ id: pid, count: c, m: h.mid, bay: h.bi,
          alloc: Object.assign({}, (sl.palloc || {})[pid] || {}) });
        /* 当前方案：装/卸舰载机后立刻重绘它自己的加点块和「基础加成」里的战机/护航艇 */
        if (k === S.cur) { renderPlaneTrees(); renderBaseAttrs(); }
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

      tb.appendChild(tr);          /* 之前漏了这一句：行建好了却没挂进表里，页面上一片空白 */
    });

    tbl.appendChild(tb);
    card.appendChild(tbl);


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

  if (skipSlots.length) {
    const who = skipSlots.map(k0 => {
      const sl0 = S.slots[k0];
      const sh0 = sl0.ship && shipOf(sl0.ship);
      return '方案 ' + k0 + '（' + ((sh0 && sh0.name) || sl0.ship || '未选') + '）';
    }).join('、');
    const fe = el('div', 'muted', '已跳过 ' + who + '：母舰没有搭载舱位，不参与舰载机搭配。');
    fe.style.marginTop = '8px';
    host.appendChild(fe);
  }

  const t2 = $('#planeCmp'); t2.innerHTML = '';
  const t2p = t2 && t2.closest('table'); if (t2p) t2p.style.display = '';
  visSlots.forEach(k2 => {
    const rr = (S.results || {})[k2] || {};
    const s2 = S.slots[k2];
    const mods = (s2.carrierMods || []).map(id => {
      const sh = shipOf(s2.ship);
      const m = holderOf(sh, id);
      return m ? m.name : id;
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
  systems: ['id', 'ship', 'slot', 'name', 'sys_kind', 'tech_cap', 'ord', 'no_nodes', 'note'],
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
  if (ent === 'ships') return (S.bp.shipsAll || S.bp.ships);
  if (ent === 'planes') return S.bp.planes;
  const out = [];
  for (const s of S.bp.ships) {
    /* 舰载机自己的加点节点只在「舰载机组合 / 加点区」里维护，不混进数据管理的节点清单 */
    if (ent === 'nodes' && s.kind === '舰载机') continue;
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
  /* 每次渲染都重算：首次进入时权限可能还没加载完，不能只在绑定那一瞬间算一次 */
  const expBtn = $('#expJson'); if (expBtn) expBtn.classList.toggle('hide', !can('export'));
  const impBtn = $('#impShipBtn'); if (impBtn) impBtn.classList.toggle('hide', !isShip || !canEditRow);
  const dedBtn = $('#dedupeBtn'); if (dedBtn) dedBtn.classList.toggle('hide', !isShip || !canEditRow);
  const cols = colsFor(ent);
  const head = $('#entHead'); head.innerHTML = '';
  cols.forEach(c => head.appendChild(el('th', '', c.replace('_', ''))));
  if (isShip) {
    head.appendChild(el('th', '', '系统'));
    head.appendChild(el('th', '', '加点'));
    head.appendChild(el('th', '', '标记'));
  }
  head.appendChild(el('th', '', '操作'));
  const body = $('#entBody'); body.innerHTML = '';
  const canEdit = canEditRow;
  const q = (S.entQ || '').trim().toLowerCase();
  const allRows = rowsOf(ent);
  const shownRows = allRows.filter(row => {
    if (!q) return true;
    return cols.some(c => {
      const v = row[c];
      return v !== undefined && v !== null && String(v).toLowerCase().includes(q);
    });
  });
  shownRows.forEach(row => {
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
    if (isShip) {
      /* 数据体检：同名 / 0 系统 / 已弃用 一眼能看出来 */
      const sysArr = row.systems || [];
      const nNodes = sysArr.reduce((a, x) => a + ((x.nodes || []).length), 0);
      const mine = (row.name || '').trim();
      const dup = ((S.bp.shipsAll || []).filter(x => (x.name || '').trim() === mine)).length;
      const flags = [];
      if (+row.deprecated || 0) flags.push('已弃用');
      if (dup > 1) flags.push('同名 ' + dup + ' 条');
      if (!sysArr.length) flags.push('0 系统');
      tr.appendChild(el('td', 'muted', String(sysArr.length)));
      tr.appendChild(el('td', 'muted', String(nNodes)));
      const tdF = el('td', 'muted', flags.length ? '⚠ ' + flags.join(' · ') : '—');
      if (flags.length) { tdF.style.color = 'var(--warn)'; }
      tr.appendChild(tdF);
    }
    const td = el('td');
    if (canEdit) {
      const b = el('button', 'btn ghost', '改');
      b.onclick = () => (ent === 'ships' ? wizStart(row.id) : openEnt(row));
      const d = el('button', 'btn danger', '删'); d.style.marginLeft = '6px';
      d.onclick = () => delEnt(row.id);
      td.append(b, d);
      if (ent === 'ships') {
        const e2 = el('button', 'btn ghost', '导出'); e2.style.marginLeft = '6px';
        e2.title = '导出这艘船（船体 + 系统 + 加点 + 模块）为 JSON';
        e2.onclick = () => exportShip(row.id);
        td.append(e2);
      }
    }
    tr.appendChild(td); body.appendChild(tr);
  });
  const hint = (ent === 'effects')
    ? '效果库 = 加点节点的效果名。name 显示给用户看，unit 可留空；'
      + '改名/加单位后，所有引用它的节点会自动用新名字。删掉某个效果前，先把引用它的节点改掉。'
    : (ent === 'modules')
    ? '模块的 bonus/stats 已清空，点「改」按 {"dmg":15,"cd":20} 这类写法填；空着就只算舱位。'
    : '';
  const dataTips = [];
  if (isShip) dataTips.push('「标记」列会提示同名重复、0 系统、已弃用的船');
  if (hint) dataTips.push(hint);
  $('#dataNote').textContent = canEdit
    ? '共 ' + allRows.length + ' 条'
      + (q ? '，筛出 ' + shownRows.length + ' 条' : '')
      + (shownRows.length === 0 && q ? '（换个关键字试试）' : '')
      + (dataTips.length ? '。' + dataTips.join('；') : '')
      + '。改完立即生效，所有在线页面自动刷新。'
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
  if (isCancelSubmit(ev)) { $('#entDlg').close(); return; }
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
  let extra = '';
  if (S.ent === 'ships') {
    const sh = (S.bp.shipsAll || S.bp.ships || []).find(x => x.id === id);
    if (sh) {
      const sys = sh.systems || [];
      const nd = sys.reduce((a, x) => a + (x.nodes || []).length, 0);
      const md = (sh.modules || []).length;
      extra = '\n\n这条船下还有 ' + sys.length + ' 个系统、' + nd + ' 条加点、' + md + ' 个模块，会一起删掉。';
    }
  }
  if (!askConfirm(id, '删除 ' + S.ent + ' / ' + id + extra)) return;
  try { await api('/api/data/' + S.ent + '/' + encodeURIComponent(id), {method: 'DELETE', confirm: id});
    toast('已删除', 'good'); await loadBlueprints(true); renderData(); }
  catch (e) { toast('删除失败：' + e.message, 'bad'); }
}

/* ---------- 单船导出 / 导入、批量清理重复 ---------- */
function shipBundleOf(sid) {
  const sh = (S.bp.shipsAll || S.bp.ships || []).find(x => x.id === sid);
  if (!sh) return null;
  return {
    kind: 'fleet-ship', payload_version: 1, exported_at: new Date().toISOString(),
    ship: { id: sh.id, name: sh.name, cls: sh.cls, kind: sh.kind, size: sh.size,
            pgroup: sh.pgroup, cmd_type: sh.cmd_type, tech_total: sh.tech_total,
            base: sh.base || {}, note: sh.note, class: sh.class, role: sh.role },
    modules: (sh.modules || []).map(m => ({ id: m.id, ship: m.ship, slot: m.slot,
      name: m.name, mkind: m.mkind, cap: m.cap, allow_group: m.allow_group,
      bonus: m.bonus, stats: m.stats, note: m.note, bays: m.bays, sys: m.sys })),
    systems: (sh.systems || []).map(sy => ({
      id: sy.id, ship: sy.ship, slot: sy.slot, name: sy.name, tech_cap: sy.tech_cap,
      stats: sy.stats || null, stats_norm: sy.norm || {}, bays: sy.bays || null,
      is_weapon: sy.is_weapon, sys_kind: sy.sys_kind, no_nodes: sy.no_nodes, ord: sy.ord,
      nodes: (sy.nodes || []).map(n => ({ id: n.id, sys: n.sys, parent: n.parent,
        label: n.label, max_lv: n.max_lv, cost: n.cost, costs: n.costs,
        effect: n.effect, per_lv: n.per_lv, note: n.note }))
    }))
  };
}

function exportShip(sid) {
  const b = shipBundleOf(sid);
  if (!b) { toast('找不到这艘船', 'bad'); return; }
  const blob = new Blob([JSON.stringify(b, null, 2)], {type: 'application/json'});
  const a = el('a'); a.href = URL.createObjectURL(blob);
  a.download = 'ship-' + sid + '.json'; a.click();
  toast('已导出 ' + (b.ship.name || sid), 'good');
}

function uniqShipName(name, taken) {
  const base = (name || '导入舰船').trim() || '导入舰船';
  if (!taken.has(base)) return base;
  let i = 1, cand = base + '（副本）';
  while (taken.has(cand)) { i += 1; cand = base + '（副本 ' + i + '）'; }
  return cand;
}

async function importOneShip(b) {
  if (!b || !b.ship) throw new Error('文件里没有 ship 字段');
  const all = S.bp.shipsAll || [];
  const names = new Set(all.map(x => (x.name || '').trim()));
  const ids = new Set(all.map(x => x.id));
  let sid = String(b.ship.id || ('ship_' + Date.now()));
  let nm = String(b.ship.name || '').trim() || '导入舰船';
  if (ids.has(sid)) sid = 'ship_' + Date.now() + '_' + Math.floor(Math.random() * 900 + 100);
  if (names.has(nm)) nm = uniqShipName(nm, names);
  await api('/api/data/ships', {method: 'POST', body: Object.assign({}, b.ship,
    {id: sid, name: nm, class: b.ship.class || b.ship.cls})});
  let ns = 0, nn = 0, nmd = 0;
  const sysMap = {};
  for (const sy of (b.systems || [])) {
    const syId = sid + '_' + (sy.slot || 'X');
    sysMap[sy.id] = syId;
    const row = Object.assign({}, sy, {id: syId, ship: sid});
    delete row.nodes;
    await api('/api/data/systems', {method: 'POST', body: row});
    ns += 1;
    for (const n of (sy.nodes || [])) {
      const code = String(n.id || '').split(':').pop();
      await api('/api/data/nodes', {method: 'POST', body: Object.assign({}, n,
        {id: syId + ':' + code, sys: syId})});
      nn += 1;
    }
  }
  let mi = 0;
  /* 导入的模块行常常没有 sys（导出它的老库里就是 NULL）：按槽位补上新系统的 id，
     这样导入后下次打开问卷能靠 sys 精确匹配（口径同 modOfSys）。 */
  const sysBySlot = {};
  for (const sy of (b.systems || [])) sysBySlot[sy.slot || 'X'] = sid + '_' + (sy.slot || 'X');
  for (const m of (b.modules || [])) {
    mi += 1;
    await api('/api/data/modules', {method: 'POST', body: Object.assign({}, m,
      {id: sid + '_mod' + mi, ship: sid,
        sys: m.sys ? (sysMap[m.sys] || m.sys) : (sysBySlot[m.slot || 'X'] || null)})});
    nmd += 1;
  }
  return {sid: sid, nm: nm, ns: ns, nn: nn, nmd: nmd};
}

async function importShipFile(file) {
  if (!file) return;
  let obj = null;
  try { obj = JSON.parse(await file.text()); }
  catch (e) { toast('不是合法的 JSON 文件', 'bad'); return; }
  const list = Array.isArray(obj) ? obj : (obj && obj.ship ? [obj] : null);
  if (!list || !list.length) { toast('文件里没有可导入的舰船（应为单船导出文件）', 'bad'); return; }
  if (!askConfirm(file.name, '导入 ' + list.length + ' 艘船？\n\n重名会自动加「（副本）」，原有的船不动。')) return;
  let done = 0, sysN = 0, ndN = 0;
  try {
    for (const b of list) {
      const r = await importOneShip(b);
      done += 1; sysN += r.ns; ndN += r.nn;
    }
    toast('已导入 ' + done + ' 艘（系统 ' + sysN + ' 个、加点 ' + ndN + ' 条）', 'good');
  } catch (e) {
    toast('导入到第 ' + (done + 1) + ' 艘时失败：' + e.message
      + (done ? '（前面 ' + done + ' 艘已写入）' : ''), 'bad');
  }
  await loadBlueprints(true); renderData(); renderEditor();
}

function shipDedupePlan() {
  const rows = (S.bp.shipsAll || []).slice();
  const groups = {};
  rows.forEach(s => {
    const k = String(s.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k) return;
    (groups[k] = groups[k] || []).push(s);
  });
  const kick = [], mark = [];
  const rich = x => {
    const sys = x.systems || [];
    const nNodes = sys.reduce((a, y) => a + ((y.nodes || []).length), 0);
    const strong = sys.some(y => (y.norm && Object.keys(y.norm).length) || (y.bays && y.bays.length));
    return {sys: sys.length, nodes: nNodes, strong: strong};
  };
  Object.keys(groups).forEach(k => {
    const arr = groups[k];
    if (arr.length < 2) return;
    arr.sort((x, y) => {
      const px = /^ship_/.test(x.id) ? 1 : 0, py = /^ship_/.test(y.id) ? 1 : 0;
      if (px !== py) return px - py;
      const rx = rich(x), ry = rich(y);
      if (rx.strong !== ry.strong) return rx.strong ? -1 : 1;
      if (ry.nodes !== rx.nodes) return ry.nodes - rx.nodes;
      if (ry.sys !== rx.sys) return ry.sys - rx.sys;
      return String(x.id).localeCompare(String(y.id));
    });
    const keeper = arr[0];
    arr.slice(1).forEach(x => {
      const r = rich(x);
      if (!r.sys || (r.nodes === 0 && !r.strong)) kick.push(x);
      else mark.push({row: x, keeper: keeper});
    });
  });
  return {kick: kick, mark: mark, groups: Object.keys(groups).length};
}

async function dedupeShips() {
  const plan = shipDedupePlan();
  const kick = plan.kick, mark = plan.mark;
  if (!kick.length && !mark.length) { toast('没有发现同名舰船', 'good'); return; }
  const lines = [];
  if (kick.length) lines.push('删除空壳 ' + kick.length + ' 条：'
    + kick.slice(0, 5).map(x => x.id).join('、') + (kick.length > 5 ? ' …' : ''));
  if (mark.length) lines.push('标记弃用 ' + mark.length + ' 条：'
    + mark.slice(0, 5).map(x => x.row.id).join('、') + (mark.length > 5 ? ' …' : ''));
  if (!askConfirm('清理重复舰船', lines.join('\n\n')
    + '\n\n空壳（没有系统 / 没有加点）直接删；有内容的只标为「已弃用」，数据和备注都保留。')) return;
  let ok = 0, bad = 0;
  for (const x of kick) {
    try { await api('/api/data/ships/' + encodeURIComponent(x.id), {method: 'DELETE', confirm: x.id}); ok += 1; }
    catch (e) { bad += 1; }
  }
  for (const m of mark) {
    try {
      const body = Object.assign({}, m.row, {deprecated: 1,
        note: ('重复：与 ' + m.keeper.id + ' 同名，请核对后删除。' + (m.row.note || '')).slice(0, 300)});
      delete body.systems; delete body.modules; delete body.planes;
      await api('/api/data/ships', {method: 'PUT', body: body});
      ok += 1;
    } catch (e) { bad += 1; }
  }
  toast('清理完成：成功 ' + ok + ' 条' + (bad ? '，失败 ' + bad + ' 条' : ''),
    bad ? 'bad' : 'good');
  await loadBlueprints(true); renderData(); renderEditor();
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
/* 「权限到期」的实时说明：留空 / 还剩几天 / 已到期，都在日期框下面说清 */
/* 日期框空值时挂 dempty，CSS 把原生的「yyyy/mm/日」压掉、显示中文提示 */
function markDateEmpty(inp) {
  if (!inp || String(inp.type || '').toLowerCase() !== 'date') return;
  const has = !!(inp.value || '').trim();
  const cls = String(inp.className || '').replace(/\bdempty\b/g, '').replace(/\s+/g, ' ').trim();
  inp.className = has ? cls : (cls ? cls + ' dempty' : 'dempty');
}
function bindDateHints() {
  document.querySelectorAll('input[type="date"]').forEach(x => markDateEmpty(x));
}
document.addEventListener('input', e => markDateEmpty(e.target));
document.addEventListener('change', e => markDateEmpty(e.target));
function syncPermExpireHint() {
  const f = $('#userForm');
  const inp = f && f.perm_expire_at;
  const box = $('#permExpireHint');
  if (!inp || !box) return;
  const v = (inp.value || '').trim();
  markDateEmpty(inp);
  box.className = 'dim perhint';
  if (!v) { box.textContent = '留空 = 长期有效，不会自动收回。'; return; }
  const t = new Date(v + 'T00:00:00');
  if (!isFinite(t.getTime())) { box.textContent = '日期格式不对，应为 2026-11-19 这种写法。'; return; }
  /* 按日历天算：今天 = 0，明天 = 1，别被「几点」影响 */
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const days = Math.round((t.getTime() - t0.getTime()) / 86400000);
  const ds = v.replace(/-/g, '/');
  if (days < 0) {
    box.className = 'perhint bad';
    box.textContent = ds + ' 已到期：对方登录后只能改密码，看不到任何模块。';
  } else if (days === 0) {
    box.className = 'perhint warn';
    box.textContent = ds + ' 今天到期：今天过后权限收回。';
  } else {
    if (days <= 7) box.className = 'perhint warn';
    box.textContent = ds + ' 到期，还剩 ' + days + ' 天' + (days <= 7 ? '（快到期了）' : '') + '。';
  }
}
function openUserDlg(u) {
  S.editing = u || null;
  const f = $('#userForm');
  $('#dlgTitle').textContent = u ? '修改人员 · ' + u.username : '新增人员';
  f.username.value = u ? u.username : ''; f.username.disabled = !!u;
  f.password.value = ''; f.name.value = u ? u.name : '';
  f.role.value = u ? u.role : 'viewer';
  const supOpt = f.role.querySelector('option[value=superadmin]');
  const iTop = !!(S.user && S.user.role === 'superadmin');
  if (supOpt) supOpt.disabled = true;   /* 超管角色只能服务器指定 */
  const admOpt = f.role.querySelector('option[value=admin]');
  if (admOpt) admOpt.disabled = !iTop;
  f.role.dataset.fixed = (f.role.value === 'admin' || f.role.value === 'superadmin') ? '1' : '0'; f.squadron.value = u ? u.squadron : '';
  f.phone.value = u ? u.phone : ''; f.status.value = u ? u.status : '在职';
  f.note.value = u ? u.note : '';
  renderPermBox();
  if (f.scope) f.scope.value = (u && u.scope) || 'all';
  if (f.org) f.org.value = (u && u.org) || '';
  if (f.alliance) f.alliance.value = (u && u.alliance) || '';
  if (f.perm_expire_at) {
    f.perm_expire_at.value = (u && u.perm_expire_at) || '';
    f.perm_expire_at.onchange = syncPermExpireHint;
    f.perm_expire_at.oninput = syncPermExpireHint;
  }
  syncPermExpireHint();
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
  // 勾了「人员档案」就自动带上「人员查询」：档案能看，查询自然能看
  box.addEventListener('change', e => {
    if (e.target.value !== 'roster_view' || !e.target.checked) return;
    const q = box.querySelector('input[value="roster_query"]');
    if (q && !q.disabled) q.checked = true;
  });
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
    if (role === 'superadmin') hint.textContent = '超级管理员恒为全权（' + Object.keys(PERM_LABEL).length + ' 项），不能单独勾选。';
    else if (fixed) hint.textContent = '管理员默认拥有全部权限；只有超级管理员能调整管理员的权限。';
    else if (role === 'admin') hint.textContent = '你在调整管理员的权限：取消勾选后保存，该管理员会立刻失去对应能力（全不勾 = 恢复全权）。';
    else if (u && u.perm_expired) hint.textContent = '这个账号的权限已到期（只剩登录能力），改「权限到期」或重新勾选后保存即可恢复。';
    else hint.textContent = '「看」= 能打开该模块；「改」= 能新增/修改/删除。改动保存后对方刷新页面生效。';
  }
}
function boxPerms() {
  return [...document.querySelectorAll('#permBox input:checked')].map(cb => cb.value).join(',');
}
// 表单里的「取消」也是 submit 按钮，不判一下会被当成保存提交
function isCancelSubmit(ev) {
  const s = ev && ev.submitter;
  return !!(s && String(s.value) === 'cancel');
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
  if (isCancelSubmit(ev)) { $('#userDlg').close(); return; }
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
    toast(j && j.changed === false ? '内容没变，已跳过（不写日志）'
      : (S.editing ? '已保存' : '已新增：' + (data.username || '') + '（首次登录须先设置新密码）'), 'good');
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
  if (!S.user) return toast('请先登录', 'bad');
  if (!can('data_edit') && !can('sim_edit'))
    return toast('当前账号没有修改舰船的权限，找管理员开「数据管理·改」或「舰船数据·改」', 'bad');
  /* 只接受「字符串 id」，其它（事件对象、undefined）一律当作新建 */
  if (typeof editId === 'string' && editId) return wizEdit(editId);
  WIZ = {step: 0, laneLeft: 0, scrollToEnd: false, scrollToSys: '', laneMap: {},
  ship: {id: '', name: '', cls: '主力舰', kind: '主力舰', size: '大型舰船', cmd_type: '', tech_total: 100, base: {}},
    systems: [], nodes: [], modules: [], editIdx: -1,
    dSys: {name: '', slot: '', tech_cap: 5, bayF: '', bayC: '', bayG: ''},
  editSys: -1,
    dNode: {sysIdx: '0', label: '', max_lv: 5, cost: 2, costs: '', effect: 'dmg', val: 3, parent: '', parent2: '', perLv: ''},
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
    const addOpts = (list, host) => (list || []).forEach(([v, t]) => {
      const o = el('option', '', t); o.value = v;
      if (obj[key] === v) o.selected = true; host.appendChild(o);
    });
    if (opts && opts.groups) {
      /* 分组下拉：按作用域分 optgroup（整舰 / 系统内 / 武器 / 载机 / 说明） */
      opts.groups.forEach(g => {
        if (!g.items || !g.items.length) return;
        const og = el('optgroup'); og.label = g.label;
        addOpts(g.items, og); inp.appendChild(og);
      });
    } else addOpts(opts, inp);
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
/* 同节点成对的效果：填一个键，另一个用「配对数值」一起写。
   文档里目前只有暴击对（crit_rate + crit）和闪避对（eva_missile + eva_torp）。 */
const PAIR_GROUPS = [['crit_rate', 'crit'], ['eva_missile', 'eva_torp']];
function pairGroupOf(k) {
  for (let i = 0; i < PAIR_GROUPS.length; i++) if (PAIR_GROUPS[i].indexOf(k) >= 0) return PAIR_GROUPS[i];
  return null;
}
function critPairKey(k) {
  const g = pairGroupOf(k);
  return g ? g[g[0] === k ? 1 : 0] : '';
}
/* 保存节点时合并效果键：保留其它键、覆盖这次编辑的那一项、按需收/放配对键 */
function mergeNodeEff(prevEff, effect, pair) {
  const out = {};
  Object.keys(prevEff || {}).forEach(k => { if (k !== effect) out[k] = prevEff[k]; });
  const pk = critPairKey(effect);
  if (pk) {
    const pv = +pair || 0;
    if (pv > 0) out[pk] = pv; else delete out[pk];
  } else {
    /* 改成非配对效果时，把遗留的配对键一并清掉，免得旧值还在偷偷参与计算 */
    PAIR_GROUPS.forEach(g => { delete out[g[0]]; delete out[g[1]]; });
  }
  return out;
}
/* —— 每级数值分段（per_lv）——
   一个节点可以写 [2,2,2,3,3]（单效果节点），也可以写 {键:[...]}（一个节点挂多种效果）。
   问卷里用「逐级数值」一格编辑：逗号分隔，留空 = 每级固定值。 */
function perLvArr(perLv, key) {
  if (!perLv) return null;
  if (Array.isArray(perLv)) return perLv.map(Number);
  if (typeof perLv === 'object') {
    const a = perLv[key];
    return Array.isArray(a) ? a.map(Number) : null;
  }
  return null;
}
function perLvText(perLv, key) {
  const a = perLvArr(perLv, key);
  return a && a.length ? a.join(',') : '';
}
function parseLvText(txt) {
  return String(txt || '').split(/[,，\s]+/).map(x => Number(x)).filter(x => isFinite(x) && x > 0);
}
function buildPerLv(prev, key, arr, eff) {
  if (prev && !Array.isArray(prev) && typeof prev === 'object') {
    const o = Object.assign({}, prev);
    if (arr.length) o[key] = arr; else delete o[key];
    return Object.keys(o).length ? o : null;
  }
  if (Object.keys(eff || {}).length > 1) return arr.length ? {[key]: arr} : null;
  return arr.length ? arr : null;
}
/* —— 节点身份键（问卷内部的前置关系一律存它）——
   老节点用库里的 id，新建节点用 newN 临时键，保存时按序换成真实 id。
   不要再用 1 / 1-1 这种展示编号：每个系统的编号都从 1 起，跨系统必然重号，
   删节点时会误伤别的系统（2026-11-21 修，见 wizDelNode）。 */
let WIZ_SEQ = 0;
function wizKey(n) {
  if (!n) return '';
  if (n._id) return n._id;
  if (!n._k) n._k = 'new' + (++WIZ_SEQ);
  return n._k;
}
/* —— 节点编辑的三个入口（横向结构里就地展开）—— */
function wizStartNewNode(si, parentKey) {
  WIZ.editIdx = -1;
  WIZ.nodeDraft = {sysIdx: si, parent: parentKey || ''};
  Object.assign(WIZ.dNode, {sysIdx: String(si), label: '', parent: parentKey || '', parent2: '',
    effect: WIZ.dNode.effect || 'dmg', cost: 2, costs: '', max_lv: 5, val: 3, pair: 0, perLv: ''});
  wizRender();
}
function wizStartEditNode(idx) {
  const n = WIZ.nodes[idx];
  if (!n) return;
  WIZ.editIdx = idx;
  WIZ.nodeDraft = null;
  const pl = parList(n.parent);
  const pk = critPairKey(n.effect);
  Object.assign(WIZ.dNode, {sysIdx: String(n.sysIdx), label: n.label, max_lv: n.max_lv,
    cost: n.cost, costs: n.costs || '', effect: n.effect, val: n.val,
    pair: pk ? (+((n._eff || {})[pk]) || 0) : 0,
    perLv: perLvText(n._perLv, n.effect),
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
  /* 节点可以带多个效果键：保留其它键，只覆盖这次编辑的那一项；暴击再单独收/放配对键 */
  const _prev = isDraft ? null : WIZ.nodes[WIZ.editIdx];
  base._eff = mergeNodeEff(_prev && _prev._eff, WIZ.dNode.effect, WIZ.dNode.pair);
  base._effKey = WIZ.dNode.effect;
  base._perLv = buildPerLv(_prev && _prev._perLv, WIZ.dNode.effect,
    parseLvText(WIZ.dNode.perLv), base._eff);
  if (isDraft) { base._k = 'new' + (++WIZ_SEQ); WIZ.nodes.push(base); }
  /* 改已有节点时保留 _id/_note/_eff，否则会被当成新节点、老行还留在库里 */
  else WIZ.nodes[WIZ.editIdx] = Object.assign({}, WIZ.nodes[WIZ.editIdx], base);
  WIZ.editIdx = -1; WIZ.nodeDraft = null; WIZ.dNode.label = '';
  WIZ.scrollToEnd = true;                                    /* 新节点通常在更右边一列 */
  WIZ.scrollToSys = (WIZ.systems[si] || {}).id || ('s' + si); /* 只滚这一个系统 */
  wizRender();
}
/* 删节点：前置关系按「节点键 + 同一系统」处理。
   旧写法拿展示编号（1 / 1-1）跨系统比对，别的系统同名编号的节点也会被清掉前置。 */
function wizDelNodePlan(idx) {
  const n = WIZ.nodes[idx];
  if (!n) return { n: null, key: '', kids: [] };
  const key = wizKey(n);
  const sameSys = y => String(y.sysIdx) === String(n.sysIdx);
  const kids = WIZ.nodes.filter(y => sameSys(y) && parList(y.parent).indexOf(key) >= 0);
  return { n, key, kids };
}
function wizDelNode(si, x) {
  const plan = wizDelNodePlan(x.idx);
  const n = plan.n;
  if (!n) return;
  if (plan.kids.length && !confirm('这个系统里有 ' + plan.kids.length + ' 个节点把它当前置，删掉后这些引用会一并去掉，继续？')) return;
  WIZ.nodes.forEach(y => {
    if (String(y.sysIdx) !== String(n.sysIdx)) return;
    const p0 = parList(y.parent);
    const rest = p0.filter(c => c !== plan.key);
    if (rest.length !== p0.length) y.parent = rest.join(',');
  });
  WIZ.nodes = WIZ.nodes.filter((y, k) => k !== x.idx);
  WIZ.editIdx = -1; WIZ.nodeDraft = null;
  wizRender();
}
/* —— 武器表（问卷里编辑 stats_norm.weapons[]）——
   文档重建后的武器系统逐把存六字段（单发 / 弹药 / 攻击次数 / 持续 / 冷却 / 门数），
   外加族、对舰扣甲、校准系数 k、突防时间、对空命中率与协同效率。问卷里按行编辑，
   改完点「按公式重算并写回」把对舰、对空两行存档刷新（存档只作对照，引擎按公式现算）。 */
const WEP_FAMILIES = [['cannon', '通用火炮'], ['rail', '轨道炮'], ['pulse', '脉冲炮'],
  ['plasma', '等离子'], ['ion', '离子炮'], ['torpedo', '鱼雷'], ['missile', '导弹'],
  ['drone', '无人机'], ['other', '其它']];
/* 武器类型来自库表 families（可增删改）；表还没同步时退回内置清单 */
function wepFamilyRows() {
  const rows = (S.bp && Array.isArray(S.bp.families)) ? S.bp.families : [];
  if (!rows.length) return WEP_FAMILIES.map(([id, name]) => ({ id, name, armor: (id === 'cannon' || id === 'rail') ? 10 : 0 }));
  return rows.map(r => ({ id: r.id, name: r.name || r.id, armor: Number(r.armor) || 0 }));
}
function wepFamilyPairs() { return wepFamilyRows().map(r => [r.id, r.name]); }
function wepArmor(fam) {
  const hit = wepFamilyRows().find(r => r.id === fam);
  if (hit) return hit.armor;
  return (fam === 'cannon' || fam === 'rail') ? 10 : 0;
}
/* 归一：volley 跟弹药×攻击次数同步；族变了但没手填 armor 时按族给默认扣甲 */
function wepFix(w) {
  const ammo = Number(w.ammo) || 0, atk = Number(w.atk) || 0;
  if (ammo && atk) w.volley = ammo * atk;
  else if (!(Number(w.volley) > 0)) w.volley = Number(w.ammo_atk) || 0;
  if (w.armor === undefined || w.armor === null || w.armor === '') w.armor = wepArmor(w.family);
  if (!(Number(w.k) > 0)) w.k = 1;
  return w;
}
function wepCalc(sy) {
  const ws = ((sy.raw || {}).weapons) || [];
  const cp = 1 + calibPctOf((sy.raw || {})._calib) / 100;
  let atk = 0, air = 0;
  ws.forEach(w => {
    wepFix(w);
    const g = (w.guns === undefined || w.guns === null || w.guns === '') ? 1 : Number(w.guns);
    const dmg = Number(w.dmg) || 0;
    const dmgA = Number(w.dmg_air) > 0 ? Number(w.dmg_air) : dmg;
    if (!g || (!dmg && !dmgA)) return;
    const vol = Number(w.volley) || 0;
    const cyc = Math.max(0.5, (Number(w.dur) || 0) + (Number(w.cd) || 0) + (Number(w.pen) || 0));
    const kk = Number(w.k) || 1;
    if (dmg > 0) {
      atk += Math.max(0, dmg * cp - Number(w.armor)) * vol / cyc * 60 * g * kk + (Number(w.atk_add) || 0);
    }
    air += dmgA * cp * vol / cyc * 60 * g * kk * wepHitOf(w) * wepCoopOf(w);
  });
  return [atk, air];
}
/* 单把武器的对舰 / 对空现算（和 wepCalc 同一口径，只用于卡片里实时显示） */
function wepOne(w, pct) {
  const g = (w.guns === undefined || w.guns === null) ? 1 : (Number(w.guns) || 0);
  if (!g) return [0, 0];
  const vol = Number(w.volley) || (Number(w.ammo) || 0) * (Number(w.atk) || 0) || 0;
  const cyc = Math.max(0.5, (Number(w.dur) || 0) + (Number(w.cd) || 0) + (Number(w.pen) || 0));
  const dmg = Number(w.dmg) || 0;
  const arm = (w.armor === undefined || w.armor === null) ? 10 : Number(w.armor);
  const k = Number(w.k) || 1;
  const f = 1 + (Number(pct) || 0) / 100;
  const dmgA = Number(w.dmg_air) > 0 ? Number(w.dmg_air) : dmg;
  return [Math.max(0, dmg * f - arm) * vol / cyc * 60 * g * k + (Number(w.atk_add) || 0),
    dmgA * f * vol / cyc * 60 * g * k * wepHitOf(w) * wepCoopOf(w)];
}

function wizWeaponsBox(sy, rerender) {
  const box = el('div', 'wepbox');
  if (!sy.raw) sy.raw = {};
  const ws = Array.isArray(sy.raw.weapons) ? sy.raw.weapons : [];
  const cp = () => calibPctOf(sy.raw._calib);
  box.appendChild(el('div', 'wepnote', '武器表（' + (ws.length ? ws.length + ' 把' : '还没加武器')
    + '）：逐把填 单发 / 弹药 / 攻击次数 / 门数 / 持续 / 冷却 / 突防，对空再填 命中率 与 协同效率；'
    + '「单发（对空）」留空就沿用对舰单发，填了就只作用于对空；'
    + '下面按公式实时算对舰 / 对空。改完点「按公式重算并写回」把两行存档刷新（存档只作对照）。'));
  const total = el('div', 'weptotal');
  const updTotal = () => {
    let a = 0, b = 0;
    ws.forEach(w => { const r = wepOne(w, cp()); a += r[0]; b += r[1]; });
    total.textContent = ws.length
      ? '本系统合计（公式现算）：对舰 ' + fmtNum(Math.round(a * 10) / 10)
        + ' / 分 · 对空 ' + fmtNum(Math.round(b * 10) / 10) + ' / 分（门数为 0 的武器不计）'
      : '';
  };
  ws.forEach((w, i) => {
    /* 老数据可能没写命中率/协同：按缺省值回填到显示，避免输入框空着让人以为 0 */
    if (w.aa_hit === undefined || w.aa_hit === null || w.aa_hit === '') w.aa_hit = wepHitOf(w);
    if (w.aa_coop === undefined || w.aa_coop === null || w.aa_coop === '') w.aa_coop = wepCoopOf(w);
    if (w.armor === undefined || w.armor === null || w.armor === '') w.armor = wepArmor(w.family);
    const item = el('div', 'wepitem');
    const r1 = el('div', 'wrow1');
    const iName = wIn(r1, '武器名', w, 'name', 'text');
    if (iName && iName.parentNode) iName.parentNode.classList.add('w-name');
    const iFam = wIn(r1, '族', w, 'family', 'select', wepFamilyPairs());
    if (iFam && iFam.parentNode) iFam.parentNode.classList.add('w-fam');
    /* 族只给默认护甲口径；手动改过「护甲」之后不再被族覆盖 */
    if (iFam) iFam.onchange = () => { if (!w.armor_manual) w.armor = wepArmor(iFam.value); rerender(); };
    const iGun = wIn(r1, '门数', w, 'guns', 'number', null, '门');
    if (iGun && iGun.parentNode) iGun.parentNode.classList.add('w-guns');
    const del = el('button', 'btn wepdel', '删除'); del.type = 'button';
    del.onclick = () => { ws.splice(i, 1); if (!ws.length) sy.raw.weapons = []; rerender(); };
    r1.appendChild(del);

    const r2 = el('div', 'wrow2');
    [['单发', 'dmg', '点'], ['单发（对空）', 'dmg_air', '点'], ['弹药', 'ammo', ''], ['攻击次数', 'atk', ''],
      ['持续', 'dur', 's'], ['冷却', 'cd', 's'], ['突防', 'pen', 's'],
      ['命中率', 'aa_hit', ''], ['协同效率', 'aa_coop', '%'], ['锁定', 'lock', 's']].forEach(([lb, k, un]) => {
      wIn(r2, lb, w, k, 'number', null, un);
    });

    /* 护甲口径：每把武器单独选「扣 10 点 / 不扣」，与族解耦（有的同族武器不扣甲） */
    (function () {
      const row = el('label', 'row');
      row.appendChild(el('span', '', '护甲'));
      const sel = el('select', '');
      [['10', '扣 10 点标准护甲'], ['0', '不扣护甲']].forEach(([v, t]) => {
        const o = el('option', '', t); o.value = v; sel.appendChild(o);
      });
      const cur = (w.armor === undefined || w.armor === null || w.armor === '') ? wepArmor(w.family) : Number(w.armor);
      sel.value = String(Number(cur) || 0);
      sel.onchange = () => { w.armor = Number(sel.value) || 0; w.armor_manual = 1; rerender(); };
      row.appendChild(sel);
      r2.appendChild(row);
    })();

    /* 公式提示：本族扣不扣甲 + 两路公式（界面里就能核对） */
    const hint = el('div', 'wepf');
    const armorNow = (w.armor === undefined || w.armor === null || w.armor === '') ? wepArmor(w.family) : Number(w.armor);
    hint.textContent = '本武器·' + (Number(armorNow) > 0 ? ('扣 ' + armorNow + ' 点标准护甲') : '不扣护甲')
      + ' ｜ 对舰 = (单发 − ' + (Number(armorNow) > 0 ? armorNow : 0) + ') × 弹药×攻击 × 60÷周期 × 门数'
      + ' ｜ 对空 = 单发（对空）× 弹药×攻击 × 60÷周期 × 门数 × 命中率 × 协同%'
      + ' ｜ 系统调校 ' + (cp() ? ('+' + cp() + '%（作用在单发上：对舰先放大单发再扣护甲）') : '未启用（不影响两路）');
    /* 对空标准命中：0.15（舰船）/ 0.768（载机）一键填 */
    const std = el('div', 'wepstd');
    std.appendChild(el('span', 'dim', '对空标准命中：'));
    [['0.15', 0.15], ['0.768', 0.768]].forEach(([lb, v]) => {
      const b = el('button', 'btn ghost tiny', lb); b.type = 'button';
      b.title = '一键把命中率设为 ' + lb;
      b.onclick = () => { w.aa_hit = v; rerender(); };
      std.appendChild(b);
    });

    const sum = el('div', 'wsum');
    const updSum = () => {
      const r = wepOne(w, cp());
      sum.textContent = '这把现算：对舰 ' + fmtNum(Math.round(r[0] * 10) / 10)
        + ' / 分 · 对空 ' + fmtNum(Math.round(r[1] * 10) / 10) + ' / 分';
    };
    item.appendChild(r1);
    item.appendChild(r2);
    item.appendChild(hint);
    item.appendChild(std);
    item.appendChild(sum);
    item.addEventListener('input', () => { wepFix(w); updSum(); updTotal(); });
    updSum();
    box.appendChild(item);
  });
  box.appendChild(total);
  const acts = el('div', 'row wepacts');
  const add = el('button', 'btn', '增加武器'); add.type = 'button';
  add.onclick = () => {
    if (!Array.isArray(sy.raw.weapons)) sy.raw.weapons = [];
    sy.raw.weapons.push({name: '新武器', family: 'cannon', dmg: 10, ammo: 1, atk: 1,
      dur: 0, cd: 3, pen: 0, guns: 1, lock: 3, armor: 10, k: 1, aa_hit: 0.8, aa_coop: 100});
    sy.is_weapon = true;
    rerender();
  };
  const addFam = el('button', 'btn ghost', '＋ 增加武器类型'); addFam.type = 'button';
  addFam.onclick = async () => {
    const nm = prompt('新武器类型叫什么？（例如：离子炮 / 电磁炮）');
    if (!nm) return;
    const id = 'f' + Date.now().toString(36);
    let armor = 0;
    if (confirm('这类武器计算对舰时要扣 10 点标准护甲吗？\n确定 = 扣 10，取消 = 不扣')) armor = 10;
    try {
      await api('/api/data/families', { method: 'PUT', body: { id, name: nm, armor, ord: 999 } });
      await loadBlueprints(true);
      toast('已加入武器类型：' + nm + (armor ? '（扣 10 护甲）' : '（不扣甲）'), 'good');
      rerender();
    } catch (e) { toast('增加失败：' + e.message, 'bad'); }
  };
  const calc = el('button', 'btn ghost', '按公式重算并写回'); calc.type = 'button';
  calc.onclick = () => {
    if (!ws.length) return toast('先增加一把武器', 'bad');
    const r = wepCalc(sy);
    sy.raw.dmg_atk = Math.round(r[0] * 10) / 10;
    sy.raw.dmg_air = Math.round(r[1] * 10) / 10;
    toast('已写回存档：对舰 ' + fmtNum(sy.raw.dmg_atk) + ' / 分 · 对空 '
      + fmtNum(sy.raw.dmg_air) + ' / 分', 'good');
    rerender();
  };
  acts.append(add, addFam, calc);
  box.appendChild(acts);
  updTotal();
  return box;
}
function wizRender() {
  const st = WIZ.step;
  $('#wizTitle').textContent = (WIZ.edit ? '修改舰船 · ' + (WIZ.ship.name || '') + ' · ' : '问卷式录入 · ') + W_STEPS[st];
  $('#wizStep').textContent = '第 ' + (st + 1) + ' 步 / 共 ' + W_STEPS.length + ' 步' +
    (WIZ.edit ? '　（改完在第 6 步点「保存修改」，只动这一艘船）' : '　（系统会逐条问，答完就载入数据库）');
  const b = $('#wizBody');
  /* 加点树有 4~5 层时，点「+ 子节点」会整块重绘；按系统分别记住横向位置，否则会被甩回第 1 层 */
  WIZ.laneMap = WIZ.laneMap || {};
  b.querySelectorAll('.wiz-lane').forEach(l => {
    if (l.dataset.sys) WIZ.laneMap[l.dataset.sys] = l.scrollLeft;
  });
  b.innerHTML = '';
  $('#wizPrev').classList.toggle('hide', st === 0);
  $('#wizSkip').classList.toggle('hide', st === 0 || st >= 5);
  $('#wizNext').textContent = st === 5 ? (WIZ.edit ? '保存修改' : '载入数据库') : '下一步';
  $('#wizClose').classList.toggle('hide', st !== 5);

  if (st === 0) {
    const c = el('div');
    const nameInp = wIn(c, '名称', WIZ.ship, 'name', 'text');
    const dupTip = el('div', 'muted');
    dupTip.id = 'wizNameDup';
    dupTip.style.color = '#e06a6a';
    dupTip.style.margin = '-4px 0 8px';
    c.appendChild(dupTip);
    const checkDup = () => {
      const v = (nameInp.value || '').trim();
      nameInp.value = v; WIZ.ship.name = v;
      const d = v ? (((S.bp.shipsAll || S.bp.ships) || [])).find(x => (x.name || '').trim() === v
        && x.id !== (WIZ.ship.id || '')) : null;
      dupTip.textContent = d ? '已有同名舰船「' + d.name + '」（' + d.id + '），保存会被拒绝：请改那一条' : '';
    };
    nameInp.oninput = checkDup;
    nameInp.onblur = checkDup;
    if (!WIZ.ship.name) setTimeout(() => { try { nameInp.focus(); } catch (e) {} }, 40);
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
      '模块槽位：只有超主力舰有；舱位：由系统提供，任何舰种都可以有（第 3 步里填），第 5 步会自动跳过没有的。'
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
    }
    /* 舱位跟舰种无关：任何舰种的系统都可以带舰载机/无人机舱 */
    f.appendChild(el('div', 'muted',
      canMod(WIZ.ship)
        ? '这个系统提供舱位吗？（模块就是系统，加成在上面「加点」里填，这里只管能装几架）'
        : '这个系统提供舱位吗？舱位由系统提供，与舰种无关 —— 主力舰、护卫舰的系统也可以带机库。'));
    wIn(f, '战机舱能装几架（0=没有）', WIZ.dSys, 'bayF', 'number');
    wIn(f, '护航艇舱能装几架（0=没有）', WIZ.dSys, 'bayC', 'number');
    wIn(f, '编组限制（只对战机舱生效）', WIZ.dSys, 'bayG', 'select',
      [['', '不限'], ['中编组', '仅中编组'], ['大编组', '仅大编组']]);
    f.appendChild(el('div', 'muted',
      '护航艇没有大 / 中编组之分：这一项只写进战机舱，战机舱填 0 时它不生效。'));
    wIn(f, '该系统节点上限（能点几个节点）', WIZ.dSys, 'tech_cap', 'number');
    const add = el('button', 'btn', WIZ.editSys >= 0 ? '保存修改' : '加进列表'); add.type = 'button';
    add.onclick = () => {
      if (!WIZ.dSys.name.trim()) return toast('系统名不能空', 'bad');
      const bf = +WIZ.dSys.bayF || 0, bc = +WIZ.dSys.bayC || 0, bg = WIZ.dSys.bayG || '';
      /* 只重建「战机 / 护航艇」两舱，其它种类（老数据里的无人机舱等）原样保留，
         否则在这里点一次保存就把它们抹掉了。 */
      const _keepBays = ((WIZ.editSys >= 0 ? (WIZ.systems[WIZ.editSys].bays || []) : []))
        .filter(b => b && b.kind !== '战机' && b.kind !== '护航艇');
      const bays = [];
      if (bf) bays.push({kind: '战机', cap: bf, allow_group: bg});
      if (bc) bays.push({kind: '护航艇', cap: bc, allow_group: ''});
      _keepBays.forEach(b => bays.push(b));
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
      + '<b>对舰 / 对空</b> 只有「武器」类系统才有。这里填的是<b>系统基础值</b>，加点收益在第 4 步。';
    b.appendChild(head);
    const sysgrid = el('div', 'wiz-sysgrid');
    b.appendChild(sysgrid);

    if (!WIZ.systems.length) {
      const tip = el('div', 'card2');
      tip.appendChild(el('div', 'muted', '还没有系统。先在上一步「系统」里加几个（例如：装甲系统、动力系统、武器系统）。'));
      b.appendChild(tip);
    }

    const FUNC_FIELDS = [
      ['hull', '结构值', '点'], ['syshull', '系统结构值', '点'],
      ['armor', '抵抗伤害', '点'], ['shield', '护盾值', '%'],
      ['cruise', '巡航速度', 'jm'], ['warp', '曲率速度', 'jm'], ['spd', '突防速度', ''],
      ['eva', '通用闪避', '%'],
      ['repair_bonus_pct', '维修加成', '%']
    ];
    /* 维修系统的字段原本只写在 KIND_KEYS 里，FUNC_FIELDS 没有对应条目，
       kindFieldsFor 一过滤就只剩「系统结构值」—— 单次维修量 / 冷却 / 工作次数都填不进去。
       这里把维修真正会用到的键补齐（口径与 engine._repair_total、repairDpmOf 一致）：
       单次 × 工作次数 × 60÷(持续+冷却) × 设备数 × 系数，锁定时间只是记录项。 */
    const REPAIR_FIELDS = [
      ['repair', '单次维修量', '点'], ['volley', '工作次数', '次'],
      ['dur', '持续时间', 's'], ['cd', '冷却时间', 's'],
      ['guns', '维修设备数', '台'], ['k', '维修系数', ''],
      ['lock', '锁定时间', 's'], ['syshull', '系统结构值', '点']
    ];
    /* 维修单位：无人机（单次 500 那类）/ 维修设备（375 那类）。只做记录与展示，不进公式。 */
    const REPAIR_UNITS = [['', '（未填）'], ['无人机', '维修无人机'], ['维修设备', '维修设备']];
    /* 按系统类型裁剪：只显示这个系统真正会提供的数值项。
       装甲类 → 结构值/抵抗伤害/护盾值/维修加成；动力类 → 巡航/曲率/突防/闪避；
       能源类 → 能量输出/储能；其余（指挥/信息/搭载…）不提供船体数值，只留模块名。 */
    const SYS_FIELD_GROUPS = {
      armor: ['hull', 'syshull', 'armor', 'shield', 'repair_bonus_pct'],
      drive: ['cruise', 'warp', 'spd', 'eva']
    };
    /* 系统类型：每类只给自己的字段。
       类型清单与显示名在文件上方统一定义（SYS_KINDS / SYS_KIND_META），
       基础加成表的「类型」列和这里的下拉读的是同一份，不会再出现「表里写功能、问卷里写装甲」。
       字段只看 sys_kind：以前是「名字关键词 + 有没有存过值」猜出来的 —— 只要存过一次
       系统结构值，能源/指挥/仓储 也会展开成装甲那五格。 */
    const KIND_KEYS = {
      '装甲': ['hull', 'syshull', 'armor', 'shield', 'repair_bonus_pct'],
      '动力': ['cruise', 'warp', 'spd', 'eva', 'syshull'],
      '维修': ['unit', 'repair', 'volley', 'dur', 'cd', 'guns', 'k', 'lock', 'syshull']
    };
    /* 字段表：key / 显示名 / 单位 / 控件类型（不写就是 number）/ 选项。
       unit 走下拉，其余都是数字框。 */
    const kindFieldsFor = (kind) => {
      const map = {};
      FUNC_FIELDS.forEach(f => { map[f[0]] = f; });
      REPAIR_FIELDS.forEach(f => { map[f[0]] = f; });
      map.syshull = ['syshull', '系统结构值', '点'];
      map.unit = ['unit', '维修单位', '', 'select', REPAIR_UNITS];
      return (KIND_KEYS[kind] || ['syshull']).map(k => map[k]).filter(Boolean);
    };
    /* 老系统没填 sys_kind（3 艘早期船）：先按数值 / 名字推断一个，只在内存里写回 sy，
       保存问卷时才落库 —— 免得下拉停在「其他」，一保存又把空值写回去。
       推断不出（真的什么都没有）就保持「其他」，不硬塞。 */
    const kindOf = (sy) => {
      if (SYS_KINDS.indexOf(sy.sys_kind) < 0) {
        const g = sysKindOf(sy, sy.raw);
        if (g !== '其他') { sy.sys_kind = g; sy.is_weapon = (g === '武器'); }
      }
      return SYS_KINDS.indexOf(sy.sys_kind) >= 0 ? sy.sys_kind : '其他';
    };
    const WEP_FIELDS = [
      ['syshull', '系统结构值', '点'],
      ['dmg_atk', '对舰', '/分'], ['dmg_air', '对空', '/分'],
      /* 六字段：填齐这几个，引擎就按「单发 x 弹药 x 攻击次数 / 周期 x 门数」现算三路输出 */
      ['dmg', '单发伤害', '点'], ['ammo', '弹药数', ''], ['atk', '攻击次数', ''],
      ['guns', '门数', '门'],
      ['dur', '持续时间', 's'], ['cd', '冷却时间', 's'], ['lock', '锁定时间', 's'],
      ['warn', '预警', '%'], ['cyc', '工作次数', '次'], ['repair', '维修量', '点'],
      ['crit_rate', '自带暴击率', '%'], ['crit', '自带暴击伤害', '%']
    ];
    /* 多武器系统只填「三路存档 + 自带暴击」；单套六字段那些格子归武器表管，避免两处打架 */
    const WEP_TOTALS = [
      ['syshull', '系统结构值', '点'],
      ['dmg_atk', '对舰', '/分'], ['dmg_air', '对空', '/分'],
      ['crit_rate', '自带暴击率', '%'], ['crit', '自带暴击伤害', '%']
    ];

    WIZ.systems.forEach((sy, si) => {
      if (!sy.raw) sy.raw = {};
      if (sy.is_weapon === undefined) sy.is_weapon = false;
      const card = el('div', 'card2');
      const title = el('div', 'wiz-head');
      title.appendChild(el('b', '', '系统 ' + (si + 1) + '：' + (sy.name || '（未命名）')));
      const typeSel = el('select');
      SYS_KINDS.forEach(k => {
        const o = el('option', '', (SYS_KIND_META[k] || {label: k}).label); o.value = k; typeSel.appendChild(o);
      });
      typeSel.value = kindOf(sy);
      typeSel.onchange = () => {
        sy.sys_kind = typeSel.value;
        sy.is_weapon = typeSel.value === '武器';
        wizRender();
      };
      title.appendChild(typeSel);
      card.appendChild(title);

      /* 有 weapons[] 的走武器表（下面），这里只留三路存档与暴击；单武器老数据仍给整套六字段 */
      const kind = kindOf(sy);
      const hasW = (weaponListOf(sy.raw) || []).length > 0;
      const fields = kind === '武器' ? (hasW ? WEP_TOTALS : WEP_FIELDS) : kindFieldsFor(kind);
      if (kind !== '武器' && !fields.length) {
        card.appendChild(el('div', 'muted', '该类型不提供船体数值，只填模块名即可。'));
      } else {
        const grid = el('div', 'wiz-grid2');
        fields.forEach(([k, label, unit, ctl, opts]) => {
          /* 不预置 0：留空显示灰色 0 占位，填了才落数；unit 是下拉（维修单位） */
          wIn(grid, label, sy.raw, k, ctl || 'number', opts || null, unit);
        });
        card.appendChild(grid);
        if (kind === '维修') {
          const qb = el('div', 'wepstd');
          qb.appendChild(el('span', 'dim', '一键套用常见档：'));
          [['500', 500, '无人机', '维修无人机'], ['375', 375, '维修设备', '维修设备']].forEach(([lb, v, u2, t]) => {
            const b = el('button', 'btn ghost tiny', lb); b.type = 'button';
            b.title = '单次维修量设为 ' + lb + '，维修单位设为「' + t + '」';
            b.onclick = () => { sy.raw.repair = v; sy.raw.unit = u2; wizRender(); };
            qb.appendChild(b);
          });
          card.appendChild(qb);
          const rh = el('div', 'muted');
          const updR = () => {
            const rw = sy.raw || {};
            const dpm = repairDpmOf(rw);
            const vol = (Number(rw.volley) > 0 ? Number(rw.volley)
              : (Number(rw.ammo) || 0) * (Number(rw.atk) || 0)) || 1;
            const unit = rw.unit ? ('维修单位 ' + rw.unit + '；') : '';
            rh.textContent = dpm
              ? (unit + '分钟维修量 = 单次 ' + fmtNum(rw.repair) + ' × 工作次数 ' + fmtNum(vol)
                + ' × 60÷(' + fmtNum(rw.dur || 0) + '+' + fmtNum(rw.cd || 0) + ')（未含加点缩减）'
                + ' × ' + fmtNum(rw.guns || 1) + ' 台 × 系数 ' + fmtNum(rw.k || 1)
                + ' ×（1+调校%） = ' + fmtNum(Math.round(dpm * 10) / 10) + ' / 分')
              : (unit + '填了「单次维修量」就会按公式现算分钟维修量。');
          };
          grid.addEventListener('input', updR);
          grid.addEventListener('change', updR);
          updR();
          card.appendChild(rh);
        }
        if (sy.is_weapon) {
          /* 武器表：多武器系统在这里增删改，改完点「按六字段重算对舰存档」写回存档 */
          card.appendChild(wizWeaponsBox(sy, wizRender));
          /* 自带暴击只抬本系统的对舰/对空：两行空着就白填，输入时实时说一声 */
          const hint = el('div', 'muted');
          const upd = () => {
            const rw = sy.raw || {};
            const r = Number(rw.crit_rate) || 0, d = Number(rw.crit) || 0;
            const hasDmg = rw.dmg_atk !== undefined || rw.dmg_air !== undefined
              || !!weaponSixOf(rw) || !!weaponListOf(rw);
            if (!(r > 0 || d > 0)) { hint.textContent = ''; return; }
            if (!(r > 0 && d > 0)) { hint.textContent = '自带暴击只填了一格：暴击率和暴击伤害要都填才生效。'; return; }
            if (!hasDmg) { hint.textContent = '自带暴击已填（×' + (1 + r * d / 10000).toFixed(2) + '），但对舰 / 对空都是空的：这两行没有数字可抬，先填伤害才看得到效果。'; return; }
            hint.textContent = '自带暴击生效：本系统对舰 / 对空各 ×' + (1 + r * d / 10000).toFixed(2) + '。';
          };
          grid.addEventListener('input', upd);
          upd();
          card.appendChild(hint);
        }
      }

      // 模块名（可选，只对「一系统一模块」的写法有意义）
      wIn(card, '模块名（可选）', sy, 'module', 'text');
      sysgrid.appendChild(card);
    });

    const tail = el('div', 'muted');
    tail.innerHTML = '输入框按系统类型自动裁剪：「装甲系统」填结构值 / 抵抗 / 护盾，「动力系统」填巡航 / 曲率 / 突防 / 闪避，'
      + '「维修系统」填单次维修量 / 维修单位 / 工作次数 / 持续 / 冷却 / 设备数 / 维修系数 / 锁定时间，其余系统只填模块名。'
      + '<b>结构值</b>最终会按「基础值 ×（1 + 加点收益%）」算；'
      + '武器系统用下面的<b>武器表</b>逐把填：单发 / 弹药 / 攻击次数 / 门数 / 持续 / 冷却，'
      + '点「按公式重算并写回」把对舰、对空两行存档一起刷新（存档只作对照）。'
      + '老数据的单武器系统仍可只填六字段（引擎会自动现算），要扩成多武器就点「增加武器」。'
      + '最后两格「自带暴击率 / 自带暴击伤害」填该武器系统自带的暴击：三行各乘「1 + 暴击率% × 暴击伤害%」（如 30 与 50 → ×1.15），只作用于本系统；两格只填一格不生效。';
    b.appendChild(tail);
  } else if (st === 3) {
    if (!WIZ.systems.length) {
      b.appendChild(el('div', 'muted', '先回上一步加系统，加点必须挂在某个系统下。'));
    } else {
      /* ---- 效果库：新建 / 修改 / 删除 ---- */
      const EFF_FIELDS = [
        /* key, 名称, 单位, 类型(pct/add), 作用域 */
        ['cargo', '仓储量', '点', 'add', 'ship'],
        ['lockres', '反锁定', '%', 'pct', 'ship'],
        ['repair_bonus_pct', '受维修效果', '%', 'pct', 'ship'],
        ['eva_missile', '导弹闪避', '%', 'pct', 'ship'],
        ['speed', '巡航速度', '%', 'pct', 'ship'],
        ['critres', '暴击抵抗', '%', 'pct', 'ship'],
        ['warp', '曲率速度', '%', 'pct', 'ship'],
        ['armor', '物理护甲', '点', 'add', 'ship'],
        ['hull', '结构', '点', 'add', 'ship'],
        ['shield', '能量护盾', '点', 'add', 'ship'],
        ['selfheal', '自维修', '%', 'pct', 'ship'],
        ['eva', '通用闪避', '%', 'pct', 'ship'],
        ['eva_torp', '鱼雷闪避', '%', 'pct', 'ship'],
        ['dmg', '伤害', '%', 'pct', 'system'],
        ['dmg_drone', '无人机伤害', '%', 'pct', 'system'],
        ['crit', '暴击伤害', '%', 'pct', 'system'],
        ['crit_rate', '暴击率', '%', 'pct', 'system'],
        ['syshull', '系统结构值', '%', 'pct', 'system'],
        ['repair', '维修量', '点', 'add', 'system'],
        ['cd', '冷却时间', '%', 'pct', 'weapon'],
        ['acc_large', '大型命中', '%', 'pct', 'weapon'],
        ['dmg_atk_pct', '对舰伤害', '%', 'pct', 'weapon'],
        ['dmg_missile', '导弹/鱼雷伤害', '%', 'pct', 'weapon'],
        ['acc_small', '小型命中', '%', 'pct', 'weapon'],
        ['intc', '拦截率', '%', 'pct', 'weapon'],
        ['dur', '持续时间', '%', 'pct', 'weapon'],
        ['dmg_siege_pct', '攻城伤害', '%', 'pct', 'weapon'],
        ['dmg_cannon', '火炮伤害', '%', 'pct', 'weapon'],
        ['dmg_plasma', '等离子伤害', '%', 'pct', 'weapon'],
        ['dmg_pulse', '脉冲炮伤害', '%', 'pct', 'weapon'],
        ['dmg_rail', '轨道炮伤害', '%', 'pct', 'weapon'],
        ['acc', '通用命中', '%', 'pct', 'weapon'],
        ['lock', '锁定时间缩减', '%', 'pct', 'weapon'],
        ['warn', '防空锁定效率', '%', 'pct', 'weapon'],
        ['dmg_air_pct', '防空伤害', '%', 'pct', 'weapon'],
        ['freq', '频率', '%', 'pct', 'weapon'],
        ['intc_torp', '鱼雷拦截率', '%', 'pct', 'weapon'],
        ['move', '突防速度', '%', 'pct', 'plane'],
        ['acc_plane', '舰载机命中', '%', 'pct', 'plane'],
        ['plane', '载机伤害', '%', 'pct', 'plane'],
        ['p_freq', '载机冷却时间', '%', 'pct', 'plane'],
        ['p_acc', '载机命中率', '%', 'pct', 'plane'],
        ['p_eva_missile', '载机对导弹闪避', '%', 'pct', 'plane'],
        ['p_move', '载机突防时间', '%', 'pct', 'plane'],
        ['p_lock', '载机选目标时间', '%', 'pct', 'plane'],
      ];
      /* 武器族是数据表 families 驱动的：新加一个族，这里自动多一个「XX伤害」字段 */
      const effFieldsAll = () => {
        const out = EFF_FIELDS.slice();
        ((S.bp && S.bp.families) || []).forEach(f => {
          const k = 'dmg_' + f.id;
          if (out.some(r => r[0] === k)) return;
          out.push([k, (f.name || f.id) + '伤害', '%', 'pct', f.id === 'drone' ? 'system' : 'weapon']);
        });
        return out;
      };
      const effFieldOf = (k) => effFieldsAll().find(r => r[0] === k) || null;
      const effectDialog = (curId, asRequest) => {
        const cur = ((S.bp && S.bp.effects) || []).find(e => e.id === curId) || null;
        const wrap = el('div', 'dlgwrap');
        const box = el('div', 'dlg effdlg');
        wrap.appendChild(box);
        box.appendChild(el('div', 'dlgh',
          asRequest ? '申请新增效果（提交后等超管批准）'
                    : (cur ? ('修改效果：' + (cur.name || cur.id)) : '新建效果')));
        const body = el('div', 'dlgb');
        box.appendChild(body);

        const st = {
          name: cur ? (cur.name || '') : '',
          field: cur ? (cur.target || cur.id) : 'dmg',
          unit: cur ? (cur.unit || '') : '%',
          kind: cur ? (cur.kind || 'pct') : 'pct',
          scope: cur ? (cur.scope || 'system') : 'system',
          note: cur ? (cur.note || '') : ''
        };
        if (cur && !effFieldOf(st.field)) st.field = '__custom__';

        const row = (label, node) => { const r = el('div', 'row'); r.appendChild(el('span', '', label)); r.appendChild(node); body.appendChild(r); return r; };
        const iName = el('input'); iName.type = 'text'; iName.value = st.name; iName.placeholder = '中文名，例如「火炮伤害」';
        row('名称', iName);

        const opts = effFieldsAll().map(r => [r[0], r[1] + '（' + r[2] + '，' + r[4] + '作用域）']);
        opts.push(['__custom__', '自定义键（引擎不认识，只能当说明，不参与计算）']);
        const selF = el('select');
        opts.forEach(([v, t]) => { const o = el('option', '', t); o.value = v; selF.appendChild(o); });
        selF.value = st.field;
        row('字段（决定加在哪里）', selF);

        const iUnit = el('input'); iUnit.type = 'text'; iUnit.value = st.unit; iUnit.placeholder = '% / 点 / 秒';
        row('单位（只影响显示）', iUnit);

        const selK = el('select');
        [['pct', '百分比（%）：数值按百分比加'], ['add', '直接数值（点）：数值直接加']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; selK.appendChild(o); });
        selK.value = st.kind;
        row('类型（决定怎么加）', selK);

        const selS = el('select');
        [['ship', '整舰：加到舰体属性'], ['system', '系统内：只影响这个系统'], ['weapon', '武器：只影响本系统武器'],
         ['plane', '舰载机：机库 / 载机口径'], ['note', '说明：不参与计算']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; selS.appendChild(o); });
        selS.value = st.scope;
        row('作用域（决定加到哪一层）', selS);

        const iNote = el('input'); iNote.type = 'text'; iNote.value = st.note; iNote.placeholder = '可选：给人看的说明';
        row('说明', iNote);

        const tip = el('div', 'muted', '');
        body.appendChild(tip);
        const refreshTip = () => {
          const f = effFieldOf(selF.value);
          if (!f) {
            tip.textContent = '⚠ 自定义键：只有键名正好是引擎读的字段（如 dmg_ion、hull、cd）才会进计算；'
              + '随便起的名字只会当说明。不确定就回上面选一个字段。';
            return;
          }
          tip.textContent = '这个效果会按「' + f[1] + '」计入计算：作用域 ' + selS.value + '，类型 ' + selK.value
            + '，单位 ' + (iUnit.value || '无') + '（单位只影响显示，不影响算法）。';
        };
        selF.onchange = () => {
          const f = effFieldOf(selF.value);
          if (f) { iUnit.value = f[2]; selK.value = f[3]; selS.value = f[4]; }
          refreshTip();
        };
        [iUnit, selK, selS].forEach(x => x.addEventListener('input', refreshTip));
        refreshTip();

        const foot = el('div', 'dlgf');
        box.appendChild(foot);
        const bCancel = el('button', 'btn ghost', '取消'); bCancel.type = 'button';
        bCancel.onclick = () => wrap.remove();
        foot.appendChild(bCancel);
        if (cur && !asRequest) {
          const bDel = el('button', 'btn danger', '删除'); bDel.type = 'button';
          bDel.onclick = async () => {
            const used = WIZ.nodes.filter(y => y.effect === cur.id).length;
            const warn = cur.builtin
              ? '\n这是内置效果：引擎里仍写着它的计算口径，删掉只是从下拉里隐藏；'
                + '有节点在用时服务端会拒绝删除。'
              : '';
            if (!confirm('删除效果「' + (cur.name || cur.id) + '」？' + (used ? '\n当前有 ' + used + ' 个节点在用它。' : '') + warn)) return;
            try {
              await api('/api/data/effects/' + encodeURIComponent(cur.id), { method: 'DELETE', confirm: cur.id });
              await loadBlueprints(true);
              if (WIZ.dNode.effect === cur.id) WIZ.dNode.effect = 'dmg';
              wrap.remove(); toast('已删除效果', 'good'); wizRender();
            } catch (e) { toast('删除失败：' + e.message, 'bad'); }
          };
          foot.appendChild(bDel);
        }
        const bSave = el('button', 'btn', '保存'); bSave.type = 'button';
        bSave.onclick = async () => {
          const f = effFieldOf(selF.value);
          const nm = iName.value.trim() || (f ? f[1] : '新效果');
          const id = cur ? cur.id : (f ? f[0] : 'e' + Date.now().toString(36));
          const payload = { id, name: nm, unit: iUnit.value.trim(), kind: selK.value, scope: selS.value, note: iNote.value.trim(), target: id };
          /* 选的字段已经在效果库里：直接复用，不覆盖它的名称 */
          if (!cur && ((S.bp.effects || []).some(e => e.id === id))) {
            WIZ.dNode.effect = id;
            wrap.remove();
            toast('效果库里已有「' + (effName(id)) + '」，已直接选用', 'good');
            wizRender();
            return;
          }
          try {
            if (asRequest) {
              await api('/api/effreq/create', { method: 'POST',
                body: { name: nm, unit: payload.unit, field: payload.target, kind: payload.kind,
                        scope: payload.scope, note: payload.note } });
              wrap.remove();
              toast('已提交申请，等超级管理员批准后即可选用', 'good');
              return;
            }
            await api('/api/data/effects', { method: 'PUT', body: payload });
            await loadBlueprints(true);
            if (!cur) WIZ.dNode.effect = id;
            wrap.remove();
            toast(cur ? '已保存效果' : '已加入效果库：' + nm, 'good');
            wizRender();
          } catch (e) { toast((asRequest ? '提交失败：' : '保存失败：') + e.message, 'bad'); }
        };
        foot.appendChild(bSave);
        /* 问卷本身是模态 <dialog>（在 top layer），弹窗必须挂在它里面，否则会被盖住 */
        (document.getElementById('wizDlg') || document.body).appendChild(wrap);
        iName.focus();
      };
      const mkEffect = async () => { effectDialog(''); };

      // —— 节点：横向结构（一层一列，点卡片就地展开编辑）——
      const treeCard = el('div', 'card2');
      treeCard.appendChild(el('div', 'muted',
        '横向结构：从左往右是第 1 层 → 第 2 层 → 第 3 层（对应 1 → 1-1 → 1-1-1）。'
        + '点卡片就在原地展开编辑，不用去下面找表单；「＋ 根节点」在系统标题右边。'));

      /* 节点效果统一口径：先列内置这批（顺序固定），再接文档重建后新增的键；
         effects 表里没登记的键会自动落到「（自定义）」里 */
      const NODE_EFFECT_IDS = ['dmg', 'freq', 'acc', 'acc_small', 'acc_large', 'acc_plane',
        'armor', 'crit_rate', 'crit', 'eff7587', 'eva', 'eva_missile', 'eva_torp',
        'lock', 'lockres', 'hull', 'move', 'repair', 'shield', 'warp', 'speed',
        'syshull', 'dmg_cannon', 'dmg_rail', 'dmg_pulse', 'dmg_missile', 'dmg_plasma',
        'dmg_drone', 'dmg_atk_pct', 'dmg_air_pct', 'dur', 'warn', 'cd',
        'cargo', 'repair_bonus_pct', 'intc', 'intc_torp', 'critres', 'plane',
        'p_acc', 'p_move', 'p_lock', 'p_freq', 'p_eva_missile'];
      /* 作用域 → 分组标题（顺序固定；引擎按 scope 决定这条加成加到哪） */
      const EFF_SCOPE_ORDER = [
        ['ship', '整舰（直接加到舰体）'],
        ['system', '系统内（只影响这个系统）'],
        ['weapon', '武器（只影响本系统武器）'],
        ['plane', '舰载机（机库 / 载机口径）'],
        ['note', '说明（不参与计算）'],
        ['other', '其它']
      ];
      const effLabel = (k) => {
        const e = ((S.bp && S.bp.effects) || []).find(x => x.id === k);
        if (!e) return k;
        const nm = splitNameUnit(e.name, e.unit);
        return nm.base || k;
      };
      const effOptions = () => {
        const all = ((S.bp && S.bp.effects) || []);
        const byId = {};
        all.forEach(e => { byId[e.id] = e; });
        const cur = (WIZ.dNode && WIZ.dNode.effect) || '';
        /* 本船节点正在用 / 当前节点选中的键：即使没登记也要列出来，否则下拉会显示空白 */
        const used = {};
        (WIZ.nodes || []).forEach(n => {
          if (n.effect) used[n.effect] = 1;
          Object.keys(n._eff || {}).forEach(k => { used[k] = 1; });
        });
        if (cur && cur !== '__custom__') used[cur] = 1;
        const groups = {};
        EFF_SCOPE_ORDER.forEach(([g]) => { groups[g] = []; });
        const seen = {};
        NODE_EFFECT_IDS.forEach(k => {
          const e = byId[k];
          if (!e) return;
          seen[k] = 1;
          const g = (e.kind === 'note') ? 'note' : (groups[e.scope] ? e.scope : 'other');
          groups[g].push([k, effLabel(k)]);
        });
        /* 其余效果整表列出（新建的自定义效果要能立刻选到；服务端已清理过垃圾行） */
        all.filter(e => !seen[e.id] && !(+e.deprecated || 0))
          .sort((a, b) => String(effLabel(a.id)).localeCompare(String(effLabel(b.id)), 'zh')
            || String(a.id).localeCompare(String(b.id)))
          .forEach(e => {
            seen[e.id] = 1;
            const g = (e.kind === 'note') ? 'note' : (groups[e.scope] ? e.scope : 'other');
            const tail = effFieldOf(e.id) ? '' : '（自定义）';
            groups[g].push([e.id, effLabel(e.id) + tail]);
          });
        const out = { groups: EFF_SCOPE_ORDER
          .map(([g, label]) => ({ label: label, items: groups[g] }))
          .filter(g => g.items.length) };
        /* 超管：改 / 删 这个效果（合并为一个入口；内置效果只能改名、不能删） */
        if (cur && byId[cur] && S.user && S.user.role === 'superadmin')
          out.groups.push({ label: '维护', items: [['__edit__', '✎ 修改 / 删除这个效果…']] });
        return out;
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
          const _pkN = critPairKey(n.effect);
          const _pvN = _pkN ? (+((n._eff || {})[_pkN]) || 0) : 0;
          card.appendChild(el('div', 'wiz-meta', effName(n.effect) + ' +' + n.val + '/级'
            + (_pvN > 0 ? '（同节点 ' + effName(_pkN) + ' +' + _pvN + '/级）' : '')));
          card.appendChild(el('div', 'wiz-meta',
            '每级 ' + n.cost + (n.costs ? '（逐级 ' + n.costs + '）' : '') + ' · 上限 ' + n.max_lv + ' 级'));
          const _pvTxt = perLvText(n._perLv, n.effect);
          if (_pvTxt) card.appendChild(el('div', 'wiz-meta',
            '逐级数值 ' + _pvTxt.replace(/,/g, '/') + '（按级数累加，超出末项外推）'));
          const acts = el('div', 'wiz-acts');
          const kid = el('button', 'btn sm ghost', '＋子节点'); kid.type = 'button';
          kid.onclick = (ev) => { ev.stopPropagation(); wizStartNewNode(si, x.key); };
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
        const pOpts = [['', '（无，作为根节点）']].concat(treeNow.map(y => [y.key, y.code + '　' + y.node.label]));
        const parSel = wIn(f, '前置节点 1', WIZ.dNode, 'parent', 'select', pOpts);
        parSel.onchange = () => { WIZ.dNode.parent = parSel.value; };
        const parSel2 = wIn(f, '前置节点 2（可选，满足其一即可）', WIZ.dNode, 'parent2', 'select', pOpts);
        parSel2.onchange = () => { WIZ.dNode.parent2 = parSel2.value; };
        const _effs = effOptions();
        const _curE = WIZ.dNode.effect;
        const _flat = _effs.groups.reduce((a, g) => a.concat(g.items), []);
        if (_curE && !_flat.some(o => o[0] === _curE))
          _effs.groups.unshift({ label: '当前在用',
            items: [[_curE, '⚠ 已删除：' + _curE + '（保留原值，改选其它项才会覆盖）']] });
        const effSel = wIn(f, '效果', WIZ.dNode, 'effect', 'select', _effs);
        effSel.value = WIZ.dNode.effect || 'dmg';
        effSel.onchange = async () => {
          if (effSel.value === '__custom__') {
            effectDialog('');
            effSel.value = WIZ.dNode.effect || 'dmg';
          } else if (effSel.value === '__edit__') {
            effectDialog(WIZ.dNode.effect || '');
            effSel.value = WIZ.dNode.effect || 'dmg';
          } else if (effSel.value) {
            const wasCrit = !!critPairKey(WIZ.dNode.effect), willCrit = !!critPairKey(effSel.value);
            WIZ.dNode.effect = effSel.value;
            if (wasCrit !== willCrit) wizRender();   /* 进/出暴击时补出或收掉「配对」输入框 */
          }
        };
        if (S.user && S.user.role === 'superadmin') {
          const bNew = el('button', 'btn sm ghost', '＋ 新建效果'); bNew.type = 'button';
          bNew.onclick = mkEffect;
          f.appendChild(bNew);
        } else {
          const bReq = el('button', 'btn sm ghost', '申请新增效果…'); bReq.type = 'button';
          bReq.onclick = () => effectDialog('', true);
          f.appendChild(bReq);
          f.appendChild(el('div', 'muted', '新增效果需超管批准；进度可在「人员管理 → 效果申请」查看。'));
        }
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
        /* 暴击：一个节点写「概率 + 额外暴伤」就成对相乘；只填暴伤 = 全局暴伤，加到本系统所有概率上 */
        if (critPairKey(WIZ.dNode.effect)) {
          const _pkIn = critPairKey(WIZ.dNode.effect);
          wIn(f, '同节点「' + effName(_pkIn) + '」（可留空，% / 每级）', WIZ.dNode, 'pair', 'number');
          f.appendChild(el('div', 'muted',
            '暴击只有两种写法：① 同一节点同时填「暴击率」和「暴击伤害」= 概率 × 额外暴伤（如 30 + 50 = +15%）；'
            + '② 只填「暴击伤害」= 全局暴伤，叠加到同一系统里所有暴击概率上；没有概率时单填暴伤不生效。'));
        }
        wIn(f, '每级数值', WIZ.dNode, 'val', 'number');
        wIn(f, '逐级数值（逗号分隔，可空；例 2,3,3,3,3 = 前 3 级 +2、后 2 级 +3）', WIZ.dNode, 'perLv', 'text');
        f.appendChild(el('div', 'muted',
          '填了逐级数值就按级数逐级累加（级数超过数组长度时按最后一项外推）；留空 = 每级都加「每级数值」。'));
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
        const depthOf = {};
        rows.forEach(x => { depthOf[x.key] = x.depth; });
        const draftHere = !!(WIZ.nodeDraft && String(WIZ.nodeDraft.sysIdx) === String(si));
        const draftDepth = draftHere
          ? (WIZ.nodeDraft.parent
            ? (depthOf[WIZ.nodeDraft.parent] === undefined ? -1 : depthOf[WIZ.nodeDraft.parent] + 1)
            : 0) : -1;
        if (!rows.length && !draftHere) {
          box.appendChild(el('div', 'muted', '这个系统还没有节点，点右上角「＋ 根节点」开始。'));
        }
        const byDepth = {};
        rows.forEach(x => {
          (byDepth[x.depth] = byDepth[x.depth] || []).push(x);
        });
        const depths = Object.keys(byDepth).map(Number);
        const maxD = Math.max(-1, ...depths, draftDepth);
        if (maxD >= 0) {
          const grid = el('div', 'tgrid tgrid-edit');
          grid.style.gridTemplateColumns = 'repeat(' + Math.max(1, maxD + 1) + ', minmax(132px, 1fr))';
          for (let d = 0; d <= maxD; d++) {
            (byDepth[d] || []).forEach((x, ri) => {
              const c = nodeCardEl(si, x);
              c.style.gridColumn = String(d + 1);
              c.style.gridRow = String(ri + 1);
              grid.appendChild(c);
            });
            if (d === draftDepth) {
              const c = nodeCardEl(si, {code: '', draft: true});
              c.style.gridColumn = String(d + 1);
              c.style.gridRow = String((byDepth[d] || []).length + 1);
              grid.appendChild(c);
            }
          }
          box.appendChild(grid);
        }
        treeCard.appendChild(box);
      });
      b.appendChild(treeCard);
    }
  } else if (st === 4) {
    const _bayOnly = WIZ.systems.filter(x => (x.bays || []).length);
    if (!canMod(WIZ.ship) && !_bayOnly.length) {
      b.appendChild(el('div', 'muted',
        '「' + (WIZ.ship.kind || '未选舰种') + '」没有模块槽位，系统里也没有舱位，这一步跳过 —— 点「下一步」直接进确认页。'));
    } else if (!canMod(WIZ.ship)) {
      b.appendChild(el('div', 'muted',
        '「' + (WIZ.ship.kind || '') + '」没有模块槽位（模块槽只给超主力舰），但下面这些系统自带舱位 —— 舱位已经在第 3 步填过，这里只做确认。'));
      _bayOnly.forEach(sy => {
        b.appendChild(el('div', 'muted',
          '· ' + sy.name + '：' + (sy.bays || []).map(x => x.kind + ' ' + x.cap + ' 舱').join(' + ')));
      });
      b.appendChild(el('div', 'muted',
        '要改舱位：点「上一步」回第 2 步，选中该系统点「改」，填「战机舱 / 护航艇舱」。'));
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
      lane.dataset.sys = 'mod';
      slots.forEach(({sy}) => {
        const box = el('div', 'wiz-col');
        box.appendChild(el('div', 'wiz-colhead', sy.name));
        const card = el('div', 'wiz-node sel static');
        const f = el('div', 'wiz-form');

        const roLine = (lab, val) => {
          const line = el('label', 'row');
          line.appendChild(el('span', '', lab));
          line.appendChild(el('span', 'ro-val', val));
          return line;
        };
        const _bays = (sy.bays || []).filter(b => (+b.cap || 0) > 0);
        f.appendChild(roLine('槽位', sy.slot ? (sy.slot + '（第 2 步填）') : '（未填）'));
        _bays.forEach(b => f.appendChild(roLine(b.kind + '舱',
          (+b.cap) + ' 架 · ' + bayGroupText(b.kind, b.allow_group))));
        if (_bays.length) f.appendChild(el('div', 'muted',
          '这里只做确认，不能改 —— 要改舱位：点「上一步」回第 2 步，选中该系统点「改」。'));
        card.appendChild(f);
        const sum = el('div', 'wiz-meta', _bays.length
          ? '合计 ' + _bays.map(b => b.kind + ' ' + b.cap).join(' + ')
          : '这个槽位还没有舱位');
        card.appendChild(sum);
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
    WIZ.systems.forEach((sy, i) => put('系统 ' + (i + 1), sy.name + (sy.slot ? '（槽位 ' + sy.slot + '）' : '')
      + ' · 可用节点 ' + (sy.tech_cap || '不限')
      + (weaponListOf(sy.raw) ? ' · ' + weaponListOf(sy.raw).length + ' 把武器' : '')
      + ((sy.bays && sy.bays.length) ? ' · 舱位 ' + sy.bays.map(b => b.kind + ' ' + b.cap).join(' + ') : '')));
    WIZ.nodes.forEach((n, i) => {
      const sy = WIZ.systems[+n.sysIdx];
      const _plt = perLvText(n._perLv, n.effect);
      put('加点 ' + (i + 1), (sy ? sy.name : '?') + ' / ' + n.label + ' · 每级 ' + n.cost
        + (n.costs ? '（逐级 ' + n.costs + '）' : '') + ' · 上限 ' + n.max_lv + ' 级 · '
        + effName(n.effect) + ' +' + n.val
        + (parList(n.parent).length
          ? ' · 前置「' + parList(n.parent).map(k => {
            const t = WIZ.nodes.find(y => String(y.sysIdx) === String(n.sysIdx) && wizKey(y) === k);
            return t ? t.label : k;
          }).join(' 或 ') + '」'
          : '')
        + (_plt ? ' · 逐级 ' + _plt.replace(/,/g, '/') : ''));
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
  /* 恢复横向滚动：新增节点时滚到最右（让新加的那一列可见），其余情况回到原位 */
  const _lanes = b.querySelectorAll('.wiz-lane');
  const _endSys = WIZ.scrollToEnd ? (WIZ.scrollToSys || '') : '';
  _lanes.forEach(l => {
    const keep = (WIZ.laneMap || {})[l.dataset.sys] || 0;
    const toEnd = !!_endSys && l.dataset.sys === _endSys;
    try { l.scrollLeft = toEnd ? l.scrollWidth : keep; } catch (e) {}
  });
  if (_endSys) {
    WIZ.scrollToEnd = false; WIZ.scrollToSys = '';
    /* 新列刚插进 DOM 时 scrollWidth 可能还没算完，下一帧再补一次（只补这一个系统） */
    setTimeout(() => {
      b.querySelectorAll('.wiz-lane').forEach(l => {
        if (l.dataset.sys !== _endSys) return;
        try { l.scrollLeft = l.scrollWidth; } catch (e) {}
      });
    }, 30);
  }
}
function wizTree(sysIdx) {
  const list = WIZ.nodes.map((n, i) => ({ n, i }))
    .filter(x => String(x.n.sysIdx) === String(sysIdx));
  /* parent 里存的是节点键（库 id / 新建临时键）。这里只清「自引用」（自己当自己的前置，
     引擎那边等于没有门控，清掉不改任何出数，还防成环）；指向本系统已不存在节点的旧前置
     **原样保留** —— 那意味着这个节点永远点不出来，是库里现状，清掉会变成「无门控、恒生效」，
     反而改了出数。落位时只认第一个还存在的父键，但不写回 parent。 */
  const keysNow = {};
  list.forEach(x => { keysNow[wizKey(x.n)] = 1; });
  list.forEach(x => {
    const ps = parList(x.n.parent);
    if (!ps.length) return;
    const ok = ps.filter(c => c !== wizKey(x.n));
    if (ok.length !== ps.length) x.n.parent = ok.join(',');
  });
  const placeKey = (n) => {
    const ps = parList(n.parent).filter(c => keysNow[c] && c !== wizKey(n));
    return ps.length ? ps[0] : '';
  };
  const out = [];
  const kids = (p) => list.filter(x => placeKey(x.n) === p);
  const seen = {};
  const walk = (p, prefix, depth) => {
    kids(p).forEach((x, k) => {
      const key = wizKey(x.n);
      if (seen[key] || depth > 20) return;          /* 成环时停下来，别把页面卡死 */
      seen[key] = 1;
      const code = prefix ? prefix + '-' + (k + 1) : String(k + 1);
      out.push({ code, idx: x.i, node: x.n, key, depth });
      walk(key, code, depth + 1);
    });
  };
  walk('', '', 0);
  // 父节点被删掉的孤儿也列出来，避免“消失”
  list.forEach(x => {
    if (!out.some(o => o.idx === x.i)) out.push({ code: '?', idx: x.i, node: x.n, key: wizKey(x.n), depth: 0 });
  });
  return out;
}
/* 问卷里的 stats_norm 规整：数字键去 0（0 当清空）、空串/空数组/空对象丢掉；
   数组/对象（weapons[]、bays、fam_bonus、_calib）必须原样带回去，否则多武器数据会丢；
   字符串键（unit 维修单位）原样保留 —— 走 Number() 会变 NaN 被吞掉，等于填了没存。 */
const WIZ_STR_KEYS = { unit: 1 };
function wizNormOf(raw) {
  const num = {};
  Object.keys(raw || {}).forEach(k => {
    const v0 = raw[k];
    if (v0 === undefined || v0 === null || v0 === '') return;
    if (WIZ_STR_KEYS[k]) { const sv = String(v0).trim(); if (sv) num[k] = sv; return; }
    if (Array.isArray(v0)) { if (v0.length) num[k] = v0; return; }
    if (typeof v0 === 'object') { if (Object.keys(v0).length) num[k] = v0; return; }
    const v = Number(v0);
    if (isFinite(v) && v !== 0) num[k] = v;
  });
  return num;
}
function wizPayload() {
  const sid = WIZ.ship.id || ('ship_' + Date.now());
  /* 编辑模式沿用原 id；新建模式按序号生成 */
  const sids = WIZ.systems.map((s, i) => s._id || ('sys_' + sid + '_' + i));
  const systems = WIZ.systems.map((s, i) => {
    /* 数字照旧（0 当清空），但数组/对象必须原样带回去：
       weapons[]（文档导入的多武器）、bays、fam_bonus、_calib 一旦被过滤掉，
       在问卷里保存一次系统就会退化成「首武器兼容字段」，多武器数据直接丢失。 */
    const num = wizNormOf(s.raw);
    const stats = Object.assign({}, s._stats || {});
    if (s.module) stats['模块'] = s.module; else delete stats['模块'];
    return {id: sids[i], ship: sid, slot: s.slot, name: s.name,
      tech_cap: s.tech_cap, stats: stats,
      /* 舱位也存一份在系统上：只写 modules 时，重新打开问卷的系统表单读不到舱位 */
      bays: JSON.stringify((s.bays || []).map(b => ({kind: b.kind || '', cap: +b.cap || 0, allow_group: b.allow_group || ''}))),
      stats_norm: Object.keys(num).length ? JSON.stringify(num) : '',
      is_weapon: s.is_weapon ? 1 : 0,
      sys_kind: s.sys_kind || '',
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
    ['ammo', 'atk', 'guns'].forEach(k => {
      const v = Number(firstW.raw[k]);
      if (isFinite(v) && v > 0) WIZ.ship.base[k] = v;
    });
    const aa = Number(firstW.raw.ammo_atk);
    if (!(Number(firstW.raw.ammo) && Number(firstW.raw.atk)) && isFinite(aa) && aa > 0) {
      WIZ.ship.base.ammo = aa; WIZ.ship.base.atk = 1;
    }
  }
  /* 突防速度由功能系统（动力/引擎）提供，取第一个填了值的 */
  const spdSys = WIZ.systems.find(s => Number((s.raw || {}).spd) > 0);
  if (spdSys) WIZ.ship.base.spd = Number(spdSys.raw.spd);
  const nids = WIZ.nodes.map((n, i) => n._id || ('n_' + sid + '_' + i));
  /* 前置存的是节点键 → 这里换成真实 id；只认同系统的节点，避免跨系统串前置 */
  const keyIdx = {};
  WIZ.nodes.forEach((n, i) => { keyIdx[wizKey(n)] = i; });
  const nodes = WIZ.nodes.map((n, i) => {
    const sy = systems[n.sysIdx] || systems[0];
    const costs = (n.costs || '').split(/[,，\s]+/).map(x => Number(x)).filter(x => x > 0);
    const pcodes = parList(n.parent);
    /* 保留原效果里的其它键（一个节点可能带 cd_up 这类第二效果），只覆盖当前编辑的那一项 */
    const eff = {};
    if (n._eff) Object.keys(n._eff).forEach(k => { if (k !== (n._effKey || '')) eff[k] = n._eff[k]; });
    if (n.effect) eff[n.effect] = n.val;
    return {id: nids[i], sys: sy ? sy.id : '',
      /* 能找到且同系统的键换成真实 id；找不到的键原样保留 —— 那是库里既有的悬空前置，
         保留它才能让引擎的门控行为和现在完全一致（清掉会让该节点变成无门控）。 */
      parent: pcodes.map(c => {
        const at = keyIdx[c];
        if (at === undefined) return c;
        const pn = WIZ.nodes[at];
        return String(pn.sysIdx) === String(n.sysIdx) ? nids[at] : '';
      }).filter(Boolean).join(','),
      label: n.label, max_lv: n.max_lv, cost: n.cost,
      costs: costs.length ? JSON.stringify(costs) : '',
      effect: eff,
      per_lv: n._perLv ? JSON.stringify(n._perLv) : '',
      note: n._note || (n.effect ? (effName(n.effect) + ' +' + n.val + '/级') : '')};
  });
  const modules = WIZ.systems.map((sy, i) => ({sy, i}))
    /* 只要带舱位就生成模块记录（槽位可以空）：否则「填了舱位、没填槽位」时
       舱位存库后会凭空消失，舰载机组合里也就勾不到。 */
    .filter(x => x.sy.slot || (x.sy.bays || []).length)
    .map(({sy, i}, k) => {
      const old = sy._mod || {};
      /* 舱位口径：读取时已经把「系统自身 bays 为空、模块行有 bays」的情况合并进
         sy.bays（见 wizEditOpen / wizBaysOf），所以这里只认 sy.bays ——
         用户主动清空舱位时也就能真的清空，不再被旧值顶回来。 */
      const bays = (sy.bays || []).map(b => ({kind: b.kind, cap: +b.cap || 0, allow_group: b.allow_group || ''}));
      const cap = bays.reduce((a, b) => a + b.cap, 0);
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
  WIZ = {step: 0, edit: true, editIdx: -1, laneLeft: 0, scrollToEnd: false, scrollToSys: '', laneMap: {},
    ship: {id: sh.id, name: sh.name, kind: sh.kind, cls: sh.cls, size: sh.size,
      pgroup: sh.pgroup || '', cmd_type: sh.cmd_type || '', tech_total: +sh.tech_total || 0,
      base: Object.assign({}, sh.base || {}), note: sh.note || ''},
    systems: [], nodes: [], modules: [], editSys: -1,
    dSys: {name: '', slot: '', tech_cap: 5, bayF: '', bayC: '', bayG: ''},
    dNode: {sysIdx: '0', label: '', max_lv: 5, cost: 2, costs: '', effect: 'dmg', val: 3, parent: '', parent2: '', perLv: ''},
    dMod: {slot: '', name: '', dmg: 10, sysIdx: '', bays: [], bayKind: '战机', bayCap: '', bayAllow: ''},
    orig: {systems: [], nodes: [], modules: []}};
  (sh.systems || []).forEach((sy, si) => {
    /* 模块行用统一口径找（见 modOfSys）：sys 精确 → 同船同槽位 → 名字。找不到就会把
       舱位读空、保存时连模块行一起丢掉，所以不能只靠 sys 或名字。 */
    const mod = modOfSys(sh, sy);
    let raw = {};
    try { raw = JSON.parse(sy.stats_norm || '{}') || {}; } catch (e) { raw = {}; }
    /* 旧数据把弹药数、攻击次数分开存：合并口径读回来时乘成一项，避免编辑后丢失 */
    if (raw.ammo_atk === undefined && !(Number(raw.ammo) && Number(raw.atk))
      && (Number(raw.ammo) || Number(raw.atk))) {
      raw.ammo_atk = (Number(raw.ammo) || 0) * (Number(raw.atk) || 1);
    }
    WIZ.systems.push({_id: sy.id, _stats: sy.stats || {}, _note: sy.note || '',
      _ord: sy.ord || (si + 1), _no_nodes: sy.no_nodes || 0, _mod: mod || null,
      name: sy.name, slot: sy.slot || '', tech_cap: +sy.tech_cap || 0,
      raw: raw,
      is_weapon: !!(sy.is_weapon || (raw.dmg_atk !== undefined || raw.dmg_air !== undefined
        || !!weaponSixOf(raw) || !!weaponListOf(raw))),
      module: (sy.stats && sy.stats['模块']) || '',
      bays: wizBaysOf(sy, mod)});
    WIZ.orig.systems.push(sy.id);
    if (mod) WIZ.orig.modules.push(mod.id);
    const push = n => {
      const ks = Object.keys(n.effect || {});
      const ek = ks[0] || '';
      WIZ.nodes.push({_id: n.id, _k: n.id, _note: n.note || '', _eff: n.effect || {}, _effKey: ek,
        _perLv: n.per_lv || null,
        sysIdx: si, label: n.label,
        max_lv: +n.max_lv || 1, cost: +n.cost || 0, costs: (n.costs || []).join(','),
        effect: ek, val: Number((n.effect || {})[ek] || 0),
        /* 前置直接沿用库里的节点 id（= 节点键），不用再换算成 1/1-1 */
        parent: parList(n.parent).join(',')});
      WIZ.orig.nodes.push(n.id);
    };
    /* 按树的先序插一遍，保证同层顺序稳定；没挂到树上的（孤儿）最后补 */
    const walk = (pid) => (sy.nodes || []).filter(n => firstPar(n.parent) === pid)
      .forEach(n => { push(n); walk(n.id); });
    walk('');
    (sy.nodes || []).forEach(n => { if (!WIZ.nodes.some(x => x._id === n.id)) push(n); });
  });
  $('#wizDlg').showModal();
  wizRender();
}
async function wizSave() {
  const p = wizPayload();
  /* 统一校验：允许 0 系统 / 0 加点 / 0 模块，但基本信息必须齐 */
  p.ship.name = (p.ship.name || '').trim();
  WIZ.ship.name = p.ship.name;
  const errs = [];
  if (!p.ship.name) errs.push('① 名称没填');
  if (!p.ship.kind) errs.push('② 舰种没选');
  if (!p.ship.cls) errs.push('③ 舰型没选（主力舰选巡洋/驱逐/护卫，超主力舰选航母/战巡）');
  if (errs.length) {
    alert('还不能保存：\n\n' + errs.join('\n') + '\n\n（系统、加点、模块都可以是 0 条）');
    return;
  }
  if (!WIZ.edit) {
    const dup = (((S.bp && (S.bp.shipsAll || S.bp.ships)) || []))
      .find(x => (x.name || '').trim() === (p.ship.name || '').trim());
    if (dup) {
      alert('已经有同名舰船「' + dup.name + '」（' + dup.id + '）。\n\n'
        + '请回到第 1 步选它、用「修改」保存，不要另建一条同名船。');
      return;
    }
  }
  const btn = $('#wizNext'); btn.disabled = true;
  const doneStages = [];
  let stage = '舰船';
  try {
    await api('/api/data/ships', {method: 'PUT', body: p.ship});
    stage = '系统'; doneStages.push('舰船');
    for (const s of p.systems) await api('/api/data/systems', {method: 'PUT', body: s});
    stage = '加点'; doneStages.push('系统 ' + p.systems.length + ' 个');
    for (const n of p.nodes) await api('/api/data/nodes', {method: 'PUT', body: n});
    const withMod = canMod(p.ship);
    stage = '模块'; doneStages.push('加点 ' + p.nodes.length + ' 条');
    if (withMod) {
      for (const m of p.modules) await api('/api/data/modules', {method: 'PUT', body: m});
      if (p.modules.length) doneStages.push('模块 ' + p.modules.length + ' 个');
    }
    /* 编辑模式：把这次删掉的旧行一起清掉（先删节点，再删模块，最后删系统） */
    if (WIZ.edit) {
      const keepN = new Set(p.nodes.map(x => x.id));
      const keepM = new Set(p.modules.map(x => x.id));
      const keepS = new Set(p.systems.map(x => x.id));
      for (const id of WIZ.orig.nodes) if (!keepN.has(id)) await api('/api/data/nodes/' + encodeURIComponent(id), {method: 'DELETE', confirm: id});
      if (withMod) {
        /* 收窄：只有「原来挂着这条模块行的系统已经不存在」才删。
           系统还在、只是这次没生成模块行（槽位/舱位被清空）时保留该行，
           免得连带把它的备注、加成、舱位一起丢掉（以前就是这么丢的）。 */
        const claimed = new Set();
        for (const sy of WIZ.systems) if (sy._mod && sy._mod.id) claimed.add(sy._mod.id);
        for (const id of WIZ.orig.modules) {
          if (keepM.has(id) || claimed.has(id)) continue;
          await api('/api/data/modules/' + encodeURIComponent(id), {method: 'DELETE', confirm: id});
        }
      }
      for (const id of WIZ.orig.systems) if (!keepS.has(id)) await api('/api/data/systems/' + encodeURIComponent(id), {method: 'DELETE', confirm: id});
    }
    toast((WIZ.edit ? '已保存：' : '已新建：') + '1 条舰船 / ' + p.systems.length + ' 个系统 / '
      + p.nodes.length + ' 条加点 / ' + p.modules.length + ' 个模块', 'good');
    $('#wizDlg').close();
    S.slots[S.cur].ship = p.ship.id; S.sys[S.cur] = '';   /* 存完自动切到这条船 */
    await loadBlueprints(true); renderData(); renderEditor();
  } catch (e) {
    const info = doneStages.length
      ? '已经写进库里的：' + doneStages.join('、') + '。'
        + '\n\n剩下的没写进去——重新打开这条船、再点一次「保存修改」就行（按 id 覆盖，不会多出重复数据）。'
      : '这次一条都没写进去，改完再存即可。';
    alert('保存失败（停在「' + stage + '」这一步）：\n\n' + (e && e.message ? e.message : e) + '\n\n' + info);
  }
  finally { btn.disabled = false; }
}

/* ---------- 实时（SSE）：断线只在「确实连不上」时提示，恢复后自动消失 ---------- */
let STREAM_RETRY = null, STREAM_ES = null, STREAM_PROBE = null, STREAM_DOWN_AT = 0;

function offlineBox() { return document.getElementById('offline'); }
function showOffline(on, msg) {
  const b = offlineBox();
  if (!b) return;
  if (msg) {
    const s = b.querySelector('#offlineMsg');
    if (s) s.textContent = msg; else b.textContent = msg;
  }
  b.classList.toggle('hide', !on);
}
async function healthOk() {
  try {
    const r = await fetch('/api/health', {cache: 'no-store'});
    return !!(r && r.ok);
  } catch (e) { return false; }
}
function streamUp() {
  STREAM_DOWN_AT = 0;
  if (STREAM_PROBE) { clearInterval(STREAM_PROBE); STREAM_PROBE = null; }
  showOffline(false);
}
function streamDown() {
  if (!STREAM_DOWN_AT) STREAM_DOWN_AT = Date.now();
  if (STREAM_PROBE) return;
  STREAM_PROBE = setInterval(async () => {
    if (await healthOk()) { streamUp(); return; }           // 服务端正常 = 只是这条流断了，不吓用户
    if (Date.now() - STREAM_DOWN_AT < 8000) return;          // 8 秒宽限，防抖
    showOffline(true, navigator.onLine === false
      ? '网络已断开，恢复后会自动重连。'
      : '实时同步已断开，正在重连……这期间页面仍可正常保存，数字可能不是最新的。');
  }, 3000);
}
function scheduleStream(ms) {
  if (STREAM_RETRY) clearTimeout(STREAM_RETRY);
  STREAM_RETRY = setTimeout(connectStream, ms);
}
async function connectStream() {
  if (STREAM_ES) { try { STREAM_ES.close(); } catch (e) {} STREAM_ES = null; }
  let tk = '';
  try {
    const r = await api('/api/stream_ticket', {method: 'POST'});
    tk = r.ticket || '';
  } catch (e) {
    $('#liveTag').textContent = '实时 · 未连接';
    streamDown();
    if (e && e.perm) return;              /* 权限不足：不再每 5 秒重连 */
    scheduleStream(5000);
    return;
  }
  const es = new EventSource('/api/stream?ticket=' + encodeURIComponent(tk));
  STREAM_ES = es;
  es.onopen = () => { $('#liveTag').textContent = '实时 · 已连接'; streamUp(); };
  es.addEventListener('version', ev => {
    streamUp();
    const v = +ev.data;
    $('#liveTag').textContent = (S.user && S.user.role === 'superadmin') ? '实时 · v' + v : '实时';
    if (v !== S.version && S.bp) { S.version = v; loadBlueprints(true); }
  });
  es.onerror = () => {
    /* EventSource 自带重连不会再次触发 onopen，所以这里主动关掉重建；
       同时横幅要等「health 也不通」才显示，避免一次抖动就报警。 */
    $('#liveTag').textContent = '实时 · 重连中';
    try { es.close(); } catch (e) {}
    if (STREAM_ES === es) STREAM_ES = null;
    streamDown();
    scheduleStream(3000);
  };
}
if (!window.__netBound) {
  window.__netBound = 1;
  window.addEventListener('online', () => { healthOk().then(ok => { if (ok) streamUp(); }); });
  window.addEventListener('offline', () => showOffline(true, '网络已断开，恢复后会自动重连。'));
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
  markDateEmpty($('#bmDate'));   /* 程序写值不触发 input 事件，空态要手动刷一次 */
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
  if (tab === 'data') { renderData(); if (window.__er) window.__er(); }
  if (tab === 'roster') loadRosterQuery();
  if (tab === 'rosterM') loadRosterAdmin();
  if (tab === 'people' && S.user) { loadUsers(); loadPwdReqs(); if (window.__rc) window.__rc(); if (window.__tpl) window.__tpl(); }
  if (tab === 'audit') loadAudit();
  if (tab === 'season' && window.renderSeason) renderSeason();
  if (tab === 'posts' && window.__posts) window.__posts();
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
  const sy = (ship.systems || []).find(x => x.id === S.sys[S.cur]);
  if (sy) sy.nodes.forEach(nd => delete S.slots[S.cur].alloc[nd.id]);
  renderTree(); recalc(S.cur);
};
$('#saveBuild').onclick = async () => {
  if (!S.user) return toast('先登录再保存方案', 'bad');
  const sl = S.slots[S.cur];
  if (!sl.ship || !shipOf(sl.ship)) return toast('当前方案还没有选中真实存在的舰船，先选一艘再保存', 'bad');
  const name = prompt('方案名称', '方案 ' + S.cur); if (!name) return;
  try { await api('/api/builds', {method: 'POST', body: {ship: sl.ship, name,
    modules: sl.modules, alloc: sl.alloc,
    planes: (sl.planes || []).map(x => Object.assign({}, x,
      {alloc: Object.assign({}, (sl.palloc || {})[x.id] || {})}))}}); toast('已保存', 'good'); }
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

$('#newEnt').onclick = () => {
  if (S.ent === 'ships') return toast('舰船请用「问卷式录入舰船」：它会连带把系统、节点、模块一起建好', 'bad');
  openEnt(null);
};
$('#expJson').onclick = exportJson;
$('#dedupeBtn').onclick = () => dedupeShips();
$('#impShipBtn').onclick = () => $('#impShipFile').click();
$('#impShipFile').onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importShipFile(f); };
$('#entForm').onsubmit = submitEnt;
$('#entCancel').onclick = () => { try { $('#entDlg').close(); } catch (e) {} };
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
  const errEl = $('#pwdErr');
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hide'); }
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
  const errEl = $('#pwdErr');
  const fail = msg => {
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hide'); }
    toast(msg, 'bad');                      // 弹窗是模态层，toast 会被挡住，真正看得见的是上面这行
  };
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hide'); }
  const oldv = f.old.value, nw = f.new.value, ag = f.again.value;
  if (!oldv) { fail('请填写当前密码'); return; }
  if (nw !== ag) { fail('两次输入的新密码不一样'); return; }
  if (nw.length < 8) { fail('新密码至少 8 位'); return; }
  if (nw === oldv) { fail('新密码不能和当前密码一样'); return; }
  try {
    const j = await api('/api/me/password', {method: 'POST', body: {old: oldv, new: nw}});
    S.user = j.user || S.user;
    if (S.user) S.user.must_change = 0;
    $('#pwdDlg').close();
    toast('密码已更新', 'good');
    if (PWD_FORCED) { PWD_FORCED = false; location.reload(); }
  } catch (e) { fail('改密失败：' + e.message); }
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
        if (pw.trim().length < 8) return toast('临时密码至少 8 位', 'bad');
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
$('#userCancel').onclick = () => { try { $('#userDlg').close(); } catch (e) {} };
$('#pwdForm').onsubmit = submitPwd;
['old', 'new', 'again'].forEach(n => {
  const inp = document.querySelector('#pwdForm [name="' + n + '"]');
  if (inp) inp.addEventListener('input', () => { const e = $('#pwdErr'); if (e) { e.textContent = ''; e.classList.add('hide'); } });
});
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
  /* 记下“进入页面时”的地址栏：loadBlueprints → renderEditor → syncUrl 会把 ?ship= 改写成
     第一艘船（cv3000），不提前捕获的话，后面的还原永远读到错的船。 */
  const bootQS = new URLSearchParams(location.search);
  S.booting = true;
  try {
    const j = await api('/api/me');
    S.user = j.user;
    S.csrf = j.csrf || '';
  } catch (e) {
    S.token = ''; localStorage.removeItem('ft_token');
    S.booting = false;
    goLogin('登录已过期，请重新登录');
    return;
  }
  whoami();
  bindDateHints();
  if (S.user && Number(S.user.must_change)) { S.booting = false; openPwdDlg(true); return; }
  renderSlotTabs();
  await loadBlueprints(true);
  // 地址栏还原：?slot=b&ship=xxx&sys=yyy —— 收藏或发给别人能回到同一处
  try {
    const p = bootQS;
    const ss = (p.get('slot') || '').trim().toUpperCase();
    if (SLOTS.indexOf(ss) >= 0) S.cur = ss;
    /* 地址栏没带 ship（例如直接打开根地址）时，用上次记住的方案/舰船/系统 */
    if (!p.get('ship')) {
      try {
        const last = JSON.parse(localStorage.getItem('ft_lastSel') || 'null');
        if (last && last.ship && shipOf(last.ship) &&
            SLOTS.indexOf(String(last.slot || '').toUpperCase()) >= 0) {
          S.cur = String(last.slot).toUpperCase();
          p.set('slot', S.cur); p.set('ship', last.ship);
          if (last.sys) p.set('sys', last.sys);
        }
      } catch (e2) {}
    }
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
  /* 另一套方案（非当前槽位）的舰船也从本地记录里还原 */
  try {
    const _all = JSON.parse(localStorage.getItem('ft_slots') || '[]');
    (_all || []).forEach(it => {
      const k = String((it && it.k) || '').toUpperCase();
      if (!k || k === S.cur || SLOTS.indexOf(k) < 0) return;
      const sh = it && it.ship;
      if (sh && shipOf(sh)) S.slots[k].ship = sh;
      const sp = S.slots[k].ship ? shipOf(S.slots[k].ship) : null;
      const sy = it && it.sys;
      if (sy && sp && (sp.systems || []).some(x => x.id === sy)) S.sys[k] = sy;
    });
    SLOTS.forEach(recalc);
  } catch (e2) {}
  /* 还原完成，恢复地址栏同步（把规范化后的 slot/ship/sys/tab 写回去） */
  S.booting = false;
  try { syncUrl(); } catch (e) {}
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
  S.booting = false;   /* 兜底：无论中间哪一步抛错，都别让 syncUrl 永久失效 */
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
      const bs = b.ship ? shipOf(b.ship) : null;
      const bt = bs ? bs.name : (b.ship ? ('⚠ ' + b.ship + '（该舰船已不存在）') : '（未记录舰船）');
      const o = el('option', '', b.name + ' · ' + bt); o.value = String(b.id);
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
  /* 舰船解析：先按 id，再按船名；两者都找不到就保留当前舰船并提示，
     否则 renderEditor 的“自愈”会把整页跳到第一艘船。 */
  const want = String(b.ship || '').trim();
  let target = want && shipOf(want) ? want : '';
  if (!target && want) {
    const byName = (S.bp.ships || []).find(x => String(x.name || '').trim() === want);
    if (byName) target = byName.id;
  }
  let sameShip = true;
  if (target) {
    sameShip = (target === sl.ship);
    sl.ship = target;
    if (!sameShip) {
      sl.modules = {}; sl.alloc = {}; sl.planes = [];
      sl.palloc = {}; sl.psys = {};
      sl.carrierMods = undefined; sl.noCarrier = false;
    }
  }
  sl.modules = P(b.modules) || sl.modules || {};
  sl.alloc = P(b.alloc) || sl.alloc || {};
  sl.planes = P(b.planes) || sl.planes || [];
  /* 老方案里没有 palloc：从每条搭载记录的 alloc 还原（同型号多架共用一套） */
  sl.palloc = {}; sl.psys = {};
  (sl.planes || []).forEach(x => {
    const a = x && x.alloc;
    if (x && x.id && a && typeof a === 'object' && Object.keys(a).length)
      sl.palloc[x.id] = Object.assign({}, a);
  });
  if (target) S.sys[S.cur] = ((shipOf(sl.ship) || {}).systems || [{}])[0].id || '';
  S.undo = [];
  markBase();
  repaintAll();
  if (target) syncUrl();
  toast(target
    ? ('已载入方案「' + b.name + '」：舰船 ' + ((shipOf(target) || {}).name || target))
    : ('已载入方案「' + b.name + '」，但它记录的舰船已不存在（' + (want || '未填写') + '），已保留当前舰船'),
    target ? 'good' : 'warn');
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

/* ================= 赛季历程：星系 → 联合体 → 小队 ================= */
(function () {
  var REL = ['友好', '中立', '敌对'];
  var CLS = { '友好': 'relf', '中立': 'reln', '敌对': 'relh' };
  var SE = { mode: 'current', season: null, data: null, sel: null, kw: '', rel: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function relOf(v) { return REL.indexOf(v) >= 0 ? v : '中立'; }
  function tag(v) { var r = relOf(v); return '<span class="rel ' + CLS[r] + '">' + r + '</span>'; }
  function op(body) { return api('/api/season/op', { method: 'POST', body: body }); }
  function root() { return document.getElementById('seRoot'); }

  function load() {
    var url = '/api/season/tree?mode=' + SE.mode;
    if (SE.mode === 'archive' && SE.season) url += '&season=' + SE.season;
    return api(url).then(function (r) { SE.data = r; paint(r); })
      .catch(function (e) {
        var d = root();
        if (d) d.innerHTML = '<div class="empty" style="padding:18px">加载失败：'
          + esc((e && e.message) || e) + '</div>';
      });
  }

  function n0(n) { return (n == null ? 0 : n); }
  function pplKnown() { return !!(SE.data && SE.data.people && SE.data.people.known); }
  function pplTxt(n) { return pplKnown() ? (' · ' + n0(n) + ' 人') : ''; }

  function alliSorted() {
    var g = (SE.data && (SE.data.galaxies || [])[0]) || null;
    var alls = (g && g.alliances) || [];
    return alls.slice().sort(function (a, b) {
      var d1 = REL.indexOf(relOf(a.relation)) - REL.indexOf(relOf(b.relation));
      return d1 !== 0 ? d1 : ((a.ord || 0) - (b.ord || 0));
    });
  }
  function findAlli(id) {
    var hit = null;
    alliSorted().forEach(function (a) { if (String(a.id) === String(id)) hit = a; });
    return hit;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function dayOf(v) {
    var t = String(v == null ? '' : v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '—';
  }

  function evRow(e, edit) {
    var h = '<div class="seEvr"><span class="sevT">' + esc(dayOf(e.at || e.created_at)) + '</span>'
      + '<span class="sevB"><b>' + esc(e.title) + '</b>';
    if (e.detail) h += '<span class="dim"> · ' + esc(e.detail) + '</span>';
    if (e.actor) h += '<span class="sevA">' + esc(e.actor) + '</span>';
    h += '</span>';
    if (edit) {
      h += '<button class="mini del" data-ev="' + e.id + '" title="删除这条" aria-label="删除">✕</button>';
    }
    return h + '</div>';
  }

  /* 赛季信息 / 新建赛季共用一个轻量弹窗（复用 .semask .sedlg） */
  function pickSeason() {
    var all = (SE.data && SE.data.seasons) || [];
    if (SE.mode === 'archive' && SE.season) {
      var hit = null;
      all.forEach(function (x) { if (String(x.id) === String(SE.season)) hit = x; });
      return hit;
    }
    return (SE.data && SE.data.current) || null;
  }

  function seasonDlg(title, fields, onOk, onDel) {
    var old = document.getElementById('seMd');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var h = '<div class="semask" id="seMd"><div class="sedlg"><div class="sedgh">'
      + '<b>' + esc(title) + '</b><span class="grow"></span>'
      + '<button class="btn ghost sm" data-md="cancel">取消</button></div><div class="seMbody">';
    fields.forEach(function (f) {
      h += '<label class="row"><span>' + esc(f.label) + '</span>';
      if (f.type === 'date') {
        h += '<span class="datewrap"><input type="date" id="' + f.id + '" value="'
          + esc(f.value || '') + '"><span class="dph">点这里选日期（年/月/日）</span></span>';
      } else if (f.type === 'check') {
        h += '<input type="checkbox" id="' + f.id + '"' + (f.value ? ' checked' : '') + '>';
      } else {
        h += '<input class="inp" id="' + f.id + '" type="text" value="' + esc(f.value || '') + '"'
          + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '')
          + ' maxlength="' + (f.max || 60) + '">';
      }
      h += '</label>';
    });
    h += '<div class="sedgf">';
    if (onDel) h += '<button class="btn danger" data-md="del">删除这个赛季</button>';
    h += '<span class="grow"></span><button class="btn" data-md="ok">保存</button>'
      + '</div></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);
    var box = document.getElementById('seMd');
    box.querySelectorAll('input[type="date"]').forEach(function (inp) {
      markDateEmpty(inp);
      inp.addEventListener('input', function () { markDateEmpty(inp); });
      inp.addEventListener('change', function () { markDateEmpty(inp); });
    });
    box.addEventListener('click', function (ev) {
      var tg = ev.target;
      if (tg === box || (tg.closest && tg.closest('[data-md="cancel"]'))) {
        if (box.parentNode) box.parentNode.removeChild(box);
        return;
      }
      if (onDel && tg.closest && tg.closest('[data-md="del"]')) {
        onDel(function () { if (box.parentNode) box.parentNode.removeChild(box); });
        return;
      }
      if (tg.closest && tg.closest('[data-md="ok"]')) {
        var vals = {};
        fields.forEach(function (f) {
          var el = document.getElementById(f.id);
          vals[f.id] = f.type === 'check' ? !!(el && el.checked) : (el ? el.value : '');
        });
        onOk(vals, function () { if (box.parentNode) box.parentNode.removeChild(box); });
      }
    });
    var f0 = document.querySelector('#seMd input');
    if (f0 && f0.focus) f0.focus();
  }

  function renderList() {
    var box = document.getElementById('seList');
    if (!box) return;
    var kw = String(SE.kw || '').trim().toLowerCase();
    var rows = alliSorted().filter(function (a) {
      if (SE.rel && relOf(a.relation) !== SE.rel) return false;
      if (!kw) return true;
      if (String(a.name || '').toLowerCase().indexOf(kw) >= 0) return true;
      return (a.squads || []).some(function (x) {
        return String(x.name || '').toLowerCase().indexOf(kw) >= 0
          || String(x.leader || '').toLowerCase().indexOf(kw) >= 0;
      });
    });
    if (!rows.length) {
      box.innerHTML = '<div class="empty" style="padding:14px">没有匹配的联合体</div>';
      return;
    }
    var h = '';
    rows.forEach(function (a) {
      var on = String(SE.sel) === String(a.id);
      h += '<div class="serow' + (on ? ' on' : '') + '" data-pick="' + a.id + '">'
        + '<i class="bar ' + CLS[relOf(a.relation)] + '"></i>'
        + '<div class="seitem"><b>' + esc(a.name) + '</b>'
        + '<span class="meta">' + relOf(a.relation) + ' · ' + (a.squads || []).length + ' 队'
        + pplTxt(a.n) + '</span></div></div>';
    });
    box.innerHTML = h;
  }

  function renderDetail() {
    var box = document.getElementById('seDetail');
    if (!box) return;
    var edit = can('season_edit');
    var a = SE.sel ? findAlli(SE.sel) : null;
    if (!a) {
      box.innerHTML = '<div class="empty" style="padding:28px">左边选一个联合体</div>';
      return;
    }
    var kw = String(SE.kw || '').trim().toLowerCase();
    var sqs = (a.squads || []).slice().sort(function (x, y) { return (x.ord || 0) - (y.ord || 0); });
    var h = '<div class="sedh"><b>' + esc(a.name) + '</b>' + tag(a.relation)
      + '<span class="tag">' + sqs.length + ' 队' + pplTxt(a.n) + '</span>'
      + (a.note ? '<span class="tagf">' + esc(a.note) + '</span>' : '')
      + '<span class="grow"></span>';
    if (edit) {
      h += '<button class="btn ghost sm" data-se="add_squad" data-id="' + a.id + '">＋小队</button>'
        + '<button class="btn ghost sm" data-se="set_rel" data-id="' + a.id
        + '" data-rel="' + relOf(a.relation) + '" data-name="' + esc(a.name) + '">改关系</button>'
        + '<button class="btn ghost sm" data-se="ren" data-lv="alliance" data-id="' + a.id
        + '" data-name="' + esc(a.name) + '">改名</button>'
        + '<button class="btn ghost sm danger" data-se="del" data-lv="alliance" data-id="' + a.id
        + '" data-name="' + esc(a.name) + '">删除</button>';
    }
    h += '</div>';
    if (!sqs.length) {
      h += '<div class="empty" style="padding:18px">还没有小队'
        + (edit ? '，点「＋小队」添加。' : '') + '</div>';
    } else {
      h += '<div class="seqgrid">';
      sqs.forEach(function (x) {
        var hit = kw && (String(x.name || '').toLowerCase().indexOf(kw) >= 0
          || String(x.leader || '').toLowerCase().indexOf(kw) >= 0);
        h += '<div class="seq' + (hit ? ' hit' : '') + '">'
          + '<div class="seqn">' + esc(x.name) + '</div>'
          + '<div class="seqm">' + (x.leader ? esc(x.leader) : '—')
          + ' · <b class="hc" data-hc="' + x.id + '" data-hn="' + n0(x.n)
          + '" data-hname="' + esc(x.name) + '" title="点这里改人数">' + n0(x.n) + '</b> 人</div>';
        if (edit) {
          h += '<div class="seqo">'
            + '<button class="mini edit" data-se="ren" data-lv="squad" data-id="' + x.id
            + '" data-name="' + esc(x.name) + '" title="改名" aria-label="改名">✎</button>'
            + '<button class="mini del" data-se="del" data-lv="squad" data-id="' + x.id
            + '" data-name="' + esc(x.name) + '" title="删除" aria-label="删除">✕</button>'
            + '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
    box.innerHTML = h;
  }

  function paint(r) {
    var d = root();
    if (!d) return;
    var edit = can('season_edit');
    var seasons = r.seasons || [];
    var g = (r.galaxies || [])[0] || null;
    var alls = (g && g.alliances) || [];
    var seas = (SE.mode === 'archive' && SE.season)
      ? (seasons.filter(function (x) { return String(x.id) === String(SE.season); })[0] || r.target)
      : r.current;
    var cnt = { '友好': 0, '中立': 0, '敌对': 0 };
    var sqn = 0, ppl = 0;
    alls.forEach(function (a) {
      cnt[relOf(a.relation)]++;
      sqn += (a.squads || []).length;
      ppl += (a.n || 0);
    });
    SE.data = r;
    if (!SE.sel || !findAlli(SE.sel)) SE.sel = alls.length ? alls[0].id : null;

    var h = '<div class="sebar">';
    h += '<span class="tag">赛季 <b>' + esc(seas ? seas.label : '（无）') + '</b></span>';
    h += '<select id="seSel" class="selsm"><option value="">当前赛季</option>';
    seasons.forEach(function (x) {
      if (x.is_current) return;
      h += '<option value="' + x.id + '"' + (String(SE.season) === String(x.id) ? ' selected' : '')
        + '>' + esc(x.label) + '</option>';
    });
    h += '</select>';
    h += '<span class="chips seChips">';
    ['友好', '中立', '敌对'].forEach(function (k) {
      h += '<span class="chip sef' + (SE.rel === k ? ' sel' : '') + '" data-sefilter="' + k + '">'
        + k + ' ' + cnt[k] + '</span>';
    });
    h += '<span class="chip">小队 ' + sqn + '</span>';
    if (pplKnown()) h += '<span class="chip">人数 ' + ppl + '</span>';
    h += '</span>';
    h += '<span class="grow"></span>';
    if (edit) {
      if (g) h += '<button class="btn sm" data-se="add_alli">＋联合体</button>';
      h += '<button class="btn ghost sm" data-se="season_meta">赛季信息</button>';
      if (seas) h += '<button class="btn danger sm" data-se="season_del">删除赛季</button>';
      if (SE.mode === 'archive' && SE.season) {
        h += '<button class="btn sm" data-se="season_cur">设为当前赛季</button>';
      }
      h += '<button class="btn ghost sm" data-se="new_season">＋新建赛季</button>';
    }
    h += '</div>';
    if (seas && (seas.started_at || seas.ended_at || seas.note)) {
      h += '<div class="seMeta">'
        + '<span class="tag">开始 ' + esc(dayOf(seas.started_at)) + '</span>'
        + (seas.ended_at ? '<span class="tag">结束 ' + esc(dayOf(seas.ended_at)) + '</span>' : '')
        + (seas.note ? '<span class="tagf">' + esc(seas.note) + '</span>' : '')
        + '</div>';
    }

    if (!g) {
      h += '<div class="empty" style="padding:18px">这个赛季还没有星系。'
        + (edit ? '一个赛季最多一个星系，点下面「＋新建星系」补一个。'
                : '请让有编辑权限的人先建。')
        + (edit ? '<div style="margin-top:10px">'
                + '<button class="btn sm" data-se="add_galaxy">＋新建星系</button></div>' : '')
        + '</div>';
      d.innerHTML = h;
      return;
    }

    h += '<div class="seG"><div class="segh"><b>' + esc(g.name) + '</b>'
      + '<span class="tag">联合体 ' + alls.length + ' · 小队 ' + sqn
      + (pplKnown() ? ' · 人数 ' + ppl : '') + '</span>'
      + (g.note ? '<span class="tagf">' + esc(g.note) + '</span>' : '')
      + '<span class="grow"></span>';
    if (edit) {
      h += '<button class="btn ghost sm" data-se="ren" data-lv="galaxy" data-id="' + g.id
        + '" data-name="' + esc(g.name) + '">改星系名</button>';
      h += '<button class="btn ghost sm danger" data-se="del" data-lv="galaxy" data-id="' + g.id
        + '" data-name="' + esc(g.name) + '">删除星系</button>';
    }
    h += '</div>';

    if (!alls.length) {
      h += '<div class="empty" style="padding:10px 0">还没有联合体。'
        + (edit ? '点「＋联合体」添加。' : '') + '</div></div>';
      d.innerHTML = h;
      return;
    }

    h += '<div class="sewrap">'
      + '<div class="selist"><input id="seFind" class="inp sefind" placeholder="搜 联合体 / 小队 / 队长" value="'
      + esc(SE.kw || '') + '"><div id="seList"></div></div>'
      + '<div class="sedetail" id="seDetail"></div>'
      + '</div>';
    h += '<div class="seEv"><div class="seEvh"><b>事件历程</b>'
      + '<span class="dim">记一笔这个赛季发生过什么，按日期倒序</span></div>';
    if (edit) {
      h += '<div class="seEvF">'
        + '<span class="datewrap"><input type="date" id="evAt" value="' + todayStr() + '"></span>'
        + '<input class="inp" id="evTitle" placeholder="发生了什么（必填）" maxlength="60">'
        + '<input class="inp" id="evDetail" placeholder="补充说明（可选）" maxlength="200">'
        + '<button class="btn sm" data-se="ev_add">记一笔</button>'
        + '</div>';
    }
    h += '<div class="seEvL">';
    var evs = (r.events || []);
    if (!evs.length) {
      h += '<div class="empty" style="padding:10px 0">还没有事件记录'
        + (edit ? '，在上面填一行点「记一笔」。' : '。') + '</div>';
    }
    evs.forEach(function (e) { h += evRow(e, edit); });
    h += '</div></div></div>';
    d.innerHTML = h;
    renderList();
    renderDetail();
    if (SE.kw) {
      var fi = document.getElementById('seFind');
      if (fi) { fi.focus(); try { fi.setSelectionRange(fi.value.length, fi.value.length); } catch (e) {} }
    }
  }

  function bindOnce() {
    var d = root();
    if (!d || d.__seBound) return;
    d.__seBound = true;
    d.addEventListener('click', function (ev) {
      var hc = ev.target.closest('[data-hc]');
      if (hc) {
        var oldN = parseInt(hc.getAttribute('data-hn') || '0', 10) || 0;
        var vv = prompt('「' + (hc.getAttribute('data-hname') || '') + '」的人数', String(oldN));
        if (vv === null) return;
        vv = parseInt(String(vv).replace(/[^0-9]/g, ''), 10);
        if (isNaN(vv)) { toast('请填 0 或正整数', 'bad'); return; }
        op({ op: 'headcount', level: 'squad', id: hc.getAttribute('data-hc'), n: vv })
          .then(load)
          .catch(function (e) { toast((e && e.message) || '保存失败', 'bad'); });
        return;
      }
      var pk = ev.target.closest('[data-pick]');
      if (pk) {
        SE.sel = pk.getAttribute('data-pick');
        renderList(); renderDetail();
        return;
      }
      var ft = ev.target.closest('[data-sefilter]');
      if (ft) {
        var kk = ft.getAttribute('data-sefilter');
        SE.rel = (SE.rel === kk) ? '' : kk;
        paint(SE.data);
        return;
      }
      var done = function (p) { p.then(load).catch(function (e) { toast((e && e.message) || '操作失败', 'bad'); }); };
      var evb = ev.target.closest('[data-ev]');
      if (evb) {
        if (!confirm('删除这条事件记录？删了就找不回来了。')) return;
        done(op({ op: 'ev_del', id: evb.getAttribute('data-ev') }));
        return;
      }
      var t = ev.target.closest('[data-se]');
      if (!t) return;
      var act = t.getAttribute('data-se');
      var gid = SE.data && SE.data.galaxies && SE.data.galaxies[0] ? SE.data.galaxies[0].id : null;

      if (act === 'new_season') {
        seasonDlg('新建赛季', [
          { id: 'nlabel', label: '赛季名称', ph: '留空自动编号：第 N 赛季', max: 40 },
          { id: 'nstart', label: '开始日期', type: 'date', value: todayStr() },
          { id: 'nnote', label: '备注', ph: '可选，比如哪个赛区', max: 80 },
          { id: 'ncur', label: '设为当前赛季', type: 'check', value: true }
        ], function (v, close) {
          close();
          done(op({ op: 'new_season', name: v.nlabel, started_at: v.nstart,
                    note: v.nnote, is_current: v.ncur ? 1 : 0 }));
        });
        return;
      }
      if (act === 'season_meta') {
        var cs = pickSeason();
        if (!cs) { toast('先选一个赛季', 'bad'); return; }
        seasonDlg('赛季信息', [
          { id: 'mlabel', label: '赛季名称', value: cs.label || '', max: 40 },
          { id: 'mstart', label: '开始日期', type: 'date', value: dayOf(cs.started_at) === '—' ? '' : dayOf(cs.started_at) },
          { id: 'mend', label: '结束日期', type: 'date', value: dayOf(cs.ended_at) === '—' ? '' : dayOf(cs.ended_at) },
          { id: 'mnote', label: '备注', value: cs.note || '', max: 80 }
        ], function (v, close) {
          close();
          done(op({ op: 'season_meta', id: cs.id, name: v.mlabel,
                    started_at: v.mstart, ended_at: v.mend, note: v.mnote }));
        }, function (close) {
          if (!confirm('确定删除赛季「' + (cs.label || '') + '」？\n'
            + '它下面的星系 / 联合体 / 小队 / 事件记录会一起删掉，删了就找不回来了。')) return;
          close();
          done(op({ op: 'delete_season', id: cs.id }));
        });
        return;
      }
      if (act === 'season_del') {
        var dcs = pickSeason();
        if (!dcs) { toast('先选一个赛季', 'bad'); return; }
        if (!confirm('确定删除赛季「' + (dcs.label || '') + '」？\n'
          + '它下面的星系 / 联合体 / 小队 / 事件记录会一起删掉，删了就找不回来了。')) return;
        done(op({ op: 'delete_season', id: dcs.id }));
        return;
      }
      if (act === 'add_galaxy') {
        var gcs = pickSeason();
        if (!gcs) { toast('先选一个赛季', 'bad'); return; }
        done(op({ op: 'add', level: 'galaxy', parent: gcs.id, name: '主星系' }));
        return;
      }
      if (act === 'season_cur') {
        if (!confirm('把「当前赛季」切到这一季？原来那一季会自动记上结束时间。')) return;
        done(op({ op: 'activate', id: SE.season }));
        return;
      }
      if (act === 'ev_add') {
        var eAt = document.getElementById('evAt');
        var eTi = document.getElementById('evTitle');
        var eDe = document.getElementById('evDetail');
        var sid2 = SE.data && SE.data.target;
        if (!sid2) { toast('先选一个赛季', 'bad'); return; }
        var ttl = eTi ? String(eTi.value || '').trim() : '';
        if (!ttl) {
          toast('写一句发生了什么', 'bad');
          if (eTi) eTi.focus();
          return;
        }
        done(op({ op: 'ev_add', season: sid2, at: eAt ? eAt.value : '', title: ttl,
                  detail: eDe ? String(eDe.value || '').trim() : '' }));
        return;
      }
      if (act === 'add_alli') {
        var an = prompt('联合体名称', '');
        if (!an) return;
        done(op({ op: 'add', level: 'alliance', parent: gid, name: an, relation: '中立' }));
        return;
      }
      if (act === 'add_squad') {
        var sn = prompt('小队名称', '');
        if (!sn) return;
        var ld = prompt('队长（可留空）', '');
        done(op({ op: 'add', level: 'squad', parent: t.getAttribute('data-id'), name: sn, leader: ld || '' }));
        return;
      }
      if (act === 'set_rel') {
        var cur = t.getAttribute('data-rel') || '中立';
        var v = prompt('关系标记：友好 / 中立 / 敌对\n当前：' + cur, cur);
        if (v === null) return;
        v = (v || '').trim();
        if (['友好', '中立', '敌对'].indexOf(v) < 0) { toast('只能填 友好 / 中立 / 敌对', 'bad'); return; }
        done(op({ op: 'relation', level: 'alliance', id: t.getAttribute('data-id'), relation: v }));
        return;
      }
      if (act === 'ren') {
        var old = t.getAttribute('data-name') || '';
        var ne = prompt('新名称', old);
        if (!ne || ne === old) return;
        done(op({ op: 'rename', level: t.getAttribute('data-lv'), id: t.getAttribute('data-id'), name: ne }));
        return;
      }
      if (act === 'del') {
        var nm = t.getAttribute('data-name') || '';
        var lv = t.getAttribute('data-lv');
        if (!confirm('确定删除「' + nm + '」？' + (lv === 'alliance' ? '其下小队会一并删除。' : ''))) return;
        done(op({ op: 'delete', level: lv, id: t.getAttribute('data-id') }));
      }
    });
    d.addEventListener('input', function (ev) {
      if (ev.target && ev.target.id === 'seFind') {
        SE.kw = ev.target.value;
        renderList(); renderDetail();
      }
    });
    d.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'seSel') {
        var v = ev.target.value;
        if (!v) { SE.mode = 'current'; SE.season = null; }
        else { SE.mode = 'archive'; SE.season = v; }
        load();
      }
    });
  }

  window.renderSeason = function () {
    if (!root()) return;
    bindOnce();
    load();
  };
})();

/* 构建标记：排查「服务器是不是旧文件」用 */
window.__APP_VER = '2026-11-21.128';
try { console.info('[fleet-tool] app.js ' + window.__APP_VER); } catch (e) {}

/* ---------- 超管恢复码（仅 superadmin 可见） ---------- */
(function () {
  function paint(st) {
    const box = document.getElementById('rcState');
    if (!box) return;
    const left = (st && st.left != null) ? st.left : 0;
    let t = '剩余可用恢复码：' + left + ' 个';
    if (st && st.created) t += '（上次生成 ' + st.created + '）';
    if (st && st.last_used) t += '；最近使用 ' + st.last_used;
    box.textContent = t;
  }
  async function load() {
    const card = document.getElementById('rcCard');
    if (!card) return;
    /* 不依赖 window.S：直接用接口鉴权，非超管会返回 403 */
    try {
      const st = await api('/api/rc/state');
      card.classList.remove('hide');
      paint(st);
    } catch (e) {
      card.classList.add('hide');
    }
  }
  async function gen() {
    if (!confirm('重新生成会作废现有全部恢复码，确定继续？')) return;
    try {
      const j = await api('/api/rc/generate', { method: 'POST', body: {} });
      const box = document.getElementById('rcCodes');
      box.innerHTML = '';
      (j.codes || []).forEach(function (c) {
        const d = document.createElement('div');
        d.className = 'rccode';
        d.textContent = c;
        d.title = '点击复制';
        d.onclick = function () {
          try { navigator.clipboard.writeText(c); toast('已复制 ' + c, 'ok'); } catch (e) {}
        };
        box.appendChild(d);
      });
      box.classList.remove('hide');
      paint(j);
      const note = document.getElementById('rcCodeNote');
      if (note) note.textContent = '上面这些码只显示这一次，关掉页面就看不到了；用掉任意一个，其余 9 个一起作废。';
    } catch (e) { toast('生成失败：' + e.message, 'bad'); }
  }
  window.__rc = load;
  const b = document.getElementById('rcGen');
  if (b) b.onclick = gen;
  const r = document.getElementById('rcRefresh');
  if (r) r.onclick = load;
})();

/* ---------- 效果申请（超管审批管理员提交的新效果） ---------- */
(function () {
  function row(r) {
    const d = document.createElement('div');
    d.className = 'histitem';
    d.style.gridTemplateColumns = '1fr 90px 130px';
    const a = document.createElement('div');
    a.textContent = (r.name || '') + (r.unit ? '（' + r.unit + '）' : '')
        + (r.efield ? ' · 字段 ' + r.efield : '') + (r.scope ? ' · ' + r.scope : '')
        + ' · ' + (r.username || '');
    const b = document.createElement('div');
    b.className = 'muted';
    b.textContent = r.status || '';
    const c = document.createElement('div');
    if ((r.status || '') === '待处理') {
      const ok = document.createElement('button');
      ok.className = 'btn sm'; ok.textContent = '批准';
      ok.onclick = function () { handle(r.id, 'approve'); };
      const no = document.createElement('button');
      no.className = 'btn sm ghost'; no.textContent = '驳回'; no.style.marginLeft = '6px';
      no.onclick = function () { handle(r.id, 'reject'); };
      c.appendChild(ok); c.appendChild(no);
    }
    d.appendChild(a); d.appendChild(b); d.appendChild(c);
    return d;
  }
  async function handle(id, act) {
    if (!confirm(act === 'approve' ? '批准后会把该效果加入效果库，确定？' : '确定驳回这条申请？')) return;
    try {
      await api('/api/effreq/' + id + '/handle', { method: 'POST', body: { act: act } });
      toast(act === 'approve' ? '已批准并加入效果库' : '已驳回', 'good');
      await loadBlueprints(true);
      load();
    } catch (e) { toast('操作失败：' + e.message, 'bad'); }
  }
  async function load() {
    const card = document.getElementById('erCard');
    if (!card) return;
    let j;
    try { j = await api('/api/effreqs'); } catch (e) { card.classList.add('hide'); return; }
    const rows = (j && j.rows) || [];
    const isSuper = !!(window.S && S.user && S.user.role === 'superadmin');
    if (!isSuper && !rows.length) { card.classList.add('hide'); return; }
    card.classList.remove('hide');
    const body = document.getElementById('erBody');
    body.innerHTML = '';
    const pend = rows.filter(function (r) { return (r.status || '') === '待处理'; });
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = pend.length ? ('待处理 ' + pend.length + ' 条') : '暂无待处理申请。';
    body.appendChild(note);
    rows.slice(0, 30).forEach(function (r) { body.appendChild(row(r)); });
  }
  window.__er = load;
  const btn = document.getElementById('erRefresh');
  if (btn) btn.onclick = load;

/* ==================== 交流（公告板）+ 个人中心 ==================== */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = (s) => String(s || '').replace('T', ' ').slice(0, 16);
  let POSTS = [], bound = false;

  function dlg(title, html, onOk, okText) {
    const w = document.createElement('div');
    w.className = 'dlgwrap';
    w.innerHTML = '<div class="dlg"><div class="dlgh">' + esc(title) + '</div>' +
      '<div class="dlgb">' + html + '</div>' +
      '<div class="dlgf"><button class="btn ghost" data-cancel="1">取消</button>' +
      '<button class="btn" data-ok="1">' + esc(okText || '确定') + '</button></div></div>';
    document.body.appendChild(w);
    const close = () => w.remove();
    w.addEventListener('click', (e) => {
      if (e.target === w || e.target.dataset.cancel) return close();
      if (e.target.dataset.ok) {
        Promise.resolve(onOk && onOk(w)).then((r) => { if (r !== false) close(); });
      }
    });
    return { w, close };
  }

  function setBadge(n) {
    const b = $('#postBadge');
    if (!b) return;
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hide', !n);
  }

  async function loadUnread() {
    try { const r = await api('/api/posts/unread'); setBadge(r.count || 0); } catch (e) {}
  }

  function paintNotice(list) {
    const box = $('#notice'), txt = $('#noticeTxt');
    if (!box || !txt) return;
    const pin = (list || []).find((p) => p && p.pinned);
    if (!pin) { box.classList.add('hide'); box.dataset.pid = ''; return; }
    box.dataset.pid = pin.id;
    txt.textContent = pin.title + (pin.replies ? '（' + pin.replies + ' 条回复）' : '');
    box.classList.remove('hide');
  }
  async function loadNotice() {
    const box = $('#notice');
    if (!box) return;
    try { const r = await api('/api/posts?limit=20'); paintNotice(r.posts || []); }
    catch (e) { box.classList.add('hide'); }
  }

  function itemHtml(p) {
    return '<div class="postitem' + (p.unread ? ' unread' : '') + '" data-id="' + p.id + '">' +
      (p.pinned ? '<span class="pin">置顶</span>' : '') +
      '<div class="ptitle">' + esc(p.title) + '</div>' +
      '<div class="pmeta">' + esc(p.shown || p.username || '') + ' · ' + esc(fmt(p.created_at)) +
      ' · 回复 ' + (p.replies || 0) + '</div>' +
      '<div class="pexcerpt">' + esc(p.excerpt || '') + '</div></div>';
  }

  async function loadList() {
    const box = $('#postList');
    if (!box) return;
    box.innerHTML = '<div class="pempty">加载中…</div>';
    try {
      const r = await api('/api/posts?limit=50');
      POSTS = r.posts || [];
      $('#postCnt').textContent = '共 ' + (r.total || 0) + ' 条';
      box.innerHTML = POSTS.length ? POSTS.map(itemHtml).join('') : '<div class="pempty">还没有公告。管理员可以在右上角发布。</div>';
      const nb = $('#postNew');
      if (nb) nb.classList.toggle('hide', !can('people_edit'));
      paintNotice(POSTS);
    } catch (e) {
      box.innerHTML = '<div class="pempty">加载失败：' + esc(e.message || e) + '</div>';
    }
    loadUnread();
  }

  async function openDetail(id) {
    let d;
    try { d = await api('/api/posts/' + id); }
    catch (e) { return toast('打不开：' + (e.message || e), 'bad'); }
    const p = d.post, rs = d.replies || [];
    const html =
      '<div class="pbody">' + esc(p.body || '').replace(/\n/g, '<br>') + '</div>' +
      '<div class="preplylist">' + (rs.length ? rs.map((r) =>
        '<div class="preply"><b>' + esc(r.shown || r.username || '') + '</b>' +
        '<span class="pt">' + esc(fmt(r.created_at)) + '</span>' +
        '<div>' + esc(r.body || '').replace(/\n/g, '<br>') + '</div></div>').join('')
        : '<div class="pempty">还没有回复</div>') + '</div>' +
      '<div class="pform"><textarea id="replyBody" rows="3" placeholder="写回复…（Ctrl+Enter 提交）"></textarea></div>' +
      (d.can_pin || d.can_del ? '<div class="pops">' +
        (d.can_pin ? '<button class="btn ghost sm" data-act="pin">' + (p.pinned ? '取消置顶' : '置顶') + '</button>' : '') +
        (d.can_del ? '<button class="btn del sm" data-act="del">删除这条</button>' : '') + '</div>' : '');
    const { w, close } = dlg(p.title, html, async (root) => {
      const ta = $('#replyBody', root);
      const body = (ta && ta.value || '').trim();
      if (!body) return false;
      try { await api('/api/posts/' + id + '/reply', { method: 'POST', body: { body } }); }
      catch (e) { toast('回复失败：' + (e.message || e), 'bad'); return false; }
      close(); loadList(); openDetail(id); return false;
    }, '回复');
    const ta = $('#replyBody', w);
    if (ta) ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('[data-ok]', w).click(); }
    });
    w.addEventListener('click', async (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      e.stopPropagation();
      if (act === 'pin') {
        try { await api('/api/posts/' + id + '/pin', { method: 'POST', body: { pinned: p.pinned ? 0 : 1 } }); }
        catch (err) { return toast('操作失败：' + (err.message || err), 'bad'); }
        close(); loadList(); openDetail(id); return;
      }
      if (act === 'del') {
        if (!confirm('删除这条公告？')) return;
        try { await api('/api/posts/' + id + '/delete', { method: 'POST', body: {} }); }
        catch (err) { return toast('删除失败：' + (err.message || err), 'bad'); }
        close(); loadList(); return;
      }
    });
  }

  function newPost() {
    const html = '<div class="pform"><input id="npTitle" maxlength="60" placeholder="标题（≤60 字）">' +
      '<textarea id="npBody" rows="6" placeholder="正文…"></textarea></div>';
    dlg('发布公告', html, async (root) => {
      const title = ($('#npTitle', root).value || '').trim();
      const body = ($('#npBody', root).value || '').trim();
      if (!title) { toast('标题不能为空', 'bad'); return false; }
      try { await api('/api/posts', { method: 'POST', body: { title, body } }); }
      catch (e) { toast('发布失败：' + (e.message || e), 'bad'); return false; }
      toast('已发布', 'ok'); loadList(); return true;
    }, '发布');
  }

  async function openMe() {
    let d;
    try { d = await api('/api/me/profile'); }
    catch (e) { return toast('打不开个人资料：' + (e.message || e), 'bad'); }
    const u = d.user || {};
    const perms = (d.perms || []).map((x) => '<span class="tag">' + esc(x.t) + '</span>').join('') || '<span class="tag">无</span>';
    const sess = (d.sessions || []).map((s) =>
      '<div class="lerow">' + (s.current ? '<b>当前设备</b>' : '其它设备') +
      ' · 剩余 ' + s.left_h + ' 小时</div>').join('') || '<div class="lerow">无</div>';
    const aud = (d.audit || []).map((a) =>
      '<div class="lerow">' + esc(fmt(a.ts)) + ' · ' + esc(a.action || '') +
      (a.target ? ' · ' + esc(a.target) : '') + '</div>').join('') || '<div class="lerow">暂无</div>';
    dlg('我的资料', '<div class="merow"><b>' + esc(u.name || u.username || '') + '</b>' +
      '<span class="tag">' + esc(u.username || '') + '</span>' +
      '<span class="tag">' + esc(u.role_cn || u.role || '') + '</span>' +
      '<span class="tag">范围：' + esc(d.scope_cn || '') + '</span></div>' +
      '<div class="mtit">我的权限</div><div class="mtags">' + perms + '</div>' +
      '<div class="mtit">登录设备</div>' + sess +
      '<div class="mtit">我的最近操作</div>' + aud, null, '关闭');
  }

  document.addEventListener('click', function (e) {
    const w = e.target && e.target.closest ? e.target.closest('#who') : null;
    if (!w) return;
    e.preventDefault(); openMe();
  });

  window.__posts = function () {
    loadList();
    if (bound) return;
    bound = true;
    const r = $('#postRefresh'); if (r) r.onclick = loadList;
    const n = $('#postNew'); if (n) n.onclick = newPost;
    const list = $('#postList');
    if (list) list.addEventListener('click', (e) => {
      const it = e.target.closest('.postitem');
      if (it) openDetail(it.dataset.id);
    });
    const who = $('#who');
    if (who) { who.style.cursor = 'pointer'; who.title = '点击查看我的资料'; who.addEventListener('click', openMe); }
    const bar = $('#notice');
    if (bar) bar.onclick = (e) => {
      if (e.target && e.target.id === 'noticeMore') e.stopPropagation();
      const id = bar.dataset.pid; if (id) openDetail(id);
    };
    loadUnread();
    loadNotice();
  };
  setTimeout(() => { try { if (S.user) { loadUnread(); loadNotice(); } } catch (e) {} }, 1500);
  setInterval(() => { try { if (S.user) loadNotice(); } catch (e) {} }, 60000);

  window.__me = openMe;
})();
/* ---------- 权限模板（人员管理） ---------- */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const SCOPE_CN = { all: '全部', org: '本组织', alliance: '本联合体', self: '只看自己' };
  let TPL = [];
  const bodyEl = () => document.getElementById('tplBody');

  function dlg(title, html, onOk, okText) {
    const w = document.createElement('div');
    w.className = 'dlgwrap';
    w.innerHTML = '<div class="dlg"><div class="dlgh">' + esc(title) + '</div>' +
      '<div class="dlgb">' + html + '</div>' +
      '<div class="dlgf"><button class="btn ghost" data-cancel="1">取消</button>' +
      '<button class="btn" data-ok="1">' + esc(okText || '确定') + '</button></div></div>';
    document.body.appendChild(w);
    const close = () => w.remove();
    w.addEventListener('click', (e) => {
      if (e.target === w || e.target.dataset.cancel) return close();
      if (e.target.dataset.ok) {
        Promise.resolve(onOk && onOk(w)).then((r) => { if (r !== false) close(); });
      }
    });
    return { w, close };
  }

  async function load() {
    if (!can('people_view')) return;
    try {
      const r = await api('/api/perm_templates');
      TPL = r.templates || [];
      paint();
    } catch (e) {
      const b = bodyEl();
      if (b) b.innerHTML = '<tr><td colspan="4" class="pempty">读取失败：' + esc(e.message || e) + '</td></tr>';
    }
  }

  function fillSelect() {
    const sel = document.getElementById('uTpl');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">（不套用，手工勾选）</option>';
    TPL.forEach((t, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = (t.cn || t.name) + ' · ' + ((t.perms || []).length) + ' 项 · '
        + (SCOPE_CN[t.scope] || '全部');
      sel.appendChild(o);
    });
    if (cur && TPL[Number(cur)]) sel.value = cur;
    sel.onchange = () => {
      if (sel.value === '') return;
      const t = TPL[Number(sel.value)];
      if (t) applyTplLocal(t);
    };
  }

  function applyTplLocal(t) {
    const want = {};
    (t.perms || []).forEach((k) => { want[k] = 1; });
    document.querySelectorAll('#permBox input').forEach((cb) => {
      if (!cb.disabled) cb.checked = !!want[cb.value];
    });
    const rd2 = [...document.querySelectorAll('#scopeBox input[name=scope]')]
      .find((r) => r.value === (t.scope || 'all'));
    if (rd2) { rd2.checked = true; rd2.dispatchEvent(new Event('change', { bubbles: true })); }
    toast('已套用「' + (t.cn || t.name) + '」：权限与范围已填好，补上登录名/密码再点保存', 'ok');
  }

  window.__tplFill = fillSelect;

  function paint() {
    fillSelect();
    const b = bodyEl();
    if (!b) return;
    const note = document.getElementById('tplNote');
    if (note) note.textContent = TPL.length ? ('共 ' + TPL.length + ' 个模板') : '';
    if (!TPL.length) {
      b.innerHTML = '<tr><td colspan="4" class="pempty">还没有模板。点右上角「新建模板」，把常用的一套权限存下来，之后新增或修改人员时一键套用。</td></tr>';
      return;
    }
    const canEdit = can('people_edit');
    b.innerHTML = TPL.map((t) => {
      const ks = t.perms || [];
      const tags = ks.slice(0, 6).map((k) => '<span class="tag">' + esc(PERM_LABEL[k] || k) + '</span>').join('');
      const more = ks.length > 6 ? ' <span class="dim">等 ' + ks.length + ' 项</span>' : '';
      const ops = canEdit
        ? '<button class="btn ghost sm" data-act="use">套用</button>'
          + '<button class="btn ghost sm" data-act="edit" style="margin-left:6px">修改</button>'
          + '<button class="btn del sm" data-act="del" style="margin-left:6px">删除</button>'
        : '<span class="dim">只读</span>';
      return '<tr data-id="' + t.id + '">'
        + '<td><b>' + esc(t.cn || t.name) + '</b>'
        + (t.cn && t.cn !== t.name ? '<div class="dim">' + esc(t.name) + '</div>' : '') + '</td>'
        + '<td>' + (tags || '<span class="dim">—</span>') + more + '</td>'
        + '<td>' + esc(SCOPE_CN[t.scope] || t.scope || '全部') + '</td>'
        + '<td>' + ops + '</td></tr>';
    }).join('');
  }

  function tplEdit(t) {
    const cur = t || { name: '', cn: '', perms: [], scope: 'all' };
    const have = {};
    (cur.perms || []).forEach((k) => { have[k] = 1; });
    const cb = (key, label) => '<label class="permcb"><input type="checkbox" value="' + key + '"'
      + (have[key] ? ' checked' : '') + '> ' + esc(label) + '</label>';
    const groups = PERM_GROUPS.map((g) => {
      let cells = cb(g.view, '看');
      if (g.edit) cells += cb(g.edit, '改');
      (g.extra || []).forEach((x) => { cells += cb(x[0], x[1]); });
      return '<div class="permrow"><span class="permmod">' + esc(g.mod) + '</span>' + cells + '</div>';
    }).join('');
    const scopes = Object.keys(SCOPE_CN).map((k) =>
      '<label class="scopecb"><input type="radio" name="tscope" value="' + k + '"'
      + ((cur.scope || 'all') === k ? ' checked' : '') + '><i>' + esc(SCOPE_CN[k]) + '</i></label>').join('');
    const html =
      '<div class="pform">'
      + '<label class="row"><span>模板名称</span><input id="tplName" maxlength="40" placeholder="例如：星域维护员" value="'
      + esc(cur.cn || cur.name || '') + '"></label>'
      + '<div class="row" style="align-items:flex-start"><span>数据范围</span><div class="scopebox">' + scopes + '</div></div>'
      + '<div class="row" style="align-items:flex-start"><span>权限</span><div class="permgrid" id="tplPerm">' + groups + '</div></div>'
      + '<div class="muted" style="margin-top:6px">模板只决定「套用」时勾什么；已经存在的账号权限不会自动变。</div>'
      + '</div>';
    dlg(t ? '修改权限模板' : '新建权限模板', html, async (root) => {
      const nm = ($('#tplName', root).value || '').trim();
      if (!nm) { toast('模板名称不能空', 'bad'); return false; }
      const perms = [...root.querySelectorAll('#tplPerm input:checked')].map((x) => x.value);
      if (!perms.length) { toast('至少勾选一项权限', 'bad'); return false; }
      const rd = [...root.querySelectorAll('input[name=tscope]')].find((x) => x.checked);
      const body = { name: nm, cn: nm, perms: perms, scope: rd ? rd.value : 'all' };
      if (t && t.id) body.id = t.id;
      try { await api('/api/perm_templates', { method: 'POST', body: body }); }
      catch (e) { toast('保存失败：' + (e.message || e), 'bad'); return false; }
      toast('已保存模板「' + nm + '」', 'ok');
      load();
      return true;
    }, '保存');
  }

  async function delTpl(t) {
    if (!confirm('删除模板「' + (t.cn || t.name) + '」？已套用的账号不受影响。')) return;
    try { await api('/api/perm_templates/' + t.id, { method: 'DELETE' }); }
    catch (e) { return toast('删除失败：' + (e.message || e), 'bad'); }
    toast('已删除模板', 'ok');
    load();
  }

  function applyTpl(t) {
    openUserDlg(null);
    applyTplLocal(t);
  }

  function bindOps() {
    const card = document.getElementById('tplCard');
    if (!card || card.dataset.bound === '1') return;
    card.dataset.bound = '1';
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const t = TPL.find((x) => String(x.id) === String(tr && tr.dataset.id));
      if (!t) return;
      const act = btn.dataset.act;
      if (act === 'use') applyTpl(t);
      else if (act === 'edit') tplEdit(t);
      else if (act === 'del') delTpl(t);
    });
  }

  function ensureSaveAs() {
    const hint = document.getElementById('permHintBox');
    if (!hint || document.getElementById('permSaveAs')) return;
    const b = el('button', 'btn ghost sm', '把当前勾选另存为模板…');
    b.id = 'permSaveAs'; b.type = 'button'; b.style.marginTop = '8px';
    b.onclick = async () => {
      const nm = prompt('模板名称（例如：星域维护员）');
      if (!nm || !nm.trim()) return;
      const perms = boxPerms();
      if (!perms) { toast('至少勾选一项权限', 'bad'); return; }
      const f = document.getElementById('userForm');
      const scope = (f && f.scope && f.scope.value) || 'all';
      try {
        await api('/api/perm_templates', { method: 'POST', body: { name: nm.trim(), cn: nm.trim(), perms: perms, scope: scope } });
        toast('已保存模板「' + nm.trim() + '」', 'ok');
        load();
      } catch (e) { toast('保存失败：' + (e.message || e), 'bad'); }
    };
    hint.parentNode.insertBefore(b, hint.nextSibling);
  }

  const rf = document.getElementById('tplRefresh');
  if (rf) rf.onclick = load;
  const nw = document.getElementById('tplNew');
  if (nw) nw.onclick = () => {
    if (!can('people_edit')) return toast('没有人员管理权限', 'bad');
    tplEdit(null);
  };
  bindOps();
  document.addEventListener('click', () => setTimeout(ensureSaveAs, 0));
  window.__tpl = load;
})();

})();
