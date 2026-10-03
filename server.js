// node server.js — 同一個 Wi-Fi 的連線對戰：這台電腦當牌桌，其他人用瀏覽器連進來
// 牌局在這裡跑，每位玩家只收到自己看得到的牌。主機 → 玩家用 SSE，玩家 → 主機用 POST。
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
require('./js/rules.js');
require('./js/ai.js');
require('./js/game.js');
require('./js/mono/board.js');
require('./js/mono/game.js');
require('./js/mono/ai.js');
const MJ = globalThis.MJ, MONO = globalThis.MONO;

const PORT = Number(process.env.PORT) || 3000;
const SPEED = process.env.MJ_SPEED === undefined ? 1 : Number(process.env.MJ_SPEED); // 測試用：0 就不等動畫
const DELAY = { deal: 3300, draw: 380, discard: 700, call: 1000, flower: 650, win: 2600 }; // 配合 ui.js 的動畫時間
const CLAIM_MS = 15000; // 吃碰槓胡的考慮時間，逾時算過
const GONE_MS = Number(process.env.MJ_GONE_MS) || 15000; // 斷線多久後由電腦代打
const NEXT_MS = 60000;  // 結算畫面最多等多久
const BOTS = ['阿明', '美玲', '老陳'];
const ABORT = new Error('abort');
const sleep = ms => new Promise(r => setTimeout(r, ms * SPEED));

const URLS = [];
for (const list of Object.values(os.networkInterfaces())) {
  for (const a of list) if (a.family === 'IPv4' && !a.internal) URLS.push(`http://${a.address}:${PORT}`);
}

// 玩家的回覆必須是主機給過的選項
function legal(p, act, hand) {
  const o = p.o, t = act && act.type;
  if (p.kind === 'turn') {
    if (t === 'hu') return !!o.hu;
    if (t === 'ankong' || t === 'addkong') return (o[t] || []).includes(act.tile);
    return t === 'discard' && hand.includes(act.tile);
  }
  if (t === 'chi') return Array.isArray(act.pair) && (o.chi || []).some(c => c[0] === act.pair[0] && c[1] === act.pair[1]);
  return t === 'pass' || ((t === 'hu' || t === 'pong' || t === 'kong') && !!o[t]);
}

class Room {
  constructor(key) {
    this.key = key;
    this.seats = [null, null, null, null]; // { id, name, res, bot, pending, gone }
    this.game = null;
    this.seq = 0;
    this.reveal = -1;   // 胡牌後亮牌的那家
    this.waiting = null; // 結算後還沒按下一局的座位
  }

  send(s, m) { if (s && s.res) s.res.write(`data: ${JSON.stringify(m)}\n\n`); }

  lobby() {
    const host = this.seats.findIndex(Boolean);
    this.seats.forEach((s, i) => this.send(s, { t: 'lobby', seats: this.seats.map(x => x && x.name), me: i, host, urls: URLS }));
  }

  connect(id, name, res) {
    let i = this.seats.findIndex(s => s && s.id === id);
    if (i < 0) {
      i = this.game ? -1 : this.seats.indexOf(null);
      if (i < 0) {
        res.write(`data: ${JSON.stringify({ t: 'full', playing: !!this.game })}\n\n`);
        res.end();
        return;
      }
      this.seats[i] = { id, name, res: null, bot: false, pending: null, gone: null };
    }
    const s = this.seats[i];
    if (s.res) s.res.end();
    clearTimeout(s.gone);
    s.res = res;
    s.bot = false;
    if (!this.game) { s.name = name; this.lobby(); return; }
    // 牌局中重新連上：補上目前的牌局與還沒回答的問題
    this.send(s, { t: 'sync', state: this.view(i) });
    if (s.pending) this.send(s, s.pending.msg);
    if (this.waiting && this.waiting.has(i)) this.send(s, this.resultMsg(i));
  }

