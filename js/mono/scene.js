// three.js 大富翁桌：跟麻將同一個房間、同一盞吊燈，桌上換成一張台灣環島的棋盤
(function () {
  'use strict';
  const MONO = window.MONO, T = window.THREE, C = window.CANNON;
  const SQ = MONO.SQUARES;
  const S = MONO.scene = { muted: false, reduced: false, idle: true, hoverable: true };

  // 棋盤：半寬 50，四角 14 見方，每邊 9 格各寬 8
  const B = 50, CORNER = 14, CELL = 8, TOP = 1.2, TABLE = 70;
  const KAI = '"DFKai-SB", "BiauKai", "KaiTi", "Kaiti TC", "Noto Serif TC", serif';
  const SANS = '"Microsoft JhengHei UI", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  MONO.COLORS = ['#e2483d', '#3f8cff', '#f2b632', '#36b37e'];   // 四家的棋子
  const rnd = (a, b) => a + Math.random() * (b - a);
  const smooth = k => k * k * (3 - 2 * k);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 第 i 格的中心與朝向：side 0 下、1 左、2 上、3 右；格子裡的「上」朝棋盤中央
  function cell(i) {
    const side = Math.floor(i / 10), k = i % 10, mid = B - CORNER / 2;
    let x, z;
    if (k === 0) [x, z] = [[mid, mid], [-mid, mid], [-mid, -mid], [mid, -mid]][side];
    else {
      const t = B - CORNER - (k - 1) * CELL - CELL / 2;
      [x, z] = [[t, mid], [-mid, t], [-t, -mid], [mid, -t]][side];
    }
    return { x, z, side, a: side * Math.PI / 2, corner: k === 0 };
  }
  // 格子裡的局部座標（x 向右、y 朝外）換成桌面座標
  function at(i, lx, ly) {
    const c = cell(i), cs = Math.cos(c.a), sn = Math.sin(c.a);
    return { x: c.x + lx * cs - ly * sn, z: c.z + lx * sn + ly * cs };
  }
  S.cell = cell;

  let renderer, scene, camera, world;
  const pawns = [], dice = [], houses = SQ.map(() => []), tabs = [], tweens = [];
  const cam = { yaw: 0, yawTo: 0, zoom: 1, zoomTo: 1, fit: 1, tx: 0, tz: 6, fx: 0, fz: 6 };
  const raycaster = new T.Raycaster(), mouse = new T.Vector2();
  let boardMesh, hoverMesh, ringMesh, decks = {}, flyCard, state = null, hover = -1;
  let houseGeo, roofGeo, hotelGeo, hotelRoofGeo, houseMat, hotelMat;

  // ---- 貼圖 ----
  function noisePattern(ctx, size, lo, hi) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d'), img = x.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = rnd(lo, hi);
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  }

  // 文字塞進寬度 w：太長就分兩行
  function label(ctx, text, y, w, size, font) {
    ctx.font = `700 ${size}px ${font || KAI}`;
    if (ctx.measureText(text).width <= w || text.length < 4) {
      ctx.fillText(text, 0, y, w);
      return;
    }
    const h = Math.ceil(text.length / 2);
    ctx.fillText(text.slice(0, h), 0, y - size * 0.55, w);
    ctx.fillText(text.slice(h), 0, y + size * 0.55, w);
  }

  // 整張棋盤一張貼圖：象牙底、色帶、地名、價錢，中間是玉綠色的「台灣大富翁」
  function boardTexture() {
    const N = 3072, U = N / (B * 2);
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f3ecd8';
    ctx.fillRect(0, 0, N, N);

    // 中央：玉綠絨面、金色雙框
    const inner = (B - CORNER) * 2 * U, o = CORNER * U;
    const g = ctx.createRadialGradient(N / 2, N / 2, N * 0.05, N / 2, N / 2, inner * 0.75);
    g.addColorStop(0, '#2f7f68'); g.addColorStop(1, '#1d5a49');
    ctx.fillStyle = g;
    ctx.fillRect(o, o, inner, inner);
    ctx.strokeStyle = 'rgba(227, 178, 60, 0.75)';
    ctx.lineWidth = 0.35 * U; ctx.strokeRect(o + 1.6 * U, o + 1.6 * U, inner - 3.2 * U, inner - 3.2 * U);
    ctx.lineWidth = 0.12 * U; ctx.strokeRect(o + 2.4 * U, o + 2.4 * U, inner - 4.8 * U, inner - 4.8 * U);

    ctx.save();
    ctx.translate(N / 2, N / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 機會、命運的牌堆位置
    for (const [deck, x, y, col, text] of [['chance', -15, -15, '#ef8a2c', '機會'], ['chest', 15, 15, '#3f6fc4', '命運']]) {
      ctx.save();
      ctx.translate(x * U, y * U);
      ctx.rotate(-Math.PI / 4);
      ctx.strokeStyle = col; ctx.lineWidth = 0.3 * U; ctx.setLineDash([0.8 * U, 0.5 * U]);
      ctx.strokeRect(-7 * U, -4.5 * U, 14 * U, 9 * U);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(243, 236, 216, 0.5)';
      ctx.font = `700 ${1.4 * U}px ${KAI}`;
      ctx.fillText(text, 0, 6.2 * U);
      ctx.restore();
      void deck;
    }
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.font = `700 ${7.5 * U}px ${KAI}`;
    ctx.fillText('台灣大富翁', 0.35 * U, 0.45 * U);
    const gold = ctx.createLinearGradient(0, -4 * U, 0, 4 * U);
    gold.addColorStop(0, '#ffe7a3'); gold.addColorStop(0.5, '#e3b23c'); gold.addColorStop(1, '#a87a1c');
    ctx.fillStyle = gold;
    ctx.fillText('台灣大富翁', 0, 0);
    ctx.font = `400 ${1.5 * U}px ${SANS}`;
    ctx.fillStyle = 'rgba(243, 236, 216, 0.7)';
    ctx.fillText('環 島 一 圈 ・ 起 點 領 兩 千', 0, 6 * U);
    ctx.restore();

    // 外框與格線
    ctx.strokeStyle = '#2b2a26';
    ctx.lineWidth = 0.18 * U;
    ctx.strokeRect(0.09 * U, 0.09 * U, N - 0.18 * U, N - 0.18 * U);
    ctx.strokeRect(o, o, inner, inner);

    SQ.forEach((s, i) => {
      const cl = cell(i);
      ctx.save();
      ctx.translate((cl.x + B) * U, (cl.z + B) * U);
      ctx.rotate(cl.a);
      ctx.scale(U, U);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1d2a2c';
      if (cl.corner) drawCorner(ctx, s);
      else drawEdge(ctx, s);
      ctx.restore();
    });

    // 紙質：細顆粒
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = noisePattern(ctx, 256, 150, 255);
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const tex = new T.CanvasTexture(c);
    tex.anisotropy = 8;
    return tex;
  }

  // 一般格子：寬 8、深 14，y = -7 是靠棋盤中央那一邊
  function drawEdge(ctx, s) {
    const h = CORNER / 2, w = CELL / 2;
    ctx.strokeStyle = '#2b2a26'; ctx.lineWidth = 0.12;
    ctx.strokeRect(-w, -h, CELL, CORNER);
    const price = n => {
      ctx.font = `400 1.45px ${SANS}`;
      ctx.fillText(MONO.money(n), 0, 5.3, 7.4);
    };
    const icon = (ch, y, size) => { ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`; ctx.fillText(ch, 0, y); };
    if (s.type === 'prop') {
      ctx.fillStyle = MONO.GROUPS[s.group].color;
      ctx.fillRect(-w, -h, CELL, 3.4);
      ctx.strokeRect(-w, -h, CELL, 3.4);
      ctx.fillStyle = '#1d2a2c';
      label(ctx, s.name, 0.6, 7.4, 1.9);
      price(s.price);
    } else if (s.type === 'rail') {
      label(ctx, s.name, -4.4, 7.4, 1.75);
      icon('🚆', 0.9, 4.6);
      price(s.price);
    } else if (s.type === 'util') {
      label(ctx, s.name, -4.4, 7.4, 1.75);
      icon(s.i === 12 ? '💡' : '🚰', 0.9, 4.6);
      price(s.price);
    } else if (s.type === 'chance') {
      ctx.fillStyle = '#ef8a2c';
      ctx.font = `700 7px ${KAI}`;
      ctx.fillText('?', 0, 0.6);
      ctx.fillStyle = '#1d2a2c';
      label(ctx, '機會', -4.6, 7.2, 1.9);
    } else if (s.type === 'chest') {
      ctx.fillStyle = '#3f6fc4';
      ctx.beginPath(); ctx.roundRect(-2.4, -1.8, 4.8, 4.8, 0.6); ctx.fill();
      ctx.fillStyle = '#f3ecd8';
      ctx.font = `700 3.4px ${KAI}`;
      ctx.fillText('命', 0, 0.7);
      ctx.fillStyle = '#1d2a2c';
      label(ctx, '命運', -4.6, 7.2, 1.9);
    } else if (s.type === 'tax') {
      label(ctx, s.name, -4.4, 7.4, 1.9);
      ctx.fillStyle = '#c0352b';
      ctx.font = `700 4px ${KAI}`;
      ctx.fillText('稅', 0, 0.6);
      ctx.fillStyle = '#1d2a2c';
      ctx.font = `400 1.45px ${SANS}`;
      ctx.fillText('付 ' + MONO.money(s.amt), 0, 5.4);
    }
  }

  function drawCorner(ctx, s) {
    const h = CORNER / 2;
    ctx.strokeStyle = '#2b2a26'; ctx.lineWidth = 0.12;
    ctx.strokeRect(-h, -h, CORNER, CORNER);
    ctx.save();
    if (s.type === 'jail') {
      // 左上那塊（靠棋盤中央）是牢房，外面右邊、下面兩條是「探監」
      ctx.fillStyle = '#ef8a2c';
      ctx.fillRect(-h, -h, 10, 10);
      ctx.strokeRect(-h, -h, 10, 10);
      ctx.strokeStyle = '#1d2a2c'; ctx.lineWidth = 0.3;
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(-h + k * 2, -h + 0.8); ctx.lineTo(-h + k * 2, -h + 9.2); ctx.stroke(); }
      ctx.save(); ctx.translate(-2, -2); ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#f3ecd8'; ctx.fillRect(-3.3, -1.4, 6.6, 2.8);
      ctx.fillStyle = '#1d2a2c'; ctx.font = `700 2.2px ${KAI}`; ctx.fillText('監獄', 0, 0.1);
      ctx.restore();
      ctx.fillStyle = '#1d2a2c';
      ctx.font = `700 1.6px ${KAI}`;
      ctx.fillText('探　監', -2, h - 2);
      ctx.save(); ctx.translate(h - 2, -2); ctx.rotate(-Math.PI / 2); ctx.fillText('探　監', 0, 0); ctx.restore();
      ctx.restore();
      return;
    }
    if (s.type === 'go') {
      ctx.font = `700 4px ${KAI}`;
      ctx.fillStyle = '#c0352b';
      ctx.fillText('起點', 0, -2);
      ctx.fillStyle = '#1d2a2c';
      ctx.font = `400 1.3px ${SANS}`;
      ctx.fillText('經過領 ' + MONO.money(MONO.SALARY), 0, 1.4);
      // 往左（前進方向）的大箭頭
      ctx.fillStyle = '#c0352b';
      ctx.beginPath();
      ctx.moveTo(-6, 4.4); ctx.lineTo(-3.2, 2.8); ctx.lineTo(-3.2, 3.8); ctx.lineTo(5.5, 3.8); ctx.lineTo(5.5, 5); ctx.lineTo(-3.2, 5); ctx.lineTo(-3.2, 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.rotate(Math.PI / 4);
    if (s.type === 'park') {
      ctx.font = '4.5px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.fillText('🏮', 0, -1);
      ctx.font = `700 2.2px ${KAI}`;
      ctx.fillText(s.name, 0, 3.4);
    } else {
      ctx.font = '4.5px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.fillText('👮', 0, -1);
      ctx.font = `700 2.2px ${KAI}`;
      ctx.fillStyle = '#c0352b';
      ctx.fillText(s.name, 0, 3.4);
    }
    ctx.restore();
  }

  function feltTexture() {
    const N = 1024, c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(N / 2, N / 2, N * 0.1, N / 2, N / 2, N * 0.72);
    g.addColorStop(0, '#2b6e64'); g.addColorStop(1, '#173f3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = noisePattern(ctx, 256, 70, 185);
    ctx.fillRect(0, 0, N, N);
    return new T.CanvasTexture(c);
  }

  function woodTexture() {
    const w = 1024, h = 128, c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#7a4f2c'); base.addColorStop(0.5, '#6a4224'); base.addColorStop(1, '#55331b');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const y0 = rnd(0, h), amp = rnd(0.5, 4), f = rnd(0.002, 0.012), ph = rnd(0, 6.28);
      ctx.strokeStyle = Math.random() < 0.6 ? `rgba(40, 20, 8, ${rnd(0.08, 0.3)})` : `rgba(190, 140, 90, ${rnd(0.05, 0.18)})`;
      ctx.lineWidth = rnd(0.5, 2.2);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y0 + Math.sin(x * f + ph) * amp);
      ctx.stroke();
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }

  function pipTexture(v) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f7f2e4';
    ctx.fillRect(0, 0, 128, 128);
    const spots = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
      5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] }[v];
    ctx.fillStyle = v === 1 || v === 4 ? '#c0352b' : '#1d2a2c';
    for (const [x, y] of spots) {
      ctx.beginPath();
      ctx.arc(30 + x * 34, 30 + y * 34, v === 1 ? 22 : 12, 0, Math.PI * 2);
      ctx.fill();
    }
    return new T.CanvasTexture(c);
  }
  // BoxGeometry 六面依序是 +x -x +y -y +z -z
  const DIE_FACES = [3, 4, 1, 6, 2, 5];
  const DIE_AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(a => new T.Vector3(...a));

  function deckTexture(text, color) {
    const c = document.createElement('canvas');
    c.width = 384; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, 384, 256);
    ctx.strokeStyle = 'rgba(255, 245, 220, 0.8)'; ctx.lineWidth = 8; ctx.strokeRect(14, 14, 356, 228);
    ctx.fillStyle = '#fff6df'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 110px ${KAI}`;
    ctx.fillText(text, 192, 134);
    return new T.CanvasTexture(c);
  }

  function environment() {
    const env = new T.Scene();
    env.add(new T.Mesh(new T.SphereGeometry(60, 16, 8), new T.MeshBasicMaterial({ color: 0x16201e, side: T.BackSide })));
    const lamp = (x, y, z, w, h, color) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color, side: T.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    lamp(0, 45, 0, 46, 46, 0xffffff);
    lamp(-40, 22, 28, 22, 34, 0xfff0d0);
    lamp(40, 16, -24, 18, 26, 0xcfe6ff);
    return new T.PMREMGenerator(renderer).fromScene(env, 0.04).texture;
  }

  // ---- 房間：跟麻將桌同一間 ----
  function buildRoom(wood) {
    const FLOOR = -70;
    const pc = document.createElement('canvas');
    pc.width = pc.height = 512;
    const px = pc.getContext('2d');
    px.fillStyle = '#4a321f'; px.fillRect(0, 0, 512, 512);
    for (let col = 0; col < 8; col++) {
      let y = -rnd(0, 200);
      while (y < 512) {
        const len = rnd(140, 300), shade = rnd(-18, 18);
        px.fillStyle = `rgb(${74 + shade},${50 + shade * 0.7},${31 + shade * 0.5})`;
        px.fillRect(col * 64 + 1, y + 1, 62, len - 2);
        y += len;
      }
    }
    const planks = new T.CanvasTexture(pc);
    planks.wrapS = planks.wrapT = T.RepeatWrapping;
    planks.repeat.set(7, 7);
    const floor = new T.Mesh(new T.PlaneGeometry(900, 900), new T.MeshStandardMaterial({ map: planks, roughness: 0.6, envMapIntensity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR;
    scene.add(floor);
    const rc = document.createElement('canvas');
    rc.width = rc.height = 512;
    const rx = rc.getContext('2d');
    rx.fillStyle = '#5b1f1c'; rx.fillRect(0, 0, 512, 512);
    rx.strokeStyle = '#b08a4a'; rx.lineWidth = 6; rx.strokeRect(22, 22, 468, 468);
    rx.lineWidth = 2; rx.strokeRect(40, 40, 432, 432);
    const rug = new T.Mesh(new T.PlaneGeometry(280, 280), new T.MeshStandardMaterial({ map: new T.CanvasTexture(rc), roughness: 1, envMapIntensity: 0.15 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = FLOOR + 0.2;
    scene.add(rug);
    const dark = new T.MeshStandardMaterial({ color: 0x3a2413, roughness: 0.55, envMapIntensity: 0.4 });
    const apron = new T.Mesh(new T.BoxGeometry(TABLE * 2 + 7, 7, TABLE * 2 + 7), dark);
    apron.position.y = -4.4;
    scene.add(apron);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new T.Mesh(new T.BoxGeometry(6, 63, 6), dark);
      leg.position.set(sx * (TABLE - 3), FLOOR + 31.5, sz * (TABLE - 3));
      scene.add(leg);
    }
    for (let i = 0; i < 4; i++) {
      const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), i * Math.PI / 2);
      const rim = new T.Mesh(new T.BoxGeometry(TABLE * 2 + 8, 3, 4), wood);
      rim.position.copy(new T.Vector3(0, 0.6, TABLE + 2).applyQuaternion(q));
      rim.quaternion.copy(q);
      rim.castShadow = rim.receiveShadow = true;
      scene.add(rim);
    }
    const lamp = new T.SpotLight(0xffdfae, 0.55, 520, 0.72, 0.9, 1);
    lamp.position.set(0, 190, 0);
    scene.add(lamp, lamp.target);
    scene.fog = new T.Fog(0x0b1413, 220, 560);
  }

  // ---- 棋子：一顆一顆車床車出來的亮漆棋子 ----
  function makePawn(color) {
    const pts = [[0, 0], [1.75, 0], [1.75, 0.35], [1.45, 0.6], [0.95, 0.9], [0.7, 2.1], [1.15, 2.45], [1.1, 2.7], [0.55, 2.95], [0, 2.95]]
      .map(([r, y]) => new T.Vector2(r, y));
    const mat = new T.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.9 });
    const g = new T.Group();
    const body = new T.Mesh(new T.LatheGeometry(pts, 28), mat);
    const head = new T.Mesh(new T.SphereGeometry(1.05, 24, 16), mat);
    head.position.y = 3.75;
    body.castShadow = head.castShadow = true;
    g.add(body, head);
    g.scale.setScalar(1.15);
    scene.add(g);
    return g;
  }
  // 棋子在格子裡的站位：四家各佔一角，監獄分牢裡、牢外
  function spot(pid, i, jailed) {
    const lay = [[-1.9, 1.3], [1.9, 1.3], [-1.9, 4.5], [1.9, 4.5]][pid], c = cell(i);
    if (i === MONO.JAIL) {
      // 牢房在 (-41, 41) 一帶；探監的人站在外側左邊、下面兩條
      if (jailed) return new T.Vector3(c.x + 2 + (pid % 2 ? 2.2 : -2.2), TOP, c.z - 2 + (pid > 1 ? 2.2 : -2.2));
      const [x, z] = [[-5, -5], [-5, -1], [-1, 5], [3, 5]][pid];
      return new T.Vector3(c.x + x, TOP, c.z + z);
    }
    if (c.corner) return new T.Vector3(c.x + (pid % 2 ? 2.6 : -2.6), TOP, c.z + (pid > 1 ? 2.6 : -2.6));
    const p = at(i, lay[0], lay[1]);
    return new T.Vector3(p.x, TOP, p.z);
  }

  // ---- 房子與旅館 ----
  function buildHouseKit() {
    houseGeo = new T.BoxGeometry(1.5, 1.2, 1.5).translate(0, 0.6, 0);
    roofGeo = new T.ConeGeometry(1.2, 0.9, 4).rotateY(Math.PI / 4).translate(0, 1.65, 0);
    hotelGeo = new T.BoxGeometry(4.2, 1.6, 1.8).translate(0, 0.8, 0);
    hotelRoofGeo = new T.CylinderGeometry(0.01, 1.4, 0.9, 4, 1).rotateY(Math.PI / 4).scale(2.1, 1, 0.9).translate(0, 2.05, 0);
    houseMat = new T.MeshPhysicalMaterial({ color: 0x2f9a5b, roughness: 0.3, clearcoat: 0.8, envMapIntensity: 0.7 });
    hotelMat = new T.MeshPhysicalMaterial({ color: 0xc0352b, roughness: 0.3, clearcoat: 0.8, envMapIntensity: 0.7 });
  }
  function setHouses(i, n, animate) {
    const list = houses[i];
    if (list.n === n) return;
    for (const m of list) scene.remove(m);
    list.length = 0;
    list.n = n;
    const c = cell(i), q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -c.a);
    const put = (geo, roof, mat, lx) => {
      const g = new T.Group();
      const a = new T.Mesh(geo, mat), b = new T.Mesh(roof, mat);
      a.castShadow = b.castShadow = true;
      g.add(a, b);
      const p = at(i, lx, -5.3);
      g.position.set(p.x, TOP, p.z);
      g.quaternion.copy(q);
      if (animate) { g.scale.setScalar(0.01); tween(g, { scale: 1, dur: 380, delay: 0 }); }
      scene.add(g);
      list.push(g);
    };
    if (n === 5) put(hotelGeo, hotelRoofGeo, hotelMat, 0);
    else for (let k = 0; k < n; k++) put(houseGeo, roofGeo, houseMat, -2.7 + k * 1.8);
  }

  // 地主標籤：價錢那一條換成地主的顏色，抵押中的蓋成灰色斜紋
  function buildTabs() {
    const geo = new T.BoxGeometry(6.6, 0.12, 1.7);
    const stripes = document.createElement('canvas');
    stripes.width = 128; stripes.height = 32;
    const sx = stripes.getContext('2d');
    sx.fillStyle = '#8b8577'; sx.fillRect(0, 0, 128, 32);
    sx.strokeStyle = '#5d584d'; sx.lineWidth = 6;
    for (let x = -32; x < 160; x += 16) { sx.beginPath(); sx.moveTo(x, 32); sx.lineTo(x + 32, 0); sx.stroke(); }
    const mortTex = new T.CanvasTexture(stripes);
    const mats = MONO.COLORS.map(col => new T.MeshPhysicalMaterial({ color: col, roughness: 0.35, clearcoat: 0.6 }));
    const mort = new T.MeshStandardMaterial({ map: mortTex, roughness: 0.8 });
    SQ.forEach((s, i) => {
      if (!MONO.buyable(s)) return;
      const m = new T.Mesh(geo, mats[0]);
      const p = at(i, 0, 5.4), c = cell(i);
      m.position.set(p.x, TOP + 0.07, p.z);
      m.rotation.y = -c.a;
      m.visible = false;
      m.receiveShadow = true;
      m.userData = { mats, mort };
      scene.add(m);
      tabs[i] = m;
    });
  }

  // ---- 簡單補間 ----
  function tween(obj, o) {
    const k = S.reduced ? 0.45 : 1;
    tweens.push({
      obj, t0: performance.now() + (o.delay || 0) * k, dur: o.dur * k,
      p0: obj.position.clone(), p1: o.pos ? o.pos.clone() : null, arc: o.arc || 0,
      s0: obj.scale.x, s1: o.scale, q0: obj.quaternion.clone(), q1: o.quat || null, done: o.done,
    });
  }

  // ---- 骰子：先在看不見的世界裡擲一次，把滾的過程錄下來，
  // 再把骰子轉成「該朝上的點數正好朝上」的樣子重播 ----
  function buildDice() {
    world = new C.World();
    world.gravity.set(0, -260, 0);
    world.allowSleep = true;
    world.defaultContactMaterial.friction = 0.35;
    world.defaultContactMaterial.restitution = 0.35;
    const plane = (axis, angle, x, y, z) => {
      const b = new C.Body({ mass: 0, shape: new C.Plane() });
      b.quaternion.setFromAxisAngle(axis, angle);
      b.position.set(x, y, z);
      world.addBody(b);
    };
    plane(new C.Vec3(1, 0, 0), -Math.PI / 2, 0, TOP, 0);
    const up = new C.Vec3(0, 1, 0), F = 24;
    plane(up, -Math.PI / 2, F, 0, 0);
    plane(up, Math.PI / 2, -F, 0, 0);
    plane(up, Math.PI, 0, 0, F);
    plane(up, 0, 0, 0, -F);
    const geo = new T.BoxGeometry(3, 3, 3);
    const mats = DIE_FACES.map(v => new T.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.3, envMapIntensity: 0.5 }));
    for (let i = 0; i < 2; i++) {
      const m = new T.Mesh(geo, mats);
      m.castShadow = true;
      m.position.set(i ? 3 : -3, TOP + 1.5, 4);
      scene.add(m);
      const body = new C.Body({ mass: 1, shape: new C.Box(new C.Vec3(1.5, 1.5, 1.5)) });
      body.sleepSpeedLimit = 0.6; body.sleepTimeLimit = 0.2;
      world.addBody(body);
      dice.push({ m, body, frames: null, fix: new T.Quaternion(), hits: [] });
    }
  }
  let rolling = null;
  // 從鏡頭這一側往棋盤中央丟；values 是規則那邊已經擲出來的點數
  S.roll = values => {
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    dice.forEach((d, i) => {
      const b = d.body, side = i ? 1 : -1;
      b.position.set(fx * 26 + side * 2.5 * fz, TOP + 7 + i, fz * 26 - side * 2.5 * fx);
      b.quaternion.setFromEuler(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      b.velocity.set(-fx * rnd(55, 70) + rnd(-8, 8), rnd(8, 16), -fz * rnd(55, 70) + rnd(-8, 8));
      b.angularVelocity.set(rnd(-25, 25), rnd(-25, 25), rnd(-25, 25));
      b.wakeUp();
      d.frames = [];
      d.hits = [];
      b.removeEventListener('collide', b._hit);
      b._hit = () => d.hits.push(d.frames.length);
      b.addEventListener('collide', b._hit);
    });
    for (let f = 0; f < 120 * 4; f++) {
      world.step(1 / 120);
      for (const d of dice) {
        const p = d.body.position, q = d.body.quaternion;
        d.frames.push([p.x, p.y, p.z, q.x, q.y, q.z, q.w]);
      }
      if (f > 60 && dice.every(d => d.body.sleepState === 2)) break;
    }
    const q = new T.Quaternion();
    dice.forEach((d, i) => {
      const last = d.frames[d.frames.length - 1];
      q.set(last[3], last[4], last[5], last[6]);
      let top = 0, best = -2;
      DIE_AXES.forEach((a, k) => { const y = a.clone().applyQuaternion(q).y; if (y > best) { best = y; top = k; } });
      const want = DIE_FACES.indexOf(values[i]);
      // 兩個都是座標軸，轉出來的一定是方塊本身的對稱（90 或 180 度），看起來跟物理算的一樣
      d.fix.setFromUnitVectors(DIE_AXES[want], DIE_AXES[top]);
    });
    const frames = dice[0].frames.length;
    return new Promise(resolve => {
      rolling = { t0: performance.now(), frames, done: resolve, played: [0, 0] };
    });
  };

  // ---- 牌堆 ----
  function buildDecks() {
    for (const [deck, x, z, col, text] of [['chance', -15, -15, '#ef8a2c', '機會'], ['chest', 15, 15, '#3f6fc4', '命運']]) {
      const top = new T.MeshStandardMaterial({ map: deckTexture(text, col), roughness: 0.5 });
      const side = new T.MeshStandardMaterial({ color: 0xf3ecd8, roughness: 0.7 });
      const m = new T.Mesh(new T.BoxGeometry(12, 1.6, 8), [side, side, top, side, side, side]);
      m.position.set(x, TOP + 0.8, z);
      m.rotation.y = Math.PI / 4;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      decks[deck] = { m, top };
    }
    flyCard = new T.Mesh(new T.BoxGeometry(12, 0.15, 8), [0, 0, 0, 0, 0, 0].map(() => new T.MeshStandardMaterial({ color: 0xf3ecd8 })));
    flyCard.visible = false;
    flyCard.castShadow = true;
    scene.add(flyCard);
  }
  // 抽一張：從牌堆掀起來飛到鏡頭前
  S.card = deck => {
    const d = decks[deck];
    flyCard.material[2] = d.top;
    flyCard.position.set(d.m.position.x, TOP + 1.8, d.m.position.z);
    flyCard.quaternion.copy(d.m.quaternion);
    flyCard.scale.setScalar(1);
    flyCard.visible = true;
    const toward = new T.Vector3().copy(camera.position).sub(flyCard.position).multiplyScalar(0.45).add(flyCard.position);
    const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(camera.position, toward, new T.Vector3(0, 1, 0)))
      .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2));
    sfx('card');
    return new Promise(done => tween(flyCard, { pos: toward, quat: q, arc: 6, dur: 650, done: () => { flyCard.visible = false; done(); } }));
  };

  // ---- 狀態 → 畫面 ----
  S.setState = (s, fresh) => {
    state = s;
    s.players.forEach((p, i) => {
      const pw = pawns[i];
      pw.visible = !p.out;
      if (pw.userData.busy) return;
      const to = spot(i, p.pos, p.jail > 0);
      if (fresh || !pw.userData.placed) { pw.position.copy(to); pw.userData.placed = true; }
      else if (pw.position.distanceTo(to) > 0.05) tween(pw, { pos: to, dur: 300, arc: 1 });
    });
    for (let i = s.players.length; i < 4; i++) pawns[i].visible = false;
    SQ.forEach((sq, i) => {
      if (!MONO.buyable(sq)) return;
      const t = tabs[i], who = s.owner[i];
      t.visible = who >= 0;
      if (who >= 0) t.material = s.mortgaged[i] ? t.userData.mort : t.userData.mats[who];
      setHouses(i, s.houses[i], !fresh);
    });
    if (fresh) for (const tw of tweens.splice(0)) { if (tw.p1) tw.obj.position.copy(tw.p1); if (tw.s1 != null) tw.obj.scale.setScalar(tw.s1); }
  };

  // 一格一格跳過去；steps 負的是往回走，jump 是直接飛去監獄
  S.move = async (pid, from, steps, jump) => {
    const pw = pawns[pid], n = Math.abs(steps), dir = Math.sign(steps);
    pw.userData.busy = true;
    if (jump) {
      await new Promise(done => tween(pw, { pos: spot(pid, MONO.JAIL, true), arc: 22, dur: 900, done }));
      sfx('jail');
    } else {
      const hop = S.reduced ? 120 : 230;
      for (let k = 1; k <= n; k++) {
        const i = (from + dir * k + 40) % 40;
        await new Promise(done => tween(pw, { pos: spot(pid, i, false), arc: 2.6, dur: hop - 20, done }));
        sfx(i === 0 ? 'go' : 'hop');
        await sleep(20);
      }
    }
    pw.userData.busy = false;
  };

  S.focus = pid => {
    if (!state) return;
    const p = state.players[pid];
    if (!p) return;
    const c = cell(p.pos);
    cam.fx = c.x * 0.25; cam.fz = c.z * 0.25 + 6;
  };
  S.celebrate = pid => {
    const pw = pawns[pid];
    tween(pw, { pos: pw.position.clone(), arc: 8, dur: 700 });
    sfx('win');
  };

  // 螢幕座標：格子上方、棋子頭上（給飄字用）
  function toScreen(v) {
    v.project(camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }
  S.squareScreen = i => { const c = cell(i); return toScreen(new T.Vector3(c.x, TOP + 4, c.z)); };
  S.pawnScreen = pid => { const p = pawns[pid].position; return toScreen(new T.Vector3(p.x, p.y + 7, p.z)); };

  // ---- 音效：全用合成音，跟麻將一樣 sounds/ 放了檔案就換成錄音 ----
  let actx = null;
  S.audio = () => {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  };
  function tone(freq, dur, vol, type, delay = 0) {
    if (!actx || S.muted) return;
    const o = actx.createOscillator(), gain = actx.createGain(), t = actx.currentTime + delay;
    o.type = type || 'sine';
    o.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gain); gain.connect(actx.destination);
    o.start(t); o.stop(t + dur);
  }
  function clack(vol) {
    if (!actx || S.muted) return;
    const len = Math.floor(actx.sampleRate * 0.06), buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = actx.createBufferSource(), bp = actx.createBiquadFilter(), gain = actx.createGain();
    src.buffer = buf;
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.4;
    gain.gain.value = vol;
    src.connect(bp); bp.connect(gain); gain.connect(actx.destination);
    src.start();
  }
  function sfx(name) {
    if (!actx || S.muted) return;
    if (name === 'hop') clack(0.35);
    else if (name === 'dice') clack(0.55);
    else if (name === 'go') [784, 988, 1175].forEach((f, i) => tone(f, 0.25, 0.14, 'triangle', i * 0.07));
    else if (name === 'cash') [1319, 1760].forEach((f, i) => tone(f, 0.22, 0.12, 'triangle', i * 0.06));
    else if (name === 'pay') [660, 440].forEach((f, i) => tone(f, 0.25, 0.12, 'triangle', i * 0.08));
    else if (name === 'buy') [523, 659, 784].forEach((f, i) => tone(f, 0.3, 0.14, 'triangle', i * 0.08));
    else if (name === 'build') { clack(0.6); tone(330, 0.15, 0.12, 'square'); }
    else if (name === 'card') tone(1046, 0.18, 0.08, 'sine');
    else if (name === 'jail') [220, 185, 147].forEach((f, i) => tone(f, 0.35, 0.16, 'sawtooth', i * 0.14));
    else if (name === 'win') [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, 0.16, 'triangle', i * 0.11));
    else if (name === 'bust') [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, 0.14, 'sawtooth', i * 0.16));
    else if (name === 'tick') tone(880, 0.1, 0.12, 'triangle');
  }
  S.sfx = sfx;

  // ---- 初始化 ----
  S.init = canvas => {
    renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    scene.background = new T.Color(0x0b1413);
    scene.environment = environment();
    camera = new T.PerspectiveCamera(40, 1, 1, 700);

    scene.add(new T.HemisphereLight(0xffffff, 0x1c3a36, 0.42));
    const sun = new T.DirectionalLight(0xfff1d8, 0.55);
    sun.position.set(-35, 110, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 6;
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -75; sc.right = sc.top = 75; sc.near = 10; sc.far = 260;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    const felt = new T.Mesh(new T.PlaneGeometry(TABLE * 2, TABLE * 2), new T.MeshStandardMaterial({ map: feltTexture(), roughness: 1, envMapIntensity: 0.25 }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    scene.add(felt);
    const grain = woodTexture();
    const wood = new T.MeshStandardMaterial({ map: grain, bumpMap: grain, bumpScale: 0.06, roughness: 0.5, envMapIntensity: 0.5 });
    buildRoom(wood);

    // 棋盤：厚紙板，上面一張貼圖
    const side = new T.MeshStandardMaterial({ color: 0x24302e, roughness: 0.8 });
    const top = new T.MeshStandardMaterial({ map: boardTexture(), roughness: 0.62, envMapIntensity: 0.3 });
    boardMesh = new T.Mesh(new T.BoxGeometry(B * 2, TOP, B * 2), [side, side, top, side, side, side]);
    boardMesh.position.y = TOP / 2;
    boardMesh.receiveShadow = boardMesh.castShadow = true;
    scene.add(boardMesh);

    hoverMesh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.28, depthWrite: false }));
    hoverMesh.rotation.x = -Math.PI / 2;
    hoverMesh.visible = false;
    scene.add(hoverMesh);
    ringMesh = new T.Mesh(new T.RingGeometry(2.3, 2.9, 40), new T.MeshBasicMaterial({ color: 0xe3b23c, transparent: true, opacity: 0.85, depthWrite: false }));
    ringMesh.rotation.x = -Math.PI / 2;
    scene.add(ringMesh);

    buildHouseKit();
    buildTabs();
    buildDecks();
    buildDice();
    for (let i = 0; i < 4; i++) pawns.push(makePawn(MONO.COLORS[i]));
    pawns.forEach((p, i) => p.position.copy(spot(i, 0, false)));

    // 拖曳轉鏡頭、滾輪縮放；沒怎麼拖就算點了一格
    let drag = null;
    canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, yaw: cam.yawTo, moved: false }; });
    canvas.addEventListener('pointermove', e => {
      if (drag && Math.abs(e.clientX - drag.x) > 6) {
        drag.moved = true;
        cam.yawTo = drag.yaw - (e.clientX - drag.x) / window.innerWidth * Math.PI * 1.4;
        S.idle = false;
      }
      const i = pickSquare(e);
      if (i !== hover) { hover = i; showHover(); }
      canvas.style.cursor = i >= 0 && MONO.buyable(SQ[i]) ? 'pointer' : drag && drag.moved ? 'grabbing' : '';
    });
    canvas.addEventListener('pointerup', e => {
      if (drag && !drag.moved) { const i = pickSquare(e); if (i >= 0 && S.onSquare) S.onSquare(i); }
      drag = null;
    });
    canvas.addEventListener('pointerleave', () => { hover = -1; showHover(); drag = null; });
    canvas.addEventListener('wheel', e => {
      cam.zoomTo = Math.max(0.55, Math.min(1.4, cam.zoomTo * (e.deltaY > 0 ? 1.08 : 0.93)));
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  };
  S.resetView = () => { cam.yawTo = Math.round(cam.yaw / (Math.PI * 2)) * Math.PI * 2; cam.zoomTo = 1; };

  function pickSquare(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObject(boardMesh)[0];
    if (!hit) return -1;
    const { x, z } = hit.point;
    if (Math.abs(x) > B || Math.abs(z) > B || (Math.abs(x) < B - CORNER && Math.abs(z) < B - CORNER)) return -1;
    let best = -1, d = Infinity;
    SQ.forEach((s, i) => {
      const c = cell(i), dd = Math.max(Math.abs(c.x - x), Math.abs(c.z - z)) / (c.corner ? CORNER : CELL);
      if (dd < d) { d = dd; best = i; }
    });
    return best;
  }
  function showHover() {
    hoverMesh.visible = hover >= 0;
    if (hover < 0) return;
    const c = cell(hover);
    hoverMesh.position.set(c.x, TOP + 0.03, c.z);
    hoverMesh.rotation.z = -c.a;
    hoverMesh.scale.set(c.corner ? CORNER : CELL, CORNER, 1);
    if (S.onHover) S.onHover(hover);
  }

  function setCamera(yaw, z) {
    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    camera.position.set(cam.tx + sn * 92 * z, 118 * z, cam.tz + cs * 92 * z);
    camera.lookAt(cam.tx + sn * 4, 0, cam.tz + cs * 4);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // 直的螢幕：退到剛好看得到整張棋盤的寬度
    cam.fit = Math.max(1, 1.05 / camera.aspect);
  }

  let last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    for (let i = tweens.length - 1; i >= 0; i--) {
      const a = tweens[i];
      let k = (now - a.t0) / a.dur;
      if (k < 0) continue;
      if (k >= 1) k = 1;
      const e = smooth(k);
      if (a.p1) { a.obj.position.lerpVectors(a.p0, a.p1, e); a.obj.position.y += a.arc * 4 * k * (1 - k); }
      if (a.s1 != null) a.obj.scale.setScalar(a.s0 + (a.s1 - a.s0) * (k < 1 ? 1 - Math.pow(1 - k, 3) * Math.cos(k * 6) : 1));
      if (a.q1) a.obj.quaternion.slerpQuaternions(a.q0, a.q1, e);
      if (k === 1) { tweens.splice(i, 1); if (a.done) a.done(); }
    }

    // 骰子重播
    if (rolling) {
      // rAF 給的時間可能比擲骰那一刻還早一點點
      const f = Math.max(0, Math.min(rolling.frames - 1, Math.floor((now - rolling.t0) / 1000 * 120 * (S.reduced ? 2.5 : 1.5))));
      dice.forEach((d, i) => {
        const fr = d.frames[f];
        d.m.position.set(fr[0], fr[1], fr[2]);
        d.m.quaternion.set(fr[3], fr[4], fr[5], fr[6]).multiply(d.fix);
        while (rolling.played[i] < d.hits.length && d.hits[rolling.played[i]] <= f) {
          rolling.played[i]++;
          if (i === 0 || rolling.played[i] % 2) sfx('dice');
        }
      });
      if (f >= rolling.frames - 1) { const r = rolling; rolling = null; r.done(); }
    }

    // 輪到的那家腳下一圈金光
    if (state && pawns[state.turn]) {
      const p = pawns[state.turn].position;
      ringMesh.visible = !state.players[state.turn].out;
      ringMesh.position.set(p.x, TOP + 0.05, p.z);
      ringMesh.material.opacity = 0.55 + 0.3 * Math.sin(now / 240);
    } else ringMesh.visible = false;

    // 鏡頭：待機時繞桌慢轉；玩的時候輕輕偏向輪到的那顆棋子
    if (S.idle) { cam.yaw += dt * 0.1; cam.yawTo = cam.yaw; }
    else cam.yaw += (cam.yawTo - cam.yaw) * Math.min(1, dt * 3);
    cam.zoom += (cam.zoomTo - cam.zoom) * Math.min(1, dt * 3);
    const k = Math.min(1, dt * 1.5), fx = S.idle ? 0 : cam.fx, fz = S.idle ? 6 : cam.fz;
    cam.tx += (fx - cam.tx) * k;
    cam.tz += (fz - cam.tz) * k;
    setCamera(cam.yaw, cam.zoom * cam.fit);
    renderer.render(scene, camera);
  }
})();
