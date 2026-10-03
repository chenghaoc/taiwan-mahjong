// node test/mono-lan.js — 大富翁連線：啟動主機，兩個模擬玩家加兩家電腦透過 HTTP 打完幾場
process.env.MJ_SPEED = '0';
process.env.MJ_GONE_MS = '30';
const http = require('http');
const assert = require('assert');
const server = require('../server.js');
const MONO = globalThis.MONO;

const GAMES = 6;
const stat = { games: 0, asks: 0, kinds: {}, events: 0 };
let port;

function player(name, id) {
  const c = { name, id, req: null, state: null };
  const send = msg => fetch(`http://127.0.0.1:${port}/api/send`, {
    method: 'POST', body: JSON.stringify({ game: 'mono', room: 't', id, msg }),
  });
  const view = s => Object.assign(Object.create(MONO.Game.prototype), s);
  c.on = m => {
    if (m.t === 'lobby') {
      c.lobby = m;
      if (c.onLobby) c.onLobby(m);
    } else if (m.t === 'event') {
      stat.events++;
      c.state = m.state;
      assert(m.state.me >= 0 && m.state.players.length === 4);
      m.state.players.forEach(p => assert(p.cash >= 0));
    } else if (m.t === 'ask') {
      stat.asks++;
      stat.kinds[m.kind] = (stat.kinds[m.kind] || 0) + 1;
      // 先亂回一個不合法的，主機要擋掉；再照電腦的想法回
      send({ t: 'answer', seq: m.seq, act: { type: 'build', sq: 0 } });
      send({ t: 'answer', seq: m.seq, act: MONO.ai[m.kind](view(c.state), c.state.me, m.o) });
    } else if (m.t === 'over') {
      assert.strictEqual(m.res.rank.length, 4);
      if (c.onOver) c.onOver(m);
    }
  };
  c.send = send;
  c.join = () => {
    c.req = http.get(`http://127.0.0.1:${port}/api/events?game=mono&room=t&id=${id}&name=${encodeURIComponent(name)}`, res => {
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
  const ping = await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json();
  assert(ping.mahjong && ping.monopoly);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/monopoly.html`)).status, 200);

  const a = player('小華', 'a'), b = player('小美', 'b');
  const lobbyWith = n => new Promise(r => { a.onLobby = m => { if (m.seats.filter(Boolean).length === n) r(m); }; });
  const over = () => new Promise(r => { a.onOver = r; });

  let w = lobbyWith(2);
  a.join();
  b.join();
  const lob = await w;
  assert.deepStrictEqual(lob.seats.slice(0, 2), ['小華', '小美']);

  // 不是房主不能開局
  await b.send({ t: 'start', rounds: 20 });
  await new Promise(r => setTimeout(r, 50));
  assert(!a.state, '不是房主卻開局了');

  for (let i = 0; i < GAMES; i++) {
    const done = over();
    w = lobbyWith(2);
    await a.send({ t: 'start', rounds: 20 });
    await done;
    await w;
    stat.games++;
  }

  // 小美中途斷線：電腦代打，打完回等候室時她的位子空出來
  let left = false;
  const onB = b.on;
  b.on = m => { onB(m); if (!left && m.t === 'event' && m.type === 'buy') { left = true; b.leave(); } };
  const done = over();
  w = lobbyWith(1);
  await a.send({ t: 'start', rounds: 20 });
  await done;
  assert.deepStrictEqual((await w).seats, ['小華', null, null, null]);

  assert(stat.kinds.turn && stat.kinds.buy, '應該問過擲骰與買地');
  console.log(`大富翁連線測試通過：${stat.games + 1} 場，事件 ${stat.events} 則，回答 ${stat.asks} 次 ` +
    `${JSON.stringify(stat.kinds)}，${Date.now() - t0}ms`);
  a.leave();
  server.close();
  process.exit(0);
});