  drop(res) {
    const i = this.seats.findIndex(s => s && s.res === res);
    if (i < 0) return;
    const s = this.seats[i];
    s.res = null;
    if (!this.game) { this.seats[i] = null; this.lobby(); this.tidy(); return; }
    s.gone = setTimeout(() => this.botify(i), GONE_MS);
  }

  // 沒人的牌桌收掉
  tidy() {
    if (!this.game && !this.seats.some(Boolean)) rooms.delete(this.key);
  }

  // 斷線太久：這一家改由電腦代打；真人全走光就收掉牌局
  botify(i) {
    const s = this.seats[i];
    s.bot = true;
    if (s.pending) s.pending.done(s.pending.auto());
    this.ready(i);
    if (!this.seats.some(x => x && !x.bot)) {
      this.aborted = true;
      if (this.nextDone) this.nextDone();
    }
  }

  receive(id, m) {
    const i = this.seats.findIndex(s => s && s.id === id), s = this.seats[i];
    if (!s || !m) return;
    if (m.t === 'start') {
      if (!this.game && i === this.seats.findIndex(Boolean)) this.run(m.rounds === 4 ? 4 : 1).catch(e => console.error(e));
    } else if (m.t === 'answer') {
      const p = s.pending;
      if (p && p.seq === m.seq && legal(p, m.act, this.game.players[i].hand)) p.done(m.act);
    } else if (m.t === 'next') this.ready(i);
  }

  async run(rounds) {
    let b = 0;
    const game = this.game = new MJ.Game({
      names: this.seats.map(s => (s ? s.name : BOTS[b++])),
      agents: this.seats.map((s, i) => (s ? this.agent(i) : MJ.ai)),
      ui: { emit: (type, d) => this.emit(type, d) },
      rounds,
    });
    this.aborted = false;
    try {
      while (!game.over) {
        this.reveal = -1;
        const r = await game.playHand();
        await this.result(r);
        game.advance(r);
      }
      this.seats.forEach((s, i) => this.send(s, { t: 'over', state: this.view(i) }));
    } catch (e) {
      if (e !== ABORT) throw e;
    } finally {
      this.game = null;
      for (const s of this.seats) if (s) clearTimeout(s.gone);
      this.seats = this.seats.map(s => (s && s.res ? s : null));
      this.lobby();
      this.tidy();
    }
  }

  // 座位 i 看到的牌局：座位轉成以自己為 0，別家的手牌、暗槓與牌牆只給張數
  view(i) {
    const g = this.game, rel = p => (p - i + 4) % 4;
    return {
      players: [0, 1, 2, 3].map(k => {
        const pid = (i + k) % 4, p = g.players[pid], open = k === 0 || pid === this.reveal;
        return {
          name: p.name, score: p.score, n: p.hand.length, hand: open ? p.hand : null,
          melds: p.melds.map(m => (m.type === 'ankong' && !open ? { type: 'ankong' } : m)),
          flowers: p.flowers, discards: p.discards,
        };
      }),
      wallLen: g.wall.length, taken: g.taken, turn: rel(g.turn),
      drawn: g.drawn === null ? null : g.turn === i ? g.drawn : -1,
      lastDiscard: g.lastDiscard && { tile: g.lastDiscard.tile, from: rel(g.lastDiscard.from) },
      firstDealer: rel(g.firstDealer), dealerChanges: g.dealerChanges, streak: g.streak,
      rounds: g.rounds, base: g.base, taiValue: g.taiValue,
    };
  }

  async emit(type, d) {
    if (this.aborted) throw ABORT;
    const win = type === 'call' && /胡|自摸/.test(d.text);
    if (win) this.reveal = d.pid;
    this.seats.forEach((s, i) => this.send(s, {
      t: 'event', type, d: d.pid === undefined ? d : { ...d, pid: (d.pid - i + 4) % 4 }, state: this.view(i),
    }));
    // 真人自己摸牌不必等
    const s = this.seats[d.pid];
    await sleep(win ? DELAY.win : type === 'draw' && s && !s.bot ? 0 : DELAY[type]);
  }

