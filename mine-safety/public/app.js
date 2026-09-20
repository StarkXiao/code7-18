/**
 * 调度大屏前端：
 *  - EventSource 订阅服务端事件（snapshot/tick 全量帧 + 告警/广播增量帧）
 *  - Canvas 绘制巷道底图、危险围栏与人员标签，脉冲动画标注异常
 *  - 收到广播帧时联动：高危播放双音警笛 + 语音合成播报（Web Speech）
 */

const $ = (id) => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d');

let state = null;
let selectedTag = null;
let onlyAbnormal = false;
const muted = () => !$('sound-on').checked;
let lastAlarmAt = 0;
const seenAlarms = new Set();

// ── 时间工具 ──────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
function fmtTime(ms) {
  if (!ms) return '--:--:--';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtAgo(sec) {
  if (sec == null) return '';
  if (sec < 60) return `${sec} 秒前`;
  return `${Math.floor(sec / 60)} 分${sec % 60 ? pad(sec % 60) + ' 秒' : ''}前`;
}

// ── SSE 事件订阅 ────────────────────────────────────────────────────────────────
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => applyState(JSON.parse(e.data), { first: true }));
  es.addEventListener('tick', (e) => applyState(JSON.parse(e.data)));
  es.addEventListener('broadcast.sent', (e) => onBroadcast(JSON.parse(e.data)));
  es.addEventListener('alarm.raised', (e) => onAlarmRaised(JSON.parse(e.data)));
  es.addEventListener('alarm.resolved', (e) => onAlarmChanged(JSON.parse(e.data)));
  es.addEventListener('alarm.updated', (e) => onAlarmChanged(JSON.parse(e.data)));
  es.addEventListener('simulator', (e) => flashSim(JSON.parse(e.data).scenario));
  es.onerror = () => {
    $('sse-state').textContent = '连接中断，重连中…';
    $('sse-state').className = 'bad';
  };
  es.onopen = () => {
    $('sse-state').textContent = '实时连接中';
    $('sse-state').className = 'ok';
  };
}

function applyState(snap, opts = {}) {
  state = snap;
  if (opts.first) {
    // 初始全量帧里已有的活动告警不重复响警报声（只是页面加载）
    snap.alarms.filter((a) => a.status === 'active').forEach((a) => seenAlarms.add(a.id));
  }
  renderAll();
}

function flashSim(scenario) {
  $('sim-state').textContent = `模拟源：${scenarioName(scenario)}（已切换）`;
}

// ── 告警/广播联动 ────────────────────────────────────────────────────────────────
function onAlarmRaised(alarm) {
  if (seenAlarms.has(alarm.id)) return;
  seenAlarms.add(alarm.id);
  // 增量帧不立即响（由随后的 broadcast.sent 统一触发声光），此处仅兜底标题闪烁
  document.title = `⚠ 新告警 · ${alarm.typeLabel}`;
  setTimeout(() => { document.title = '井下人员定位安全系统 · 调度大屏'; }, 4000);
  lastAlarmAt = Date.now();
}

function onAlarmChanged(_alarm) {
  // 状态以最近一次全量 tick 为准，无需局部改数据
}

function onBroadcast(bc) {
  if (muted()) return;
  if (bc.level === 'danger') {
    playSiren(bc.repeat ? 1.2 : 2.4);
  }
  speak(bc.text, bc.level === 'danger');
}

// ── WebAudio 警笛（双音交替，无需音频文件） ─────────────────────────────────────
let audioCtx = null;
function playSiren(seconds = 2) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    // 频率在 700/1000Hz 间往复，模拟矿山救护警笛
    const cycles = Math.max(1, Math.round(seconds / 0.7));
    for (let i = 0; i < cycles; i++) {
      osc.frequency.setValueAtTime(700, now + i * 0.7);
      osc.frequency.linearRampToValueAtTime(1000, now + i * 0.7 + 0.35);
      osc.frequency.linearRampToValueAtTime(700, now + i * 0.7 + 0.7);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
    gain.gain.setValueAtTime(0.0001, now + seconds);
    osc.start(now);
    osc.stop(now + seconds + 0.05);
  } catch { /* 无音频设备时静默降级 */ }
}

// ── 语音合成（对应井下 IP 广播的人声播报） ──────────────────────────────────────
let speakQueue = Promise.resolve();
function speak(text, urgent) {
  if (!('speechSynthesis' in window)) return;
  speakQueue = speakQueue.then(() => new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = urgent ? 1.05 : 0.95;
    u.volume = urgent ? 1 : 0.85;
    u.onend = resolve;
    u.onerror = resolve;
    window.speechSynthesis.speak(u);
  }));
}

