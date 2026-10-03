// 大富翁牌局流程：擲骰、走格子、買地、收過路費、抽卡、蓋房子、抵押、破產
// 和麻將的 MJ.Game 一樣：每家是一個 agent，需要決定時就問它，畫面靠 ui.emit 跟上
(function (g) {
  'use strict';
  const MONO = g.MONO;
  const SQ = MONO.SQUARES;
  const MANAGE = ['build', 'sell', 'mortgage', 'unmortgage'];

  // 回覆必須是給過的選項（電腦、真人、連線玩家都一樣檢查）
  MONO.legal = (kind, o, act) => {
    const t = act && act.type;
    if (kind === 'buy') return t === 'buy' || t === 'pass';
    if (kind === 'deal') return t === 'accept' || t === 'decline';
    if (MANAGE.includes(t)) return (o[t] || []).includes(act.sq);
    if (t === 'offer') {
      return (o.offer || []).includes(act.sq) && Number.isInteger(act.price) && act.price >= 10 && act.price <= o.maxOffer;
    }
    if (kind === 'raise') return t === 'bankrupt';
    return (t === 'roll' || t === 'end' || t === 'pay' || t === 'card') && !!o[t];
  };
  MONO.unmortgageCost = sq => Math.ceil(SQ[sq].price * 0.55 / 10) * 10;
  MONO.money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US');

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  class Game {
    constructor(o) {
      this.agents = o.agents;
      this.ui = o.ui || null;
      this.rng = o.rng || Math.random;
      this.maxRounds = o.rounds || 0;   // 0：打到只剩一人（最多 200 圈）
      this.players = o.names.map(name => ({ name, cash: MONO.START_CASH, pos: 0, jail: 0, free: [], out: false }));
      this.owner = SQ.map(() => -1);
      this.houses = SQ.map(() => 0);    // 5 = 旅館
      this.mortgaged = SQ.map(() => false);
      this.decks = {
        chance: shuffle(MONO.CHANCE.map((_, i) => i), this.rng),
        chest: shuffle(MONO.CHEST.map((_, i) => i), this.rng),
      };
      this.first = this.turn = Math.floor(this.rng() * this.players.length);
      this.round = 1;
      this.dice = [1, 1];
      this.outs = 0;   // 破產幾家了；p.out 記的是第幾個破產
      this.offered = new Set();
    }

    emit(type, data) { return this.ui ? this.ui.emit(type, data) : null; }
    get alive() { return this.players.filter(p => !p.out).length; }
    get over() { return this.alive <= 1 || this.round > (this.maxRounds || 200); }

    // 給畫面與連線玩家的狀態：全部公開，只少了牌堆順序
    snapshot() {
      return {
        players: this.players.map(p => ({ name: p.name, cash: p.cash, pos: p.pos, jail: p.jail, free: p.free.length, out: p.out })),
        owner: this.owner.slice(), houses: this.houses.slice(), mortgaged: this.mortgaged.slice(),
        turn: this.turn, round: this.round, maxRounds: this.maxRounds, dice: this.dice.slice(),
      };
    }

    // ---- 資產 ----
    ownsGroup(gi, pid) { return MONO.groupOf(gi).every(i => this.owner[i] === pid); }
    count(type, pid) { return SQ.filter(s => s.type === type && this.owner[s.i] === pid).length; }
    worth(pid) {
      let w = this.players[pid].cash;
      SQ.forEach((s, i) => {
        if (this.owner[i] !== pid) return;
        w += this.mortgaged[i] ? s.price / 2 : s.price;
        if (s.type === 'prop') w += this.houses[i] * MONO.GROUPS[s.group].house;
      });
      return w;
    }
    // 目前可以蓋、賣、抵押、贖回的地
    assets(pid) {
      const cash = this.players[pid].cash, o = { build: [], sell: [], mortgage: [], unmortgage: [] };
      SQ.forEach((s, i) => {
        if (this.owner[i] !== pid) return;
        if (this.mortgaged[i]) { if (cash >= MONO.unmortgageCost(i)) o.unmortgage.push(i); return; }
        if (s.type !== 'prop') { o.mortgage.push(i); return; }
        const grp = MONO.groupOf(s.group), hs = grp.map(j => this.houses[j]);
        // 平均蓋：同一組裡房子最少的那塊才能加蓋，最多的那塊才能拆
        if (this.ownsGroup(s.group, pid) && !grp.some(j => this.mortgaged[j]) && this.houses[i] < 5 &&
            this.houses[i] === Math.min(...hs) && cash >= MONO.GROUPS[s.group].house) o.build.push(i);
        if (this.houses[i] > 0 && this.houses[i] === Math.max(...hs)) o.sell.push(i);
        if (hs.every(h => h === 0)) o.mortgage.push(i);
      });
      for (const k of MANAGE) if (!o[k].length) delete o[k];
      return o;
    }
    rent(i, mod) {
      const s = SQ[i], who = this.owner[i];
      if (s.type === 'rail') return MONO.RAIL_RENT[this.count('rail', who)] * (mod.rail ? 2 : 1);
      if (s.type === 'util') return (this.dice[0] + this.dice[1]) * (mod.util || this.count('util', who) === 2 ? 100 : 40);
      const h = this.houses[i];
      return h ? s.rent[h] : s.rent[0] * (this.ownsGroup(s.group, who) ? 2 : 1);
    }

    async ask(pid, kind, o) {
      const ag = this.agents[pid];
      let act = await ag[kind](this, pid, o);
      if (!MONO.legal(kind, o, act)) act = MONO.ai[kind](this, pid, o);
      return act;
    }

    async manageAct(pid, act) {
      const p = this.players[pid], i = act.sq, s = SQ[i];
      if (act.type === 'build') { p.cash -= MONO.GROUPS[s.group].house; this.houses[i]++; }
      else if (act.type === 'sell') { p.cash += MONO.GROUPS[s.group].house / 2; this.houses[i]--; }
      else if (act.type === 'mortgage') { p.cash += s.price / 2; this.mortgaged[i] = true; }
      else { p.cash -= MONO.unmortgageCost(i); this.mortgaged[i] = false; }
      await this.emit(act.type, { pid, sq: i });
    }

    // 可以出價收購的地：別人的、整組都沒蓋房子的；同一塊地每回合只能出價一次
    offers(pid) {
      return SQ.filter(s => {
        const who = this.owner[s.i];
        if (who < 0 || who === pid || this.offered.has(s.i)) return false;
        return s.type !== 'prop' || MONO.groupOf(s.group).every(j => !this.houses[j]);
      }).map(s => s.i);
    }

    // 問玩家要做什麼；蓋房子、抵押、出價收購這類的做完再問一次，直到選了 base 裡的動作
    async manage(pid, base) {
      for (;;) {
        const o = Object.assign({}, base, this.assets(pid)), offer = this.offers(pid), cash = this.players[pid].cash;
        if (offer.length && cash >= 10) { o.offer = offer; o.maxOffer = cash; }
        const act = await this.ask(pid, 'turn', o);
        if (act.type === 'offer') await this.offer(pid, act.sq, act.price);
        else if (MANAGE.includes(act.type)) await this.manageAct(pid, act);
        else return act;
      }
    }

    // 出現金收購別人的地，對方答應就成交（抵押中的照樣抵押著過戶）
    async offer(pid, sq, price) {
      const to = this.owner[sq];
      this.offered.add(sq);
      await this.emit('offer', { pid, to, sq, price });
      const d = await this.ask(to, 'deal', { sq, price, from: pid });
      const ok = d.type === 'accept';
      if (ok) {
        this.players[pid].cash -= price;
        this.players[to].cash += price;
        this.owner[sq] = pid;
      }
      await this.emit('deal', { pid, to, sq, price, ok });
    }

    // ---- 錢 ----
    async gain(pid, amt, why) {
      this.players[pid].cash += amt;
      await this.emit('pay', { from: -1, to: pid, amt, why });
    }
    // pid 付 amt 給 to（-1 是銀行）；現金不夠就賣房子、抵押，再不夠就破產。付得出來回傳 true
    async charge(pid, amt, to, why) {
      const p = this.players[pid];
      while (p.cash < amt) {
        const a = this.assets(pid), o = { owe: amt, to, why, bankrupt: true };
        if (a.sell) o.sell = a.sell;
        if (a.mortgage) o.mortgage = a.mortgage;
        if (!o.sell && !o.mortgage) { await this.bankrupt(pid, to); return false; }
        const act = await this.ask(pid, 'raise', o);
        if (act.type === 'bankrupt') { await this.bankrupt(pid, to); return false; }
        await this.manageAct(pid, act);
      }
      p.cash -= amt;
      if (to >= 0) this.players[to].cash += amt;
      await this.emit('pay', { from: pid, to, amt, why });
      return true;
    }
    // 破產：房子賣回銀行，剩下的現金與地產歸債主（欠銀行就收回拍賣）
    async bankrupt(pid, to) {
      const p = this.players[pid];
      SQ.forEach((s, i) => {
        if (this.owner[i] !== pid) return;
        if (s.type === 'prop') p.cash += this.houses[i] * MONO.GROUPS[s.group].house / 2;
        this.houses[i] = 0;
        if (to >= 0) this.owner[i] = to;
        else { this.owner[i] = -1; this.mortgaged[i] = false; }
      });
      if (to >= 0) { this.players[to].cash += p.cash; this.players[to].free.push(...p.free); }
      else for (const c of p.free) this.decks[c.deck].push(c.idx);
      p.free = [];
      p.cash = 0;
      p.out = ++this.outs;
      await this.emit('bankrupt', { pid, to });
    }

    // ---- 移動 ----
    async move(pid, steps, mod = {}) {
      const p = this.players[pid], from = p.pos;
      p.pos = (from + steps + 40) % 40;
      await this.emit('move', { pid, from, steps });
      if (steps > 0 && from + steps >= 40) await this.gain(pid, MONO.SALARY, '經過起點');
      await this.land(pid, mod);
    }
    moveTo(pid, to, mod) { return this.move(pid, (to - this.players[pid].pos + 40) % 40 || 40, mod); }
    async toJail(pid, why) {
      const p = this.players[pid], from = p.pos;
      p.pos = MONO.JAIL;
      p.jail = 1;
      await this.emit('move', { pid, from, steps: 0, jump: true });
      await this.emit('jail', { pid, text: why });
    }

    async land(pid, mod) {
      const p = this.players[pid], i = p.pos, s = SQ[i];
      if (s.type === 'gotojail') return this.toJail(pid, '去坐牢！');
      if (s.type === 'tax') return this.charge(pid, s.amt, -1, s.name);
      if (s.type === 'chance' || s.type === 'chest') return this.draw(pid, s.type);
      if (!MONO.buyable(s)) return;
      const who = this.owner[i];
      if (who < 0) {
        if (p.cash < s.price) return;
        const act = await this.ask(pid, 'buy', { sq: i, price: s.price });
        if (act.type !== 'buy') return;
        p.cash -= s.price;
        this.owner[i] = pid;
        await this.emit('buy', { pid, sq: i });
      } else if (who !== pid && !this.mortgaged[i]) {
        await this.charge(pid, this.rent(i, mod), who, '過路費');
      }
    }

    async draw(pid, deck) {
      const idx = this.decks[deck].shift(), c = (deck === 'chance' ? MONO.CHANCE : MONO.CHEST)[idx];
      const p = this.players[pid];
      if (c.free) p.free.push({ deck, idx });
      else this.decks[deck].push(idx);
      await this.emit('card', { pid, deck, text: c.text });
      if (c.to !== undefined) return this.moveTo(pid, c.to);
      if (c.near) {
        let j = p.pos;
        do j = (j + 1) % 40; while (SQ[j].type !== c.near);
        return this.moveTo(pid, j, { [c.near]: true });
      }
      if (c.back) return this.move(pid, -c.back);
      if (c.jail) return this.toJail(pid, '直接入獄');
      if (c.cash > 0) return this.gain(pid, c.cash, deck === 'chance' ? '機會' : '命運');
      if (c.cash < 0) return this.charge(pid, -c.cash, -1, deck === 'chance' ? '機會' : '命運');
      if (c.repair) {
        let amt = 0;
        SQ.forEach((s, i) => {
          if (this.owner[i] === pid) amt += this.houses[i] === 5 ? c.repair[1] : this.houses[i] * c.repair[0];
        });
        if (amt) await this.charge(pid, amt, -1, '修繕費');
        return;
      }
      if (c.each) {
        for (let k = 1; k < this.players.length; k++) {
          const q = (pid + k) % this.players.length;
          if (this.players[q].out || p.out) continue;
          if (c.each < 0) await this.charge(pid, -c.each, q, '請客');
          else await this.charge(q, c.each, pid, '紅包');
        }
      }
    }

    // ---- 一個回合 ----
    roll() { return Math.floor(this.rng() * 6) + 1; }

    async playTurn(pid) {
      const p = this.players[pid];
      this.turn = pid;
      this.offered = new Set();
      await this.emit('turn', { pid });
      let doubles = 0;
      for (;;) {
        if (p.jail) {
          const base = { roll: true };
          if (p.free.length) base.card = true;
          if (p.cash >= MONO.JAIL_FINE) base.pay = true;
          const act = await this.manage(pid, base);
          if (act.type === 'card') {
            const c = p.free.shift();
            this.decks[c.deck].push(c.idx);
            p.jail = 0;
            await this.emit('jail', { pid, text: '用出獄許可證', out: true });
          } else if (act.type === 'pay') {
            if (!await this.charge(pid, MONO.JAIL_FINE, -1, '保釋金')) return;
            p.jail = 0;
            await this.emit('jail', { pid, text: '交保出獄', out: true });
          }
        } else await this.manage(pid, { roll: true });

        const d = this.dice = [this.roll(), this.roll()], sum = d[0] + d[1], dbl = d[0] === d[1];
        await this.emit('roll', { pid, dice: d });
        if (p.jail) {
          // 在監獄裡擲：對子就出獄（不再擲），第三次還沒擲出對子就得交保釋金
          if (dbl) {
            p.jail = 0;
            await this.emit('jail', { pid, text: '擲出對子，出獄！', out: true });
          } else if (++p.jail > 3) {
            if (!await this.charge(pid, MONO.JAIL_FINE, -1, '保釋金')) return;
            p.jail = 0;
            await this.emit('jail', { pid, text: '關滿三輪，繳保釋金出獄', out: true });
          } else break;
          await this.move(pid, sum);
          break;
        }
        if (dbl && ++doubles === 3) { await this.toJail(pid, '連擲三次對子，超速入獄'); break; }
        await this.move(pid, sum);
        if (p.out || p.jail || !dbl) break;
        await this.emit('again', { pid });
      }
      if (!p.out) await this.manage(pid, { end: true });
    }

    async play() {
      await this.emit('start', {});
      const n = this.players.length;
      while (!this.over) {
        const pid = this.turn;
        if (!this.players[pid].out) await this.playTurn(pid);
        let next = (pid + 1) % n;
        while (this.players[next].out && next !== pid) next = (next + 1) % n;
        if ((next - this.first + n) % n <= (pid - this.first + n) % n) this.round++;
        this.turn = next;
      }
      return this.result();
    }

    // 排名：還在場上的依總資產排；破產的排後面，越晚破產越前面
    result() {
      const rank = this.players.map((p, i) => ({ pid: i, name: p.name, cash: p.cash, worth: p.out ? 0 : this.worth(i), out: p.out }))
        .sort((a, b) => (!!a.out - !!b.out) || (b.out - a.out) || b.worth - a.worth);
      return { rank };
    }
  }

  MONO.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
