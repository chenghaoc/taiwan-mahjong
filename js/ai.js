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

  function chooseDiscard(game, pid) {
    const p = game.players[pid], need = 5 - p.melds.length;
    const c = MJ.toCounts(p.hand), u = unseen(game, pid);
    const cands = [];
    let min = 99;
    for (let k = 0; k < 34; k++) {
      if (!c[k]) continue;
      c[k]--;
      const s = MJ.shanten(c, need);
      c[k]++;
      cands.push({ k, s });
      if (s < min) min = s;
    }
    let best = null;
    for (const cd of cands) {
      if (cd.s !== min) continue;
      c[cd.k]--;
      let uke = 0;
      for (let j = 0; j < 34; j++) {
        if (u[j] <= 0) continue;
        c[j]++;
        if (MJ.shanten(c, need) < min) uke += u[j];
        c[j]--;
      }
      c[cd.k]++;
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

  MJ.ai = {
    unseen,
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
