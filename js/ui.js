// 介面：名牌、按鈕、提示、對話框，以及真人玩家的操作
(function () {
  'use strict';
  const MJ = window.MJ, S = MJ.scene;
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tile = MJ.tileHtml, back = MJ.backHtml;
  const ROLE = ['', '下家', '對家', '上家'];
  const DELAY = { draw: 380, discard: 1150, call: 1100, flower: 650 };
  const signed = n => (n > 0 ? '+' + n : String(n));

  let game = null;
  let pending = null;   // 等真人決定：{kind:'turn'|'claim', o, tile, from, resolve}
  let selected = -1;
  let analysis = null;  // 輪到我時，每種牌打掉後的向聽數與進張
  let handOver = false; // 有人胡了或流局：聽牌提示收起來，等下一局發牌

  // ---- 偏好設定（存在瀏覽器裡）----
  const prefs = { muted: false, tips: true, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('mj-prefs') || '{}')); } catch (e) { /* 沒有儲存空間就用預設 */ }
  function applyPrefs() {
    S.muted = prefs.muted;
    S.reduced = prefs.reduced;
    $('#mute').textContent = prefs.muted ? '音效：關' : '音效：開';
    $('#tips-toggle').textContent = prefs.tips ? '提示：開' : '提示：關';
    $('#motion').textContent = prefs.reduced ? '動畫：精簡' : '動畫：完整';
    try { localStorage.setItem('mj-prefs', JSON.stringify(prefs)); } catch (e) { /* 同上 */ }
  }
  for (const [id, key] of [['#mute', 'muted'], ['#tips-toggle', 'tips'], ['#motion', 'reduced']]) {
    $(id).addEventListener('click', () => { prefs[key] = !prefs[key]; applyPrefs(); refresh(); });
  }

  function meldHtml(m) {
    let ts;
    if (m.type === 'chi') ts = [m.tile, m.tile + 1, m.tile + 2].map(t => tile(t));
    else if (m.type === 'pong') ts = [0, 1, 2].map(() => tile(m.tile));
    else if (m.type === 'ankong') ts = [back(), tile(m.tile), tile(m.tile), back()];
    else ts = [0, 1, 2, 3].map(() => tile(m.tile));
    return `<span class="group">${ts.join('')}</span>`;
  }
  function whoHtml(pid) {
    const p = game.players[pid];
    return `<div class="who${game.turn === pid ? ' active' : ''}">` +
      `<span class="wind">${MJ.WIND[game.seatWind(pid)]}</span>` +
      (ROLE[pid] ? `<span class="role">${ROLE[pid]}</span>` : '') +
      `<span class="name">${p.name}</span>` +
      (game.dealer === pid ? `<span class="dealer">莊${game.streak ? '・連' + game.streak : ''}</span>` : '') +
      `<span class="score">${signed(p.score)}</span></div>`;
  }

  // 聽的牌，各標出還剩幾張；已經絕張的變暗
  function waitList(c, need) {
    const ws = MJ.waits(c, need);
    if (!ws.length) return '';
    const u = MJ.ai.unseen(game, 0);
    return ws.map(t => {
      const left = Math.max(0, u[t]);
      return tile(t, 't-xs' + (left ? '' : ' dead')) + `<small>×${left}</small>`;
    }).join('');
  }

  function hintHtml(me) {
    if (pending && pending.kind === 'claim') {
      return `<span>${game.players[pending.from].name}打出</span>${tile(pending.tile, 't-xs')}<span>，要嗎？</span>` +
        (pending.secs ? `<span class="dim">${pending.secs}s</span>` : '');
    }
    if (pending && pending.kind === 'turn') {
      if (selected < 0) {
        return '<span>輪到你出牌</span>';
      }
      const k = me.hand[selected], name = MJ.tileName(k);
      if (tingHtml(me)) return '';
      const a = prefs.tips && analysis && analysis.find(x => x.k === k);
      return a
        ? `<span>打${name}：${a.s} 向聽・進張 ${a.uke}</span>`
        : `<span>打${name}？</span>`;
    }
    return '';
  }

  // 聽牌（或選中的牌打出後會聽）另外放在畫面中央偏下，比底部提示醒目
  function tingHtml(me) {
    if (handOver) return '';
    const need = 5 - me.melds.length;
    if (pending && pending.kind === 'turn') {
      if (selected < 0) return '';
      const k = me.hand[selected];
      const c = MJ.toCounts(me.hand);
      c[k]--;
      const w = waitList(c, need);
      return w ? `<b>打${MJ.tileName(k)}聽</b>${w}` : '';
    }
    if (me.hand.length % 3 === 1) {
      const w = waitList(MJ.toCounts(me.hand), need);
      if (w) return `<b>聽牌</b>${w}`;
    }
    return '';
  }

  // 每張手牌上方的進張數：只標向聽數最好的那些，其中進張最多的用金色
  function renderTips() {
    const box = $('#tips');
    if (!game || !prefs.tips || !analysis || !pending || pending.kind !== 'turn') { box.innerHTML = ''; return; }
    const min = Math.min(...analysis.map(a => a.s));
    const top = Math.max(...analysis.filter(a => a.s === min).map(a => a.uke));
    const pts = S.handPoints(), hand = game.players[0].hand;
    box.innerHTML = hand.map((k, i) => {
      const a = analysis.find(x => x.k === k);
      if (!a || a.s !== min || !pts[i]) return '';
      return `<span class="tip${a.uke === top ? ' best' : ''}" style="left:${pts[i].x}px;top:${pts[i].y}px">${a.uke}</span>`;
    }).join('');
  }

  function actionsHtml() {
    if (!pending) return '';
    const o = pending.o, b = [];
    if (pending.kind === 'turn') {
      if (o.hu) b.push('<button class="btn win" data-act="hu">自摸</button>');
      for (const k of o.ankong || []) b.push(`<button class="btn" data-act="ankong" data-tile="${k}">暗槓${tile(k)}</button>`);
      for (const k of o.addkong || []) b.push(`<button class="btn" data-act="addkong" data-tile="${k}">加槓${tile(k)}</button>`);
    } else {
      if (o.hu) b.push('<button class="btn win" data-act="hu">胡</button>');
      if (o.kong) b.push('<button class="btn" data-act="kong">槓</button>');
      if (o.pong) b.push('<button class="btn" data-act="pong">碰</button>');
      (o.chi || []).forEach((pair, i) => {
        const three = pair.concat(pending.tile).sort((x, y) => x - y);
        b.push(`<button class="btn" data-act="chi" data-i="${i}">吃${three.map(t => tile(t)).join('')}</button>`);
      });
      b.push('<button class="btn quiet" data-act="pass">過</button>');
    }
    return b.join('');
  }

  // 名牌、按鈕、提示更新後，再讓 3D 牌桌跟上牌局
  function refresh() {
    if (!game) return;
    for (let pid = 0; pid < 4; pid++) $('#who' + pid).innerHTML = whoHtml(pid);
    $('#actions').innerHTML = actionsHtml();
    const hint = hintHtml(game.players[0]);
    $('#hint').innerHTML = hint;
    $('#hint').hidden = !hint;
    const ting = tingHtml(game.players[0]);
    $('#ting').innerHTML = ting;
    $('#ting').hidden = !ting;
    S.pickable = !!pending && pending.kind === 'turn';
    S.selected = selected;
    S.sync();
    renderTips();
  }
  S.onResize = renderTips;

  function shout(pid, text) {
    const el = $('#shout'), p = S.screen(pid);
    el.textContent = text;
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.hidden = false;
    // 重新觸發進場動畫
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }
  S.onDice = (dealer, sum) => {
    shout(dealer, `${sum} 點`);
    setTimeout(() => { $('#shout').hidden = true; }, 850);
  };

  // ---- 真人玩家 ----
  const human = {
    isHuman: true,
    turn(g, pid, o) {
      return new Promise(resolve => {
        pending = { kind: 'turn', o, resolve };
        selected = -1;
        analysis = MJ.ai.analyze(g, 0);
        refresh();
      });
    },
    claim(g, pid, o, t, from) {
      return new Promise(resolve => { pending = { kind: 'claim', o, tile: t, from, resolve }; refresh(); });
    },
  };
  function answer(act) {
    const p = pending;
    pending = null;
    selected = -1;
    analysis = null;
    refresh();
    p.resolve(act);
  }

  $('#actions').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !pending) return;
    const a = btn.dataset.act;
    if (a === 'chi') answer({ type: 'chi', pair: pending.o.chi[Number(btn.dataset.i)] });
    else if (a === 'ankong' || a === 'addkong') answer({ type: a, tile: Number(btn.dataset.tile) });
    else answer({ type: a });
  });
  // power：按住蓄力後放開的力道（0–1）；快點一下是 null，照舊先選再打
  S.onPick = (idx, power) => {
    if (!pending || pending.kind !== 'turn') return;
    if (power != null || idx === selected) {
      S.throwPower = power;
      answer({ type: 'discard', tile: game.players[0].hand[idx] });
    } else { selected = idx; refresh(); }
  };

  const ui = {
    async emit(type, d) {
      if (type === 'deal') {
        handOver = false;
        for (let pid = 0; pid < 4; pid++) $('#who' + pid).innerHTML = whoHtml(pid);
        await S.deal();
        return;
      }
      const win = type === 'call' && /胡|自摸/.test(d.text);
      if (type === 'discard') S.mark = true;
      if (type === 'call') S.mark = false;
      if (win) handOver = true;
      if (win) S.reveal = { pid: d.pid, ron: d.text === '胡', from: game.lastDiscard ? game.lastDiscard.from : -1 };
      refresh();
      if (type === 'call' || type === 'flower') shout(d.pid, d.text);
      if (type === 'call') S.say(d.text);
      if (win) { S.celebrate(d.pid); await sleep(prefs.reduced ? 1500 : 3200); }
      else {
        // 吃、碰鏡頭不動
        if (type === 'call' && d.text !== '吃' && d.text !== '碰') S.focus(d.pid, 1000);
        // 自己摸牌不必等
        if (!(type === 'draw' && d.pid === 0)) await sleep(DELAY[type] * (prefs.reduced ? 0.6 : 1));
      }
      $('#shout').hidden = true;
    },
  };

  // ---- 對話框 ----
  function dialog(html) {
    const ov = $('#overlay');
    ov.innerHTML = `<div class="sheet">${html}</div>`;
    ov.hidden = false;
    const first = ov.querySelector('button');
    if (first) first.focus();
    return new Promise(resolve => {
      ov.onclick = e => {
        // 先收起對話框看牌桌，按「回到結算」再回來
        if (e.target.closest('[data-peek]')) { ov.hidden = true; $('#back').hidden = false; return; }
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        ov.hidden = true;
        ov.onclick = null;
        resolve(b.dataset.v);
      };
    });
  }
  $('#back').addEventListener('click', () => { $('#back').hidden = true; $('#overlay').hidden = false; });

  // 胡牌後在桌上一條一條數台
  async function showTai(r) {
    const box = $('#tai'), w = game.players[r.winner];
    box.innerHTML = `<h2>${w.name}${r.zimo ? '自摸' : '胡牌'}</h2><table></table>`;
    box.hidden = false;
    const table = box.querySelector('table');
    let sum = 0;
    for (const it of r.items) {
      await sleep(430);
      sum += it.tai;
      table.insertAdjacentHTML('beforeend', `<tr><td>${it.name}</td><td class="n">${it.tai} 台</td></tr>`);
      S.tick();
    }
    await sleep(500);
    table.insertAdjacentHTML('beforeend', `<tr class="sum"><td>合計</td><td class="n">${sum} 台</td></tr>`);
    S.tick();
    await sleep(1300);
    box.hidden = true;
  }

  const deltaRows = deltas => game.players.map((p, i) =>
    `<tr><td>${p.name}</td><td class="n ${deltas[i] > 0 ? 'plus' : deltas[i] < 0 ? 'minus' : ''}">${signed(deltas[i])}</td>` +
    `<td class="n">${signed(p.score)}</td></tr>`).join('');

  function showResult(r) {
    const btns = '<div class="btns"><button class="btn win" data-v="next">下一局</button>' +
      '<button class="btn" data-peek>看牌桌</button></div>';
    if (r.type === 'draw') {
      return dialog(`<h1>流局</h1><p>牌摸完了，沒有人胡牌。莊家連莊。四家的手牌都攤在桌上了。</p>${btns}`);
    }
    const P = game.players, w = P[r.winner];
    const concealed = w.hand.slice();
    if (r.zimo) concealed.splice(concealed.indexOf(r.tile), 1);
    concealed.sort((a, b) => a - b);
    const title = r.zimo ? `${w.name}自摸` : `${w.name}胡牌<small>${P[r.from].name}放槍</small>`;
    const handHtml = '<div class="open">' +
      (w.flowers.length ? `<span class="group">${w.flowers.slice().sort((a, b) => a - b).map(t => tile(t)).join('')}</span>` : '') +
      w.melds.map(meldHtml).join('') +
      `<span class="group">${concealed.map(t => tile(t)).join('')}</span>` +
      `<span class="group">${tile(r.tile, 'last')}</span></div>`;
    const items = r.items.map(it => `<tr><td>${it.name}</td><td class="n">${it.tai} 台</td></tr>`).join('');
    const extra = r.dealerExtra ? `<p>莊家另外多付 ${r.dealerExtra} 台。</p>` : '';
    return dialog(
      `<h1>${title}</h1>${handHtml}` +
      `<div class="cols"><div><table>${items}<tr class="sum"><td>合計</td><td class="n">${r.tai} 台</td></tr></table>${extra}</div>` +
      `<table><tr><td></td><td class="n">這局</td><td class="n">累計</td></tr>${deltaRows(r.deltas)}</table></div>` +
      `<p>每家付 底 ${game.base} ＋ 台數 × ${game.taiValue}。</p>${btns}`);
  }

  function showStart(extra, lan) {
    S.idle = true;
    return dialog(
      `${extra}<h1>台灣十六張麻將</h1>` +
      '<p>你和三位電腦對打。每人十六張，湊滿五組面子加一對將就胡牌；只能吃上家的牌，碰、槓、胡不限。</p>' +
      '<p>底 100、每台 20，莊家連莊照連 N 拉 N 計算。</p>' +
      '<div class="btns"><button class="btn win" data-v="1">打一圈</button>' +
      '<button class="btn" data-v="4">打四圈（一將）</button>' +
      (lan ? '<button class="btn" data-v="net">連線對戰</button>' : '') + '</div>');
  }

  function rankHtml() {
    const rank = game.players.slice().sort((a, b) => b.score - a.score);
    const rows = rank.map((p, i) =>
      `<tr><td>第 ${i + 1} 名</td><td>${p.name}</td><td class="n ${p.score > 0 ? 'plus' : p.score < 0 ? 'minus' : ''}">${signed(p.score)}</td></tr>`).join('');
    return `<h1>牌局結束</h1><table>${rows}</table>`;
  }

  async function playLocal(rounds) {
    game = new MJ.Game({ names: ['你', '阿明', '美玲', '老陳'], agents: [human, MJ.ai, MJ.ai, MJ.ai], ui, rounds });
    S.setGame(game, true);
    $('#hud').hidden = false;
    while (!game.over) {
      const r = await game.playHand();
      handOver = true;
      refresh();
      if (r.type === 'win' && !prefs.reduced) await showTai(r);
      // 結算前把四家的手牌都攤開
      S.revealAll = true;
      S.rest();
      S.pay();
      refresh();
      await sleep(r.type === 'draw' ? 1600 : 900);
      await showResult(r);
      $('#back').hidden = true;
      game.advance(r);
    }
    return rankHtml() + '<p>&nbsp;</p>';
  }

  // ---- 連線對戰：牌局在牌桌主機上跑，這裡只負責顯示與回覆 ----
  // 沒有按鈕要等的畫面（等候室、等其他人）
  function sheet(html, onclick = null) {
    const ov = $('#overlay');
    ov.innerHTML = `<div class="sheet">${html}</div>`;
    ov.onclick = onclick;
    ov.hidden = false;
  }
  function show(state, fresh) {
    game = MJ.net.view(state, fresh);
    S.setGame(game, fresh);
  }

  async function playNet() {
    const cleanName = s => s.replace(/[<>&"']/g, '').trim().slice(0, 8);
    const v = await dialog(
      '<h1>連線對戰</h1><p>拿到這桌連結的人都能加入（同一個 Wi-Fi 或線上都行），空位由電腦補上。</p>' +
      `<p><label>名字　<input id="name" maxlength="8" value="${cleanName(localStorage.mjName || '')}"></label></p>` +
      '<div class="btns"><button class="btn win" data-v="join">加入</button><button class="btn" data-v="back">返回</button></div>');
    if (v !== 'join') return '';
    const name = localStorage.mjName = cleanName($('#name').value) || '玩家';

    return new Promise(done => {
      const leave = html => {
        MJ.net.close();
        pending = null;
        refresh();
        $('#overlay').hidden = true;
        done(html);
      };
      // 等候室下方的總排行榜：進等候室、打完一將回來時各抓一次
      let lobbyMsg = null, board = '';
      const lobby = m => {
        lobbyMsg = m;
        const host = m.host === m.me, links = MJ.net.links(m.urls);
        S.idle = true;
        sheet('<h1>等候室</h1>' +
          (links.length ? `<p>請其他人用瀏覽器打開 ${links.map(u => `<b>${u}</b>`).join(' 或 ')}</p>` : '') +
          `<table>${m.seats.map((n, i) => `<tr><td>${n || '電腦'}</td><td>${i === m.me ? '你' : ''}${i === m.host ? '　房主' : ''}</td></tr>`).join('')}</table>` +
          (host ? '' : '<p>等房主開始…</p>') + '<div class="btns">' +
          (host ? '<button class="btn win" data-v="1">打一圈</button><button class="btn" data-v="4">打四圈（一將）</button>' : '') +
          '<button class="btn" data-v="leave">離開</button></div>' + board,
        e => {
          const b = e.target.closest('button[data-v]');
          if (!b) return;
          if (b.dataset.v === 'leave') leave('');
          else MJ.net.send({ t: 'start', rounds: Number(b.dataset.v) });
        });
      };
      const loadBoard = () => MJ.net.scores().then(j => {
        board = j.enabled && j.rows.length ? '<h2>總排行榜</h2><table>' + j.rows.map((r, i) =>
          `<tr><td>第 ${i + 1} 名</td><td>${cleanName(r.name)}</td><td class="n ${r.total > 0 ? 'plus' : r.total < 0 ? 'minus' : ''}">${signed(r.total)}</td><td>${r.wins}/${r.hands} 胡</td></tr>`).join('') + '</table>' : '';
        if (lobbyMsg) lobby(lobbyMsg);
      });
      loadBoard();
      MJ.net.open(name, async m => {
        if (m.t !== 'lobby') lobbyMsg = null;
        if (m.t === 'lobby') {
          lobby(m);
        } else if (m.t === 'event') {
          show(m.state, m.type === 'deal');
          if (m.type === 'deal') { $('#overlay').hidden = true; $('#hud').hidden = false; }
          // 喊牌語音平常掛在 Game 的事件上；連線時牌局在主機，這裡自己喊
          if (m.type === 'call' && S.say) S.say(m.d.text, m.d.pid);
          await ui.emit(m.type, m.d);
        } else if (m.t === 'ask') {
          pending = { kind: m.kind, o: m.o, tile: m.tile, from: m.from, secs: m.secs, seq: m.seq,
            resolve: act => MJ.net.send({ t: 'answer', seq: m.seq, act }) };
          selected = -1;
          refresh();
        } else if (m.t === 'cancel') {
          // 逾時或已由電腦代答
          if (pending && pending.seq === m.seq) { pending = null; selected = -1; refresh(); }
        } else if (m.t === 'result') {
          handOver = true;
          show(m.state);
          S.rest();
          S.pay();
          refresh();
          // 不擋住後面的訊息：主機等太久會直接發下一局
          showResult(m.r).then(() => {
            $('#back').hidden = true; MJ.net.send({ t: 'next' }); sheet('<p>等其他人按下一局…</p>'); });
        } else if (m.t === 'over') {
          loadBoard();
          show(m.state);
          refresh();
          S.idle = true;
          await dialog(`${rankHtml()}<div class="btns"><button class="btn win" data-v="ok">回等候室</button></div>`);
        } else if (m.t === 'sync') {
          // 牌局中重新連上
          show(m.state, true);
          $('#overlay').hidden = true;
          $('#hud').hidden = false;
          S.idle = false; S.reveal = null; S.mark = false;
          handOver = false;
          pending = null;
          refresh();
          S.settle();
        } else if (m.t === 'full') {
          leave(`<p>${m.busy ? '牌桌都被佔滿了' : m.playing ? '這一桌已經開打' : '這一桌滿了'}，晚點再試。</p>`);
        }
      });
    });
  }

  // 手機：按下開始時順便全螢幕並鎖橫向（Android 可以；iPhone 不支援就算了）
  function landscape() {
    if (!window.matchMedia('(pointer: coarse)').matches || document.fullscreenElement) return;
    const el = document.documentElement;
    if (!el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
      .catch(() => {});
  }

  async function main() {
    S.init($('#stage'));
    applyPrefs();
    const lan = await MJ.net.available();
    let extra = '';
    for (;;) {
      const v = await showStart(extra, lan);
      S.audio();
      landscape();
      extra = v === 'net' ? await playNet() : await playLocal(Number(v));
    }
  }

  main();
})();
