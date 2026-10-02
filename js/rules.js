// 台灣十六張麻將：牌、胡牌判定、向聽數、台數計算
(function (g) {
  'use strict';
  const MJ = g.MJ = g.MJ || {};

  // 牌種編號：0-8 萬、9-17 筒、18-26 條、27-30 東南西北、31-33 中發白、
  // 34-37 春夏秋冬、38-41 梅蘭菊竹
  const NUM = '一二三四五六七八九';
  const HONOR = '東南西北中發白';
  const FLOWER = '春夏秋冬梅蘭菊竹';
  const SUIT = '萬筒條';

  MJ.WIND = ['東', '南', '西', '北'];
  MJ.isFlower = t => t >= 34;
  MJ.isHonor = t => t >= 27 && t < 34;
  MJ.suitOf = t => (t < 27 ? Math.floor(t / 9) : 3);
  MJ.tileName = t => {
    if (t < 27) return NUM[t % 9] + SUIT[Math.floor(t / 9)];
    if (t < 34) return HONOR[t - 27];
    return FLOWER[t - 34];
  };

  MJ.buildWall = rng => {
    const w = [];
    for (let t = 0; t < 34; t++) w.push(t, t, t, t);
    for (let t = 34; t < 42; t++) w.push(t);
    for (let i = w.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [w[i], w[j]] = [w[j], w[i]];
    }
    return w;
  };

  MJ.toCounts = tiles => {
    const c = new Array(34).fill(0);
    for (const t of tiles) c[t]++;
    return c;
  };

  // ---- 胡牌判定：need 組面子 + 一對將 ----
  function meldsOnly(c, i) {
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) return true;
    if (c[i] >= 3) {
      c[i] -= 3;
      const ok = meldsOnly(c, i);
      c[i] += 3;
      if (ok) return true;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      const ok = meldsOnly(c, i);
      c[i]++; c[i + 1]++; c[i + 2]++;
      if (ok) return true;
    }
    return false;
  }

  MJ.canWin = (counts, need) => {
    let n = 0;
    for (let i = 0; i < 34; i++) n += counts[i];
    if (n !== need * 3 + 2) return false;
    const c = counts.slice();
    for (let i = 0; i < 34; i++) {
      if (c[i] < 2) continue;
      c[i] -= 2;
      const ok = meldsOnly(c, 0);
      c[i] += 2;
      if (ok) return true;
    }
    return false;
  };

  // 聽哪些牌（counts 為 3k+1 張）
  MJ.waits = (counts, need) => {
    const out = [], c = counts.slice();
    for (let t = 0; t < 34; t++) {
      if (c[t] >= 4) continue;
      c[t]++;
      if (MJ.canWin(c, need)) out.push(t);
      c[t]--;
    }
    return out;
  };

  // 所有拆法：{pair, pungs:[牌], chows:[起始牌]}
  function decompose(counts) {
    const c = counts.slice(), out = [], pungs = [], chows = [];
    (function rec(i, pair) {
      while (i < 34 && c[i] === 0) i++;
      if (i === 34) {
        if (pair >= 0) out.push({ pair, pungs: pungs.slice(), chows: chows.slice() });
        return;
      }
      if (c[i] >= 3) {
        c[i] -= 3; pungs.push(i);
        rec(i, pair);
        pungs.pop(); c[i] += 3;
      }
      if (pair < 0 && c[i] >= 2) {
        c[i] -= 2;
        rec(i, i);
        c[i] += 2;
      }
      if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
        c[i]--; c[i + 1]--; c[i + 2]--; chows.push(i);
        rec(i, pair);
        chows.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
      }
    })(0, -1);
    return out;
  }
  MJ.decompose = decompose;

  // ---- 向聽數（-1 胡牌、0 聽牌）----
  const suitMemo = new Map();
  // 回傳 tbl[有無將][面子數] = 最多搭子數（-1 表示不可能）
  function suitTable(counts, off, len, honor) {
    const a = counts.slice(off, off + len);
    const key = (honor ? 'h' : 's') + a.join('');
    let tbl = suitMemo.get(key);
    if (tbl) return tbl;
    tbl = [new Array(7).fill(-1), new Array(7).fill(-1)];
    (function rec(i, m, t, p) {
      while (i < len && a[i] === 0) i++;
      if (i >= len) {
        if (t > tbl[p][m]) tbl[p][m] = t;
        return;
      }
      if (a[i] >= 3) { a[i] -= 3; rec(i, m + 1, t, p); a[i] += 3; }
      if (a[i] >= 2) {
        a[i] -= 2;
        if (!p) rec(i, m, t, 1);
        rec(i, m, t + 1, p);
        a[i] += 2;
      }
      if (!honor) {
        const n1 = i + 1 < len && a[i + 1] > 0, n2 = i + 2 < len && a[i + 2] > 0;
        if (n1 && n2) { a[i]--; a[i + 1]--; a[i + 2]--; rec(i, m + 1, t, p); a[i]++; a[i + 1]++; a[i + 2]++; }
        if (n1) { a[i]--; a[i + 1]--; rec(i, m, t + 1, p); a[i]++; a[i + 1]++; }
        if (n2) { a[i]--; a[i + 2]--; rec(i, m, t + 1, p); a[i]++; a[i + 2]++; }
      }
      const save = a[i];
      a[i] = 0; rec(i + 1, m, t, p); a[i] = save;
    })(0, 0, 0, 0);
    if (suitMemo.size > 200000) suitMemo.clear();
    suitMemo.set(key, tbl);
    return tbl;
  }

  MJ.shanten = (counts, need) => {
    let cur = [new Array(7).fill(-1), new Array(7).fill(-1)];
    cur[0][0] = 0;
    const groups = [[0, 9, false], [9, 9, false], [18, 9, false], [27, 7, true]];
    for (const [off, len, honor] of groups) {
      const tbl = suitTable(counts, off, len, honor);
      const nxt = [new Array(7).fill(-1), new Array(7).fill(-1)];
      for (let p1 = 0; p1 < 2; p1++) for (let m1 = 0; m1 < 7; m1++) {
        const t1 = cur[p1][m1];
        if (t1 < 0) continue;
        for (let p2 = 0; p1 + p2 < 2; p2++) for (let m2 = 0; m1 + m2 < 7; m2++) {
          const t2 = tbl[p2][m2];
          if (t2 < 0) continue;
          if (t1 + t2 > nxt[p1 + p2][m1 + m2]) nxt[p1 + p2][m1 + m2] = t1 + t2;
        }
      }
      cur = nxt;
    }
    let best = 99;
    for (let p = 0; p < 2; p++) for (let m = 0; m <= need && m < 7; m++) {
      const t = cur[p][m];
      if (t < 0) continue;
      const s = 2 * need - 2 * m - Math.min(t, need - m) - p;
      if (s < best) best = s;
    }
    return best;
  };

  // ---- 台數 ----
  // w: {counts（含胡的那張）, melds, flowers, winTile, zimo, seatWind, roundWind, waits, flags}
  // flags: {kong 槓上/補花自摸, rob 搶槓, last 最後一張, heaven 天胡, earth 地胡}
  function scoreOne(w, d) {
    const items = [];
    const add = (name, tai) => items.push({ name, tai });
    const melds = w.melds, f = w.flags || {};
    const ankong = melds.filter(m => m.type === 'ankong').length;
    const exposed = melds.length - ankong;
    const pungKinds = d.pungs.concat(melds.filter(m => m.type !== 'chi').map(m => m.tile));
    const seqs = d.chows.length + melds.filter(m => m.type === 'chi').length;
    const menqing = exposed === 0;
    const quanqiu = exposed === 5 && !w.zimo;

    if (f.heaven) add('天胡', 16);
    else if (f.earth) add('地胡', 16);
    else if (w.zimo && menqing) add('門清自摸', 3);
    else if (w.zimo) add('自摸', 1);
    else if (menqing) add('門清', 1);

    if (quanqiu) add('全求人', 2);
    if (f.kong) add('槓上開花', 1);
    if (f.rob) add('搶槓', 1);
    if (f.last) add(w.zimo ? '海底撈月' : '河底撈魚', 1);
    if (w.waits === 1 && !quanqiu && !f.heaven) add('獨聽', 1);

    const dragons = pungKinds.filter(k => k >= 31);
    if (dragons.length === 3) add('大三元', 8);
    else if (dragons.length === 2 && d.pair >= 31) add('小三元', 4);
    else for (const k of dragons) add(MJ.tileName(k), 1);

    const winds = pungKinds.filter(k => k >= 27 && k <= 30);
    if (winds.length === 4) add('大四喜', 16);
    else if (winds.length === 3 && d.pair >= 27 && d.pair <= 30) add('小四喜', 8);
    else {
      if (winds.includes(27 + w.roundWind)) add('圈風' + MJ.WIND[w.roundWind], 1);
      if (winds.includes(27 + w.seatWind)) add('門風' + MJ.WIND[w.seatWind], 1);
    }

    for (const base of [34, 38]) {
      const set = w.flowers.filter(t => t >= base && t < base + 4);
      if (set.length === 4) add('花槓', 2);
      else if (set.includes(base + w.seatWind)) add('正花' + MJ.tileName(base + w.seatWind), 1);
    }

    const suits = new Set();
    let honor = false;
    for (let t = 0; t < 34; t++) if (w.counts[t]) { if (t < 27) suits.add(MJ.suitOf(t)); else honor = true; }
    for (const m of melds) { if (m.tile < 27) suits.add(MJ.suitOf(m.tile)); else honor = true; }
    if (suits.size === 0) add('字一色', 16);
    else if (suits.size === 1) honor ? add('混一色', 4) : add('清一色', 8);

    if (seqs === 0 && suits.size > 0) add('碰碰胡', 4);
    if (seqs === 5 && !honor && !w.flowers.length && !w.zimo && w.waits >= 2) add('平胡', 2);

    // 暗刻：放槍胡的那張若只能湊成刻子，該刻不算暗刻
    let anke = d.pungs.length + ankong;
    if (!w.zimo && d.pungs.includes(w.winTile)) {
      const inChow = d.chows.some(s => w.winTile >= s && w.winTile <= s + 2);
      if (!inChow) anke--;
    }
    if (anke === 3) add('三暗刻', 2);
    else if (anke === 4) add('四暗刻', 5);
    else if (anke >= 5) add('五暗刻', 8);

    return { items, total: items.reduce((s, x) => s + x.tai, 0) };
  }

  MJ.score = w => {
    let best = null;
    for (const d of decompose(w.counts)) {
      const r = scoreOne(w, d);
      if (!best || r.total > best.total) best = r;
    }
    return best;
  };
})(typeof window !== 'undefined' ? window : globalThis);
