// 連線對戰（玩家端）：收牌桌主機的訊息，把「只看得到自己的牌」的狀態補成畫面要的整副牌
(function (g) {
  'use strict';
  const MJ = g.MJ;

  // 看不到的牌（牌牆、別家的手牌與暗槓）用還沒現身的牌種佔位。
  // 佔位牌盡量留在原處；真牌亮出來時，跟離開原位的那張佔位牌對調牌面，
  // 牌才會從對的地方飛出來。
  function viewer() {
    let cur = null;
    return (s, fresh) => {
      const old = fresh ? null : cur;
      // 每種牌還有幾張沒現身
      const unk = Array.from({ length: 42 }, (_, k) => (k < 34 ? 4 : 1));
      for (const p of s.players) {
        for (const t of (p.hand || []).concat(p.flowers, p.discards)) unk[t]--;
        for (const m of p.melds) {
          if (m.type === 'chi') { unk[m.tile]--; unk[m.tile + 1]--; unk[m.tile + 2]--; }
          else if (m.tile !== undefined) unk[m.tile] -= m.type === 'pong' ? 3 : 4;
        }
      }

      // 佔位牌 { k: 牌種, at: 它在舊畫面的位置 }；一組佔位格現在要 n 張
      const groups = [], free = [];
      const group = (cells, n) => { const gr = { cells, n }; groups.push(gr); return gr; };
      const kept = [];
      if (old) {
        const head = s.taken - old.taken, end = head + s.wallLen;
        old.wall.forEach((k, j) => (j >= head && j < end ? kept : free).push({ k, at: { zone: 'wall', ring: old.taken + j } }));
      }
      const wall = group(kept, s.wallLen);
      const hands = s.players.map((p, i) => {
        const o = old && old.players[i];
        return group(o && o.fake ? o.hand.map((k, j) => ({ k, at: { zone: 'hand', owner: i, idx: j } })) : [], p.hand ? 0 : p.n);
      });
      const kongs = s.players.map((p, i) => p.melds.map((m, mi) => {
        const o = old && old.players[i].melds[mi];
        return group(o && o.fake ? o.fake.map((k, j) => ({ k, at: { zone: 'meld', owner: i, idx: mi * 4 + j } })) : [],
          m.type === 'ankong' && m.tile === undefined ? 4 : 0);
      }));

      // drop[k] > 0：這種牌剛現身，佔位牌裡要少這麼多張
      const drop = unk.map(u => -u);
      for (const c of free) drop[c.k]++;
      for (const gr of groups) for (const c of gr.cells) drop[c.k]++;
      const spare = [];
      const release = c => { if (drop[c.k] > 0) drop[c.k]--; else spare.push(c); };
      free.forEach(release);
      for (const gr of groups) {
        while (gr.cells.length > gr.n) {
          let j = gr.cells.findIndex(c => drop[c.k] > 0);
          if (j < 0) j = Math.floor(Math.random() * gr.cells.length);
          release(gr.cells.splice(j, 1)[0]);
        }
      }
      for (let k = 0; k < 42; k++) for (; drop[k] > 0; drop[k]--) {
        let d;
        for (const gr of groups) if ((d = gr.cells.find(c => c.k === k))) break;
        if (!d) break;
        const c = spare.pop();
        if (c) { MJ.scene.swapKinds(c.at, d.at); d.k = c.k; } else d.k = -1;
      }
      // 多出來的格子：先收留離開原位的佔位牌（例如別家從牌牆摸進手裡），不夠再從沒現身的牌裡抽
      for (const gr of groups) while (gr.cells.length < gr.n) gr.cells.push(spare.pop() || { k: -1 });
      const pool = [];
      for (const gr of groups) for (const c of gr.cells) if (c.k >= 0) unk[c.k]--;
      unk.forEach((n, k) => { for (; n > 0; n--) pool.push(k); });
      for (const gr of groups) for (const c of gr.cells) {
        if (c.k < 0) c.k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0] || 0;
      }

      // 沿用 Game 的莊家、圈風、門風算法
      cur = Object.assign(Object.create(MJ.Game.prototype), s, {
        wall: wall.cells.map(c => c.k),
        players: s.players.map((p, i) => Object.assign({}, p, {
          fake: !p.hand,
          hand: p.hand || hands[i].cells.map(c => c.k),
          melds: p.melds.map((m, mi) => (kongs[i][mi].n ? { type: 'ankong', fake: kongs[i][mi].cells.map(c => c.k) } : m)),
        })),
      });
      return cur;
    };
  }

  // 區域網路上只有一桌；放在網路上時每桌一個代碼，寫進網址好分享給朋友
  const LOCAL = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  function room() {
    const q = new URLSearchParams(location.search);
    if (!q.get('room') && !LOCAL.test(location.hostname)) {
      q.set('room', Math.random().toString(36).slice(2, 7));
      history.replaceState(null, '', '?' + q);
    }
    return q.get('room') || 'lan';
  }
  let es = null, id = null;

  MJ.net = {
    viewer,
    view: viewer(),
    // 放在靜態網站上時沒有牌桌主機，就不顯示連線選項
    available: () => fetch('api/ping').then(r => r.json()).then(j => !!j.mahjong, () => false),
    open(name, handle) {
      id = sessionStorage.mjId || (sessionStorage.mjId = Math.random().toString(36).slice(2));
      const mine = es = new EventSource(`api/events?room=${encodeURIComponent(room())}&id=${id}&name=${encodeURIComponent(name)}`);
      // 訊息依序處理：前一則的動畫播完才輪下一則
      let chain = Promise.resolve();
      mine.onmessage = e => {
        const m = JSON.parse(e.data);
        chain = chain.then(() => es === mine && handle(m)).catch(err => console.error(err));
      };
    },
    // 給其他人加入用的網址：在主機本機上看時用主機報的區域網路位址，其餘就是目前這個網址
    links: urls => (/^(localhost$|127\.)/.test(location.hostname) ? urls : [location.href]),
    send(msg) {
      fetch('api/send', { method: 'POST', body: JSON.stringify({ room: room(), id, msg }) });
    },
    close() {
      if (es) es.close();
      es = null;
      MJ.net.view = viewer();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
