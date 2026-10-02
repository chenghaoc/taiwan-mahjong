// 牌局流程：發牌、摸打、吃碰槓胡、算台、連莊
(function (g) {
  'use strict';
  const MJ = g.MJ;
  const RESERVE = 16; // 牌尾留 16 張不摸

  const removeTiles = (hand, tile, n) => {
    for (let i = 0; i < n; i++) hand.splice(hand.indexOf(tile), 1);
  };
  const sortHand = hand => hand.sort((a, b) => a - b);

  function chiOptions(c, t) {
    const out = [];
    if (t >= 27) return out;
    const r = t % 9;
    if (r >= 2 && c[t - 2] && c[t - 1]) out.push([t - 2, t - 1]);
    if (r >= 1 && r <= 7 && c[t - 1] && c[t + 1]) out.push([t - 1, t + 1]);
    if (r <= 6 && c[t + 1] && c[t + 2]) out.push([t + 1, t + 2]);
    return out;
  }

  class Game {
    constructor(o) {
      this.agents = o.agents;
      this.ui = o.ui || null;
      this.rounds = o.rounds || 1;
      this.base = o.base || 100;
      this.taiValue = o.taiValue || 20;
      this.rng = o.rng || Math.random;
      this.players = o.names.map(name => ({
        name, score: 0, hand: [], melds: [], flowers: [], discards: [], passedHu: false,
      }));
      this.firstDealer = Math.floor(this.rng() * 4);
      this.dealerChanges = 0;
      this.streak = 0;
      this.wall = [];
      this.turn = -1;
      this.drawn = null;
      this.lastDiscard = null;
    }

    get dealer() { return (this.firstDealer + this.dealerChanges) % 4; }
    get roundWind() { return Math.floor(this.dealerChanges / 4) % 4; }
    get over() { return this.dealerChanges >= this.rounds * 4; }
    seatWind(p) { return (p - this.dealer + 4) % 4; }
    live() { return this.wall.length - RESERVE; }

    emit(type, data) { return this.ui ? this.ui.emit(type, data) : null; }

    // 從牌尾補牌（補花、槓後），牌摸完回傳 null
    async drawReplacement(pid) {
      const p = this.players[pid];
      for (;;) {
        if (this.live() <= 0) return null;
        const t = this.wall.pop();
        if (!MJ.isFlower(t)) return t;
        p.flowers.push(t);
        await this.emit('flower', { pid, text: '補花' });
      }
    }

    async playHand() {
      const P = this.players, dealer = this.dealer;
      for (const p of P) { p.hand = []; p.melds = []; p.flowers = []; p.discards = []; p.passedHu = false; }
      this.wall = MJ.buildWall(this.rng);
      this.taken = 0; // 從牌頭摸走的張數（畫面用來定位牌牆）
      this.lastDiscard = null;
      this.drawn = null;
      for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) {
        P[(dealer + i) % 4].hand.push(...this.wall.splice(0, 4));
        this.taken += 4;
      }
      P[dealer].hand.push(this.wall.shift());
      this.taken++;
      for (let i = 0; i < 4; i++) {
        const p = P[(dealer + i) % 4];
        for (let j = 0; j < p.hand.length;) {
          if (MJ.isFlower(p.hand[j])) { p.flowers.push(p.hand[j]); p.hand[j] = this.wall.pop(); }
          else j++;
        }
        sortHand(p.hand);
      }
      this.turn = dealer;
      await this.emit('deal', {});

      let turn = dealer, needDraw = false, afterClaim = false, kongDraw = false;
      let noCalls = true;
      const turnsTaken = [0, 0, 0, 0];
      let drawnTile = P[dealer].hand[P[dealer].hand.length - 1];

      for (;;) {
        const p = P[turn];
        this.turn = turn;
        if (needDraw) {
          if (this.live() <= 0) return this.finishDraw();
          let t = this.wall.shift();
          this.taken++;
          kongDraw = false;
          p.passedHu = false;
          if (MJ.isFlower(t)) {
            p.flowers.push(t);
            await this.emit('flower', { pid: turn, text: '補花' });
            t = await this.drawReplacement(turn);
            if (t === null) return this.finishDraw();
            kongDraw = true;
          }
          p.hand.push(t);
          drawnTile = this.drawn = t;
          await this.emit('draw', { pid: turn });
        }

        // 自己的回合：胡、槓，直到打出一張
        let discard;
        for (;;) {
          const o = {};
          if (!afterClaim) {
            const c = MJ.toCounts(p.hand);
            if (MJ.canWin(c, 5 - p.melds.length)) o.hu = true;
            if (this.live() > 0) {
              const an = [], addk = [];
              for (let k = 0; k < 34; k++) if (c[k] === 4) an.push(k);
              for (const m of p.melds) if (m.type === 'pong' && c[m.tile]) addk.push(m.tile);
              if (an.length) o.ankong = an;
              if (addk.length) o.addkong = addk;
            }
          }
          const act = await this.agents[turn].turn(this, turn, o);
          if (act.type === 'hu' && o.hu) {
            const first = noCalls && turnsTaken[turn] === 0;
            await this.emit('call', { pid: turn, text: '自摸' });
            return this.win(turn, null, drawnTile, {
              kong: kongDraw,
              last: this.live() <= 0,
              heaven: first && turn === dealer,
              earth: first && turn !== dealer,
            });
          }
          if (act.type === 'ankong' || act.type === 'addkong') {
            const k = act.tile;
            noCalls = false;
            if (act.type === 'ankong') {
              removeTiles(p.hand, k, 4);
              p.melds.push({ type: 'ankong', tile: k });
              sortHand(p.hand);
              this.drawn = null;
              await this.emit('call', { pid: turn, text: '暗槓' });
            } else {
              removeTiles(p.hand, k, 1);
              p.melds.find(m => m.type === 'pong' && m.tile === k).type = 'kong';
              sortHand(p.hand);
              this.drawn = null;
              await this.emit('call', { pid: turn, text: '加槓' });
              const robber = await this.askRob(turn, k);
              if (robber >= 0) {
                // 被搶的那張不算槓成，還原成碰
                p.melds.find(m => m.type === 'kong' && m.tile === k).type = 'pong';
                await this.emit('call', { pid: robber, text: '搶槓胡' });
                return this.win(robber, turn, k, { rob: true });
              }
            }
            const t = await this.drawReplacement(turn);
            if (t === null) return this.finishDraw();
            p.hand.push(t);
            drawnTile = this.drawn = t;
            kongDraw = true;
            await this.emit('draw', { pid: turn });
            continue;
          }
          discard = act.tile;
          break;
        }

        afterClaim = false;
        removeTiles(p.hand, discard, 1);
        sortHand(p.hand);
        p.discards.push(discard);
        this.drawn = null;
        turnsTaken[turn]++;
        this.lastDiscard = { tile: discard, from: turn };
        await this.emit('discard', { pid: turn });

        const isLast = this.live() <= 0;
        const claim = await this.askClaims(turn, discard, isLast);
        if (claim) {
          const q = claim.q, pl = P[q], d = claim.d;
          if (d.type === 'hu') {
            await this.emit('call', { pid: q, text: '胡' });
            return this.win(q, turn, discard, { last: isLast });
          }
          p.discards.pop();
          noCalls = false;
          if (d.type === 'chi') {
            removeTiles(pl.hand, d.pair[0], 1);
            removeTiles(pl.hand, d.pair[1], 1);
            pl.melds.push({ type: 'chi', tile: Math.min(discard, d.pair[0]), called: discard });
          } else {
            const n = d.type === 'kong' ? 3 : 2;
            removeTiles(pl.hand, discard, n);
            pl.melds.push({ type: d.type, tile: discard });
          }
          turn = this.turn = q;
          needDraw = false;
          await this.emit('call', { pid: q, text: { chi: '吃', pong: '碰', kong: '槓' }[d.type] });
          if (d.type === 'kong') {
            const t = await this.drawReplacement(q);
            if (t === null) return this.finishDraw();
            pl.hand.push(t);
            drawnTile = this.drawn = t;
            kongDraw = true;
            pl.passedHu = false;
            await this.emit('draw', { pid: q });
          } else {
            afterClaim = true;
          }
          continue;
        }
        if (isLast) return this.finishDraw();
        turn = (turn + 1) % 4;
        needDraw = true;
      }
    }

    // 加槓時問其他三家要不要搶槓
    async askRob(from, tile) {
      for (let i = 1; i <= 3; i++) {
        const q = (from + i) % 4, pl = this.players[q];
        if (pl.passedHu) continue;
        const c = MJ.toCounts(pl.hand);
        c[tile]++;
        if (!MJ.canWin(c, 5 - pl.melds.length)) continue;
        const d = await this.agents[q].claim(this, q, { hu: true }, tile, from);
        if (d.type === 'hu') return q;
        pl.passedHu = true;
      }
      return -1;
    }

    // 胡 > 碰/槓 > 吃；多家可胡時由下家優先（攔胡）
    async askClaims(from, tile, isLast) {
      const cands = [];
      for (let i = 1; i <= 3; i++) {
        const q = (from + i) % 4, pl = this.players[q], c = MJ.toCounts(pl.hand), o = {};
        if (!pl.passedHu) {
          c[tile]++;
          if (MJ.canWin(c, 5 - pl.melds.length)) o.hu = true;
          c[tile]--;
        }
        if (!isLast) {
          if (c[tile] >= 2) o.pong = true;
          if (c[tile] >= 3) o.kong = true;
          if (i === 1) {
            const ch = chiOptions(c, tile);
            if (ch.length) o.chi = ch;
          }
        }
        if (o.hu || o.pong || o.kong || o.chi) cands.push({ q, o, order: i });
      }
      const rank = d => (d.type === 'hu' ? 3 : d.type === 'pong' || d.type === 'kong' ? 2 : d.type === 'chi' ? 1 : 0);
      let best = null;
      const consider = (cand, d) => {
        if (cand.o.hu && d.type !== 'hu') this.players[cand.q].passedHu = true;
        const r = rank(d);
        if (r > 0 && (!best || r > best.r || (r === best.r && cand.order < best.order))) {
          best = { r, order: cand.order, q: cand.q, d };
        }
      };
      // 先問電腦，再只拿還搶得到的選項問真人
      for (const cand of cands) {
        if (this.agents[cand.q].isHuman) continue;
        consider(cand, await this.agents[cand.q].claim(this, cand.q, cand.o, tile, from));
      }
      for (const cand of cands) {
        if (!this.agents[cand.q].isHuman) continue;
        const o = {}, br = best ? best.r : 0;
        if (cand.o.hu && !(br === 3 && best.order < cand.order)) o.hu = true;
        if (br < 3) { if (cand.o.pong) o.pong = true; if (cand.o.kong) o.kong = true; }
        if (br < 2 && cand.o.chi) o.chi = cand.o.chi;
        if (!(o.hu || o.pong || o.kong || o.chi)) continue;
        consider({ q: cand.q, o, order: cand.order }, await this.agents[cand.q].claim(this, cand.q, o, tile, from));
      }
      return best;
    }

    finishDraw() {
      return { type: 'draw', deltas: [0, 0, 0, 0] };
    }

    win(w, from, tile, flags) {
      const p = this.players[w], zimo = from === null;
      const counts = MJ.toCounts(zimo ? p.hand : p.hand.concat(tile));
      const need = 5 - p.melds.length;
      counts[tile]--;
      const waits = MJ.waits(counts, need).length;
      counts[tile]++;
      const sc = MJ.score({
        counts, melds: p.melds, flowers: p.flowers, winTile: tile, zimo,
        seatWind: this.seatWind(w), roundWind: this.roundWind, waits, flags,
      });
      // 莊家台：莊家胡或莊家付錢時加 1 台，連 N 拉 N 再加 2N 台
      const d = this.dealer, n = this.streak, dTai = 2 * n + 1;
      const items = sc.items.slice();
      const dealerAll = w === d || from === d;
      if (dealerAll) {
        items.push({ name: '莊家', tai: 1 });
        if (n) items.push({ name: `連${n}拉${n}`, tai: 2 * n });
      }
      const deltas = [0, 0, 0, 0];
      const payers = zimo ? [0, 1, 2, 3].filter(x => x !== w) : [from];
      for (const x of payers) {
        const tai = sc.total + (w === d || x === d ? dTai : 0);
        const amt = this.base + tai * this.taiValue;
        deltas[x] -= amt;
        deltas[w] += amt;
      }
      deltas.forEach((v, i) => { this.players[i].score += v; });
      return {
        type: 'win', winner: w, from, zimo, tile, items,
        tai: sc.total + (dealerAll ? dTai : 0),
        dealerExtra: !dealerAll && zimo ? dTai : 0,
        deltas,
      };
    }

    // 莊家胡牌或流局則連莊，否則下家接莊
    advance(result) {
      if (result.type === 'draw' || result.winner === this.dealer) this.streak++;
      else { this.streak = 0; this.dealerChanges++; }
    }
  }

  MJ.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
