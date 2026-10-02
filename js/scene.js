// three.js 牌桌：144 張實體牌，依牌局狀態決定每張的位置，移動時補上動畫
(function () {
  'use strict';
  const MJ = window.MJ, T = window.THREE;
  const S = MJ.scene = { reveal: null, mark: false, pickable: false, selected: -1, muted: false, idle: true };

  // 牌的尺寸與桌面配置（單位：牌寬 3）
  const W = 3, H = 4, D = 1.9, PITCH = 3.12, BEVEL = 0.12;
  const HALF = 52, EDGE = 41, ROW = 44, WALL_Z = 32, POOL_Z = 11.5, POOL_COLS = 7, LEAN = 0.62, MY_SCALE = 1.3;
  const X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0);
  const rotX = a => new T.Quaternion().setFromAxisAngle(X, a);
  const Q_STAND = new T.Quaternion();      // 立著，牌面朝自己
  const Q_LEAN = rotX(-LEAN);              // 我的手牌：往後靠，牌面朝鏡頭
  const Q_UP = rotX(-Math.PI / 2);         // 平躺，牌面朝上
  const Q_DOWN = rotX(Math.PI / 2);        // 平躺，牌背朝上
  const seatQ = [0, 1, 2, 3].map(p => new T.Quaternion().setFromAxisAngle(Y, p * Math.PI / 2));
  // 以座位的角度擺放：x 向右、z 朝玩家自己
  const place = (pid, x, y, z, q) => ({
    pos: new T.Vector3(x, y, z).applyQuaternion(seatQ[pid]),
    quat: seatQ[pid].clone().multiply(q),
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let renderer, scene, camera, game = null;
  const tiles = [], byKind = [];
  const raycaster = new T.Raycaster(), mouse = new T.Vector2();
  let hover = -1, marker, plate, plateCtx, plateTex, sparks, sparkVel = [], sparkLife = 0;
  const rings = [];
  const cam = { yaw: 0, zoom: 1, yawTo: 0, zoomTo: 1, fit: 1 };

  // ---- 建立場景 ----
  function roundedRect(w, h, r) {
    const s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  function faceTexture(kind) {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 320;
    const tex = new T.CanvasTexture(c);
    tex.anisotropy = 8;
    const img = new Image();
    img.onload = () => { c.getContext('2d').drawImage(img, 0, 0, 240, 320); tex.needsUpdate = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(MJ.face(kind));
    return tex;
  }

  function feltTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d'), img = ctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 205 + Math.random() * 50;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(10, 10);
    return tex;
  }

  S.init = canvas => {
    renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    scene.background = new T.Color(0x0c1d1c);
    camera = new T.PerspectiveCamera(40, 1, 1, 500);

    scene.add(new T.HemisphereLight(0xffffff, 0x1c3a36, 0.62));
    const sun = new T.DirectionalLight(0xfff1d8, 0.5);
    sun.position.set(-35, 90, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 10; sc.far = 220;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    // 桌面與木框
    const felt = new T.Mesh(
      new T.PlaneGeometry(HALF * 2, HALF * 2),
      new T.MeshStandardMaterial({ color: 0x236058, roughness: 1, map: feltTexture() }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    scene.add(felt);
    const wood = new T.MeshStandardMaterial({ color: 0x6a4426, roughness: 0.55 });
    for (let i = 0; i < 4; i++) {
      const rim = new T.Mesh(new T.BoxGeometry(HALF * 2 + 8, 3, 4), wood);
      const p = place(i, 0, 0.6, HALF + 2, Q_STAND);
      rim.position.copy(p.pos); rim.quaternion.copy(p.quat);
      rim.castShadow = rim.receiveShadow = true;
      scene.add(rim);
    }

    // 中央牌局資訊
    const pc = document.createElement('canvas');
    pc.width = pc.height = 512;
    plateCtx = pc.getContext('2d');
    plateTex = new T.CanvasTexture(pc);
    plateTex.anisotropy = 8;
    plate = new T.Mesh(new T.PlaneGeometry(20, 20), new T.MeshBasicMaterial({ map: plateTex, transparent: true }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.03;
    scene.add(plate);

    // 牌
    const shape = roundedRect(W - 2 * BEVEL, H - 2 * BEVEL, 0.24);
    const ext = d => new T.ExtrudeGeometry(shape, {
      depth: d, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 2, curveSegments: 4,
    });
    const ivoryGeo = ext(0.9).translate(0, 0, -0.07);   // z: -0.19 ~ 0.95
    const jadeGeo = ext(0.52).translate(0, 0, -0.83);   // z: -0.95 ~ -0.19
    const faceGeo = new T.PlaneGeometry(2.7, 3.6);
    const ivoryMat = new T.MeshStandardMaterial({ color: 0xf3ecd8, roughness: 0.32 });
    const jadeMat = new T.MeshStandardMaterial({ color: 0x2c9a70, roughness: 0.3 });
    for (let kind = 0; kind < 42; kind++) {
      byKind[kind] = [];
      const faceMat = new T.MeshStandardMaterial({
        map: faceTexture(kind), transparent: true, depthWrite: false, roughness: 0.4,
      });
      for (let n = kind < 34 ? 4 : 1; n > 0; n--) {
        const g = new T.Group();
        const a = new T.Mesh(ivoryGeo, ivoryMat), b = new T.Mesh(jadeGeo, jadeMat), f = new T.Mesh(faceGeo, faceMat);
        f.position.z = D / 2 + 0.008;
        a.castShadow = b.castShadow = a.receiveShadow = b.receiveShadow = true;
        g.add(a, b, f);
        scene.add(g);
        const t = { g, kind, pos: new T.Vector3(), quat: new T.Quaternion(), zone: 'wall', owner: -1, idx: -1, ring: 0, scale: 1, tw: null, bounce: 0 };
        g.userData.tile = t;
        tiles.push(t);
        byKind[kind].push(t);
      }
    }
    // 開場：整圈牌牆
    shuffled(tiles).forEach((t, i) => {
      const p = wallPlace(i, i % 2 === 0);
      t.pos.copy(p.pos); t.quat.copy(p.quat); t.ring = i;
      t.g.position.copy(p.pos); t.g.quaternion.copy(p.quat);
    });

    // 最後一張打出的牌上方的標記
    marker = new T.Mesh(
      new T.OctahedronGeometry(0.9),
      new T.MeshStandardMaterial({ color: 0xe3b23c, emissive: 0x7a5a10, roughness: 0.25, metalness: 0.4 }));
    marker.scale.set(1, 1.5, 1);
    marker.visible = false;
    scene.add(marker);

    // 落牌時的光圈
    for (let i = 0; i < 6; i++) {
      const r = new T.Mesh(
        new T.RingGeometry(1.9, 2.3, 40),
        new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.userData.t0 = -1;
      scene.add(r);
      rings.push(r);
    }

    // 胡牌的金粉
    const N = 220, geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3));
    sparks = new T.Points(geo, new T.PointsMaterial({ color: 0xffd766, size: 0.7, transparent: true, depthWrite: false }));
    sparks.visible = false;
    sparks.frustumCulled = false;
    scene.add(sparks);
    for (let i = 0; i < N; i++) sparkVel.push(new T.Vector3());

    canvas.addEventListener('pointermove', e => {
      const idx = pick(e);
      canvas.style.cursor = idx >= 0 ? 'pointer' : '';
      if (idx !== hover) { hover = idx; if (game) S.sync(); }
    });
    canvas.addEventListener('pointerleave', () => { if (hover !== -1) { hover = -1; if (game) S.sync(); } });
    canvas.addEventListener('click', e => {
      const idx = pick(e);
      if (idx >= 0 && S.onPick) S.onPick(idx);
    });
    window.addEventListener('resize', resize);
    resize();
    drawPlate();
    requestAnimationFrame(frame);
  };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    cam.fit = Math.max(1, 1.72 / camera.aspect);
    if (S.onResize) S.onResize();
  }

  function pick(e) {
    if (!S.pickable) return -1;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const mine = tiles.filter(t => t.zone === 'hand' && t.owner === 0).map(t => t.g);
    const hit = raycaster.intersectObjects(mine, true)[0];
    return hit ? hit.object.parent.userData.tile.idx : -1;
  }

  // 玩家手牌上方在螢幕上的位置（給喊牌的字用）
  S.screen = pid => {
    const v = place(pid, 0, 9, pid === 0 ? 33 : 40, Q_STAND).pos.project(camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  };

  S.setGame = g => { game = g; };

  // ---- 牌局狀態 → 每張牌該在哪 ----
  // 牌牆：四邊各 18 墩，i 為整副牌的順序；偶數在上層
  function wallPlace(i, top) {
    const s = Math.floor(i / 2), side = [0, 3, 2, 1][Math.floor(s / 18)], k = s % 18;
    return place(side, (8.5 - k) * PITCH, top ? D * 1.5 + 0.02 : D / 2, WALL_Z, Q_DOWN);
  }

  function computeSlots() {
    const out = [], g = game;
    const add = (kind, p, zone, owner = -1, idx = -1, ring = 0, scale = 1) =>
      out.push({ kind, pos: p.pos, quat: p.quat, zone, owner, idx, ring, scale });

    const n = g.wall.length;
    for (let j = 0; j < n; j++) {
      const i = g.taken + j;
      // 下層被從牌尾補走時，上層那張落到桌面
      add(g.wall[j], wallPlace(i, i % 2 === 0 && j + 1 < n), 'wall', -1, -1, i);
    }

    g.players.forEach((p, pid) => {
      const shown = S.reveal && S.reveal.pid === pid;
      const hand = p.hand.slice();
      let discards = p.discards;
      let gapLast = g.turn === pid && g.drawn !== null && hand.length % 3 === 2;
      if (S.reveal && S.reveal.ron) {
        // 放槍的那張從牌河移到胡牌者手邊
        if (S.reveal.from === pid) discards = discards.slice(0, -1);
        if (shown) { hand.push(g.lastDiscard.tile); gapLast = true; }
      }

      // 花牌擺在自己牌河右側的空地，四張一排
      p.flowers.forEach((t, i) => {
        add(t, place(pid, 14.5 + (i % 4) * PITCH, D / 2, 13 + H / 2 + Math.floor(i / 4) * (H + 0.15), Q_UP), 'flower', pid);
      });
      const left = -EDGE;

      // 吃碰槓：第一組靠最右，之後往左排
      let mx = EDGE - W / 2;
      for (const m of p.melds) {
        const ks = m.type === 'chi' ? [m.tile, m.tile + 1, m.tile + 2]
          : m.type === 'pong' ? [m.tile, m.tile, m.tile] : [m.tile, m.tile, m.tile, m.tile];
        for (let i = ks.length - 1; i >= 0; i--) {
          const down = m.type === 'ankong' && !shown && (pid !== 0 || i === 0 || i === 3);
          add(ks[i], place(pid, mx, D / 2, ROW, down ? Q_DOWN : Q_UP), 'meld', pid);
          mx -= PITCH;
        }
        mx -= 0.9;
      }
      const right = p.melds.length ? mx + PITCH / 2 - 0.3 : EDGE;

      const gap = gapLast ? 1.6 : 0;
      // 自己的手牌放大一些，比較好認
      const sc = pid === 0 && !shown ? MY_SCALE : 1, step = PITCH * sc;
      const width = hand.length * step + gap;
      let cx = 0;
      if (cx + width / 2 > right) cx = right - width / 2;
      if (cx - width / 2 < left) cx = left + width / 2;
      hand.forEach((t, i) => {
        const hx = cx - width / 2 + step / 2 + i * step + (gapLast && i === hand.length - 1 ? gap : 0);
        let pl;
        if (shown) pl = place(pid, hx, D / 2, ROW, Q_UP);
        else if (pid === 0) {
          const lift = i === S.selected ? 1.5 : i === hover && S.pickable ? 0.5 : 0;
          const y = (H / 2 * Math.cos(LEAN) + D / 2 * Math.sin(LEAN)) * sc;
          pl = place(0, hx, y + lift * Math.cos(LEAN), ROW - lift * Math.sin(LEAN), Q_LEAN);
        } else pl = place(pid, hx, H / 2, ROW, Q_STAND);
        add(t, pl, 'hand', pid, i, 0, sc);
      });

      discards.forEach((t, i) => {
        const col = i % POOL_COLS, row = Math.floor(i / POOL_COLS);
        add(t, place(pid, (col - (POOL_COLS - 1) / 2) * PITCH, D / 2, POOL_Z + H / 2 + row * (H + 0.15), Q_UP), 'discard', pid, i);
      });
    });
    return out;
  }

  // ---- 動畫 ----
  function go(t, slot, o) {
    t.pos.copy(slot.pos); t.quat.copy(slot.quat);
    const s0 = t.g.scale.x;
    t.scale = slot.scale || 1;
    t.tw = {
      s0,
      p0: t.g.position.clone(), q0: t.g.quaternion.clone(),
      t0: performance.now() + (o.delay || 0),
      dur: o.dur, arc: o.arc || 0, spin: o.spin || 0, land: !!o.land,
    };
  }

  function motion(t, slot, dist) {
    const from = t.zone, to = slot.zone;
    const delay = S.dealing ? t.ring * 9 : 0;
    if (to === 'discard' && from !== 'discard') return { dur: 540, arc: 10, spin: 1, land: true };
    if (to === 'meld') return { dur: 460, arc: 6, spin: from === 'discard' ? 1 : 0, land: true };
    if (to === 'flower') return { dur: 520, arc: 7, spin: 1, delay };
    if (to === 'hand' && from === 'wall') return { dur: 400, arc: 5, delay };
    if (to === 'hand' && S.reveal && S.reveal.pid === slot.owner) {
      return { dur: 480, arc: from === 'discard' ? 9 : 2.5, spin: from === 'discard' ? 2 : 0, delay: slot.idx * 35, land: from === 'discard' };
    }
    if (to === 'wall') return { dur: 260 };
    return { dur: dist > PITCH * 1.5 ? 260 : 150, arc: dist > PITCH * 1.5 ? 2.5 : 0 };
  }

  const permCache = {};
  function perms(n) {
    if (permCache[n]) return permCache[n];
    const out = [];
    (function rec(a, rest) {
      if (!rest.length) { out.push(a); return; }
      rest.forEach((v, i) => rec(a.concat(v), rest.slice(0, i).concat(rest.slice(i + 1))));
    })([], Array.from({ length: n }, (_, i) => i));
    return (permCache[n] = out);
  }

  // 同一種牌的實體可互換：挑總移動距離最短的配對，沒變動的牌留在原地
  S.sync = () => {
    if (!game) return;
    const by = Array.from({ length: 42 }, () => []);
    for (const s of computeSlots()) by[s.kind].push(s);
    for (let kind = 0; kind < 42; kind++) {
      const ms = byKind[kind], ss = by[kind];
      let best = null, bestCost = Infinity;
      for (const perm of perms(ms.length)) {
        let cost = 0;
        for (let i = 0; i < ms.length; i++) {
          const s = ss[perm[i]];
          if (!s) continue;
          const d = ms[i].pos.distanceTo(s.pos);
          if (d > 0.01) cost += d + 0.5;
        }
        if (cost < bestCost) { bestCost = cost; best = perm; }
      }
      ms.forEach((t, i) => {
        const s = ss[best[i]];
        if (!s) return;
        const dist = t.pos.distanceTo(s.pos);
        if (dist > 0.01 || t.quat.angleTo(s.quat) > 0.01 || t.scale !== s.scale) go(t, s, motion(t, s, dist));
        t.zone = s.zone; t.owner = s.owner; t.idx = s.idx; t.ring = s.ring;
      });
    }
    drawPlate();
  };

  // 略過動畫，直接到位
  S.settle = () => {
    for (const t of tiles) {
      t.tw = null; t.bounce = 0;
      t.g.position.copy(t.pos); t.g.quaternion.copy(t.quat); t.g.scale.setScalar(t.scale);
    }
    cam.yaw = cam.yawTo; cam.zoom = cam.zoomTo;
  };

  function shuffled(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 新的一局：洗牌 → 砌牌 → 發牌
  S.deal = async () => {
    S.reveal = null; S.mark = false; S.idle = false; S.selected = -1;
    cam.yawTo = 0; cam.zoomTo = 1;
    cam.yaw = Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw)) + 0.5;
    for (const t of tiles) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.sqrt(Math.random()) * 24;
      const q = new T.Quaternion().setFromAxisAngle(Y, Math.random() * Math.PI * 2).multiply(Q_DOWN);
      t.zone = 'wall';
      go(t, { pos: new T.Vector3(Math.cos(a) * r, D / 2 + Math.random() * 3, Math.sin(a) * r), quat: q },
        { dur: 520, arc: 5, spin: 1, delay: Math.random() * 200 });
    }
    clack(0.5);
    await sleep(850);

    const n = game.wall.length, used = new Set(), free = [];
    for (let i = 0; i < 144; i++) if (i < game.taken || i >= game.taken + n) free.push(i);
    const toWall = (t, i) => {
      t.ring = i;
      go(t, wallPlace(i, i % 2 === 0), { dur: 480, arc: 4, delay: i * 4 });
    };
    for (let j = 0; j < n; j++) {
      const t = byKind[game.wall[j]].find(m => !used.has(m));
      used.add(t);
      toWall(t, game.taken + j);
    }
    tiles.filter(t => !used.has(t)).forEach((t, k) => toWall(t, free[k]));
    await sleep(1250);

    S.dealing = true;
    S.sync();
    S.dealing = false;
    await sleep(game.taken * 9 + 600);
  };

  // 胡牌：鏡頭轉向贏家、灑金粉
  S.celebrate = pid => {
    cam.yawTo = [0, 0.32, 0, -0.32][pid];
    cam.zoomTo = 0.93;
    const c = place(pid, 0, 3, ROW - 4, Q_STAND).pos, pos = sparks.geometry.attributes.position;
    sparkVel.forEach((v, i) => {
      pos.setXYZ(i, c.x + (Math.random() - 0.5) * 30, c.y, c.z + (Math.random() - 0.5) * 6);
      v.set((Math.random() - 0.5) * 16, 14 + Math.random() * 22, (Math.random() - 0.5) * 16);
    });
    pos.needsUpdate = true;
    sparkLife = 2.4;
    sparks.visible = true;
    clack(1);
  };

  function ring(pos) {
    const r = rings.find(x => x.userData.t0 < 0) || rings[0];
    r.position.set(pos.x, 0.06, pos.z);
    r.userData.t0 = performance.now();
  }

  // ---- 音效：合成一聲牌敲桌面 ----
  let actx = null;
  S.audio = () => {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  };
  function clack(vol) {
    if (!actx || S.muted) return;
    const len = Math.floor(actx.sampleRate * 0.07), buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = actx.createBufferSource(), bp = actx.createBiquadFilter(), gain = actx.createGain();
    src.buffer = buf;
    bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
    gain.gain.value = vol * 0.9;
    src.connect(bp); bp.connect(gain); gain.connect(actx.destination);
    src.start();
  }

  // ---- 中央資訊牌 ----
  function drawPlate() {
    const c = plateCtx;
    c.clearRect(0, 0, 512, 512);
    c.fillStyle = 'rgba(8, 26, 25, 0.72)';
    c.beginPath();
    c.roundRect ? c.roundRect(16, 16, 480, 480, 44) : c.rect(16, 16, 480, 480);
    c.fill();
    c.strokeStyle = 'rgba(246, 241, 227, 0.22)';
    c.lineWidth = 3;
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const kai = '"DFKai-SB", "BiauKai", "KaiTi", serif';
    if (!game) {
      c.fillStyle = '#f6f1e3';
      c.font = `700 84px ${kai}`;
      c.fillText('麻將', 256, 256);
    } else {
      c.fillStyle = '#f6f1e3';
      c.font = `700 62px ${kai}`;
      c.fillText(`${MJ.WIND[game.roundWind]}風${MJ.WIND[game.dealerChanges % 4]}局`, 256, 228);
      c.font = '34px "Microsoft JhengHei", sans-serif';
      c.fillStyle = 'rgba(246, 241, 227, 0.85)';
      c.fillText(`剩 ${Math.max(0, game.live())} 張`, 256, 292);
      if (game.streak) {
        c.fillStyle = '#e3b23c';
        c.font = '28px "Microsoft JhengHei", sans-serif';
        c.fillText(`連莊 ${game.streak}`, 256, 334);
      }
      // 四家門風，字頭朝向各自的玩家；輪到的那家亮起
      for (let pid = 0; pid < 4; pid++) {
        c.save();
        c.translate(256, 256);
        c.rotate(-pid * Math.PI / 2);
        const on = game.turn === pid;
        c.fillStyle = on ? '#e3b23c' : 'rgba(246, 241, 227, 0.14)';
        c.beginPath(); c.arc(0, 186, 38, 0, Math.PI * 2); c.fill();
        c.fillStyle = on ? '#1d2a2c' : '#f6f1e3';
        c.font = `700 48px ${kai}`;
        c.fillText(MJ.WIND[game.seatWind(pid)], 0, 189);
        c.restore();
      }
    }
    plateTex.needsUpdate = true;
  }

  // ---- 每一幀 ----
  const tmpQ = new T.Quaternion(), spinAxis = new T.Vector3(1, 0.25, 0).normalize();
  let lastNow = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;

    for (const t of tiles) {
      const tw = t.tw, g = t.g;
      if (tw) {
        let k = (now - tw.t0) / tw.dur;
        if (k >= 0) {
          if (k >= 1) k = 1;
          const e = k * k * (3 - 2 * k);
          g.position.lerpVectors(tw.p0, t.pos, e);
          g.position.y += tw.arc * 4 * k * (1 - k);
          g.quaternion.slerpQuaternions(tw.q0, t.quat, e);
          g.scale.setScalar(tw.s0 + (t.scale - tw.s0) * e);
          if (tw.spin) g.quaternion.multiply(tmpQ.setFromAxisAngle(spinAxis, Math.PI * 2 * tw.spin * e));
          if (k === 1) {
            t.tw = null;
            if (tw.land) { ring(t.pos); clack(0.8); t.bounce = now; }
          }
        }
      } else if (t.bounce) {
        // 落桌後輕彈一下
        const b = (now - t.bounce) / 170;
        if (b >= 1) { t.bounce = 0; g.position.copy(t.pos); }
        else g.position.y = t.pos.y + 0.55 * Math.sin(Math.PI * b) * (1 - b);
      }
    }

    for (const r of rings) {
      if (r.userData.t0 < 0) continue;
      const k = (now - r.userData.t0) / 480;
      if (k >= 1) { r.userData.t0 = -1; r.material.opacity = 0; continue; }
      r.scale.setScalar(1 + k * 2.2);
      r.material.opacity = 0.75 * (1 - k);
    }

    // 標記最後打出的那張
    let show = false;
    if (game && S.mark && game.lastDiscard) {
      const from = game.lastDiscard.from, ds = game.players[from].discards;
      const t = tiles.find(x => x.zone === 'discard' && x.owner === from && x.idx === ds.length - 1);
      if (t && !t.tw) {
        show = true;
        marker.position.set(t.pos.x, 4.4 + Math.sin(now / 260) * 0.45, t.pos.z);
        marker.rotation.y += dt * 3.2;
      }
    }
    marker.visible = show;

    if (sparkLife > 0) {
      sparkLife -= dt;
      const pos = sparks.geometry.attributes.position;
      sparkVel.forEach((v, i) => {
        v.y -= 30 * dt;
        pos.setXYZ(i, pos.getX(i) + v.x * dt, Math.max(0.2, pos.getY(i) + v.y * dt), pos.getZ(i) + v.z * dt);
      });
      pos.needsUpdate = true;
      sparks.material.opacity = Math.min(1, sparkLife);
      if (sparkLife <= 0) sparks.visible = false;
    }

    // 鏡頭：待機時繞桌慢轉，其餘時間緩緩靠向目標
    if (S.idle) { cam.yaw += dt * 0.12; cam.zoom += (1.12 - cam.zoom) * Math.min(1, dt * 2); }
    else {
      cam.yaw += (cam.yawTo - cam.yaw) * Math.min(1, dt * 2.6);
      cam.zoom += (cam.zoomTo - cam.zoom) * Math.min(1, dt * 2.6);
    }
    const z = cam.zoom * cam.fit, sn = Math.sin(cam.yaw), cs = Math.cos(cam.yaw);
    camera.position.set(sn * 87 * z, 80 * z, cs * 87 * z);
    camera.lookAt(sn * 13, 0, cs * 13);
    renderer.render(scene, camera);
  }
})();
