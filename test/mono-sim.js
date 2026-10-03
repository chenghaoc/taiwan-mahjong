// node test/mono-sim.js — 大富翁規則與電腦玩家：電腦對打、亂按的玩家，每個事件後檢查狀態
'use strict';
const assert = require('assert');
require('../js/mono/board.js');
require('../js/mono/game.js');
require('../js/mono/ai.js');
const MONO = globalThis.MONO, SQ = MONO.SQUARES;

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

function check(g) {
  g.players.forEach((p, i) => {
    assert(p.cash >= 0, `${p.name} 現金是負的 ${p.cash}`);
    assert(p.pos >= 0 && p.pos < 40);
    if (p.out) assert(!g.owner.includes(i), '破產的人還有地');
  });
  SQ.forEach((s, i) => {
    const h = g.houses[i];
    if (!MONO.buyable(s)) assert(g.owner[i] === -1 && h === 0);
    if (h) {
      assert(s.type === 'prop' && h <= 5 && g.ownsGroup(s.group, g.owner[i]), `${s.name} 不該有房子`);
      const grp = MONO.groupOf(s.group);
      assert(!grp.some(j => g.mortgaged[j]), `${s.name} 同組有抵押還有房子`);
      const hs = grp.map(j => g.houses[j]);
      assert(Math.max(...hs) - Math.min(...hs) <= 1, `${s.name} 那組沒有平均蓋`);
    }
    if (g.mortgaged[i]) assert(g.owner[i] >= 0);
  });
  // 出獄許可證：牌堆加手上不多不少
  const free = g.players.reduce((n, p) => n + p.free.length, 0);
  assert.strictEqual(g.decks.chance.length + g.decks.chest.length + free, MONO.CHANCE.length + MONO.CHEST.length);
}

// 亂按：每次都從給的選項裡隨便挑一個
const random = r => ({
  buy: () => ({ type: r() < 0.6 ? 'buy' : 'pass' }),
  deal: () => ({ type: r() < 0.5 ? 'accept' : 'decline' }),
  turn: (g, pid, o) => {
    const acts = [];
    for (const sq of o.offer || []) acts.push({ type: 'offer', sq, price: 10 * Math.ceil(r() * o.maxOffer / 10) });
    for (const k of ['roll', 'end', 'pay', 'card']) if (o[k]) acts.push({ type: k });
    for (const k of ['build', 'sell', 'mortgage', 'unmortgage']) for (const sq of o[k] || []) acts.push({ type: k, sq });
    // 偏向往下走，不然會一直蓋了又拆
    if ((o.roll || o.end) && r() < 0.5) return { type: o.roll ? 'roll' : 'end' };
    return acts[Math.floor(r() * acts.length)];
  },
  raise: (g, pid, o) => {
    if (r() < 0.05) return { type: 'bankrupt' };
    const acts = [...(o.sell || []).map(sq => ({ type: 'sell', sq })), ...(o.mortgage || []).map(sq => ({ type: 'mortgage', sq }))];
    return acts[Math.floor(r() * acts.length)];
  },
});

async function run(n, agents, rounds, seed) {
  const stat = { games: 0, turns: 0, bankrupt: 0, built: 0, cards: 0, jail: 0, finished: 0, roundsTotal: 0 };
  for (let k = 0; k < n; k++) {
    const r = rng(seed + k);
    let g;
    const ui = {
      emit(type) {
        check(g);
        if (type === 'turn') stat.turns++;
        if (type === 'bankrupt') stat.bankrupt++;
        if (type === 'build') stat.built++;
        if (type === 'card') stat.cards++;
        if (type === 'jail') stat.jail++;
      },
    };
    g = new MONO.Game({ names: ['甲', '乙', '丙', '丁'], agents: agents(r), ui, rng: r, rounds });
    const res = await g.play();
    check(g);
    assert.strictEqual(res.rank.length, 4);
    if (g.alive === 1) { stat.finished++; assert(!res.rank[0].out); }
    stat.games++;
    stat.roundsTotal += Math.min(g.round, rounds || 200);
  }
  return stat;
}

(async () => {
  const t0 = Date.now();
  const ai = await run(200, () => [MONO.ai, MONO.ai, MONO.ai, MONO.ai], 0, 1);
  console.log(`電腦對打 ${ai.games} 場：打到剩一人 ${ai.finished} 場，平均 ${(ai.roundsTotal / ai.games).toFixed(0)} 圈，` +
    `蓋房 ${ai.built} 次，破產 ${ai.bankrupt} 家，抽卡 ${ai.cards} 次，入出獄 ${ai.jail} 次`);
  assert(ai.finished > ai.games * 0.5, '電腦對打太少分出勝負');
  assert(ai.built > 0 && ai.bankrupt > 0);

  const fuzz = await run(200, r => [random(r), MONO.ai, random(r), MONO.ai], 30, 99);
  console.log(`亂按 ${fuzz.games} 場：${fuzz.turns} 回合，破產 ${fuzz.bankrupt} 家`);
  const quick = await run(50, () => [MONO.ai, MONO.ai, MONO.ai, MONO.ai], 20, 7);
  assert(quick.games === 50);
  console.log(`大富翁規則測試通過，${Date.now() - t0}ms`);
})().catch(e => { console.error(e); process.exit(1); });