  agent(i) {
    return {
      isHuman: true,
      turn: (g, pid, o) => this.ask(i, 'turn', o),
      claim: (g, pid, o, tile, from) => this.ask(i, 'claim', o, tile, from),
    };
  }

  ask(i, kind, o, tile, from) {
    const s = this.seats[i];
    const auto = () => (kind === 'turn' ? MJ.ai.turn(this.game, i, o) : MJ.ai.claim(this.game, i, o, tile, from));
    if (s.bot) return auto();
    return new Promise(resolve => {
      const seq = ++this.seq;
      const done = act => {
        clearTimeout(timer);
        s.pending = null;
        this.send(s, { t: 'cancel', seq });
        resolve(act);
      };
      const timer = kind === 'claim' ? setTimeout(() => done({ type: 'pass' }), CLAIM_MS) : null;
      const msg = { t: 'ask', seq, kind, o };
      if (kind === 'claim') Object.assign(msg, { tile, from: (from - i + 4) % 4, secs: CLAIM_MS / 1000 });
      s.pending = { seq, kind, o, msg, auto, done };
      this.send(s, msg);
    });
  }

  resultMsg(i) {
    const r = this.last, rel = p => (p - i + 4) % 4;
    const out = { ...r, deltas: [0, 1, 2, 3].map(k => r.deltas[(i + k) % 4]) };
    if (r.type === 'win') { out.winner = rel(r.winner); out.from = r.from === null ? null : rel(r.from); }
    return { t: 'result', r: out, state: this.view(i) };
  }

  // 送出結算，等所有在線的真人按下一局
  result(r) {
    this.last = r;
    this.waiting = new Set();
    this.seats.forEach((s, i) => { if (s && !s.bot) this.waiting.add(i); });
    this.seats.forEach((s, i) => this.send(s, this.resultMsg(i)));
    return new Promise(resolve => {
      const timer = setTimeout(() => this.nextDone(), NEXT_MS);
      this.nextDone = () => {
        clearTimeout(timer);
        this.waiting = this.nextDone = null;
        resolve();
      };
      if (!this.waiting.size) this.nextDone();
    });
  }

  ready(i) {
    if (this.waiting && this.waiting.delete(i) && !this.waiting.size) this.nextDone();
  }
}

// ---- 大富翁：座位、斷線代打、等候室都跟麻將一樣，牌局換成 MONO.Game ----
// 沒有藏起來的東西，每個人收到同一份狀態，座位不轉，用 me 告訴他是哪一家
const MONO_DELAY = {
  start: 1200, turn: 400, roll: 2200, pay: 700, buy: 900, card: 2300, jail: 1200, again: 600,
  build: 500, sell: 500, mortgage: 500, unmortgage: 500, offer: 700, deal: 1300, bankrupt: 2200,
};
const MONO_ASK_MS = { turn: 60000, buy: 30000, deal: 25000, raise: 60000 }; // 逾時由電腦代為決定
const monoDelay = (type, d) => (type === 'move' ? (d.jump ? 1000 : 300 + 230 * Math.abs(d.steps)) : MONO_DELAY[type] || 0);

class MonoRoom extends Room {
  receive(id, m) {
    const i = this.seats.findIndex(s => s && s.id === id), s = this.seats[i];
    if (!s || !m) return;
    if (m.t === 'start') {
      const rounds = [20, 40, 0].includes(m.rounds) ? m.rounds : 20;
      if (!this.game && i === this.seats.findIndex(Boolean)) this.run(rounds).catch(e => console.error(e));
    } else if (m.t === 'answer') {
      const p = s.pending;
      if (p && p.seq === m.seq && MONO.legal(p.kind, p.o, m.act)) p.done(m.act);
    }
  }

