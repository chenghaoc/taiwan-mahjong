// node test/lan.js — 啟動牌桌主機，兩個模擬玩家加兩家電腦透過 HTTP 打完幾場
process.env.MJ_SPEED = '0';
process.env.MJ_GONE_MS = '30';
const http = require('http');
const assert = require('assert');
const server = require('../server.js');
require('../js/net.js');
const MJ = globalThis.MJ;

const GAMES = 12;
const stat = { games: 0, hands: 0, asks: 0, swaps: 0, reveals: 0, hiddenKongs: 0 };
let port;

const key = at => (at.zone === 'wall' ? 'w' + at.ring : `${at.zone}${at.owner}:${at.idx}`);

// 把主機給的狀態補成畫面用的牌局，並檢查佔位牌：
// 整副牌每種不超過該有的張數；留在牌牆上的佔位牌不會無故換牌種
function see(c, s, fresh) {
  assert(!('wall' in s), '主機不該送出牌牆');
  assert(s.players.slice(1).filter(p => p.hand).length <= 1, '別家手牌只有胡牌者能亮');
  const old = fresh ? null : c.game, at = new Map();
  if (old) {
    old.wall.forEach((k, j) => at.set('w' + (old.taken + j), k));
    old.players.forEach((p, i) => {
      if (p.fake) p.hand.forEach((k, j) => at.set(`hand${i}:${j}`, k));
      p.melds.forEach((m, mi) => (m.fake || []).forEach((k, j) => at.set(`meld${i}:${mi * 4 + j}`, k)));
    });
  }
  MJ.scene = {
    swapKinds(a, b) {
      const x = key(a), y = key(b);
      assert(at.has(x) && at.has(y), `對調的位置不存在 ${x} ${y}`);
      const t = at.get(x);
      at.set(x, at.get(y));
      at.set(y, t);
      stat.swaps++;
    },
  };
  const g = c.game = c.view(s, fresh);

  assert.strictEqual(g.wall.length, s.wallLen);
  const n = new Array(42).fill(0);
  let total = g.wall.length;
  for (const k of g.wall) n[k]++;
  g.players.forEach((p, i) => {
    assert.strictEqual(p.hand.length, s.players[i].n);
    for (const k of p.hand.concat(p.flowers, p.discards)) { n[k]++; total++; }
    for (const m of p.melds) {
      const ks = m.fake || (m.type === 'chi' ? [m.tile, m.tile + 1, m.tile + 2] : new Array(m.type === 'pong' ? 3 : 4).fill(m.tile));
      if (m.fake) stat.hiddenKongs++;
      for (const k of ks) { n[k]++; total++; }
    }
  });
  n.forEach((v, k) => assert(v <= (k < 34 ? 4 : 1), `牌種 ${k} 有 ${v} 張`));
  assert(total === 144 || total === 143, `共 ${total} 張`); // 被搶槓的那張不在任何地方
  if (old) {
    g.wall.forEach((k, j) => {
      const was = at.get('w' + (g.taken + j));
      assert(was === undefined || was === k, '牌牆上的佔位牌換了牌種');
    });
  }
  return g;
}

