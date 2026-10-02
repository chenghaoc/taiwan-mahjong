// 牌面圖案（SVG，viewBox 60x80）：對話框、按鈕直接用，3D 牌面也拿它當貼圖
(function () {
  'use strict';
  const MJ = window.MJ;
  const INK = '#1d2a2c', RED = '#c0352b', GRN = '#1f7a4d', BLU = '#1f4f8f', FACE = '#f6f1e3';
  const NUM = '一二三四五六七八九';
  const txt = (x, y, size, fill, s) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="middle">${s}</text>`;
  const dot = ([x, y, r, c]) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="none" stroke="${FACE}" stroke-width="${r * 0.2}"/>`;
  const stick = ([x, y, h, c]) =>
    `<rect x="${x - 3.5}" y="${y - h / 2}" width="7" height="${h}" rx="3" fill="${c}"/>` +
    `<rect x="${x - 3.5}" y="${y - 1}" width="7" height="2" fill="${FACE}"/>`;
  const grid = (xs, ys, size, color) => {
    const out = [];
    ys.forEach((y, r) => xs.forEach((x, c) => out.push([x, y, size, typeof color === 'function' ? color(r, c) : color])));
    return out;
  };
  const DOTS = [
    [[30, 40, 21, RED]],
    [[30, 21, 13, GRN], [30, 59, 13, BLU]],
    [[15, 17, 10, BLU], [30, 40, 10, RED], [45, 63, 10, GRN]],
    grid([17, 43], [22, 58], 11.5, (r, c) => (r === c ? BLU : GRN)),
    grid([15, 45], [17, 63], 10, (r, c) => (r === c ? BLU : GRN)).concat([[30, 40, 10, RED]]),
    grid([17, 43], [15, 40, 65], 10, r => (r === 0 ? GRN : RED)),
    [[14, 11, 7, GRN], [30, 19, 7, GRN], [46, 27, 7, GRN]].concat(grid([18, 42], [47, 67], 8.5, RED)),
    grid([18, 42], [11, 30, 50, 69], 8.5, BLU),
    grid([12, 30, 48], [15, 40, 65], 8.5, r => [BLU, RED, GRN][r]),
  ];
  const STICKS = [
    [[30, 40, 52, GRN], [30, 40, 16, RED]],
    grid([30], [22, 58], 26, GRN),
    [[30, 22, 26, GRN], [17, 58, 26, GRN], [43, 58, 26, GRN]],
    grid([17, 43], [22, 58], 26, GRN),
    grid([14, 46], [22, 58], 26, GRN).concat([[30, 40, 26, RED]]),
    grid([14, 30, 46], [22, 58], 26, GRN),
    [[30, 14, 18, RED]].concat(grid([14, 30, 46], [39, 64], 20, GRN)),
    grid([10, 23.5, 36.5, 50], [22, 58], 26, GRN),
    grid([14, 30, 46], [14, 40, 66], 21, (r, c) => (c === 1 ? RED : GRN)),
  ];
  const cache = [];
  MJ.face = t => {
    if (cache[t]) return cache[t];
    let s;
    if (t < 9) s = txt(30, 33, 30, INK, NUM[t]) + txt(30, 71, 32, RED, '萬');
    else if (t < 18) s = DOTS[t - 9].map(dot).join('');
    else if (t < 27) s = STICKS[t - 18].map(stick).join('');
    else if (t < 31) s = txt(30, 57, 46, INK, MJ.tileName(t));
    else if (t === 31) s = txt(30, 57, 46, RED, '中');
    else if (t === 32) s = txt(30, 57, 46, GRN, '發');
    else if (t === 33) s = `<rect x="11" y="13" width="38" height="54" rx="4" fill="none" stroke="${BLU}" stroke-width="4"/>`;
    else {
      const c = t < 38 ? RED : GRN;
      s = txt(30, 64, 40, c, MJ.tileName(t)) + txt(t < 38 ? 11 : 49, 18, 16, INK, ((t - 34) % 4) + 1);
    }
    return (cache[t] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80" width="240" height="320" ' +
      `font-family="DFKai-SB, BiauKai, KaiTi, serif" font-weight="700" aria-hidden="true">${s}</svg>`);
  };
  MJ.tileHtml = (t, cls = '') => `<span class="tile ${cls}" title="${MJ.tileName(t)}">${MJ.face(t)}</span>`;
  MJ.backHtml = (cls = '') => `<span class="tile back ${cls}"></span>`;
})();