// ── Canvas 地图渲染 ──────────────────────────────────────────────────────────────
const MARGIN = 46;
let view = null; // {scale, ox, oy, w, h}

function computeView() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  const pts = [];
  state.map.tracks.forEach((t) => t.path.forEach((p) => pts.push(p)));
  state.zones.forEach((z) => z.polygon.forEach((p) => pts.push(p)));
  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const scale = Math.min((w - MARGIN * 2) / (maxX - minX), (h - MARGIN * 2) / (maxY - minY));
  const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (h - (maxY - minY) * scale) / 2 - minY * scale;
  view = { scale, ox, oy, w, h };
}
const mx = (x) => view.ox + x * view.scale;
const my = (y) => view.oy + y * view.scale;

function renderMap(now) {
  if (!state) return;
  computeView();
  const { w, h } = view;
  ctx.clearRect(0, 0, w, h);
  drawGrid();
  // 危险区域在巷道下层
  for (const zone of state.zones) drawZone(zone, now);
  for (const track of state.map.tracks) drawTrack(track);
  drawEntrance();
  for (const tag of state.tags) drawTag(tag, now);
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(77,163,255,0.06)';
  ctx.lineWidth = 1;
  const grid = 20 * view.scale;
  for (let x = view.ox % grid; x < view.w; x += grid) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, view.h); ctx.stroke();
  }
  for (let y = view.oy % grid; y < view.h; y += grid) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(view.w, y); ctx.stroke();
  }
}

function drawTrack(track) {
  ctx.beginPath();
  track.path.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(mx(x), my(y));
    else ctx.lineTo(mx(x), my(y));
  });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#37507f';
  ctx.lineWidth = 15;
  ctx.stroke();
  ctx.strokeStyle = '#4a6aa0';
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,231,249,.55)';
  ctx.setLineDash([6, 10]);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  // 巷道名标注在中点
  const mid = track.path[Math.floor((track.path.length - 1) / 2)];
  ctx.fillStyle = 'rgba(160,180,210,.75)';
  ctx.font = '11px sans-serif';
  ctx.fillText(track.name, mx(mid[0]) + 8, my(mid[1]) - 10);
}

