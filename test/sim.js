// node test/sim.js — 規則單元測試 + 四家電腦對打的整局模擬
require('../js/rules.js');
require('../js/ai.js');
require('../js/game.js');
const MJ = globalThis.MJ;
const assert = require('assert');

// 以文字建立手牌：'123m 456p 789s 1122z'（z: 1-4 東南西北、5-7 中發白）
function tiles(str) {
  const out = [], off = { m: 0, p: 9, s: 18, z: 27 };
  for (const part of str.split(' ')) {
    const s = part[part.length - 1];
    for (const ch of part.slice(0, -1)) out.push(off[s] + Number(ch) - 1);
  }
  return out;
}
const score = (hand, o = {}) => {
  const counts = MJ.toCounts(tiles(hand));
  const melds = o.melds || [], winTile = tiles(o.win)[0];
  counts[winTile]--;
  const waits = MJ.waits(counts, 5 - melds.length).length;
  counts[winTile]++;
  return MJ.score({
    counts, melds, flowers: o.flowers || [], winTile, zimo: !!o.zimo,
    seatWind: o.seat || 0, roundWind: o.round || 0, waits, flags: o.flags || {},
  });
};
const names = r => r.items.map(i => i.name + i.tai).join(',');

// 胡牌判定
assert(MJ.canWin(MJ.toCounts(tiles('123m 456m 789m 123p 456p 11z')), 5));
assert(!MJ.canWin(MJ.toCounts(tiles('123m 456m 789m 123p 457p 11z')), 5));
assert(MJ.canWin(MJ.toCounts(tiles('11z')), 0));
assert.deepStrictEqual(MJ.waits(MJ.toCounts(tiles('123m 456m 789m 123p 45p 11z')), 5), tiles('36p'));

// 向聽數
assert.strictEqual(MJ.shanten(MJ.toCounts(tiles('123m 456m 789m 123p 456p 11z')), 5), -1);
assert.strictEqual(MJ.shanten(MJ.toCounts(tiles('123m 456m 789m 123p 45p 11z')), 5), 0);
assert.strictEqual(MJ.shanten(MJ.toCounts(tiles('123m 456m 789m 123p 4p 19s 1z')), 5), 2);

// 台數
let r = score('123m 456m 789m 123p 456p 22s', { win: '6p', seat: 1 });
assert.strictEqual(names(r), '門清1,平胡2');
r = score('123m 456m 789m 123p 456p 22s', { win: '6p', zimo: true });
assert.strictEqual(names(r), '門清自摸3');
r = score('111m 222m 333m 444m 555m 66m', { win: '6m', zimo: true });
assert.strictEqual(names(r), '門清自摸3,清一色8,碰碰胡4,五暗刻8');
r = score('123m 456m 77m', {
  win: '7m', seat: 2,
  melds: [{ type: 'pong', tile: 31 }, { type: 'pong', tile: 32 }, { type: 'pong', tile: 33 }],
});
assert.strictEqual(names(r), '大三元8,混一色4');
r = score('11z', {
  win: '1z',
  melds: [0, 9, 18, 3, 12].map(t => ({ type: 'chi', tile: t })),
});
assert.strictEqual(names(r), '全求人2');
r = score('123m 456m 789m 123p 555z 22s', { win: '5z', seat: 1, flowers: [35, 34, 36, 37, 39] });
assert.strictEqual(names(r), '門清1,中1,花槓2,正花蘭1');
console.log('規則測試通過');

// 防守：放槍風險
{
  const g = Object.create(MJ.Game.prototype);
  g.wall = new Array(16 + 40).fill(0);
  const P = n => ({ hand: [], discards: [], melds: [], flowers: [], name: n });
  g.players = [P('我'), P('甲'), P('乙'), P('丙')];
  g.players[0].hand = tiles('145m 1z');
  // 開局沒人有威脅：全部安全
  let d = MJ.ai.danger(g, 0);
  assert(d.tiles.every(x => x.level === 0));
  // 甲吃碰了三組、打過四萬，東風已經出現三張
  g.players[1].melds = [{ type: 'pong', tile: 31 }, { type: 'chi', tile: 9 }, { type: 'pong', tile: 20 }];
  g.players[1].discards = tiles('4m 9s 9s 1z 1z 1z');
  d = MJ.ai.danger(g, 0);
  const at = k => d.tiles.find(x => x.k === tiles(k)[0]);
  assert.strictEqual(at('4m').why, '現物');
  assert.strictEqual(at('4m').level, 0);
  assert.strictEqual(at('1m').why, '筋');
  assert.strictEqual(at('1z').why, '絕張');
  assert.strictEqual(at('1z').level, 0);
  assert.strictEqual(at('5m').level, 3);
  assert.strictEqual(at('5m').foe, 1);
  assert(at('1m').d < at('5m').d);
}
console.log('防守測試通過');

// 模擬
(async () => {
  const GAMES = 300;
  let hands = 0, wins = 0, zimo = 0, draws = 0, taiSum = 0, maxTai = 0;
  const seen = {};
  const t0 = Date.now();
  for (let gi = 0; gi < GAMES; gi++) {
    // 第一家每次出牌前都算一次放槍風險，確認整局各種局面都算得出來
    const guarded = Object.assign({}, MJ.ai, {
      turn(game, pid, o) {
        const d = MJ.ai.danger(game, pid);
        for (const x of d.tiles) assert(x.d >= 0 && x.d <= 1 && x.level >= 0 && x.level <= 3);
        return MJ.ai.turn(game, pid, o);
      },
    });
    const game = new MJ.Game({ names: ['A', 'B', 'C', 'D'], agents: [guarded, MJ.ai, MJ.ai, MJ.ai], rounds: 1 });
    while (!game.over) {
      const res = await game.playHand();
      hands++;
      let n = game.wall.length;
      for (const p of game.players) {
        n += p.hand.length + p.flowers.length + p.discards.length;
        for (const m of p.melds) n += m.type === 'chi' || m.type === 'pong' ? 3 : 4;
      }
      // 被搶槓的那張已離開手牌、也不在牌河
      if (res.type === 'win' && res.items.some(i => i.name === '搶槓')) n++;
      assert.strictEqual(n, 144, '牌數不守恆');
      assert.strictEqual(res.deltas.reduce((a, b) => a + b, 0), 0);
      if (res.type === 'win') {
        wins++;
        if (res.zimo) zimo++;
        taiSum += res.tai;
        maxTai = Math.max(maxTai, res.tai);
        const p = game.players[res.winner];
        assert.strictEqual(p.hand.length + (res.zimo ? 0 : 1) + p.melds.length * 3, 17);
        for (const it of res.items) seen[it.name.replace(/[東南西北春夏秋冬梅蘭菊竹]$|\d+/g, '')] = (seen[it.name.replace(/[東南西北春夏秋冬梅蘭菊竹]$|\d+/g, '')] || 0) + 1;
      } else draws++;
      game.advance(res);
    }
    assert.strictEqual(game.players.reduce((a, p) => a + p.score, 0), 0);
  }
  console.log(`${GAMES} 局 ${hands} 手，胡 ${wins}（自摸 ${zimo}），流局 ${draws}，平均 ${(taiSum / wins).toFixed(2)} 台，最大 ${maxTai} 台，${Date.now() - t0}ms`);
  console.log(seen);
})();
