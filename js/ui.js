// 介面：名牌、按鈕、提示、對話框，以及真人玩家的操作
(function () {
  'use strict';
  const MJ = window.MJ, S = MJ.scene;
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tile = MJ.tileHtml, back = MJ.backHtml;
  const ROLE = ['', '下家', '對家', '上家'];
  const DELAY = { draw: 380, discard: 700, call: 1000, flower: 650 };
  const signed = n => (n > 0 ? '+' + n : String(n));

  let game = null;
  let pending = null;   // 等真人決定：{kind:'turn'|'claim', o, tile, from, resolve}
  let selected = -1;

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

  function hintHtml(me) {
    const need = 5 - me.melds.length;
    const waitList = c => {
      const ws = MJ.waits(c, need);
      if (!ws.length) return '';
      const u = MJ.ai.unseen(game, 0);
      const left = ws.reduce((s, t) => s + Math.max(0, u[t]), 0);
      return ws.map(t => tile(t, 't-xs')).join('') + `<span>（還有 ${left} 張）</span>`;
    };
    if (pending && pending.kind === 'claim') {
      return `<span>${game.players[pending.from].name}打出</span>${tile(pending.tile, 't-xs')}<span>，要嗎？</span>`;
    }
    if (pending && pending.kind === 'turn') {
      if (selected < 0) return '<span>輪到你了。點一張牌選取，再點一次打出。</span>';
      const c = MJ.toCounts(me.hand);
      c[me.hand[selected]]--;
      const w = waitList(c);
      return w ? `<span>打出後聽</span>${w}` : `<span>再點一次打出${MJ.tileName(me.hand[selected])}</span>`;
    }
    if (me.hand.length % 3 === 1) {
      const w = waitList(MJ.toCounts(me.hand));
      if (w) return `<span>聽牌</span>${w}`;
    }
    return '';
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
    S.pickable = !!pending && pending.kind === 'turn';
    S.selected = selected;
    S.sync();
  }

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

  // ---- 真人玩家 ----
  const human = {
    isHuman: true,
    turn(g, pid, o) {
      return new Promise(resolve => { pending = { kind: 'turn', o, resolve }; selected = -1; refresh(); });
    },
    claim(g, pid, o, t, from) {
      return new Promise(resolve => { pending = { kind: 'claim', o, tile: t, from, resolve }; refresh(); });
    },
  };
  function answer(act) {
    const p = pending;
    pending = null;
    selected = -1;
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
  S.onPick = idx => {
    if (!pending || pending.kind !== 'turn') return;
    if (idx === selected) answer({ type: 'discard', tile: game.players[0].hand[idx] });
    else { selected = idx; refresh(); }
  };
  $('#mute').addEventListener('click', () => {
    S.muted = !S.muted;
    $('#mute').textContent = S.muted ? '音效：關' : '音效：開';
  });

  const ui = {
    async emit(type, d) {
      if (type === 'deal') {
        for (let pid = 0; pid < 4; pid++) $('#who' + pid).innerHTML = whoHtml(pid);
        await S.deal();
        return;
      }
      const win = type === 'call' && /胡|自摸/.test(d.text);
      if (type === 'discard') S.mark = true;
      if (type === 'call') S.mark = false;
      if (win) S.reveal = { pid: d.pid, ron: d.text === '胡', from: game.lastDiscard ? game.lastDiscard.from : -1 };
      refresh();
      if (type === 'call' || type === 'flower') shout(d.pid, d.text);
      if (win) { S.celebrate(d.pid); await sleep(2600); }
      // 自己摸牌不必等
      else if (!(type === 'draw' && d.pid === 0)) await sleep(DELAY[type]);
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
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        ov.hidden = true;
        ov.onclick = null;
        resolve(b.dataset.v);
      };
    });
  }

  const deltaRows = deltas => game.players.map((p, i) =>
    `<tr><td>${p.name}</td><td class="n ${deltas[i] > 0 ? 'plus' : deltas[i] < 0 ? 'minus' : ''}">${signed(deltas[i])}</td>` +
    `<td class="n">${signed(p.score)}</td></tr>`).join('');

  function showResult(r) {
    const next = '<div class="btns"><button class="btn win" data-v="next">下一局</button></div>';
    if (r.type === 'draw') {
      return dialog(`<h1>流局</h1><p>牌摸完了，沒有人胡牌。莊家連莊。</p>${next}`);
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
      `<p>每家付 底 ${game.base} ＋ 台數 × ${game.taiValue}。</p>${next}`);
  }

  function showStart(extra = '') {
    S.idle = true;
    return dialog(
      `${extra}<h1>台灣十六張麻將</h1>` +
      '<p>你和三位電腦對打。每人十六張，湊滿五組面子加一對將就胡牌；只能吃上家的牌，碰、槓、胡不限。</p>' +
      '<p>底 100、每台 20，莊家連莊照連 N 拉 N 計算。</p>' +
      '<div class="btns"><button class="btn win" data-v="1">打一圈</button>' +
      '<button class="btn" data-v="4">打四圈（一將）</button></div>');
  }

  async function main() {
    S.init($('#stage'));
    let rounds = Number(await showStart());
    for (;;) {
      S.audio();
      game = new MJ.Game({ names: ['你', '阿明', '美玲', '老陳'], agents: [human, MJ.ai, MJ.ai, MJ.ai], ui, rounds });
      S.setGame(game);
      $('#hud').hidden = false;
      while (!game.over) {
        const r = await game.playHand();
        refresh();
        await showResult(r);
        game.advance(r);
      }
      const rank = game.players.slice().sort((a, b) => b.score - a.score);
      const rows = rank.map((p, i) =>
        `<tr><td>第 ${i + 1} 名</td><td>${p.name}</td><td class="n ${p.score > 0 ? 'plus' : p.score < 0 ? 'minus' : ''}">${signed(p.score)}</td></tr>`).join('');
      rounds = Number(await showStart(`<h1>牌局結束</h1><table>${rows}</table><p>&nbsp;</p>`));
    }
  }

  main();
})();
