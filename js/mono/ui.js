// 大富翁介面：帳本、按鈕、地契、卡片、紀錄，以及真人玩家的操作
(function () {
  'use strict';
  const MONO = window.MONO, S = MONO.scene, SQ = MONO.SQUARES;
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const money = MONO.money;
  const DECK = { chance: ['機會', '#ef8a2c'], chest: ['命運', '#3f6fc4'] };
  const MANAGE = ['build', 'sell', 'mortgage', 'unmortgage'];

  let st = null;        // 目前的牌局狀態（Game.snapshot() 再接上 Game 的算法）
  let me = 0;           // 我是第幾家
  let pending = null;   // 等我決定：{ kind: 'turn'|'buy'|'deal'|'raise', o, resolve, secs }
  let hover = -1, pinned = -1;
  let panel = null;     // 開著的整理表：'props' | 'offer'

  // ---- 偏好設定 ----
  const prefs = { muted: false, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('mono-prefs') || '{}')); } catch (e) { /* 沒有儲存空間就用預設 */ }
  function applyPrefs() {
    S.muted = prefs.muted;
    S.reduced = prefs.reduced;
    $('#mute').textContent = prefs.muted ? '音效：關' : '音效：開';
    $('#motion').textContent = prefs.reduced ? '動畫：精簡' : '動畫：完整';
    try { localStorage.setItem('mono-prefs', JSON.stringify(prefs)); } catch (e) { /* 同上 */ }
  }
  for (const [id, key] of [['#mute', 'muted'], ['#motion', 'reduced']]) {
    $(id).addEventListener('click', () => { prefs[key] = !prefs[key]; applyPrefs(); });
  }
  $('#view').addEventListener('click', () => S.resetView());
  const wait = ms => sleep(ms * (prefs.reduced ? 0.5 : 1));

  // 狀態接上 Game 的算法（總資產、過路費、整組判斷），本機和連線都一樣用
  const view = s => Object.assign(Object.create(MONO.Game.prototype), s);
  const who = pid => `<b style="--c:${MONO.COLORS[pid]}">${st.players[pid].name}</b>`;
  const place = i => `<b style="--c:${SQ[i].type === 'prop' ? MONO.GROUPS[SQ[i].group].color : 'var(--ivory)'}">${SQ[i].name}</b>`;
  const swatch = i => (SQ[i].type === 'prop' ? MONO.GROUPS[SQ[i].group].color : SQ[i].type === 'rail' ? '#4a4a44' : '#cfc6ad');

  // ---- 帳本、圈數、紀錄 ----
  function renderLedger() {
    $('#ledger').innerHTML = st.players.map((p, i) => {
      const chips = SQ.filter(s => st.owner[s.i] === i)
        .map(s => `<i class="chip${st.mortgaged[s.i] ? ' m' : ''}" style="--c:${swatch(s.i)}" title="${s.name}"></i>`).join('');
      const tags = (p.jail ? '<span class="tag">坐牢</span>' : '') + (p.free ? `<span>出獄卡×${p.free}</span>` : '');
      return `<div class="acct${st.turn === i ? ' active' : ''}${p.out ? ' out' : ''}" style="--c:${MONO.COLORS[i]}">` +
        `<span class="pawn"></span><span class="name">${p.name}${i === me && p.name !== '你' ? '<small>你</small>' : ''}</span>` +
        `<span class="cash">${p.out ? '破產' : money(p.cash)}</span>` +
        `<span class="sub">${p.out ? '' : `總資產 ${money(st.worth(i))}　`}${tags}${chips}</span></div>`;
    }).join('');
    $('#round').textContent = `第 ${Math.min(st.round, st.maxRounds || Infinity)}${st.maxRounds ? ' / ' + st.maxRounds : ''} 圈`;
  }
  function log(html) {
    const box = $('#log');
    box.insertAdjacentHTML('beforeend', `<p>${html}</p>`);
    while (box.children.length > 9) box.firstChild.remove();
  }
  function shout(text, ms = 1100) {
    const el = $('#shout');
    el.textContent = text;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(shout.t);
    shout.t = setTimeout(() => { el.hidden = true; }, ms * (prefs.reduced ? 0.6 : 1));
  }
  function float(pt, text, cls) {
    const el = document.createElement('span');
    el.className = 'float ' + cls;
    el.textContent = text;
    el.style.left = pt.x + 'px';
    el.style.top = pt.y + 'px';
    $('#floats').appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  // ---- 地契 ----
  function rentRows(i) {
    const s = SQ[i], own = st.owner[i] >= 0;
    if (s.type === 'prop') {
      const lv = own && !st.mortgaged[i] ? st.houses[i] : -1;
      const full = own && st.ownsGroup(s.group, st.owner[i]);
      const names = ['空地', '一棟房子', '兩棟房子', '三棟房子', '四棟房子', '旅館'];
      return s.rent.map((r, k) => `<tr${k === lv ? ' class="now"' : ''}><td>${names[k]}</td><td class="n">${money(k === 0 && full ? r * 2 : r)}</td></tr>`).join('') +
        `</table><p class="note">湊齊整組，空地租金加倍。房子每棟 ${money(MONO.GROUPS[s.group].house)}，四棟換旅館。抵押可借 ${money(s.price / 2)}。</p><table>`;
    }
    if (s.type === 'rail') {
      const n = own ? st.count('rail', st.owner[i]) : 0;
      return [1, 2, 3, 4].map(k => `<tr${k === n ? ' class="now"' : ''}><td>擁有 ${k} 座車站</td><td class="n">${money(MONO.RAIL_RENT[k])}</td></tr>`).join('');
    }
    const n = own ? st.count('util', st.owner[i]) : 0;
    return `<tr${n === 1 ? ' class="now"' : ''}><td>擁有一家</td><td class="n">點數 × 40</td></tr>` +
      `<tr${n === 2 ? ' class="now"' : ''}><td>兩家都有</td><td class="n">點數 × 100</td></tr>`;
  }
  const ABOUT = {
    go: `經過或停在起點，領 ${money(MONO.SALARY)}。`,
    jail: `停在這裡只是探監。坐牢時可以交保 ${money(MONO.JAIL_FINE)}、用出獄許可證，或擲出對子出獄；三輪都沒擲出對子就得交保。`,
    park: '在廟口歇歇腳，什麼事都不會發生。',
    gotojail: '直接進監獄，不經過起點，不領錢。',
    chance: '抽一張機會卡，照上面寫的做。',
    chest: '抽一張命運卡，照上面寫的做。',
  };

  // 這塊地現在能做的事（要問的時候才有）
  function deedAsk(i) {
    if (!pending) return '';
    const o = pending.o, b = [];
    if (pending.kind === 'turn' && (o.offer || []).includes(i)) {
      const guess = Math.min(o.maxOffer, Math.round(SQ[i].price * 1.5 / 10) * 10);
      return `<div class="ask"><p>向 ${st.players[st.owner[i]].name} 出價收購：</p><div class="btns">` +
        `<input class="price" type="number" min="10" step="10" max="${o.maxOffer}" value="${guess}">` +
        `<button class="btn win" data-act="offer" data-sq="${i}">出價</button></div></div>`;
    }
    const label = { build: `蓋房子 −${money(SQ[i].type === 'prop' ? MONO.GROUPS[SQ[i].group].house : 0)}`,
      sell: `拆一棟 +${money(SQ[i].type === 'prop' ? MONO.GROUPS[SQ[i].group].house / 2 : 0)}`,
      mortgage: `抵押 +${money((SQ[i].price || 0) / 2)}`, unmortgage: `贖回 −${money(SQ[i].price ? MONO.unmortgageCost(i) : 0)}` };
    for (const k of MANAGE) if ((o[k] || []).includes(i)) b.push(`<button class="btn" data-act="${k}" data-sq="${i}">${label[k]}</button>`);
    return b.length ? `<div class="ask"><div class="btns">${b.join('')}</div></div>` : '';
  }

  function renderDeed() {
    const box = $('#deed');
    const forced = pending && (pending.kind === 'buy' || pending.kind === 'deal') ? pending.o.sq : -1;
    const i = forced >= 0 ? forced : pinned >= 0 ? pinned : hover;
    if (i < 0 || !st) { box.hidden = true; box.dataset.sq = ''; return; }
    const s = SQ[i];
    let band = '#e8dfc6', ink = 'var(--ink)', kind = '';
    if (s.type === 'prop') { band = MONO.GROUPS[s.group].color; ink = s.group === 1 || s.group === 5 ? 'var(--ink)' : '#fff'; kind = MONO.GROUPS[s.group].name; }
    else if (s.type === 'rail') { band = '#2b2a26'; ink = 'var(--ivory)'; kind = '車站'; }
    else if (s.type === 'util') kind = '公用事業';
    else if (s.type === 'chance' || s.type === 'chest') { band = DECK[s.type][1]; ink = '#fff'; }
    let body;
    if (MONO.buyable(s)) {
      const w = st.owner[i];
      body = `<table>${rentRows(i)}</table>` +
        `<p class="owner">${w >= 0 ? `<i style="--c:${MONO.COLORS[w]}"></i>地主：${st.players[w].name}${st.mortgaged[i] ? '（抵押中，不收過路費）' : ''}` : `還沒有人買　售價 ${money(s.price)}`}</p>` +
        deedAsk(i);
    } else body = `<p class="note">${s.type === 'tax' ? `付 ${money(s.amt)} 給銀行。` : ABOUT[s.type]}</p>`;
    box.style.setProperty('--band', band);
    box.style.setProperty('--band-ink', ink);
    box.innerHTML = `<header>${kind ? `<small>${kind}</small>` : ''}<b>${s.name}</b></header><div class="body">${body}</div>` +
      (pinned === i && forced < 0 ? '<button class="close" data-close aria-label="關閉">×</button>' : '');
    box.dataset.sq = i;
    box.hidden = false;
  }
  S.onHover = i => { hover = i; if (pinned < 0) renderDeed(); };
  S.onSquare = i => { pinned = pinned === i ? -1 : i; renderDeed(); };
  $('#deed').addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { pinned = -1; renderDeed(); return; }
    const b = e.target.closest('[data-act]');
    if (!b || !pending) return;
    const sq = Number(b.dataset.sq);
    if (b.dataset.act === 'offer') {
      const price = Math.round(Number($('#deed .price').value));
      if (!MONO.legal('turn', pending.o, { type: 'offer', sq, price })) { $('#deed .price').focus(); return; }
      pinned = -1;
      answer({ type: 'offer', sq, price });
    } else answer({ type: b.dataset.act, sq });
  });

  // ---- 按鈕與提示 ----
  function actionsHtml() {
    if (!pending) return '';
    const o = pending.o, b = [];
    if (pending.kind === 'turn') {
      if (o.roll) b.push('<button class="btn win" data-act="roll">擲骰子</button>');
      if (o.end) b.push('<button class="btn win" data-act="end">結束回合</button>');
      if (o.pay) b.push(`<button class="btn" data-act="pay">交保 ${money(MONO.JAIL_FINE)}</button>`);
      if (o.card) b.push('<button class="btn" data-act="card">用出獄許可證</button>');
      if (MANAGE.some(k => o[k])) b.push('<button class="btn" data-panel="props">整理地產</button>');
      if (o.offer) b.push('<button class="btn" data-panel="offer">出價收購</button>');
    } else if (pending.kind === 'buy') {
      b.push(`<button class="btn win" data-act="buy">買下 ${money(o.price)}</button>`, '<button class="btn quiet" data-act="pass">不買</button>');
    } else if (pending.kind === 'deal') {
      b.push(`<button class="btn win" data-act="accept">賣 ${money(o.price)}</button>`, '<button class="btn quiet" data-act="decline">不賣</button>');
    } else {
      b.push('<button class="btn win" data-panel="props">拆房子、抵押</button>', '<button class="btn danger" data-act="bankrupt">宣告破產</button>');
    }
    return b.join('');
  }
  function hintHtml() {
    const secs = pending && pending.secs ? `<span class="secs">（${pending.secs} 秒內沒決定，電腦幫你選）</span>` : '';
    if (!pending) {
      const p = st.players[st.turn];
      return p && st.turn !== me ? `${who(st.turn)} 的回合…` : '';
    }
    const o = pending.o, p = st.players[me];
    if (pending.kind === 'buy') return `停在 ${place(o.sq)}，要花 ${money(o.price)} 買下嗎？你有 ${money(p.cash)}。${secs}`;
    if (pending.kind === 'deal') return `${who(o.from)} 想用 ${money(o.price)} 收購你的 ${place(o.sq)}（原價 ${money(SQ[o.sq].price)}）。${secs}`;
    if (pending.kind === 'raise') {
      return `要付 ${money(o.owe)}（${o.why}），現金只有 ${money(p.cash)}。拆房子或抵押來湊錢，不然只能破產。${secs}`;
    }
    if (o.roll && p.jail) return `你在牢裡（第 ${p.jail} 輪）：交保、用出獄許可證，或擲出對子出獄。${secs}`;
    if (o.roll) return `輪到你了，擲骰子吧。點棋盤上的格子可以看地契。${secs}`;
    return `要蓋房子、抵押或出價收購嗎？做完就結束回合。${secs}`;
  }
  function refresh() {
    if (!st) return;
    renderLedger();
    $('#actions').innerHTML = actionsHtml();
    const h = hintHtml();
    $('#hint').innerHTML = h;
    $('#hint').hidden = !h;
    renderDeed();
    if (panel) renderPanel();
  }

  function answer(act) {
    const p = pending;
    if (!p) return;
    pending = null;
    refresh();
    p.resolve(act);
  }
  $('#actions').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !pending) return;
    if (b.dataset.panel) { openPanel(b.dataset.panel); return; }
    if (b.dataset.act === 'bankrupt' && !confirm('確定要宣告破產？所有財產都會交給債主。')) return;
    answer({ type: b.dataset.act });
  });
  // 空白鍵、Enter：擲骰子或結束回合
  document.addEventListener('keydown', e => {
    if ((e.key !== ' ' && e.key !== 'Enter') || !pending || pending.kind !== 'turn' || e.target.closest('input, button') || !$('#overlay').hidden) return;
    e.preventDefault();
    if (pending.o.roll) answer({ type: 'roll' });
    else if (pending.o.end) answer({ type: 'end' });
  });

  // ---- 整理地產、出價收購（開著也不擋住牌局）----
  function openPanel(kind) { panel = kind; renderPanel(); }
  function closePanel() { panel = null; $('#overlay').hidden = true; $('#overlay').onclick = null; }
  function renderPanel() {
    const ov = $('#overlay'), o = pending ? pending.o : {};
    let html;
    if (panel === 'props') {
      const mine = SQ.filter(s => st.owner[s.i] === me);
      const rows = mine.map(s => {
        const i = s.i, h = st.houses[i];
        const state = st.mortgaged[i] ? '<span class="muted">抵押中</span>' : h === 5 ? '🏨 旅館' : h ? '🏠'.repeat(h) : '';
        const btns = [];
        if ((o.build || []).includes(i)) btns.push(`<button class="btn" data-act="build" data-sq="${i}">蓋房 −${money(MONO.GROUPS[s.group].house)}</button>`);
        if ((o.sell || []).includes(i)) btns.push(`<button class="btn" data-act="sell" data-sq="${i}">拆房 +${money(MONO.GROUPS[s.group].house / 2)}</button>`);
        if ((o.mortgage || []).includes(i)) btns.push(`<button class="btn" data-act="mortgage" data-sq="${i}">抵押 +${money(s.price / 2)}</button>`);
        if ((o.unmortgage || []).includes(i)) btns.push(`<button class="btn" data-act="unmortgage" data-sq="${i}">贖回 −${money(MONO.unmortgageCost(i))}</button>`);
        return `<tr><td><div class="sw" style="--c:${swatch(i)}"></div></td><td>${s.name}</td><td>${state}</td><td>${btns.join(' ')}</td></tr>`;
      }).join('');
      const p = st.players[me];
      const owe = pending && pending.kind === 'raise' ? `<p>還要湊到 <b>${money(o.owe)}</b>，現在現金 ${money(p.cash)}。</p>` : `<p>現金 ${money(p.cash)}。要蓋房子得先湊齊同一色的地，而且同一組要平均蓋。</p>`;
      html = `<h1>整理地產</h1>${owe}` + (mine.length ? `<table class="props">${rows}</table>` : '<p>你還沒有任何地產。</p>');
    } else {
      const rows = (o.offer || []).map(i => {
        const guess = Math.min(o.maxOffer, Math.round(SQ[i].price * 1.5 / 10) * 10);
        return `<tr><td><div class="sw" style="--c:${swatch(i)}"></div></td><td>${SQ[i].name}</td><td>${st.players[st.owner[i]].name}</td>` +
          `<td class="muted">原價 ${money(SQ[i].price)}</td><td><input class="price" type="number" min="10" step="10" max="${o.maxOffer}" value="${guess}" data-for="${i}"></td>` +
          `<td><button class="btn" data-act="offer" data-sq="${i}">出價</button></td></tr>`;
      }).join('');
      html = '<h1>出價收購</h1><p>拿現金跟別人買地，對方可以拒絕。同一塊地每回合只能出價一次；蓋了房子的那組買不到。</p>' +
        (rows ? `<table class="props">${rows}</table>` : '<p>現在沒有可以收購的地。</p>');
    }
    ov.innerHTML = `<div class="sheet">${html}<div class="btns"><button class="btn win" data-close>完成</button></div></div>`;
    ov.hidden = false;
    ov.onclick = e => {
      if (e.target.closest('[data-close]') || e.target === ov) { closePanel(); return; }
      const b = e.target.closest('[data-act]');
      if (!b || !pending) return;
      const sq = Number(b.dataset.sq);
      if (b.dataset.act === 'offer') {
        const price = Math.round(Number(ov.querySelector(`[data-for="${sq}"]`).value));
        if (!MONO.legal('turn', pending.o, { type: 'offer', sq, price })) return;
        closePanel();
        answer({ type: 'offer', sq, price });
      } else answer({ type: b.dataset.act, sq });
    };
  }

  // ---- 牌局事件 → 動畫與紀錄 ----
  async function onEvent(type, d) {
    // 整理表只在自己整理地產時開著，牌局往下走就收起來
    if (panel && !MANAGE.includes(type) && type !== 'offer' && type !== 'deal' && type !== 'pay') closePanel();
    if (type === 'move') {
      const anim = S.move(d.pid, d.from, d.steps, d.jump);
      S.setState(st);
      refresh();
      await anim;
      S.focus(d.pid);
      return;
    }
    S.setState(st, type === 'start');
    refresh();
    const n = d.pid !== undefined ? who(d.pid) : '';
    if (type === 'start') {
      S.idle = false;
      $('#log').innerHTML = '';
      log(`開局！每人 ${money(MONO.START_CASH)}，${who(st.turn)} 先擲。`);
      await wait(900);
    } else if (type === 'turn') {
      S.focus(d.pid);
      if (d.pid === me) { shout('輪到你了', 900); S.sfx('tick'); }
      await wait(350);
    } else if (type === 'roll') {
      const [a, b] = d.dice;
      // 不必等骰子完全停：最多等一秒半，連線時才跟得上主機
      await Promise.race([S.roll(d.dice), sleep(1500)]);
      shout(a === b ? `${a}＋${b} 對子！` : `${a}＋${b}＝${a + b}`, 900);
      log(`${n} 擲出 ${a}＋${b}${a === b ? '，對子' : ''}`);
      await wait(250);
    } else if (type === 'again') {
      shout('再擲一次！', 800);
      await wait(500);
    } else if (type === 'pay') {
      const amt = money(d.amt);
      if (d.from >= 0) float(S.pawnScreen(d.from), '−' + amt, 'minus');
      if (d.to >= 0) setTimeout(() => float(S.pawnScreen(d.to), '+' + amt, 'plus'), 250);
      S.sfx(d.to === me ? 'cash' : d.from === me || d.to < 0 ? 'pay' : 'cash');
      if (d.from < 0) log(d.why === '經過起點' ? `${who(d.to)} 經過起點，領 ${amt}` : `${who(d.to)} ${d.why}：領 ${amt}`);
      else if (d.to < 0) log(`${who(d.from)} 付 ${amt}（${d.why}）`);
      else if (d.why === '過路費') log(`${who(d.from)} 付給 ${who(d.to)} 過路費 ${amt}`);
      else if (d.why === '請客') log(`${who(d.from)} 請 ${who(d.to)} ${amt}`);
      else log(`${who(d.from)} 包紅包 ${amt} 給 ${who(d.to)}`);
      await wait(550);
    } else if (type === 'buy') {
      S.sfx('buy');
      float(S.squareScreen(d.sq), `${st.players[d.pid].name} 買下`, 'note');
      log(`${n} 買下 ${place(d.sq)}（${money(SQ[d.sq].price)}）`);
      await wait(700);
    } else if (type === 'card') {
      const [title, color] = DECK[d.deck], box = $('#cardpop');
      await S.card(d.deck);
      box.style.setProperty('--deck', color);
      box.innerHTML = `<h3>${title}</h3><p>${d.text}</p><small>${st.players[d.pid].name} 抽到</small>`;
      box.hidden = false;
      log(`${n} 抽到${title}：${d.text}`);
      await wait(1500);
      box.hidden = true;
    } else if (type === 'jail') {
      shout(d.text, 1200);
      S.sfx(d.out ? 'go' : 'jail');
      log(`${n} ${d.text}`);
      await wait(d.out ? 700 : 1000);
    } else if (MANAGE.includes(type)) {
      const h = st.houses[d.sq];
      const text = { build: h === 5 ? '蓋了旅館' : `蓋了第 ${h} 棟房子`, sell: '拆掉一棟房子', mortgage: '抵押了', unmortgage: '贖回了' }[type];
      S.sfx(type === 'build' ? 'build' : 'cash');
      log(type === 'build' || type === 'sell' ? `${n} 在 ${place(d.sq)} ${text}` : `${n} ${text} ${place(d.sq)}`);
      await wait(d.pid === me ? 150 : 400);
    } else if (type === 'offer') {
      log(`${n} 出 ${money(d.price)} 想收購 ${who(d.to)} 的 ${place(d.sq)}`);
      await wait(500);
    } else if (type === 'deal') {
      if (d.ok) {
        S.sfx('buy');
        log(`成交！${who(d.to)} 把 ${place(d.sq)} 以 ${money(d.price)} 賣給 ${n}`);
        if (d.pid === me || d.to === me) shout('成交！', 900);
      } else {
        log(`${who(d.to)} 不賣 ${place(d.sq)}`);
        if (d.pid === me) shout('對方不賣', 900);
      }
      await wait(900);
    } else if (type === 'bankrupt') {
      S.sfx('bust');
      shout(`${st.players[d.pid].name} 破產了！`, 1800);
      log(`${n} 破產了${d.to >= 0 ? `，剩下的財產歸 ${who(d.to)}` : '，地產收回銀行'}`);
      await wait(1900);
    }
  }

  // ---- 對話框 ----
  function dialog(html) {
    const ov = $('#overlay');
    ov.innerHTML = `<div class="sheet">${html}</div>`;
    ov.hidden = false;
    const first = ov.querySelector('button');
    if (first) first.focus();
    return new Promise(resolve => {
      ov.onclick = e => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        ov.hidden = true;
        ov.onclick = null;
        resolve(b.dataset.v);
      };
    });
  }
  function sheet(html, onclick = null) {
    const ov = $('#overlay');
    ov.innerHTML = `<div class="sheet">${html}</div>`;
    ov.onclick = onclick;
    ov.hidden = false;
  }
  const ROUND_BTNS = '<button class="btn win" data-v="20">快速局（20 圈）</button>' +
    '<button class="btn" data-v="40">標準局（40 圈）</button><button class="btn" data-v="0">打到剩一人</button>';

  function showStart(extra, lan) {
    S.idle = true;
    return dialog(
      `${extra}<h1>台灣大富翁<small>環島買地蓋房子</small></h1>` +
      '<p>你和三位電腦輪流擲骰子，繞著台灣一圈一圈走。停在沒人買的地可以買下；別人停到你的地，要付你過路費。</p>' +
      `<p>湊齊同一色的地就能蓋房子、蓋旅館，過路費翻好幾倍。每人 ${money(MONO.START_CASH)} 起家，經過起點領 ${money(MONO.SALARY)}；` +
      '付不出錢就破產。時間到時，總資產最多的人獲勝。</p>' +
      `<div class="btns">${ROUND_BTNS}${lan ? '<button class="btn" data-v="net">連線對戰</button>' : ''}</div>` +
      '<p><a class="btn quiet" href="index.html">← 回去打麻將</a></p>');
  }

  function rankHtml(res) {
    const top = res.rank[0];
    const rows = res.rank.map((r, i) => `<tr><td>第 ${i + 1} 名</td><td><i class="dot" style="--c:${MONO.COLORS[r.pid]}"></i>${r.name}</td>` +
      `<td class="n">${r.out ? '破產' : money(r.worth)}</td></tr>`).join('');
    return `<h1>${top.name}${top.pid === me ? '（你）' : ''} 成為台灣首富！</h1><table class="rank"><tr><td></td><td></td><td class="n">總資產</td></tr>${rows}</table>`;
  }

  async function finish(res) {
    S.celebrate(res.rank[0].pid);
    shout(`${res.rank[0].name} 獲勝！`, 2000);
    await wait(1800);
  }

  // ---- 本機：你和三位電腦 ----
  const human = {};
  for (const kind of ['turn', 'buy', 'deal', 'raise']) {
    human[kind] = (g, pid, o) => new Promise(resolve => { pending = { kind, o, resolve }; refresh(); });
  }

  async function playLocal(rounds) {
    me = 0;
    let g = null;
    const ui = { emit: (type, d) => { st = view(g.snapshot()); return onEvent(type, d); } };
    g = new MONO.Game({ names: ['你', '阿明', '美玲', '老陳'], agents: [human, MONO.ai, MONO.ai, MONO.ai], ui, rounds });
    st = view(g.snapshot());
    S.setState(st, true);
    $('#hud').hidden = false;
    const res = await g.play();
    st = view(g.snapshot());
    refresh();
    await finish(res);
    return rankHtml(res);
  }

  // ---- 連線對戰 ----
  async function playNet() {
    const cleanName = s => s.replace(/[<>&"']/g, '').trim().slice(0, 8);
    const v = await dialog(
      '<h1>連線對戰</h1><p>同一個 Wi-Fi 的人都能加入同一桌，空位由電腦補上。</p>' +
      `<p><label>名字　<input id="name" maxlength="8" value="${cleanName(localStorage.mjName || '')}"></label></p>` +
      '<div class="btns"><button class="btn win" data-v="join">加入</button><button class="btn" data-v="back">返回</button></div>');
    if (v !== 'join') return '';
    const name = localStorage.mjName = cleanName($('#name').value) || '玩家';

    return new Promise(done => {
      const leave = html => {
        MONO.net.close();
        pending = null;
        panel = null;
        $('#overlay').hidden = true;
        $('#hud').hidden = true;
        done(html);
      };
      const live = m => {
        st = view(m.state);
        me = m.state.me;
      };
      MONO.net.open(name, async m => {
        if (m.t === 'lobby') {
          const host = m.host === m.me, links = MONO.net.links(m.urls);
          S.idle = true;
          sheet('<h1>等候室</h1>' +
            (links.length ? `<p>請其他人用瀏覽器打開 ${links.map(u => `<b>${u}</b>`).join(' 或 ')}</p>` : '') +
            `<table>${m.seats.map((n, i) => `<tr><td><i class="dot" style="display:inline-block;width:1em;height:1em;border-radius:50%;background:${MONO.COLORS[i]}"></i></td><td>${n || '電腦'}</td><td>${i === m.me ? '你' : ''}${i === m.host ? '　房主' : ''}</td></tr>`).join('')}</table>` +
            (host ? '' : '<p>等房主開始…</p>') + '<div class="btns">' +
            (host ? ROUND_BTNS : '') + '<button class="btn" data-v="leave">離開</button></div>',
          e => {
            const b = e.target.closest('button[data-v]');
            if (!b) return;
            if (b.dataset.v === 'leave') leave('');
            else MONO.net.send({ t: 'start', rounds: Number(b.dataset.v) });
          });
        } else if (m.t === 'event') {
          live(m);
          if (m.type === 'start') { $('#overlay').hidden = true; $('#hud').hidden = false; }
          await onEvent(m.type, m.d);
        } else if (m.t === 'ask') {
          pending = { kind: m.kind, o: m.o, secs: m.secs, seq: m.seq, resolve: act => MONO.net.send({ t: 'answer', seq: m.seq, act }) };
          refresh();
        } else if (m.t === 'cancel') {
          // 逾時或已由電腦代答
          if (pending && pending.seq === m.seq) { pending = null; refresh(); }
        } else if (m.t === 'over') {
          live(m);
          pending = null;
          refresh();
          await finish(m.res);
          S.idle = true;
          await dialog(`${rankHtml(m.res)}<div class="btns"><button class="btn win" data-v="ok">回等候室</button></div>`);
        } else if (m.t === 'sync') {
          // 牌局中重新連上
          live(m);
          S.setState(st, true);
          $('#overlay').hidden = true;
          $('#hud').hidden = false;
          S.idle = false;
          pending = null;
          refresh();
        } else if (m.t === 'full') {
          leave(`<p>${m.busy ? '牌桌都被佔滿了' : m.playing ? '這一桌已經開打' : '這一桌滿了'}，晚點再試。</p>`);
        }
      });
    });
  }

  async function main() {
    S.init($('#stage'));
    applyPrefs();
    const lan = await MONO.net.available();
    let extra = '';
    for (;;) {
      const v = await showStart(extra, lan);
      S.audio();
      if (v === 'net') extra = await playNet();
      else {
        const html = await playLocal(Number(v));
        S.idle = true;
        await dialog(`${html}<div class="btns"><button class="btn win" data-v="ok">再來一場</button></div>`);
        $('#hud').hidden = true;
        extra = '';
      }
    }
  }

  main();
})();