function drawEntrance() {
  const [x, y] = [0, 120];
  ctx.fillStyle = '#2ecc8f';
  ctx.beginPath();
  ctx.arc(mx(x), my(y), 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8fd8bb';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('副井口（入口）', mx(x) + 10, my(y) - 8);
}

function drawZone(zone, now) {
  ctx.beginPath();
  zone.polygon.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(mx(x), my(y));
    else ctx.lineTo(mx(x), my(y));
  });
  ctx.closePath();
  const danger = zone.level !== 'warning';
  const color = danger ? '255,84,104' : '255,176,32';
  ctx.fillStyle = zone.enabled ? `rgba(${color},0.13)` : 'rgba(127,144,173,0.07)';
  ctx.fill();
  if (zone.enabled) {
    const pulse = 0.45 + 0.3 * Math.sin(now / 500);
    ctx.strokeStyle = `rgba(${color},${pulse})`;
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = 'rgba(127,144,173,0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const cx = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length;
  const cy = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length;
  ctx.fillStyle = zone.enabled ? (danger ? '#ff8a97' : '#ffc861') : '#6b7c99';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${zone.name}${zone.enabled ? '' : '（停用）'}`, mx(cx), my(cy) - 4);
  ctx.font = '10.5px sans-serif';
  ctx.fillStyle = zone.enabled ? 'rgba(220,231,249,.65)' : '#6b7c99';
  ctx.fillText(zone.enabled ? (danger ? '危险 · 严禁入内' : '限制进入') : '围栏已停用', mx(cx), my(cy) + 11);
  ctx.textAlign = 'left';
}

function tagState(tag) {
  if (tag.offline) return 'offline';
  if ((tag.activeAlarmIds || []).length && tag.zones.some((z) => z.level === 'danger')) return 'danger';
  if (tag.zones.some((z) => z.level === 'danger') || tag.dwellSec >= state.config.stationaryThresholdSec) return 'danger';
  if (tag.zones.length || (tag.activeAlarmIds || []).length) return 'warn';
  return 'ok';
}

function drawTag(tag, now) {
  if (tag.x == null) return;
  const x = mx(tag.x);
  const y = my(tag.y);
  const st = tagState(tag);
  const color = { ok: '#2ecc8f', warn: '#ffb020', danger: '#ff5468', offline: '#7f90ad' }[st];

  if (st === 'danger' || st === 'warn') {
    const r = 9 + 5 * (0.5 + 0.5 * Math.sin(now / 350));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = st === 'danger' ? 'rgba(255,84,104,.16)' : 'rgba(255,176,32,.14)';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = tag.offline ? '#55637a' : color;
  ctx.fill();
  ctx.strokeStyle = '#dce7f9';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.font = '11.5px sans-serif';
  ctx.fillStyle = '#cdd9ef';
  ctx.fillText(tag.name, x + 8, y - 6);
  if (tag.dwellSec > 0 && !tag.offline) {
    ctx.fillStyle = tag.dwellSec >= state.config.stationaryThresholdSec ? '#ff8a97' : '#8497b8';
    ctx.fillText(`停留 ${tag.dwellSec}s`, x + 8, y + 8);
  }
  if (tag.offline && tag.ageSec != null) {
    ctx.fillStyle = '#7f90ad';
    ctx.fillText(`离线 ${tag.ageSec}s`, x + 8, y + 8);
  }
  if (selectedTag === tag.tagId) {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

// ── 人员列表 ──────────────────────────────────────────────────────────────────
function renderPeople() {
  const list = $('people-list');
  const tags = [...state.tags]
    .filter((t) => t.lastSeenMs != null)
    .filter((t) => !onlyAbnormal || tagState(t) !== 'ok')
    .sort((a, b) => dangerRank(b) - dangerRank(a) || a.tagId.localeCompare(b.tagId));

  list.innerHTML = '';
  for (const t of tags) {
    const st = tagState(t);
    const div = document.createElement('div');
    div.className = `person ${st === 'ok' ? '' : st === 'danger' ? 'danger' : st === 'warn' ? 'stationary' : 'offline'}${selectedTag === t.tagId ? ' selected' : ''}`;
    const loc = t.location?.zone || t.location?.track || '—';
    let badge = '';
    if (t.offline) badge = '<span class="badge off">离线</span>';
    else if (st === 'danger') badge = '<span class="badge danger">危险</span>';
    else if (st === 'warn') badge = '<span class="badge warn">异常</span>';
    else if (t.dwellSec >= state.config.stationaryThresholdSec) badge = '<span class="badge warn">静止</span>';
    div.innerHTML = `
      <span class="dot"></span>
      <span class="info">
        <span class="nm">${escapeHtml(t.name)}</span>
        <span class="meta">${escapeHtml(t.dept || '')} · ${escapeHtml(loc)}</span>
      </span>
      ${badge}`;
    div.onclick = () => {
      selectedTag = selectedTag === t.tagId ? null : t.tagId;
      renderAll();
    };
    list.appendChild(div);
  }
}
const dangerRank = (t) => ({ danger: 3, warn: 2, offline: 1, ok: 0 }[tagState(t)]);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 告警列表与操作 ───────────────────────────────────────────────────────────────
function renderAlarms() {
  const list = $('alarm-list');
  const n = state.alarms.filter((a) => a.status === 'active').length;
  $('tab-alarm-n').textContent = n;
  list.innerHTML = '';
  if (!state.alarms.length) {
    list.innerHTML = '<p style="color:#5f7390;padding:18px;text-align:center">暂无告警记录</p>';
    return;
  }
  for (const a of state.alarms.slice(0, 60)) {
    const div = document.createElement('div');
    div.className = `alarm-card ${a.level === 'danger' ? 'danger' : 'warn'} ${a.ackedAt ? 'acked' : ''}`;
    const stCls = a.level === 'danger' ? 'tag-danger' : 'tag-warn';
    let actions = '';
    let statusLine = '';
    if (a.status === 'active') {
      actions = `
        <button class="mini-btn primary" data-ack="${a.id}">确认收到</button>
        <button class="mini-btn" data-clear="${a.id}">人工解除</button>`;
      statusLine = a.ackedAt
        ? `✓ ${escapeHtml(a.ackedBy || '调度员')} 已于 ${fmtTime(a.ackedAt)} 确认，等待现场消除`
        : a.level === 'danger'
          ? '未确认，系统将重复广播直至确认'
          : '等待自动消除或人工处置';
    } else {
      statusLine = `已于 ${fmtTime(a.resolvedAt)} 解除：${escapeHtml(a.resolveReason || '')}`;
    }
    div.innerHTML = `
      <div class="ac-top">
        <span class="ac-type ${stCls}">${a.typeLabel}</span>
        <span class="ac-time">${fmtTime(a.raisedAt)}</span>
      </div>
      <div class="ac-desc"><b>${escapeHtml(a.workerName)}</b>（${escapeHtml(a.tagId)}）${descOf(a)}</div>
      <div class="ac-loc">位置：${escapeHtml(a.zoneName || '—')} ｜ 坐标 (${a.x?.toFixed(1)}, ${a.y?.toFixed(1)})</div>
      ${actions ? `<div class="ac-actions">${actions}</div>` : ''}
      <div class="ac-status">${statusLine}</div>`;
    list.appendChild(div);
  }
  list.querySelectorAll('[data-ack]').forEach((b) => {
    b.onclick = () => api('/api/alarms/ack', { alarmId: b.dataset.ack });
  });
  list.querySelectorAll('[data-clear]').forEach((b) => {
    b.onclick = () => {
      const reason = prompt('解除原因（可选）：', '已电话核实，误报/已撤离');
      api('/api/alarms/clear', { alarmId: b.dataset.clear, reason: reason || undefined });
    };
  });
}

function descOf(a) {
  if (a.type === 'zone_entry') return `进入 <b>${escapeHtml(a.zoneName)}</b>：${escapeHtml(a.message || '')}`;
  if (a.type === 'stationary') return `在 ${escapeHtml(a.zoneName)} 静止超过 ${a.dwellSec ?? ''} 秒，疑似遇险`;
  if (a.type === 'offline') return `定位信号丢失 ${a.offlineSec ?? ''} 秒，最后位于 ${escapeHtml(a.zoneName)}`;
  return '';
}

function renderBroadcasts() {
  const list = $('broadcast-list');
  list.innerHTML = '';
  if (!state.broadcasts.length) {
    list.innerHTML = '<p style="color:#5f7390;padding:18px;text-align:center">暂无广播记录</p>';
    return;
  }
  for (const bc of state.broadcasts.slice(0, 60)) {
    const div = document.createElement('div');
    div.className = `bc-card ${bc.level === 'danger' ? 'danger' : 'warn'}`;
    div.innerHTML = `
      <div class="bc-meta">${fmtTime(new Date(bc.sentAt).getTime())}
        · ${escapeHtml(bc.workerName)}${bc.repeat ? '<span class="bc-repeat">重复广播</span>' : ''}
        ${bc.webhook?.status === 'failed' ? ' · <span style="color:#ff8a97">外发失败</span>' : ''}
      </div>
      <div>${escapeHtml(bc.text)}</div>`;
    list.appendChild(div);
  }
}

// ── 顶部统计 / 横幅 / 图例 / 状态栏 ───────────────────────────────────────────────
function renderChrome() {
  const s = state.stats;
  $('st-underground').textContent = s.underground;
  $('st-offline').textContent = s.offline;
  $('st-danger').textContent = s.unackedDanger;
  $('st-active').textContent = s.activeAlarms;
  const d = new Date(state.now);
  $('st-clock').textContent = fmtTime(state.now);
  $('st-date').textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const unackedDanger = state.alarms.find((a) => a.status === 'active' && a.level === 'danger' && !a.ackedAt);
  const nextWarn = state.alarms.find((a) => a.status === 'active' && (a.level !== 'danger' || a.ackedAt));
  const banner = $('alarm-banner');
  if (unackedDanger) {
    banner.className = 'alarm-banner';
    banner.innerHTML = `🚨 高危告警：${escapeHtml(unackedDanger.workerName)} ${unackedDanger.typeLabel}｜${escapeHtml(unackedDanger.zoneName)} ｜ ${fmtTime(unackedDanger.raisedAt)} 发生，未确认，应急广播已联动`;
  } else if (nextWarn) {
    banner.className = 'alarm-banner warn';
    banner.innerHTML = `⚠ 活动告警：${escapeHtml(nextWarn.workerName)} ${nextWarn.typeLabel}｜${escapeHtml(nextWarn.zoneName)}`;
  } else {
    banner.className = 'alarm-banner hidden';
    banner.textContent = '';
  }

  const legend = $('zone-legend');
  legend.innerHTML = state.zones.map((z) => `
    <div class="lg">
      <span class="sw" style="background:${z.enabled ? (z.level === 'danger' ? 'rgba(255,84,104,.5)' : 'rgba(255,176,32,.5)') : '#3a465e'}"></span>
      <span style="color:${z.enabled ? '#dce7f9' : '#6b7c99'}">${escapeHtml(z.name)}${z.enabled ? '' : '（停用）'}</span>
    </div>`).join('') + `
    <div class="lg"><span class="dot-legend" style="color:#2ecc8f">●</span> 正常</div>
    <div class="lg"><span style="color:#ffb020">●</span> 警告/静止</div>
    <div class="lg"><span style="color:#ff5468">●</span> 危险</div>
    <div class="lg"><span style="color:#7f90ad">●</span> 离线</div>`;

  $('sim-state').textContent = state.simulator.enabled
    ? `模拟源：${scenarioName(state.simulator.scenario)} · 1Hz`
    : '模拟源：关闭（等待真实定位引擎上报）';
  $('uwb-state').textContent = state.uwb
    ? `UWB：UDP ${state.uwb.port}，已收 ${state.uwb.stats?.positions ?? 0} 点${state.uwb.stats?.lastSource ? `（${state.uwb.stats.lastSource}）` : ''}`
    : 'UWB：未启用';
}

function scenarioName(s) {
  return { normal: '正常巡走', intrusion: '闯入采空区', still: '长时静止' }[s] || s;
}

// ── 弹层 ──────────────────────────────────────────────────────────────────────
canvas.addEventListener('click', (e) => {
  if (!state || !view) return;
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  let hit = null;
  for (const t of state.tags) {
    if (t.x == null) continue;
    if (Math.hypot(mx(t.x) - cx, my(t.y) - cy) < 12) { hit = t; break; }
  }
  const pop = $('tag-pop');
  if (!hit) { pop.className = 'tag-pop hidden'; selectedTag = null; renderAll(); return; }
  selectedTag = hit.tagId;
  const loc = hit.location?.zone
    ? hit.location.zone
    : hit.location?.track
      ? `${hit.location.track}（偏移 ${hit.location.offsetM}m）`
      : '—';
  pop.innerHTML = `
    <h3>${escapeHtml(hit.name)} <small style="color:#7f90ad;font-weight:400">${escapeHtml(hit.tagId)}</small></h3>
    <div class="row"><span>单位/岗位</span><b>${escapeHtml(hit.dept)} · ${escapeHtml(hit.role)}</b></div>
    <div class="row"><span>当前位置</span><b>${escapeHtml(loc)}</b></div>
    <div class="row"><span>坐标</span><b>(${hit.x?.toFixed(1)}, ${hit.y?.toFixed(1)}) m</b></div>
    <div class="row"><span>停留时长</span><b>${hit.dwellSec} 秒</b></div>
    <div class="row"><span>信号</span><b style="color:${hit.offline ? '#ff8a97' : '#2ecc8f'}">${hit.offline ? `丢失 ${hit.ageSec}s` : '正常'}</b></div>
    ${(hit.activeAlarmIds || []).length ? '<div class="row" style="margin-top:6px"><span></span><b style="color:#ff5468">存在活动告警</b></div>' : ''}`;
  const wrap = canvas.parentElement.getBoundingClientRect();
  pop.style.left = `${Math.min(cx + 14, wrap.width - 230)}px`;
  pop.style.top = `${Math.max(8, cy - 60)}px`;
  pop.className = 'tag-pop';
  renderAll();
});

// ── 接口 ──────────────────────────────────────────────────────────────────────
async function api(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`操作失败：${err.error || res.status}`);
    }
  } catch (err) {
    alert(`网络错误：${err.message}`);
  }
}

document.querySelectorAll('[data-scenario]').forEach((btn) => {
  btn.onclick = () => {
    api('/api/sim/scenario', { scenario: btn.dataset.scenario });
    document.querySelectorAll('[data-scenario]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  };
});

$('find-offline').onclick = () => {
  onlyAbnormal = !onlyAbnormal;
  $('find-offline').textContent = onlyAbnormal ? '显示全部' : '只看异常';
  renderPeople();
};

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    $('tab-alarms').classList.toggle('hidden', which !== 'alarms');
    $('tab-broadcasts').classList.toggle('hidden', which !== 'broadcasts');
  };
});

// ── 渲染调度 ──────────────────────────────────────────────────────────────────
function renderAll() {
  if (!state) return;
  renderChrome();
  renderPeople();
  renderAlarms();
  renderBroadcasts();
}
function frame(now) {
  if (state) renderMap(now);
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => { /* 下一帧自动重算 view */ });

connect();
requestAnimationFrame(frame);
