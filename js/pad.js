// 手把與鍵盤：沙發上用 Steam Machine、Steam Deck 或任何手把打牌
// 十字鍵／左搖桿移動游標（手牌、按鈕之間），A 確定（按住蓄力甩牌），B 過／返回，Y 胡，Start 跳到右上的設定
(function () {
  'use strict';
  const MJ = window.MJ, S = MJ.scene;
  const $ = s => document.querySelector(s);

  // 標準配置的按鈕編號
  const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const DIRS = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
  const REPEAT_WAIT = 320, REPEAT_EVERY = 110, DEAD = 0.5;

  let source = null;      // 'pad' | 'key' | null（滑鼠）
  let family = 'xbox';
  let focus = null;       // {tile: idx} 或 {el, key}
  let context = null;     // 換了對話框或輪到我做新的決定，就重設游標
  let held = {};          // 上一幀按著的按鈕
  let dirHeld = null, dirNext = 0;
  let rumbleNext = 0;
  let lastActive = null;

  // ---- 按鍵圖示 ----
  const GLYPH = {
    xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LR: '◀▶' },
    ps: { A: '✕', B: '○', X: '□', Y: '△', LR: '◀▶' },
    nintendo: { A: 'B', B: 'A', X: 'Y', Y: 'X', LR: '◀▶' },
    key: { A: 'Enter', B: 'Esc', X: '', Y: 'H', LR: '←→' },
  };
  const glyph = b => {
    const fam = source === 'key' ? 'key' : family;
    return `<kbd class="pad-btn ${fam} b-${b}">${GLYPH[fam][b]}</kbd>`;
  };
  const familyOf = id =>
    /054c|playstation|dualsense|dualshock/i.test(id) ? 'ps'
      : /057e|nintendo|switch|joy-con|pro controller/i.test(id) ? 'nintendo' : 'xbox';

  function setSource(s) {
    if (s === source) return;
    source = s;
    document.body.classList.toggle('pad', !!s);
    if (!s) { focus = null; paint(); }
    if (MJ.ui) MJ.ui.refresh();
  }

  // ---- 震動 ----
  function rumble(strength, ms) {
    if (source !== 'pad') return;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
      const v = gp && gp.vibrationActuator;
      if (!v || !v.playEffect) continue;
      v.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength * 1.3) }).catch(() => {});
    }
  }

  // ---- 可以停的位置：畫面上看得到的按鈕，加上輪到我時的每張手牌 ----
  const visible = el => el.offsetParent !== null;
  function stops() {
    const ov = $('#overlay');
    const els = ov.hidden
      ? [...document.querySelectorAll('#actions button, #back, #toggles button')]
      : [...ov.querySelectorAll('button')];
    const out = els.filter(visible).map(el => {
      const r = el.getBoundingClientRect();
      return { el, key: keyOf(el), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const p = MJ.ui && MJ.ui.pending();
    if (ov.hidden && p && p.kind === 'turn') {
      S.handPoints().forEach((pt, i) => { if (pt) out.push({ tile: i, x: pt.x, y: pt.y }); });
    }
    return out;
  }
  // 按鈕每次更新都會重畫，用屬性認回同一顆
  function keyOf(el) {
    if (el.id) return '#' + el.id;
    return ['act', 'v', 'i', 'tile', 'peek'].filter(k => k in el.dataset)
      .map(k => `[data-${k}="${el.dataset[k]}"]`).join('');
  }
  const same = (a, b) => !!a && !!b && (a.tile != null ? a.tile === b.tile : a.key === b.key);

  // 新情況的預設游標：對話框的第一顆、自摸、吃碰槓胡的第一顆、剛摸進來的牌
  function fallback(list) {
    const ov = $('#overlay');
    if (!ov.hidden) return list.find(s => s.el === document.activeElement) || list[0] || null;
    const p = MJ.ui && MJ.ui.pending();
    if (p && p.kind === 'turn') {
      const hu = list.find(s => s.key === '[data-act="hu"]');
      if (hu) return hu;
      const tiles = list.filter(s => s.tile != null);
      const sel = MJ.ui.selected();
      return tiles.find(s => s.tile === sel) || tiles[tiles.length - 1] || null;
    }
    return list.find(s => s.el && s.el.closest('#actions')) || list.find(s => s.key === '#back') || null;
  }

  function contextNow() {
    const ov = $('#overlay');
    if (!ov.hidden) return ov.firstElementChild;
    return (MJ.ui && MJ.ui.pending()) || ($('#back').hidden ? null : $('#back'));
  }

  // 每幀確認游標還在畫面上；換了情況就回到預設位置
  function settle() {
    const ctx = contextNow();
    const list = stops();
    if (ctx !== context) {
      const fresh = ctx && MJ.ui && ctx === MJ.ui.pending();
      context = ctx;
      focus = null;
      if (fresh) rumble(ctx.kind === 'claim' ? 0.45 : 0.25, 120);
    }
    // 用 Tab 或程式換了焦點，游標跟過去
    const ae = document.activeElement;
    if (ae !== lastActive) {
      lastActive = ae;
      const s = list.find(s => s.el === ae);
      if (s) focus = s;
    }
    const hit = focus && list.find(s => same(s, focus));
    if (hit) focus = hit;
    else if (source) focus = fallback(list);
    else focus = null;
    if (focus && focus.tile != null && MJ.ui) MJ.ui.select(focus.tile);
    paint();
    return list;
  }

  function paint() {
    for (const el of document.querySelectorAll('.pad-focus')) if (!focus || el !== focus.el) el.classList.remove('pad-focus');
    if (focus && focus.el) {
      focus.el.classList.add('pad-focus');
      if (document.activeElement !== focus.el) focus.el.focus({ preventScroll: true });
      lastActive = document.activeElement;
    }
  }

  // 往某個方向找最近的一站：正前方的距離，加上偏離方向的兩倍
  function move(name) {
    const list = settle();
    if (!focus) { focus = fallback(list); paint(); return; }
    const [dx, dy] = DIRS[name];
    // 在手牌上左右走只在手牌裡走，不會跳去角落的設定
    const inHand = focus.tile != null && dx;
    let best = null, score = Infinity;
    for (const s of list) {
      if (same(s, focus) || (inHand && s.tile == null)) continue;
      const vx = s.x - focus.x, vy = s.y - focus.y;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const sc = along + 2 * Math.abs(dx ? vy : vx);
      if (sc < score) { score = sc; best = s; }
    }
    // 手牌左右走到底就繞回另一頭
    if (!best && focus.tile != null && dx) {
      const tiles = list.filter(s => s.tile != null);
      best = dx > 0 ? tiles[0] : tiles[tiles.length - 1];
    }
    if (!best) return;
    focus = best;
    if (focus.tile != null) MJ.ui.select(focus.tile);
    paint();
  }

  // ---- 按鈕動作 ----
  function confirmDown() {
    settle();
    if (!focus) return;
    if (focus.tile != null) S.press(focus.tile, 'pad');
    else focus.el.click();
  }
  const confirmUp = () => {
    const p = S.chargePower();
    S.release('pad');
    if (p != null) rumble(0.3 + 0.7 * p, 90 + 260 * p);
  };
  function cancel() {
    if (S.chargePower() != null) { S.cancelPress(); return; }
    const ov = $('#overlay');
    const el = ov.hidden
      ? $('#actions [data-act="pass"]') || ($('#back').hidden ? null : $('#back'))
      : ov.querySelector('[data-v="back"], [data-v="leave"], [data-peek]');
    if (el) el.click();
  }
  const win = () => { const el = $('#actions [data-act="hu"]'); if (el) el.click(); };
  function settings() {
    const list = settle();
    const t = list.find(s => s.el && s.el.closest('#toggles'));
    if (!t) return;
    focus = focus && focus.el && focus.el.closest('#toggles') ? fallback(list) : t;
    paint();
  }

  // ---- 手把：每幀輪詢 ----
  function poll(now) {
    requestAnimationFrame(poll);
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const down = {};
    let ax = 0, ay = 0;
    for (const gp of pads) {
      gp.buttons.forEach((b, i) => { if (b.pressed) down[i] = true; });
      if (Math.abs(gp.axes[0] || 0) > Math.abs(ax)) ax = gp.axes[0];
      if (Math.abs(gp.axes[1] || 0) > Math.abs(ay)) ay = gp.axes[1];
    }
    const any = Object.keys(down).length || Math.abs(ax) > DEAD || Math.abs(ay) > DEAD;
    if (any && source !== 'pad') {
      family = familyOf((pads.find(gp => gp.buttons.some(b => b.pressed)) || pads[0]).id);
      setSource('pad');
      held = down;     // 叫醒用的那一下不算
      return;
    }
    if (source === 'pad') {
      const pressed = i => down[i] && !held[i], released = i => !down[i] && held[i];
      if (pressed(BTN.A)) confirmDown();
      if (released(BTN.A)) confirmUp();
      if (pressed(BTN.B)) cancel();
      if (pressed(BTN.Y)) win();
      if (pressed(BTN.START)) settings();

      // 十字鍵和左搖桿：按住會連續移動
      let dir = down[BTN.UP] ? 'UP' : down[BTN.DOWN] ? 'DOWN' : down[BTN.LEFT] ? 'LEFT' : down[BTN.RIGHT] ? 'RIGHT' : null;
      if (!dir && Math.max(Math.abs(ax), Math.abs(ay)) > DEAD) dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'RIGHT' : 'LEFT') : (ay > 0 ? 'DOWN' : 'UP');
      if (dir !== dirHeld) { dirHeld = dir; if (dir) { move(dir); dirNext = now + REPEAT_WAIT; } }
      else if (dir && now >= dirNext) { move(dir); dirNext = now + REPEAT_EVERY; }

      // 蓄力時手把跟著抖，越大力抖越兇
      const p = S.chargePower();
      if (p != null && now >= rumbleNext) { rumble(0.1 + 0.6 * p * p, 130); rumbleNext = now + 110; }
    }
    held = down;
    if (source) settle();
  }

  // ---- 鍵盤：方向鍵、Enter／空白鍵、Esc、H ----
  const KEYS = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT' };
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.matches && e.target.matches('input, textarea')) {
      // 在名字欄按 Enter 就是加入
      if (e.key === 'Enter') { const b = $('#overlay .btn.win'); if (b) { e.preventDefault(); b.click(); } }
      return;
    }
    const dir = KEYS[e.key];
    const act = e.key === 'Enter' || e.key === ' ' ? 'A' : e.key === 'Escape' || e.key === 'Backspace' ? 'B'
      : e.key === 'h' || e.key === 'H' ? 'Y' : null;
    if (!dir && !act) return;
    e.preventDefault();
    if (source !== 'key') { setSource('key'); settle(); }
    if (dir) move(dir);
    else if (e.repeat) return;
    else if (act === 'A') confirmDown();
    else if (act === 'B') cancel();
    else win();
  });
  window.addEventListener('keyup', e => {
    if ((e.key === 'Enter' || e.key === ' ') && source === 'key') { e.preventDefault(); confirmUp(); }
  });

  // 動到滑鼠或摸螢幕就換回指標操作
  window.addEventListener('pointermove', e => { if (source && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) setSource(null); });
  window.addEventListener('pointerdown', e => { if (source && e.isTrusted) setSource(null); });
  window.addEventListener('gamepadconnected', e => { family = familyOf(e.gamepad.id); });

  MJ.pad = { on: () => !!source, glyph, rumble };
  requestAnimationFrame(poll);
})();