function player(name, id) {
  const c = { name, id, game: null, view: MJ.net.viewer(), started: false, req: null };
  const send = msg => fetch(`http://127.0.0.1:${port}/api/send`, {
    method: 'POST', body: JSON.stringify({ room: 't', id, msg }),
  });
  c.on = m => {
    if (m.t === 'lobby') {
      c.lobby = m;
      if (c.onLobby) c.onLobby(m);
    } else if (m.t === 'event') {
      see(c, m.state, m.type === 'deal');
      if (m.type === 'call' && /胡|自摸/.test(m.d.text) && m.d.pid !== 0) stat.reveals++;
    } else if (m.t === 'ask') {
      stat.asks++;
      const act = m.kind === 'turn' ? MJ.ai.turn(c.game, 0, m.o) : MJ.ai.claim(c.game, 0, m.o, m.tile, m.from);
      send({ t: 'answer', seq: m.seq, act });
    } else if (m.t === 'result') {
      see(c, m.state);
      assert.strictEqual(m.r.deltas.reduce((a, b) => a + b, 0), 0);
      if (m.r.type === 'win') assert(c.game.players[m.r.winner].hand.length > 0);
      if (c.onResult) c.onResult(m);
      send({ t: 'next' });
    } else if (m.t === 'over') {
      see(c, m.state);
      assert.strictEqual(c.game.players.reduce((a, p) => a + p.score, 0), 0);
      if (c.onOver) c.onOver(m);
    }
  };
  c.send = send;
  c.join = () => {
    c.req = http.get(`http://127.0.0.1:${port}/api/events?room=t&id=${id}&name=${encodeURIComponent(name)}`, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', ch => {
        buf += ch;
        for (let k; (k = buf.indexOf('\n\n')) >= 0;) {
          const line = buf.slice(0, k);
          buf = buf.slice(k + 2);
          if (line.startsWith('data: ')) c.on(JSON.parse(line.slice(6)));
        }
      });
      res.on('error', () => {});
    });
    c.req.on('error', () => {});
  };
  c.leave = () => c.req.destroy();
  return c;
}

server.listen(0, async () => {
  port = server.address().port;
  const t0 = Date.now();
  const a = player('小華', 'a'), b = player('<b>小美', 'b');
  const lobbyWith = n => new Promise(r => { a.onLobby = m => { if (m.seats.filter(Boolean).length === n) r(m); }; });
  const over = () => new Promise(r => { a.onOver = r; });

  let w = lobbyWith(2);
  a.join();
  b.join();
  let lob = await w;
  assert.deepStrictEqual(lob.seats.slice(0, 2), ['小華', 'b小美'], '名字要去掉 HTML 字元');
  assert.strictEqual(lob.host, lob.me);

  // 不是房主不能開局；亂回的答案會被擋掉
  await b.send({ t: 'start', rounds: 1 });
  await b.send({ t: 'answer', seq: 1, act: { type: 'hu' } });

  for (let i = 0; i < GAMES; i++) {
    a.onResult = () => { stat.hands++; };
    const done = over();
    w = lobbyWith(2);
    await a.send({ t: 'start', rounds: 1 });
    await done;
    await w;
    stat.games++;
  }

  // 小美中途斷線：電腦代打，牌局照樣打完，回等候室時她的位子空出來
  let left = false;
  a.onResult = () => { stat.hands++; if (!left) { left = true; b.leave(); } };
  let done = over();
  w = lobbyWith(1);
  await a.send({ t: 'start', rounds: 1 });
  await done;
  lob = await w;
  assert.deepStrictEqual(lob.seats, ['小華', null, null, null]);

  // 牌局中想加入的人會被擋下
  let hands = 0;
  a.onResult = () => { hands++; };
  const c = player('路人', 'c');
  const refused = new Promise(r => { const on = c.on; c.on = m => { if (m.t === 'full') r(m); on(m); }; });
  done = over();
  await a.send({ t: 'start', rounds: 1 });
  await new Promise(r => { const on = a.on; a.on = m => { a.on = on; on(m); r(); }; });
  c.join();
  assert.strictEqual((await refused).playing, true);
  await done;
  assert(hands >= 4);

  assert(stat.swaps > 0 && stat.reveals > 0);
  console.log(`連線測試通過：${stat.games + 2} 場 ${stat.hands + hands} 手，回答 ${stat.asks} 次，` +
    `佔位牌對調 ${stat.swaps} 次，別家胡牌亮牌 ${stat.reveals} 次，蓋著的暗槓出現 ${stat.hiddenKongs} 次，${Date.now() - t0}ms`);
  a.leave();
  server.close();
  process.exit(0);
});
