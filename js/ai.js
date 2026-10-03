// 電腦玩家：以向聽數與進張數決定打牌、吃碰槓
(function (g) {
  'use strict';
  const MJ = g.MJ;

  // 對 pid 而言還沒看到的張數
  function unseen(game, pid) {
    const u = new Array(34).fill(4);
    game.players.forEach((p, i) => {
      if (i === pid) for (const t of p.hand) u[t]--;
      for (const t of p.discards) u[t]--;
      for (const m of p.melds) {
        if (m.type === 'chi') { u[m.tile]--; u[m.tile + 1]--; u[m.tile + 2]--; }
        else if (m.type === 'pong') u[m.tile] -= 3;
        else if (m.type !== 'ankong' || i === pid) u[m.tile] -= 4;
      }
    });
    return u;
  }

  // 手上每種牌打掉之後：s 向聽數、uke 有效進張的剩餘張數
  function analyze(game, pid) {
    const p = game.players[pid], need = 5 - p.melds.length;
    const c = MJ.toCounts(p.hand), u = unseen(game, pid);
    const out = [];
    for (let k = 0; k < 34; k++) {
      if (!c[k]) continue;
      c[k]--;
      const s = MJ.shanten(c, need);
      let uke = 0;
      for (let j = 0; j < 34; j++) {
        if (u[j] <= 0) continue;
        c[j]++;
        if (MJ.shanten(c, need) < s) uke += u[j];
        c[j]--;
      }
      c[k]++;
      out.push({ k, s, uke });
    }
    return out;
  }

  function chooseDiscard(game, pid) {
    const c = MJ.toCounts(game.players[pid].hand), u = unseen(game, pid);
    const cands = analyze(game, pid);
    const min = Math.min(...cands.map(cd => cd.s));
    let best = null;
    for (const cd of cands) {
      if (cd.s !== min) continue;
      const uke = cd.uke;
      // 進張相同時：先丟孤張字牌、么九，其次是別人打過的牌
      let pref = 0;
      const k = cd.k;
      if (k >= 27) pref = c[k] === 1 ? 3 : 0;
      else {
        const r = k % 9;
        pref = r === 0 || r === 8 ? 2 : r === 1 || r === 7 ? 1 : 0;
      }
      if (u[k] < 4 - c[k]) pref += 0.5;
      const val = uke * 10 + pref;
      if (!best || val > best.val) best = { k, val };
    }
    return best.k;
  }

  // 防守：pid 打出每種手牌會放槍的風險。只看桌上看得到的：別家的牌河、副露、剩幾張牌。
  // 每家的威脅（副露多、打得久、牌牆快沒了就越可能聽牌）乘上這張牌對他的風險，取最危險的那家。
  // 回傳 {threat:[四家], tiles:[{k, d 0–1, level 0 安全–3 危險, foe, why}]}
  function danger(game, pid) {
    const u = unseen(game, pid), live = game.live();
    const threat = game.players.map((p, j) => (j === pid ? 0 :
      Math.min(1, 0.2 * p.melds.length + 0.035 * p.discards.length + Math.max(0, 24 - live) / 48)));
    const risk = (j, k) => {
      const ds = game.players[j].discards;
      // 字牌外面一張都不剩，誰也胡不到
      if (k >= 27 && u[k] <= 0) return [0, '絕張'];
      // 台灣麻將沒有振聽，打過的牌還是可能胡，只是很少見
      if (ds.includes(k)) return [0.05, '現物'];
      if (k >= 27) {
        return [[0, 0.15, 0.35, 0.6][Math.min(3, u[k])], u[k] === 3 ? '生張' : `外面剩 ${u[k]} 張`];
      }
      const r = k % 9;
      let x = r === 0 || r === 8 ? 0.45 : r === 1 || r === 7 ? 0.6 : 0.8, why = r === 0 || r === 8 ? '么九' : '';
      // 筋：差三的牌打過，兩面聽就聽不到這張（4、5、6 要兩邊都打過）
      const lo = r >= 3 && ds.includes(k - 3), hi = r <= 5 && ds.includes(k + 3);
      if ((r < 3 && hi) || (r > 5 && lo) || (lo && hi)) { x *= 0.5; why = '筋'; }
      else if (lo || hi) { x *= 0.75; why = '半筋'; }
      // 別人手上已經沒有這張，對子、刻子都不可能
      if (u[k] <= 0) { x *= 0.6; why = '絕張'; }
      return [x, why];
    };
    const kinds = [...new Set(game.players[pid].hand)];
    return {
      threat,
      tiles: kinds.map(k => {
        let best = { k, d: 0, foe: -1, why: '' };
        for (let j = 0; j < 4; j++) {
          if (j === pid || !threat[j]) continue;
          const [x, why] = risk(j, k), d = threat[j] * x;
          if (best.foe < 0 || d > best.d) best = { k, d, foe: j, why };
        }
        best.level = best.d < 0.1 ? 0 : best.d < 0.25 ? 1 : best.d < 0.45 ? 2 : 3;
        return best;
      }),
    };
  }

  MJ.ai = {
    unseen,
    analyze,
    danger,
    turn(game, pid, o) {
      if (o.hu) return { type: 'hu' };
      const p = game.players[pid], need = 5 - p.melds.length;
      const c = MJ.toCounts(p.hand), before = MJ.shanten(c, need);
      for (const k of o.ankong || []) {
        c[k] -= 4;
        const s = MJ.shanten(c, need - 1);
        c[k] += 4;
        if (s <= before) return { type: 'ankong', tile: k };
      }
      for (const k of o.addkong || []) {
        c[k]--;
        const s = MJ.shanten(c, need);
        c[k]++;
        if (s <= before) return { type: 'addkong', tile: k };
      }
      return { type: 'discard', tile: chooseDiscard(game, pid) };
    },
    claim(game, pid, o, tile) {
      if (o.hu) return { type: 'hu' };
      const p = game.players[pid], need = 5 - p.melds.length;
      const c = MJ.toCounts(p.hand), before = MJ.shanten(c, need);
      const value = tile >= 31 || tile === 27 + game.roundWind || tile === 27 + game.seatWind(pid);
      if (o.kong) {
        c[tile] -= 3;
        const s = MJ.shanten(c, need - 1);
        c[tile] += 3;
        if (s <= before) return { type: 'kong' };
      }
      if (o.pong) {
        c[tile] -= 2;
        const s = MJ.shanten(c, need - 1);
        c[tile] += 2;
        if (s < before || (value && s <= before)) return { type: 'pong' };
      }
      if (o.chi) {
        let best = null, bestS = before;
        for (const pair of o.chi) {
          c[pair[0]]--; c[pair[1]]--;
          const s = MJ.shanten(c, need - 1);
          c[pair[0]]++; c[pair[1]]++;
          if (s < bestS) { bestS = s; best = pair; }
        }
        if (best) return { type: 'chi', pair: best };
      }
      return { type: 'pass' };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
