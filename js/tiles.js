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
  // 一條：傳統畫的是一隻鳥
  const BIRD =
    `<path d="M25 50 Q11 61 8 73 M28 52 Q19 65 18 76 M31 53 Q28 66 30 77" stroke="${GRN}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    [[8, 73], [18, 76], [30, 77]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.7" fill="${RED}"/>`).join('') +
    `<ellipse cx="32" cy="40" rx="11" ry="15" fill="${GRN}" transform="rotate(20 32 40)"/>` +
    `<ellipse cx="29" cy="42" rx="5.5" ry="10" fill="${BLU}" transform="rotate(24 29 42)"/>` +
    `<circle cx="40" cy="20" r="7.5" fill="${GRN}"/>` +
    `<path d="M47 18 L56 21.5 L47 24 Z" fill="${RED}"/>` +
    `<circle cx="42" cy="18.5" r="2.1" fill="${FACE}"/><circle cx="42.5" cy="18.5" r="1" fill="${INK}"/>` +
    `<path d="M36 13 L33 5 M40 12 L40 3 M44 13 L47 5" stroke="${RED}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M37 54 L39 66 M39 66 L35 69 M39 66 L43 69" stroke="${RED}" stroke-width="2" fill="none" stroke-linecap="round"/>`;

  // 花牌的圖：n 片花瓣繞著 (cx, cy) 排一圈，或只排在給定的角度上
  const petals = (cx, cy, n, dist, rx, ry, fill, angles) =>
    (angles || Array.from({ length: n }, (_, i) => i * 360 / n)).map(a =>
      `<ellipse cx="${cx}" cy="${cy - dist}" rx="${rx}" ry="${ry}" fill="${fill}" transform="rotate(${a} ${cx} ${cy})"/>`).join('');
  const line = (d, color, w) => `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
  const PINK = '#e2708f', BROWN = '#7a4a22';
  const FLOWER_ART = [
    // 春：桃花
    line('M30 78 L30 66 M30 72 Q22 70 19 64 M30 70 Q38 68 41 62', GRN, 2.5) +
      petals(30, 56, 5, 6.5, 4.6, 6, PINK) + '<circle cx="30" cy="56" r="3" fill="#e3b23c"/>',
    // 夏：荷花
    line('M9 71 Q30 80 51 71', GRN, 4) + petals(30, 70, 0, 20, 4.8, 12, PINK, [-56, -28, 0, 28, 56]),
    // 秋：楓葉
    line('M30 64 L30 78', BROWN, 2.5) + petals(30, 64, 0, 10, 3.6, 10.5, '#d9632a', [-76, -38, 0, 38, 76]),
    // 冬：雪花
    [0, 60, 120].map(a => `<g transform="rotate(${a} 30 59)">` + line('M30 45 L30 73 M26 49 L30 53 L34 49 M26 69 L30 65 L34 69', BLU, 2.4) + '</g>').join(''),
    // 梅：枝上幾朵梅花
    line('M9 76 Q25 66 33 54 Q39 46 51 44', BROWN, 3) +
      [[20, 62], [35, 50], [47, 42], [42, 64]].map(([x, y]) =>
        petals(x, y, 5, 3.2, 2.5, 3, RED) + `<circle cx="${x}" cy="${y}" r="1.4" fill="#e3b23c"/>`).join(''),
    // 蘭：長葉與一朵蘭花
    line('M30 78 Q13 62 9 46 M30 78 Q25 58 29 42 M30 78 Q45 64 52 52', GRN, 3.4) +
      petals(40, 46, 3, 4, 3, 5, '#8a5bb5') + '<circle cx="40" cy="46" r="1.6" fill="#e3b23c"/>',
    // 菊：細長花瓣
    line('M30 66 L30 78 M30 73 Q23 72 20 67', GRN, 2.5) +
      petals(30, 56, 12, 7.5, 2.3, 6.5, '#e3a21f') + '<circle cx="30" cy="56" r="3.4" fill="#a8621c"/>',
    // 竹：兩根竹節與竹葉
    [[22, 44, 34], [37, 50, 28]].map(([x, y, h]) =>
      [0, 1, 2].map(i => `<rect x="${x - 2.5}" y="${y + i * h / 3}" width="5" height="${h / 3 - 1.6}" rx="2" fill="${GRN}"/>`).join('')).join('') +
      petals(27, 50, 0, 8, 2, 6.5, GRN, [50, 85]) + petals(42, 56, 0, 8, 2, 6.5, GRN, [40, 80]),
  ];

  const STICKS = [
    [],
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
    else if (t === 18) s = BIRD;
    else if (t < 27) s = STICKS[t - 18].map(stick).join('');
    else if (t < 31) s = txt(30, 57, 46, INK, MJ.tileName(t));
    else if (t === 31) s = txt(30, 57, 46, RED, '中');
    else if (t === 32) s = txt(30, 57, 46, GRN, '發');
    else if (t === 33) s = `<rect x="11" y="13" width="38" height="54" rx="4" fill="none" stroke="${BLU}" stroke-width="4"/>`;
    else {
      const c = t < 38 ? RED : GRN;
      // 上方是字與編號，下方是圖
      s = txt(30, 33, 28, c, MJ.tileName(t)) + txt(t < 38 ? 9 : 51, 15, 13, INK, ((t - 34) % 4) + 1) + FLOWER_ART[t - 34];
    }
    return (cache[t] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80" width="240" height="320" ' +
      `font-family="DFKai-SB, BiauKai, KaiTi, serif" font-weight="700" aria-hidden="true">${s}</svg>`);
  };
  MJ.tileHtml = (t, cls = '') => `<span class="tile ${cls}" title="${MJ.tileName(t)}">${MJ.face(t)}</span>`;
  MJ.backHtml = (cls = '') => `<span class="tile back ${cls}"></span>`;
})();
