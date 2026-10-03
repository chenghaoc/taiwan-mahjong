// 大富翁電腦玩家：手上留一筆預備金，湊齊一組就蓋房子，缺錢先拆房再抵押
(function (g) {
  'use strict';
  const MONO = g.MONO;
  const SQ = MONO.SQUARES;

  // 預備金：場上別人的地越貴、房子越多，越要多留一點
  function reserve(game, pid) {
    let worst = 0;
    SQ.forEach((s, i) => {
      const who = game.owner[i];
      if (who >= 0 && who !== pid && !game.mortgaged[i]) worst = Math.max(worst, game.rent(i, {}));
    });
    return Math.max(1500, Math.min(6000, worst));
  }
  // 這塊地對我多有用：能湊齊一組最好，能擋住別人湊齊其次
  function value(game, pid, i) {
    const s = SQ[i];
    if (s.type !== 'prop') return s.type === 'rail' ? 1 + game.count('rail', pid) * 0.3 : 0.6;
    const grp = MONO.groupOf(s.group), mine = grp.filter(j => game.owner[j] === pid).length;
    const others = new Set(grp.map(j => game.owner[j]).filter(w => w >= 0 && w !== pid));
    if (!others.size && mine === grp.length - 1) return 2;
    if (others.size === 1 && grp.filter(j => game.owner[j] >= 0 && game.owner[j] !== pid).length === grp.length - 1) return 1.6;
    return 1;
  }
  // 要放手時：先挑沒湊成組、最便宜的
  function cheapest(game, pid, list) {
    return list.slice().sort((a, b) => {
      const ka = SQ[a].type === 'prop' && game.ownsGroup(SQ[a].group, pid), kb = SQ[b].type === 'prop' && game.ownsGroup(SQ[b].group, pid);
      return (ka - kb) || SQ[a].price - SQ[b].price;
    })[0];
  }

  // 某人拿到這塊地就湊齊一組
  const completes = (game, pid, i) => SQ[i].type === 'prop' &&
    MONO.groupOf(SQ[i].group).every(j => j === i || game.owner[j] === pid);
  const round10 = n => Math.round(n / 10) * 10;

  MONO.ai = {
    // 有人出價收購我的地
    deal(game, pid, o) {
      const s = SQ[o.sq], ratio = o.price / s.price;
      if (s.type === 'prop' && game.ownsGroup(s.group, pid)) return { type: ratio >= 3 ? 'accept' : 'decline' };
      const need = completes(game, o.from, o.sq) ? (game.players[pid].cash < 1000 ? 1.4 : 1.8) : 1.3;
      return { type: ratio >= need ? 'accept' : 'decline' };
    },
    buy(game, pid, o) {
      const left = game.players[pid].cash - o.price, v = value(game, pid, o.sq);
      return { type: left >= reserve(game, pid) / v || (v >= 2 && left >= 300) ? 'buy' : 'pass' };
    },
    turn(game, pid, o) {
      const cash = game.players[pid].cash, keep = reserve(game, pid);
      if (o.card) return { type: 'card' };
      // 前幾圈地還沒被買光，早點交保出去買地；後期待在牢裡反而不用付過路費
      if (o.pay && game.round <= 12 && cash > keep) return { type: 'pay' };
      if (o.unmortgage) {
        const i = o.unmortgage.slice().sort((a, b) => value(game, pid, b) - value(game, pid, a))[0];
        if (cash - MONO.unmortgageCost(i) > keep + 2000) return { type: 'unmortgage', sq: i };
      }
      if (o.build) {
        // 先蓋第三棟以前的（租金跳最多），同樣的話先蓋貴的組
        const i = o.build.slice().sort((a, b) => (game.houses[a] >= 3) - (game.houses[b] >= 3) || SQ[b].price - SQ[a].price)[0];
        if (cash - MONO.GROUPS[SQ[i].group].house >= keep) return { type: 'build', sq: i };
      }
      // 只差一塊就湊齊一組：出兩倍價收購
      for (const i of o.offer || []) {
        const price = round10(SQ[i].price * 2);
        if (completes(game, pid, i) && price <= o.maxOffer && cash - price >= 1000) return { type: 'offer', sq: i, price };
      }
      return { type: o.roll ? 'roll' : 'end' };
    },
    raise(game, pid, o) {
      if (o.sell) return { type: 'sell', sq: o.sell[0] };
      if (o.mortgage) return { type: 'mortgage', sq: cheapest(game, pid, o.mortgage) };
      return { type: 'bankrupt' };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