  async run(rounds) {
    let b = 0;
    const game = this.game = new MONO.Game({
      names: this.seats.map(s => (s ? s.name : BOTS[b++])),
      agents: this.seats.map((s, i) => (s ? this.agent(i) : MONO.ai)),
      ui: { emit: (type, d) => this.emit(type, d) },
      rounds,
    });
    this.aborted = false;
    try {
      const res = await game.play();
      this.seats.forEach((s, i) => this.send(s, { t: 'over', res, state: this.view(i) }));
    } catch (e) {
      if (e !== ABORT) throw e;
    } finally {
      this.game = null;
      for (const s of this.seats) if (s) clearTimeout(s.gone);
      this.seats = this.seats.map(s => (s && s.res ? s : null));
      this.lobby();
      this.tidy();
    }
  }

  view(i) { return Object.assign(this.game.snapshot(), { me: i }); }

  async emit(type, d) {
    if (this.aborted) throw ABORT;
    this.seats.forEach((s, i) => this.send(s, { t: 'event', type, d, state: this.view(i) }));
    await sleep(monoDelay(type, d));
  }

  agent(i) {
    const ask = kind => (g, pid, o) => this.ask(i, kind, o);
    return { isHuman: true, turn: ask('turn'), buy: ask('buy'), deal: ask('deal'), raise: ask('raise') };
  }

  ask(i, kind, o) {
    const s = this.seats[i];
    const auto = () => MONO.ai[kind](this.game, i, o);
    if (s.bot) return auto();
    return new Promise(resolve => {
      const seq = ++this.seq;
      const done = act => {
        clearTimeout(timer);
        s.pending = null;
        this.send(s, { t: 'cancel', seq });
        resolve(act);
      };
      const timer = setTimeout(() => done(auto()), MONO_ASK_MS[kind]);
      const msg = { t: 'ask', seq, kind, o, secs: MONO_ASK_MS[kind] / 1000 };
      s.pending = { seq, kind, o, msg, auto, done };
      this.send(s, msg);
    });
  }
}

// ---- HTTP ----
const rooms = new Map();
const MAX_ROOMS = 200;
// 麻將和大富翁的牌桌分開放；麻將沿用原本的代碼，舊的分享連結照樣能用
const roomKey = (key, game) => (game === 'mono' ? 'mono:' : '') + String(key || 'lan').slice(0, 20);
function room(key, game) {
  key = roomKey(key, game);
  if (!rooms.has(key) && rooms.size < MAX_ROOMS) rooms.set(key, game === 'mono' ? new MonoRoom(key) : new Room(key));
  return rooms.get(key);
}
const cleanName = s => String(s || '').replace(/[<>&"']/g, '').trim().slice(0, 8) || '玩家';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), q = url.searchParams;
  if (url.pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"mahjong":true,"monopoly":true}');
  } else if (url.pathname === '/api/events') {
    // X-Accel-Buffering：請代理伺服器不要把訊息攢著不送
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const r = room(q.get('room'), q.get('game'));
    if (!r) { res.end('data: {"t":"full","busy":true}\n\n'); return; }
    req.on('close', () => r.drop(res));
    r.connect(String(q.get('id')), cleanName(q.get('name')), res);
  } else if (url.pathname === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', ch => { body += ch; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const m = JSON.parse(body);
        const r = rooms.get(roomKey(m.room, m.game));
        if (r) r.receive(String(m.id), m.msg);
      } catch (e) { /* 壞掉的訊息直接丟掉 */ }
      res.writeHead(204);
      res.end();
    });
  } else {
    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!/^\/(index\.html|monopoly\.html|(css|js|audio|models)\/[\w./-]+)$/.test(file) || file.includes('..')) { res.writeHead(404); res.end(); return; }
    fs.readFile(path.join(__dirname, file), (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }
});

// SSE 連線久沒動靜會被中途的設備切掉，定時送一行註解
setInterval(() => {
  for (const r of rooms.values()) for (const s of r.seats) if (s && s.res) s.res.write(': ping\n\n');
}, 20000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('麻將牌桌開好了。這台電腦開：');
    console.log(`  http://localhost:${PORT}`);
    console.log(URLS.length ? '同一個 Wi-Fi 的其他人開：' : '找不到區域網路位址，其他人暫時連不進來。');
    for (const u of URLS) console.log('  ' + u);
  });
}
module.exports = server;
