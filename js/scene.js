// three.js 牌桌：144 張實體牌，依牌局狀態決定每張的位置，移動時補上動畫
(function () {
  'use strict';
  const MJ = window.MJ, T = window.THREE, C = window.CANNON;
  const S = MJ.scene = {
    reveal: null, revealAll: false, mark: false, pickable: false, selected: -1,
    muted: false, reduced: false, idle: true, wallOffset: 0, seed: 1,
  };

  // 牌的尺寸與桌面配置（單位：牌寬 3）
  const W = 3, H = 4, D = 1.9, PITCH = 3.12, LONG = H + 0.15, BEVEL = 0.12;
  const HALF = 52, EDGE = 41, ROW = 44, WALL_Z = 32, POOL_Z = 11.5, LEAN = 0.62;
  const WALL_SIDES = [0, 3, 2, 1];         // 牌牆順時針繞桌一圈
  const X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(0, 0, 1);
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
  // 亮出來的牌不跟著座位轉，字頭一律朝遠方，坐在我這邊看都是正的。
  // 左右兩家的牌因此是「橫著排」：沿桌邊的間距用牌高，往桌心的間距用牌寬。
  const flat = (pid, x, z, down) => ({
    pos: new T.Vector3(x, D / 2, z).applyQuaternion(seatQ[pid]),
    quat: down ? Q_DOWN : Q_UP,
  });
  const along = pid => (pid % 2 ? LONG : PITCH);
  const deep = pid => (pid % 2 ? PITCH : LONG);
  // 沿桌邊排列時，哪個方向對我來說是「由左到右／由遠到近」
  const order = pid => (pid === 1 || pid === 2 ? -1 : 1);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const smooth = k => k * k * (3 - 2 * k);

  let renderer, scene, camera, world, game = null;
  const IVORY = 0xece4cf;
  const tiles = [], byKind = [], dice = [];
  const raycaster = new T.Raycaster(), mouse = new T.Vector2();
  let hover = -1, hoverKind = -1, haloMat, marker, plateCtx, plateTex, sparks, sparkLife = 0;
  // 蓄力甩牌：按住自己的牌不放，力道在 0 和 1 之間來回擺盪，放開就打出去
  const CHARGE_DELAY = 170, CHARGE_MS = 900;
  let charge = null, meter = null;
  const sparkVel = [], rings = [], up = new T.Vector3();
  const cam = { yaw: 0, zoom: 1, yawTo: 0, zoomTo: 1, fit: 1, shake: 0 };
  // 鏡頭架設：dist/high 為鏡頭離桌心的水平距離與高度，look 為看向的桌面點，my 為我手牌的放大倍率。
  // 橫放的手機螢幕實際很小：鏡頭壓近、往我這邊看，手牌再放大，桌邊木框和地板就不佔畫面
  const RIG = { dist: 87, high: 80, look: 13, my: 1.3 };
  const RIG_PHONE = { dist: 82, high: 77, look: 17, my: 1.55 };
  const PHONE = window.matchMedia('(pointer: coarse) and (max-height: 540px) and (orientation: landscape)');
  let rig = RIG;

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

  // 牌面：顏色貼圖（象牙底 + 上色的圖案）與法線貼圖（圖案往下刻進去，邊緣會吃光）
  function faceTextures(kind) {
    const w = 240, h = 320;
    const c = document.createElement('canvas'), nc = document.createElement('canvas');
    c.width = nc.width = w; c.height = nc.height = h;
    const ctx = c.getContext('2d'), nctx = nc.getContext('2d');
    const ivory = '#' + IVORY.toString(16);
    ctx.fillStyle = ivory; ctx.fillRect(0, 0, w, h);
    nctx.fillStyle = '#8080ff'; nctx.fillRect(0, 0, w, h);
    const map = new T.CanvasTexture(c), normal = new T.CanvasTexture(nc);
    map.anisotropy = normal.anisotropy = 8;
    const img = new Image();
    img.onload = () => {
      const g = document.createElement('canvas');
      g.width = w; g.height = h;
      const gx = g.getContext('2d');
      gx.drawImage(img, 0, 0, w, h);
      const src = gx.getImageData(0, 0, w, h).data;
      // 深度 = 圖案的不透明度，先糊開讓刻痕有斜面
      let a = new Float32Array(w * h), b = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) a[i] = src[i * 4 + 3] / 255;
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let d = -2; d <= 2; d++) sum += a[y * w + Math.min(w - 1, Math.max(0, x + d))];
          b[y * w + x] = sum / 5;
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let d = -2; d <= 2; d++) sum += b[Math.min(h - 1, Math.max(0, y + d)) * w + x];
          a[y * w + x] = sum / 5;
        }
      }
      const out = nctx.createImageData(w, h), K = 3.2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = a[y * w + Math.min(w - 1, x + 1)] - a[y * w + Math.max(0, x - 1)];
        const dy = a[Math.min(h - 1, y + 1) * w + x] - a[Math.max(0, y - 1) * w + x];
        const nx = K * dx, ny = -K * dy, len = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
        out.data[i] = (nx / len * 0.5 + 0.5) * 255;
        out.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
        out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        out.data[i + 3] = 255;
      }
      nctx.putImageData(out, 0, 0);
      // 刻痕上緣壓一道暗影，再疊上顏料
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.filter = 'blur(1.5px)';
      ctx.drawImage(g, 0, -2.5);
      ctx.restore();
      ctx.drawImage(g, 0, 0);
      map.needsUpdate = normal.needsUpdate = true;
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(MJ.face(kind));
    return { map, normal };
  }

  // ---- 房間：地板、地毯、桌腳、椅子、吊燈的光 ----
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
        px.fillStyle = 'rgb(' + (74 + shade) + ',' + (50 + shade * 0.7) + ',' + (31 + shade * 0.5) + ')';
        px.fillRect(col * 64 + 1, y + 1, 62, len - 2);
        for (let i = 0; i < 7; i++) {
          px.strokeStyle = 'rgba(25, 12, 4, ' + rnd(0.1, 0.3) + ')';
          px.beginPath(); px.moveTo(col * 64 + rnd(4, 60), y); px.lineTo(col * 64 + rnd(4, 60), y + len); px.stroke();
        }
        y += len;
      }
    }
    const planks = new T.CanvasTexture(pc);
    planks.wrapS = planks.wrapT = T.RepeatWrapping;
    planks.repeat.set(7, 7);
    planks.anisotropy = 8;
    const floor = new T.Mesh(new T.PlaneGeometry(900, 900), new T.MeshStandardMaterial({ map: planks, roughness: 0.6, envMapIntensity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR;
    scene.add(floor);

    // 地毯：深紅底、金色雙框
    const rc = document.createElement('canvas');
    rc.width = rc.height = 512;
    const rx = rc.getContext('2d');
    rx.fillStyle = '#5b1f1c'; rx.fillRect(0, 0, 512, 512);
    rx.strokeStyle = '#b08a4a'; rx.lineWidth = 6; rx.strokeRect(22, 22, 468, 468);
    rx.lineWidth = 2; rx.strokeRect(40, 40, 432, 432);
    rx.strokeStyle = 'rgba(176, 138, 74, 0.35)';
    for (let i = 70; i < 450; i += 38) for (let j = 70; j < 450; j += 38) {
      rx.beginPath(); rx.moveTo(i, j - 9); rx.lineTo(i + 9, j); rx.lineTo(i, j + 9); rx.lineTo(i - 9, j); rx.closePath(); rx.stroke();
    }
    rx.globalCompositeOperation = 'overlay'; rx.globalAlpha = 0.5;
    rx.fillStyle = noisePattern(rx, 128, 60, 190); rx.fillRect(0, 0, 512, 512);
    const rug = new T.Mesh(new T.PlaneGeometry(250, 250), new T.MeshStandardMaterial({ map: new T.CanvasTexture(rc), roughness: 1, envMapIntensity: 0.15 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = FLOOR + 0.2;
    scene.add(rug);
    // 桌子底下的暗影
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const sx = sc.getContext('2d'), sg = sx.createRadialGradient(64, 64, 20, 64, 64, 64);
    sg.addColorStop(0, 'rgba(0,0,0,0.75)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    sx.fillStyle = sg; sx.fillRect(0, 0, 128, 128);
    const under = new T.Mesh(new T.PlaneGeometry(190, 190), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = FLOOR + 0.4;
    scene.add(under);

    // 桌身與桌腳
    const dark = new T.MeshStandardMaterial({ color: 0x3a2413, roughness: 0.55, envMapIntensity: 0.4 });
    const apron = new T.Mesh(new T.BoxGeometry(HALF * 2 + 7, 7, HALF * 2 + 7), dark);
    apron.position.y = -4.4;
    scene.add(apron);
    for (const [sx2, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new T.Mesh(new T.BoxGeometry(6, 63, 6), dark);
      leg.position.set(sx2 * (HALF - 3), FLOOR + 31.5, sz * (HALF - 3));
      scene.add(leg);
    }
    // 三位對手的椅子
    for (let pid = 1; pid < 4; pid++) {
      const chair = new T.Group();
      const part = (w, h, d, x, y, z) => {
        const m = new T.Mesh(new T.BoxGeometry(w, h, d), wood);
        m.position.set(x, y, z);
        chair.add(m);
      };
      part(36, 3, 34, 0, -30, 0);
      part(36, 46, 3, 0, -8.5, 17);
      for (const [lx, lz] of [[-16, -15], [16, -15], [-16, 15], [16, 15]]) part(3, 40, 3, lx, -50, lz);
      chair.position.copy(new T.Vector3(0, 0, HALF + 30).applyQuaternion(seatQ[pid]));
      chair.quaternion.copy(seatQ[pid]);
      scene.add(chair);
    }
    // 桌子正上方的吊燈：一圈暖光打在桌面與地板
    const lamp = new T.SpotLight(0xffdfae, 0.55, 520, 0.72, 0.9, 1);
    lamp.position.set(0, 190, 0);
    scene.add(lamp, lamp.target);
    scene.fog = new T.Fog(0x0b1413, 190, 520);
  }

  // ---- 物理：骰子與打出去的牌 ----
  // G_TILE：飛出去的牌；G_REST：桌上躺著、被撞到才會動的牌
  const G_GROUND = 1, G_DICE = 2, G_FENCE = 4, G_TILE = 8, G_REST = 16;
  const HIT_TILES = G_GROUND | G_TILE | G_REST;
  // 會被撞動的牌：牌河、吃碰槓、花牌，還有沒摸的牌牆和各家手牌
  const PHYS_ZONES = ['discard', 'meld', 'flower', 'wall', 'hand'];
  let tileShape;
  // 我的手牌放大過，剛體也跟著放大
  const shapes = {};
  const shapeFor = s => shapes[s] || (shapes[s] = new C.Box(new C.Vec3(W / 2 * s, H / 2 * s, D / 2 * s)));
  const resting = [];
  function buildPhysics() {
    world = new C.World();
    world.gravity.set(0, -260, 0);
    world.allowSleep = true;
    world.broadphase = new C.SAPBroadphase(world);
    world.defaultContactMaterial.friction = 0.35;
    world.defaultContactMaterial.restitution = 0.3;
    const plane = (group, mask, axis, angle, x, y, z) => {
      const b = new C.Body({ mass: 0, shape: new C.Plane(), collisionFilterGroup: group, collisionFilterMask: mask });
      b.quaternion.setFromAxisAngle(axis, angle);
      b.position.set(x, y, z);
      world.addBody(b);
    };
    plane(G_GROUND, G_DICE | G_TILE | G_REST, new C.Vec3(1, 0, 0), -Math.PI / 2, 0, 0, 0);
    // 骰子只在桌子中央滾，四面看不見的擋板圍住
    const up = new C.Vec3(0, 1, 0), F = 13;
    plane(G_FENCE, G_DICE, up, -Math.PI / 2, F, 0, 0);
    plane(G_FENCE, G_DICE, up, Math.PI / 2, -F, 0, 0);
    plane(G_FENCE, G_DICE, up, Math.PI, 0, 0, F);
    plane(G_FENCE, G_DICE, up, 0, 0, 0, -F);
    tileShape = shapeFor(1);
  }

  // 把一張牌交給物理引擎丟向它的位置；落定後再由動畫推正
  // pw：甩牌的力道，沒蓄力的一般出牌當作 0.35
  function launch(t, now) {
    const pw = t.tw.power == null ? 0.35 : t.tw.power, hard = Math.max(0, pw - 0.35);
    const g = t.g, b = new C.Body({ mass: 1, shape: tileShape, collisionFilterGroup: G_TILE, collisionFilterMask: HIT_TILES });
    b.position.set(g.position.x, g.position.y, g.position.z);
    b.quaternion.set(g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w);
    b.linearDamping = 0.15; b.angularDamping = 0.35;
    // 落點抓在目標前面一點，留一段滑行
    // 越用力飛得越快，落點也抓得越前面，留給它滑
    const dx = t.pos.x - g.position.x, dz = t.pos.z - g.position.z, len = Math.hypot(dx, dz) || 1, tf = 0.5 - 0.23 * pw;
    const short = Math.min(len * 0.5, 1.6 + 5 * hard);
    const tx = t.pos.x - dx / len * short, tz = t.pos.z - dz / len * short;
    b.velocity.set((tx - g.position.x) / tf, (1.2 - g.position.y) / tf + 0.5 * 260 * tf, (tz - g.position.z) / tf);
    const flip = new T.Vector3(1, 0, 0).applyQuaternion(g.quaternion).multiplyScalar(rnd(8, 13) * (0.5 + 1.43 * pw) * (Math.random() < 0.5 ? -1 : 1));
    b.angularVelocity.set(flip.x + rnd(-2, 2), flip.y + rnd(-3, 3), flip.z + rnd(-2, 2));
    const p = t.phys = { b, until: now + tf * 1000 + 420 + 600 * hard, hit: false, pw, kick: 0 };
    b.isTile = true;
    wakeTable(g.position, t.pos, 12 + 22 * hard);
    b.addEventListener('collide', e => {
      if (e.body.isTile) knock(e, 1);
      if (p.hit) return;
      p.hit = true;
      ring(b.position, pw > 0.75);
      sfx('discard', 0.6 + 0.85 * pw, () => clack(0.6 + 0.85 * pw));
      // 用力拍下去：牌彈起來、桌子一震、旁邊的牌跟著跳
      if (pw > 0.55) {
        p.kick = 16 + 55 * (pw - 0.55);
        tone(70, 0.3, 0.6 * pw);
        cam.shake = Math.max(cam.shake, (pw - 0.5) * 1.6);
        jolt(b.position, pw);
      }
    });
    world.addBody(b);
    t.tw = null;
  }
  // 拍桌的震波：附近桌面上的牌由近到遠依序跳一下
  function jolt(pos, pw) {
    const now = performance.now(), R = 26;
    for (const t of tiles) {
      if (t.tw || t.phys || !PHYS_ZONES.includes(t.zone)) continue;
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      if (d < 0.5 || d > R) continue;
      if (t.rest) { t.rest.kickAt = now + d * 6; t.rest.kick = (pw - 0.45) * 45 * (1 - d / R); continue; }
      t.bounce = now + d * 6;
      t.bounceAmp = (pw - 0.45) * 2.4 * (1 - d / R);
    }
  }
  function endCharge(reset) {
    if (!charge) return;
    const t = myTile(charge.idx);
    if (reset && t && !t.tw && !t.phys) t.g.position.copy(t.pos);
    charge = null;
    if (meter) meter.hidden = true;
  }
  const myTile = idx => tiles.find(t => t.zone === 'hand' && t.owner === 0 && t.idx === idx);
  function endPhys(t) {
    world.removeBody(t.phys.b);
    t.phys = null;
  }

  // 牌要飛出去了：落點附近、還有飛行路線兩旁（會擦過牌牆和手牌）的牌都給一個睡著的剛體，被撞到才醒來
  let restUntil = 0, lastKnock = 0;
  const LANE = 5;
  function wakeTable(from, at, radius) {
    const ax = at.x - from.x, az = at.z - from.z, l2 = ax * ax + az * az || 1;
    for (const t of tiles) {
      if (t.rest || t.tw || t.phys || !PHYS_ZONES.includes(t.zone)) continue;
      const k = Math.max(0, Math.min(1, ((t.pos.x - from.x) * ax + (t.pos.z - from.z) * az) / l2));
      const lane = Math.hypot(t.pos.x - from.x - ax * k, t.pos.z - from.z - az * k);
      if (Math.hypot(t.pos.x - at.x, t.pos.z - at.z) > radius && lane > LANE) continue;
      restBody(t);
    }
    restUntil = performance.now() + 4000;
  }
  // 會動的牌靠近時，旁邊還沒有剛體的牌也補一個，才不會直接穿過去
  const WAKE_R = 8;
  function wakeNear(b) {
    if (b.velocity.lengthSquared() < 4) return;
    for (const t of tiles) {
      if (t.rest || t.tw || t.phys || !PHYS_ZONES.includes(t.zone)) continue;
      const dx = t.g.position.x - b.position.x, dz = t.g.position.z - b.position.z;
      if (dx * dx + dz * dz < WAKE_R * WAKE_R) restBody(t);
    }
  }
  // 桌上的牌比飛來的牌輕，一撞就飛
  function restBody(t) {
    const g = t.g, b = new C.Body({ mass: 0.35, shape: shapeFor(t.scale), collisionFilterGroup: G_REST, collisionFilterMask: HIT_TILES });
    b.position.set(g.position.x, g.position.y, g.position.z);
    b.quaternion.set(g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w);
    b.linearDamping = 0.15; b.angularDamping = 0.35;
    b.sleepSpeedLimit = 0.8; b.sleepTimeLimit = 0.25;
    b.isTile = true;
    b.addEventListener('collide', e => { if (e.body.isTile) knock(e, 0.6); });
    b.sleep();
    world.addBody(b);
    t.rest = { b, moved: false, kickAt: 0, kick: 0, push: null };
    resting.push(t);
  }
  // 胡牌那一拍：贏家把牌一推，整桌的牌從他那邊震飛出去，落下後再各自歸位
  // 震源放在贏家手牌後面，自己的手牌也一起往前倒
  function blast(pid) {
    const now = performance.now(), R = 2 * HALF + 20;
    const mine = tiles.filter(t => t.zone === 'hand' && t.owner === pid);
    if (!mine.length) return;
    const o = mine.reduce((v, t) => v.add(t.pos), new T.Vector3()).divideScalar(mine.length);
    const back = Math.hypot(o.x, o.z) || 1;
    o.x += o.x / back * 10; o.z += o.z / back * 10;
    for (const t of tiles) {
      if (t.tw || t.phys || !PHYS_ZONES.includes(t.zone)) continue;
      if (!t.rest) restBody(t);
      t.bounce = 0;
      const dx = t.pos.x - o.x, dz = t.pos.z - o.z, d = Math.hypot(dx, dz) || 1, f = Math.max(0.3, 1 - d / R);
      const out = rnd(14, 26) * f;
      t.rest.kickAt = now + d * 4;
      t.rest.kick = rnd(32, 50) * f + (t.zone === 'hand' && t.owner === pid ? 10 : 0);
      t.rest.push = { x: dx / d * out + rnd(-3, 3), z: dz / d * out + rnd(-3, 3) };
    }
    restUntil = now + 4500;
    cam.shake = Math.max(cam.shake, 1.8);
    tone(55, 0.6, 0.7);
  }
  // 牌撞牌的喀聲，撞得越快越響
  function knock(e, k) {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal()), now = performance.now();
    if (v < 4 || now - lastKnock < 45) return;
    lastKnock = now;
    clack(Math.min(0.9, v / 60) * k);
  }
  function endRest(t) {
    world.removeBody(t.rest.b);
    resting.splice(resting.indexOf(t), 1);
    t.rest = null;
  }
  const NUDGE = 1.1, NUDGE_YAW = 0.6, axA = new T.Vector3(), axB = new T.Vector3();
  // 剛體停下的位置相對原位：水平位移和水平轉角
  function yawFrom(q, home) {
    axA.set(1, 0, 0).applyQuaternion(q);
    axB.set(1, 0, 0).applyQuaternion(home.quat);
    const yaw = Math.atan2(-axA.z, axA.x) - Math.atan2(-axB.z, axB.x);
    return Math.atan2(Math.sin(yaw), Math.cos(yaw));
  }
  const nudgeTo = (n, f) => ({
    pos: n.home.pos.clone().addScaledVector(n.off, f),
    quat: n.home.quat.clone().premultiply(new T.Quaternion().setFromAxisAngle(Y, n.yaw * f)),
    scale: n.t.scale,
  });
  // 兩張牌的方盒有沒有互相穿進去（分離軸測試），留一點縫當作貼著不算
  const BOX_GAP = 0.04, satAx = [0, 1, 2, 3, 4, 5].map(() => new T.Vector3()), satL = new T.Vector3(), satD = new T.Vector3();
  function boxesHit(p1, q1, s1, p2, q2, s2) {
    satD.subVectors(p2, p1);
    const e1 = [W / 2 * s1 - BOX_GAP, H / 2 * s1 - BOX_GAP, D / 2 * s1 - BOX_GAP];
    const e2 = [W / 2 * s2 - BOX_GAP, H / 2 * s2 - BOX_GAP, D / 2 * s2 - BOX_GAP];
    const r = Math.hypot(...e1) + Math.hypot(...e2);
    if (satD.lengthSq() > r * r) return false;
    const a = satAx;
    a[0].set(1, 0, 0).applyQuaternion(q1); a[1].set(0, 1, 0).applyQuaternion(q1); a[2].set(0, 0, 1).applyQuaternion(q1);
    a[3].set(1, 0, 0).applyQuaternion(q2); a[4].set(0, 1, 0).applyQuaternion(q2); a[5].set(0, 0, 1).applyQuaternion(q2);
    const apart = L => {
      if (L.lengthSq() < 1e-6) return false;
      let ra = 0, rb = 0;
      for (let i = 0; i < 3; i++) { ra += e1[i] * Math.abs(a[i].dot(L)); rb += e2[i] * Math.abs(a[i + 3].dot(L)); }
      return Math.abs(satD.dot(L)) > ra + rb;
    };
    for (let i = 0; i < 6; i++) if (apart(a[i])) return false;
    for (let i = 0; i < 3; i++) for (let j = 3; j < 6; j++) if (apart(satL.crossVectors(a[i], a[j]))) return false;
    return true;
  }
  // 撞完停下來：歪一點就留在那裡，像真的桌面；翻面、疊到別張上就推回原位
  // 只留水平位移和水平轉角，跑太遠的拉回一點，牌河才不會亂到看不懂
  // 一起收：每張歪掉的牌都要跟其他牌的落點比對，會穿到別張就少歪一點，最差退回原位
  const NUDGE_STEPS = [1, 0.6, 0.3, 0];
  function settleRests(list) {
    const nudged = [], back = [];
    for (const t of list) {
      const r = t.rest, b = r.b;
      endRest(t);
      if (!r.moved) continue;
      const home = t.home || { pos: t.pos.clone(), quat: t.quat.clone() };
      const q = new T.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      axA.set(0, 0, 1).applyQuaternion(q);
      axB.set(0, 0, 1).applyQuaternion(home.quat);
      const flat = axA.dot(axB) > 0.97 && Math.abs(b.position.y - home.pos.y) < 0.3;
      if (!flat) { back.push({ t, home }); continue; }
      const off = new T.Vector3(b.position.x - home.pos.x, 0, b.position.z - home.pos.z);
      if (off.length() > NUDGE) off.setLength(NUDGE);
      const yaw = Math.max(-NUDGE_YAW, Math.min(NUDGE_YAW, yawFrom(q, home)));
      nudged.push({ t, home, off, yaw, step: 0, fresh: true });
    }
    // 之前就歪著放的牌也一起重排，免得有牌回原位時撞上它
    for (const t of tiles) {
      if (!t.home || t.rest || t.phys || t.tw || nudged.some(n => n.t === t) || back.some(n => n.t === t)) continue;
      const off = t.pos.clone().sub(t.home.pos);
      nudged.push({ t, home: t.home, off, yaw: yawFrom(t.quat, t.home), step: 0, fresh: false });
    }
    const spot = new Map();
    for (const t of tiles) if (!t.phys) spot.set(t, { pos: t.pos, quat: t.quat, scale: t.scale });
    for (const { t, home } of back) spot.set(t, { pos: home.pos, quat: home.quat, scale: t.scale });
    for (const n of nudged) spot.set(n.t, nudgeTo(n, 1));
    const near = nudged.map(n => tiles.filter(o => o !== n.t && spot.has(o) && spot.get(o).pos.distanceToSquared(n.home.pos) < 100));
    for (let pass = 0, changed = true; changed && pass < 8; pass++) {
      changed = false;
      nudged.forEach((n, i) => {
        while (n.step < NUDGE_STEPS.length - 1) {
          const me = spot.get(n.t);
          if (!near[i].some(o => { const s = spot.get(o); return boxesHit(me.pos, me.quat, me.scale, s.pos, s.quat, s.scale); })) break;
          spot.set(n.t, nudgeTo(n, NUDGE_STEPS[++n.step]));
          changed = true;
        }
      });
    }
    for (const { t, home } of back) {
      go(t, { pos: home.pos.clone(), quat: home.quat.clone(), scale: t.scale }, { dur: 320, arc: 1.5 });
      t.home = home;
    }
    for (const n of nudged) {
      if (!n.fresh && !n.step) continue;
      go(n.t, spot.get(n.t), { dur: 160, arc: 0 });
      n.t.home = n.home;
    }
  }

  // ---- 桌上的小東西：籌碼、莊家牌 ----
  // 籌碼就是每家手上的現金：開局各 STAKE，之後跟著輸贏走
  const STAKE = 5000, DENOMS = [500, 100, 20];
  const props = [], stacks = [0, 1, 2, 3].map(() => DENOMS.map(() => []));
  let dealerBlock, chipGeo, chipMats;
  // 讓道具沿拋物線飛到定點
  function fly(obj, to, o) {
    const k = S.reduced ? 0.4 : 1;
    props.push({ obj, p0: obj.position.clone(), p1: to.clone(), t0: performance.now() + (o.delay || 0) * k, dur: o.dur * k, arc: (o.arc || 0) * k, flip: o.flip || 0, done: o.done });
  }
  const dealerSpot = pid => place(pid, -32.5, 0.7, 38, Q_STAND).pos;
  function buildProps() {
    // 三種面額：紅 500、藍 100、白 20，面額印在籌碼正面
    chipGeo = new T.CylinderGeometry(1.1, 1.1, 0.28, 28);
    chipMats = [['#b8322b', '#f4ead2'], ['#23508f', '#f4ead2'], ['#e9e2cf', '#2a2a2a']].map(([bg, fg], d) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = bg; x.fillRect(0, 0, 128, 128);
      x.strokeStyle = fg; x.lineWidth = 6; x.setLineDash([14, 10]);
      x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.stroke();
      x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '700 46px Georgia, serif';
      x.fillText(DENOMS[d], 64, 67);
      const side = new T.MeshStandardMaterial({ color: bg, roughness: 0.45, envMapIntensity: 0.6 });
      const face = new T.MeshStandardMaterial({ map: new T.CanvasTexture(c), roughness: 0.45, envMapIntensity: 0.6 });
      return [side, face, side];
    });
    syncChips(false);

    const dc = document.createElement('canvas');
    dc.width = dc.height = 128;
    const dx = dc.getContext('2d');
    dx.fillStyle = '#a3261f'; dx.fillRect(0, 0, 128, 128);
    dx.strokeStyle = '#e3c06a'; dx.lineWidth = 6; dx.strokeRect(9, 9, 110, 110);
    dx.fillStyle = '#f1d98a'; dx.textAlign = 'center'; dx.textBaseline = 'middle';
    dx.font = '700 84px "DFKai-SB", "BiauKai", "KaiTi", serif';
    dx.fillText('莊', 64, 68);
    const side = new T.MeshStandardMaterial({ color: 0x8a1f1a, roughness: 0.4, envMapIntensity: 0.5 });
    const top = new T.MeshStandardMaterial({ map: new T.CanvasTexture(dc), roughness: 0.4, envMapIntensity: 0.5 });
    dealerBlock = new T.Mesh(new T.BoxGeometry(3.4, 1.4, 3.4), [side, side, top, side, side, side]);
    dealerBlock.castShadow = true;
    dealerBlock.position.copy(dealerSpot(0));
    scene.add(dealerBlock);
  }
  // 現金換成籌碼：大面額優先，小面額各多留一疊零錢
  function chipCounts(cash) {
    const n = DENOMS.map(() => 0), min = DENOMS[DENOMS.length - 1];
    let rest = Math.max(0, Math.floor(cash / min)) * min;
    for (let d = DENOMS.length - 1; d > 0; d--) {
      const up = DENOMS[d - 1];
      n[d] = (rest % up) / DENOMS[d];
      rest -= n[d] * DENOMS[d];
      if (rest >= up) { n[d] += up / DENOMS[d]; rest -= up; }
    }
    n[0] = rest / DENOMS[0];
    return n;
  }
  // 讓桌上的籌碼等於每家現在的現金：多的從牌堆頂拿走飛給不夠的人，找零的直接換
  function syncChips(animate) {
    // 籌碼要歸位了：手上拿著的那枚先放掉，被玩亂的全部飛回自己那疊
    toy = null;
    const want = stacks.map((_, pid) => chipCounts(STAKE + (game ? game.players[pid].score : 0)));
    const fresh = new Set();
    DENOMS.forEach((_, d) => {
      const spare = [];
      stacks.forEach((s, pid) => { while (s[d].length > want[pid][d]) spare.push(s[d].pop()); });
      stacks.forEach((s, pid) => {
        while (s[d].length < want[pid][d]) {
          let chip = spare.pop();
          if (!chip) {
            chip = new T.Mesh(chipGeo, chipMats[d]);
            chip.castShadow = chip.receiveShadow = true;
            scene.add(chip);
            fresh.add(chip);
          }
          s[d].push(chip);
        }
      });
      spare.forEach(chip => scene.remove(chip));
    });
    if (!animate) for (let i = props.length - 1; i >= 0; i--) if (props[i].obj !== dealerBlock) props.splice(i, 1);
    // 每種面額自己排，十枚一疊，疊滿往旁邊排
    let moved = 0;
    stacks.forEach((s, pid) => {
      let col = 0;
      s.forEach(list => {
        list.forEach((chip, j) => {
          chip.userData.loose = false;
          chip.rotation.set(0, 0, 0);
          const c = col + Math.floor(j / 10);
          const to = place(pid, -39.5 + (c % 4) * 2.5, 0.15 + (j % 10) * 0.3, 31 + Math.floor(c / 4) * 2.5, Q_STAND).pos;
          if (!animate || fresh.has(chip)) chip.position.copy(to);
          else if (chip.position.distanceTo(to) > 0.01) fly(chip, to, { dur: 520, arc: 9, delay: moved++ * 80, done: () => clink(0.12) });
        });
        col += Math.ceil(list.length / 10);
      });
    });
  }
  // 結算：輸家把錢推給贏家
  S.pay = () => syncChips(true);

  // ---- 等別人的時候玩一下：籌碼可以拖著滿桌跑、點一下拋硬幣；桌上的牌點一下會被輕輕推開 ----
  const CHIP_H = 0.3, CHIP_LIFT = 4, CHIP_REACH = HALF - 4;
  const DOWN = new T.Vector3(0, -1, 0), downRay = new T.Raycaster(), rayFrom = new T.Vector3();
  const dragPlane = new T.Plane(Y, -CHIP_LIFT);
  let toy = null, nextFall = 0;
  const clink = v => tone(rnd(2300, 2900), 0.07, v, 'triangle');
  const allChips = () => stacks.flatMap(s => s.flat());
  const busy = chip => props.some(a => a.obj === chip);
  // 同一疊（xz 幾乎重合）裡最上面那枚
  function columnTop(chip, skip) {
    let top = chip;
    for (const c of allChips()) {
      if (c === skip || busy(c) || Math.hypot(c.position.x - chip.position.x, c.position.z - chip.position.z) > 0.5) continue;
      if (c.position.y > top.position.y) top = c;
    }
    return top;
  }
  // 從 from 高度往下找第一個能放籌碼的面（牌或桌面），回傳籌碼中心該在的高度
  function groundAt(x, z, from) {
    downRay.set(rayFrom.set(x, from, z), DOWN);
    const hit = downRay.intersectObjects(tiles.map(t => t.g), true).find(h => h.object.visible);
    return (hit ? hit.point.y : 0) + CHIP_H / 2;
  }
  // 放手的位置：旁邊有籌碼就疊上去，不然落在底下的牌或桌面上
  function landAt(x, z, self) {
    let near = null, nd = 1.6;
    for (const c of allChips()) {
      if (c === self || busy(c)) continue;
      const d = Math.hypot(c.position.x - x, c.position.z - z);
      if (d < nd) { nd = d; near = c; }
    }
    if (near) {
      const top = columnTop(near, self);
      return new T.Vector3(top.position.x + rnd(-0.06, 0.06), top.position.y + CHIP_H, top.position.z + rnd(-0.06, 0.06));
    }
    return new T.Vector3(x, groundAt(x, z, 40), z);
  }
  // 被玩過的籌碼底下的東西移走了（牌被摸走、底下那枚被拿走）就掉下去
  function dropLoose() {
    for (const c of allChips()) {
      if (!c.userData.loose || busy(c) || (toy && toy.chip === c)) continue;
      const p = c.position;
      // 籌碼本身不在射線的目標裡，從中心往下打就是它底下那個面
      let s = groundAt(p.x, p.z, p.y);
      for (const o of allChips()) {
        if (o === c || o.position.y > p.y - 0.1 || Math.hypot(o.position.x - p.x, o.position.z - p.z) > 0.9) continue;
        s = Math.max(s, o.position.y + CHIP_H);
      }
      if (p.y - s > 0.05) fly(c, new T.Vector3(p.x, s, p.z), { dur: 120 + 60 * Math.sqrt(p.y - s), done: () => clink(0.08) });
    }
  }
  // 游標底下最前面的是哪枚籌碼或哪張桌上的牌（自己的手牌不算，那是出牌用的）
  function tableAt(e) {
    aim(e);
    const objs = allChips().concat(tiles.filter(t => !(t.zone === 'hand' && t.owner === 0)).map(t => t.g));
    const hit = raycaster.intersectObjects(objs, true).find(h => h.object.visible);
    if (!hit) return null;
    const tile = hit.object.parent.userData.tile;
    if (tile) return { tile, point: hit.point };
    return busy(hit.object) ? null : { chip: columnTop(hit.object, null) };
  }
  function grabChip(chip, e) {
    toy = { chip, id: e.pointerId, x: e.clientX, y: e.clientY, drag: false, to: chip.position.clone() };
  }
  function dragChip(e) {
    if (!toy.drag) {
      if (Math.hypot(e.clientX - toy.x, e.clientY - toy.y) < 6) return;
      toy.drag = true;
      toy.chip.userData.loose = true;
      toy.chip.rotation.set(0, 0, 0);
      clink(0.1);
    }
    aim(e);
    if (!raycaster.ray.intersectPlane(dragPlane, toy.to)) return;
    toy.to.x = Math.max(-CHIP_REACH, Math.min(CHIP_REACH, toy.to.x));
    toy.to.z = Math.max(-CHIP_REACH, Math.min(CHIP_REACH, toy.to.z));
  }
  // 放手：拖過就落下（疊到別的籌碼上），沒拖就是原地拋一下硬幣
  function releaseChip() {
    const { chip, drag } = toy;
    toy = null;
    chip.rotation.set(0, 0, 0);
    if (drag) fly(chip, landAt(chip.position.x, chip.position.z, chip), { dur: 170, done: () => clink(0.14) });
    else {
      chip.userData.loose = true;
      fly(chip, chip.position, { dur: 620, arc: 7, flip: Math.random() < 0.5 ? 2 : 3, done: () => { clink(0.14); setTimeout(() => clink(0.07), 70); } });
    }
  }
  // 點桌上的牌：往遠離鏡頭的方向輕推一下，交給物理，停下來歪一點就留著（settleRest 會管）
  function flick(t, point) {
    if (t.tw || t.phys) return;
    wakeTable(t.pos, t.pos, PITCH * 1.4);
    if (!t.rest) return;
    const r = t.rest, b = r.b;
    const a = Math.atan2(point.z - camera.position.z, point.x - camera.position.x) + rnd(-0.5, 0.5), sp = rnd(11, 17);
    b.wakeUp();
    b.velocity.set(Math.cos(a) * sp, rnd(9, 15), Math.sin(a) * sp);
    b.angularVelocity.set(rnd(-2, 2), rnd(-7, 7), rnd(-2, 2));
    r.moved = true;
    clack(0.3);
  }

  // 每局換一組的固定亂數：同一個位置每次算出來都一樣，牌才不會自己亂動
  const jrand = k => { const x = Math.sin(k * 127.1 + S.seed * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  // 手擺的牌不會完全對齊：位置與角度各偏一點
  function jit(pl, key, posAmp, rotAmp) {
    return {
      pos: new T.Vector3(pl.pos.x + jrand(key) * posAmp, pl.pos.y, pl.pos.z + jrand(key + 0.37) * posAmp),
      quat: new T.Quaternion().setFromAxisAngle(Y, jrand(key + 0.71) * rotAmp).multiply(pl.quat),
    };
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  // 一小塊灰階雜訊，拿來當重複花紋疊在大貼圖上
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

  // 整張桌布一張貼圖（不重複）：絨布顆粒、印花邊框、洗牌磨痕、刮痕、茶漬
  function feltTexture() {
    const N = 2048, U = N / (HALF * 2), mid = N / 2;   // U：桌面一單位幾個像素
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');

    // 底色：中間亮、四周暗
    const base = ctx.createRadialGradient(mid, mid * 0.92, N * 0.08, mid, mid, N * 0.75);
    base.addColorStop(0, '#2b6e64');
    base.addColorStop(0.55, '#225c54');
    base.addColorStop(1, '#173f3a');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, N, N);

    // 斜紋織線
    ctx.lineWidth = 1;
    for (let i = -N; i < N; i += 7) {
      ctx.strokeStyle = `rgba(255,255,255,${rnd(0.012, 0.03)})`;
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + N, N); ctx.stroke();
      ctx.strokeStyle = `rgba(0,0,0,${rnd(0.015, 0.035)})`;
      ctx.beginPath(); ctx.moveTo(i + N + 3, 0); ctx.lineTo(i + 3, N); ctx.stroke();
    }

    // 印花：雙線邊框、回紋角、中央一圈細線
    const gold = a => `rgba(214, 190, 128, ${a})`;
    const inset = 5.5 * U;
    ctx.strokeStyle = gold(0.34);
    ctx.lineWidth = 5;
    ctx.strokeRect(inset, inset, N - inset * 2, N - inset * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(inset + 12, inset + 12, N - (inset + 12) * 2, N - (inset + 12) * 2);
    // 回紋：方形螺旋，四個角各一個
    const key = (x, y, s, fx, fy) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(fx, fy);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (const [px, py] of [[6, 0], [6, 6], [1, 6], [1, 2], [4, 2], [4, 4], [2.6, 4]]) ctx.lineTo(px * s, py * s);
      ctx.stroke();
      ctx.restore();
    };
    ctx.lineWidth = 4;
    ctx.strokeStyle = gold(0.3);
    const ko = inset + 30, ks = 13;
    key(ko, ko, ks, 1, 1); key(N - ko, ko, ks, -1, 1); key(ko, N - ko, ks, 1, -1); key(N - ko, N - ko, ks, -1, -1);
    // 各家面前的出牌區記號
    ctx.lineWidth = 2;
    ctx.strokeStyle = gold(0.16);
    ctx.strokeRect(mid - 29.5 * U, mid - 29.5 * U, 59 * U, 59 * U);
    ctx.beginPath(); ctx.arc(mid, mid, 15.5 * U, 0, Math.PI * 2); ctx.stroke();

    // 洗牌磨出來的亮面：中央一大片，加上一圈圈弧形擦痕
    const soft = (x, y, rx, ry, color) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    soft(mid, mid, 30 * U, 30 * U, 'rgba(190, 225, 205, 0.11)');
    ctx.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const r = rnd(5, 30) * U, a = rnd(0, Math.PI * 2);
      ctx.strokeStyle = `rgba(220, 240, 228, ${rnd(0.015, 0.05)})`;
      ctx.lineWidth = rnd(1, 5);
      ctx.beginPath();
      ctx.arc(mid + rnd(-4, 4) * U, mid + rnd(-4, 4) * U, r, a, a + rnd(0.15, 0.9));
      ctx.stroke();
    }
    // 四家手牌位置磨亮的長條，以及手肘靠的桌邊磨暗
    for (let p = 0; p < 4; p++) {
      const v = new T.Vector3(0, 0, ROW - 2).applyQuaternion(seatQ[p]);
      const along = p % 2 ? [4.5 * U, 34 * U] : [34 * U, 4.5 * U];
      soft(mid + v.x * U, mid + v.z * U, along[0], along[1], 'rgba(200, 230, 212, 0.13)');
      const e = new T.Vector3(0, 0, HALF - 1).applyQuaternion(seatQ[p]);
      soft(mid + e.x * U, mid + e.z * U, along[0] * 1.2, along[1] * 1.2, 'rgba(0, 0, 0, 0.16)');
    }

    // 刮痕：多數又短又淡，少數幾道長的
    for (let i = 0; i < 150; i++) {
      const long = i < 9;
      const x = rnd(0, N), y = rnd(0, N), a = rnd(0, Math.PI * 2), len = long ? rnd(120, 420) : rnd(8, 60);
      const bend = rnd(-0.25, 0.25) * len;
      ctx.strokeStyle = Math.random() < 0.75
        ? `rgba(225, 240, 230, ${long ? rnd(0.1, 0.2) : rnd(0.07, 0.22)})`
        : `rgba(0, 0, 0, ${rnd(0.08, 0.2)})`;
      ctx.lineWidth = long ? rnd(0.8, 1.6) : rnd(0.6, 2.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + Math.cos(a) * len / 2 - Math.sin(a) * bend, y + Math.sin(a) * len / 2 + Math.cos(a) * bend,
        x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }

    // 茶杯印與幾處污漬
    const ring = (x, y, r) => {
      ctx.strokeStyle = 'rgba(8, 26, 22, 0.22)';
      ctx.lineWidth = rnd(3, 5);
      ctx.beginPath(); ctx.arc(x, y, r, rnd(0, 1), rnd(4.6, 6.2)); ctx.stroke();
      soft(x, y, r, r, 'rgba(8, 26, 22, 0.07)');
    };
    for (let p = 0; p < 4; p++) {
      const v = new T.Vector3(-38.5, 0, 38).applyQuaternion(seatQ[p]);
      ring(mid + (v.x + rnd(-0.8, 0.8)) * U, mid + (v.z + rnd(-0.8, 0.8)) * U, 2.1 * U);
    }
    ring(mid + 35.5 * U, mid + 37 * U, 2.1 * U);
    for (let i = 0; i < 14; i++) {
      const r = rnd(1.5, 6) * U;
      soft(rnd(0, N), rnd(0, N), r, r * rnd(0.6, 1.4), `rgba(6, 22, 20, ${rnd(0.05, 0.13)})`);
    }

    // 絨布顆粒蓋在最上面
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = noisePattern(ctx, 256, 70, 185);
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const tex = new T.CanvasTexture(c);
    tex.anisotropy = 8;
    return tex;
  }

  // 木框：順著長邊的木紋、節疤、磕碰與刮痕
  function woodTexture() {
    const w = 2048, h = 128;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#7a4f2c');
    base.addColorStop(0.5, '#6a4224');
    base.addColorStop(1, '#55331b');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // 木紋：一條條微微起伏的線
    for (let i = 0; i < 90; i++) {
      const y0 = rnd(0, h), amp = rnd(0.5, 4), f = rnd(0.002, 0.012), ph = rnd(0, 6.28);
      ctx.strokeStyle = Math.random() < 0.6 ? `rgba(40, 20, 8, ${rnd(0.08, 0.3)})` : `rgba(190, 140, 90, ${rnd(0.05, 0.18)})`;
      ctx.lineWidth = rnd(0.5, 2.2);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3);
      ctx.stroke();
    }
    // 節疤
    for (let i = 0; i < 5; i++) {
      const x = rnd(0, w), y = rnd(20, h - 20);
      for (let r = 14; r > 1; r -= 2.5) {
        ctx.strokeStyle = `rgba(35, 17, 6, ${rnd(0.15, 0.4)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(x, y, r * 2.4, r, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // 刮痕與磕碰
    for (let i = 0; i < 70; i++) {
      const x = rnd(0, w), y = rnd(0, h), len = rnd(6, 90), a = rnd(-0.5, 0.5);
      ctx.strokeStyle = Math.random() < 0.6 ? `rgba(225, 190, 150, ${rnd(0.1, 0.3)})` : `rgba(20, 10, 4, ${rnd(0.2, 0.45)})`;
      ctx.lineWidth = rnd(0.6, 1.8);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
    }
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(20, 10, 4, ${rnd(0.15, 0.4)})`;
      ctx.beginPath(); ctx.ellipse(rnd(0, w), rnd(0, h), rnd(1.5, 5), rnd(1, 3), rnd(0, 3), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = noisePattern(ctx, 128, 60, 195);
    ctx.fillRect(0, 0, w, h);
    const tex = new T.CanvasTexture(c);
    tex.anisotropy = 8;
    return tex;
  }

  // 骰子的一面
  function pipTexture(v) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f7f2e4';
    ctx.fillRect(0, 0, 128, 128);
    const at = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
      5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] }[v];
    ctx.fillStyle = v === 1 || v === 4 ? '#c0352b' : '#1d2a2c';
    for (const [x, y] of at) {
      ctx.beginPath();
      ctx.arc(30 + x * 34, 30 + y * 34, v === 1 ? 22 : 12, 0, Math.PI * 2);
      ctx.fill();
    }
    return new T.CanvasTexture(c);
  }
  // BoxGeometry 六面依序是 +x -x +y -y +z -z；下表是把各點數轉到朝上的姿勢
  const DIE_FACES = [3, 4, 1, 6, 2, 5];
  const DIE_AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(a => new T.Vector3(...a));

  // 反光用的環境：一個暗房間加幾盞柔光燈
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

  S.init = canvas => {
    renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    scene.background = new T.Color(0x0b1413);
    scene.environment = environment();
    camera = new T.PerspectiveCamera(40, 1, 1, 500);

    scene.add(new T.HemisphereLight(0xffffff, 0x1c3a36, 0.42));
    const sun = new T.DirectionalLight(0xfff1d8, 0.5);
    sun.position.set(-35, 90, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 6;
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 10; sc.far = 220;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    // 桌面與木框
    const felt = new T.Mesh(
      new T.PlaneGeometry(HALF * 2, HALF * 2),
      new T.MeshStandardMaterial({ roughness: 1, map: feltTexture(), envMapIntensity: 0.25 }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    scene.add(felt);
    const grain = woodTexture();
    const wood = new T.MeshStandardMaterial({ map: grain, bumpMap: grain, bumpScale: 0.06, roughness: 0.5, envMapIntensity: 0.5 });
    // 四角的銅包角
    const brass = new T.MeshStandardMaterial({ color: 0xc9a45c, roughness: 0.42, metalness: 0.55, envMapIntensity: 1 });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const cap = new T.Mesh(new T.BoxGeometry(4.5, 3.4, 4.5), brass);
      cap.position.set(sx * (HALF + 2), 0.65, sz * (HALF + 2));
      cap.castShadow = cap.receiveShadow = true;
      scene.add(cap);
    }
    for (let i = 0; i < 4; i++) {
      const rim = new T.Mesh(new T.BoxGeometry(HALF * 2 + 8, 3, 4), wood);
      const p = place(i, 0, 0.6, HALF + 2, Q_STAND);
      rim.position.copy(p.pos); rim.quaternion.copy(p.quat);
      rim.castShadow = rim.receiveShadow = true;
      scene.add(rim);
    }

    buildRoom(wood);
    buildPhysics();
    buildProps();

    // 中央牌局資訊
    const pc = document.createElement('canvas');
    pc.width = pc.height = 512;
    plateCtx = pc.getContext('2d');
    plateTex = new T.CanvasTexture(pc);
    plateTex.anisotropy = 8;
    const plate = new T.Mesh(new T.PlaneGeometry(20, 20), new T.MeshBasicMaterial({ map: plateTex, transparent: true }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.03;
    scene.add(plate);

    // 牌：象牙層 + 綠背層 + 牌面貼圖，表面一層亮漆會反光
    const shape = roundedRect(W - 2 * BEVEL, H - 2 * BEVEL, 0.24);
    const ext = d => new T.ExtrudeGeometry(shape, {
      depth: d, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 2, curveSegments: 4,
    });
    const ivoryGeo = ext(0.9).translate(0, 0, -0.07);   // z: -0.19 ~ 0.95
    const jadeGeo = ext(0.52).translate(0, 0, -0.83);   // z: -0.95 ~ -0.19
    const faceGeo = new T.PlaneGeometry(2.7, 3.6);
    const gloss = { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.55 };
    const ivoryMat = new T.MeshPhysicalMaterial(Object.assign({ color: IVORY }, gloss));
    // 每張牌底下一片柔邊暗影，貼著桌面跟著牌走
    const shc = document.createElement('canvas');
    shc.width = shc.height = 64;
    const shx = shc.getContext('2d');
    shx.filter = 'blur(7px)';
    shx.fillRect(14, 14, 36, 36);
    const shTex = new T.CanvasTexture(shc), shGeo = new T.PlaneGeometry(1, 1);
    const jadeMat = new T.MeshPhysicalMaterial(Object.assign({ color: 0x27916a }, gloss));
    // 滑到手牌上時，桌面上同一種牌底下亮起的金色光暈
    const hc = document.createElement('canvas');
    hc.width = 96; hc.height = 120;
    const hx = hc.getContext('2d');
    hx.filter = 'blur(9px)';
    hx.fillStyle = '#ffd36a';
    hx.fillRect(16, 16, 64, 88);
    haloMat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(hc), transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const haloGeo = new T.PlaneGeometry(W * 1.9, H * 1.7);
    for (let kind = 0; kind < 42; kind++) {
      byKind[kind] = [];
      const ft = faceTextures(kind);
      const faceMat = new T.MeshPhysicalMaterial(Object.assign({ map: ft.map, normalMap: ft.normal, normalScale: new T.Vector2(1.2, 1.2) }, gloss));
      for (let n = kind < 34 ? 4 : 1; n > 0; n--) {
        const g = new T.Group();
        const a = new T.Mesh(ivoryGeo, ivoryMat), b = new T.Mesh(jadeGeo, jadeMat), f = new T.Mesh(faceGeo, faceMat);
        f.position.z = D / 2 + 0.008;
        a.castShadow = b.castShadow = a.receiveShadow = b.receiveShadow = true;
        const halo = new T.Mesh(haloGeo, haloMat);
        halo.position.z = -D / 2 + 0.06;
        halo.visible = false;
        g.add(a, b, f, halo);
        scene.add(g);
        const sh = new T.Mesh(shGeo, new T.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0 }));
        sh.rotation.order = 'YXZ';
        scene.add(sh);
        const t = { g, sh, phys: null, kind, pos: new T.Vector3(), quat: new T.Quaternion(), zone: 'wall', owner: -1, idx: -1, ring: 0, scale: 1, tw: null, bounce: 0 };
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

    // 骰子
    const dieGeo = new T.BoxGeometry(2.3, 2.3, 2.3);
    const dieMats = DIE_FACES.map(v => new T.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.3, envMapIntensity: 0.5 }));
    for (let i = 0; i < 3; i++) {
      const m = new T.Mesh(dieGeo, dieMats);
      m.castShadow = true;
      m.visible = false;
      scene.add(m);
      const body = new C.Body({
        mass: 1, shape: new C.Box(new C.Vec3(1.15, 1.15, 1.15)),
        collisionFilterGroup: G_DICE, collisionFilterMask: G_GROUND | G_DICE | G_FENCE,
      });
      body.sleepSpeedLimit = 0.8; body.sleepTimeLimit = 0.25;
      let lastHit = 0;
      body.addEventListener('collide', () => {
        const now = performance.now();
        if (now - lastHit > 90) { lastHit = now; sfx('dice', 0.5, () => clack(0.35)); }
      });
      dice.push({ m, body, live: false });
    }

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
      if (toy) {
        if (toy.id === e.pointerId) dragChip(e);
        canvas.style.cursor = toy.drag ? 'grabbing' : 'grab';
        return;
      }
      const idx = pick(e);
      const toyAt = idx < 0 && e.pointerType === 'mouse' ? tableAt(e) : null;
      canvas.style.cursor = idx >= 0 ? 'pointer' : toyAt ? (toyAt.chip ? 'grab' : 'pointer') : '';
      const ht = handTileAt(e);
      hoverKind = ht ? ht.kind : -1;
      if (idx !== hover) { hover = idx; if (game) S.sync(); }
    });
    canvas.addEventListener('pointerleave', () => { hoverKind = -1; if (hover !== -1) { hover = -1; if (game) S.sync(); } });
    // 快點一下照舊（選取、再點一次打出，直接擺進牌池）；按住不放就是蓄力，放開把那張甩出去
    meter = document.getElementById('power');
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || charge || toy) return;
      const idx = pick(e);
      if (idx < 0) {
        // 不是出牌：籌碼拿起來玩，桌上的牌推一下
        const hit = tableAt(e);
        if (hit && hit.chip) { grabChip(hit.chip, e); canvas.setPointerCapture(e.pointerId); }
        else if (hit) flick(hit.tile, hit.point);
        return;
      }
      charge = { idx, id: e.pointerId, t0: performance.now(), p: 0, live: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', e => {
      if (toy && toy.id === e.pointerId) { releaseChip(); canvas.style.cursor = 'grab'; return; }
      const c = charge;
      if (!c || c.id !== e.pointerId) return;
      const fire = S.pickable && !!S.onPick;
      endCharge(!(fire && c.live));
      if (fire) S.onPick(c.idx, c.live ? c.p : null);
    });
    canvas.addEventListener('pointercancel', () => { endCharge(true); if (toy) releaseChip(); });
    canvas.addEventListener('contextmenu', e => { if (charge) e.preventDefault(); });
    window.addEventListener('resize', resize);
    resize();
    drawPlate();
    buildHands();
    requestAnimationFrame(frame);
  };

  function setCamera(yaw, z) {
    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    camera.position.set(sn * rig.dist * z, rig.high * z, cs * rig.dist * z);
    camera.lookAt(sn * rig.look, 0, cs * rig.look);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // 桌機最多 2 倍；手機螢幕小、像素密，給到原生倍率才不會糊（總像素約 330 萬為上限）
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(dpr, Math.max(2, Math.sqrt(3.3e6 / (w * h)))));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    cam.fit = Math.max(1, 1.72 / camera.aspect);
    const r = PHONE.matches ? RIG_PHONE : RIG;
    if (r !== rig) { rig = r; S.sync(); }
    if (S.onResize) S.onResize();
  }

  function pick(e) {
    if (!S.pickable) return -1;
    const t = handTileAt(e);
    return t ? t.idx : -1;
  }

  // 游標底下是我哪張手牌（不管現在能不能出牌）
  function aim(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
  }
  function handTileAt(e) {
    if (!game) return null;
    aim(e);
    const mine = tiles.filter(t => t.zone === 'hand' && t.owner === 0).map(t => t.g);
    const hit = raycaster.intersectObjects(mine, true).find(h => h.object.visible);
    return hit ? hit.object.parent.userData.tile : null;
  }

  // 桌上的點在螢幕上的位置：一律以鏡頭的歸位姿勢計算，標示才不會跟著運鏡飄
  function toScreen(v) {
    setCamera(0, cam.fit);
    camera.updateMatrixWorld();
    v.project(camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }
  // 玩家手牌上方（給喊牌的字用）
  S.screen = pid => toScreen(place(pid, 0, 9, pid === 0 ? 33 : 40, Q_STAND).pos);
  // 我每張手牌的正上方（給提示數字用），依手牌順序
  S.handPoints = () => tiles
    .filter(t => t.zone === 'hand' && t.owner === 0)
    .sort((a, b) => a.idx - b.idx)
    .map(t => toScreen(new T.Vector3(t.pos.x, 4.9 * rig.my, ROW - 2.5 * rig.my)));

  S.setGame = (g, fresh) => {
    game = g;
    // 新的一場或新的一局：籌碼直接擺成現在的現金
    if (fresh) syncChips(false);
  };

  // ---- 牌局狀態 → 每張牌該在哪 ----
  // 牌牆：四邊各 18 墩，i 為整副牌的摸牌順序（偶數在上層），從骰子決定的開門處起算
  function wallPlace(i, top) {
    const s = (Math.floor(i / 2) + S.wallOffset) % 72, k = s % 18;
    return jit(place(WALL_SIDES[Math.floor(s / 18)], (8.5 - k) * PITCH, top ? D * 1.5 + 0.02 : D / 2, WALL_Z, Q_DOWN),
      5000 + s * 2 + (top ? 1 : 0), 0.045, 0.014);
  }

  function computeSlots() {
    const out = [], g = game;
    const add = (kind, p, zone, o) =>
      out.push(Object.assign({ kind, pos: p.pos, quat: p.quat, zone, owner: -1, idx: -1, ring: 0, scale: 1 }, o));

    const n = g.wall.length;
    for (let j = 0; j < n; j++) {
      const i = g.taken + j;
      // 下層被從牌尾補走時，上層那張落到桌面
      add(g.wall[j], wallPlace(i, i % 2 === 0 && j + 1 < n), 'wall', { ring: i });
    }

    g.players.forEach((p, pid) => {
      const winner = !!S.reveal && S.reveal.pid === pid;
      const shown = winner || S.revealAll;
      const dir = order(pid), al = along(pid), dp = deep(pid);
      const hand = p.hand.slice();
      let discards = p.discards;
      let gapLast = g.turn === pid && g.drawn !== null && hand.length % 3 === 2;
      if (S.reveal && S.reveal.ron) {
        // 放槍的那張從牌河移到胡牌者手邊
        if (S.reveal.from === pid) discards = discards.slice(0, -1);
        if (winner) { hand.push(g.lastDiscard.tile); gapLast = true; }
      }

      // 花牌擺在自己牌河右側的空地，四張一排
      p.flowers.forEach((t, i) => {
        add(t, jit(flat(pid, 13 + al / 2 + (i % 4) * (al + 0.2), 13 + dp / 2 + Math.floor(i / 4) * (dp + 0.2)), 2000 + pid * 100 + i, 0.07, 0.035), 'flower', { owner: pid });
      });

      // 吃碰槓：第一組靠最右，之後往左排
      let mx = EDGE - al / 2;
      p.melds.forEach((m, mi) => {
        // 連線時別家的暗槓看不到牌種，m.fake 是四張佔位牌
        let ks = m.fake ? m.fake : m.type === 'chi' ? [m.tile, m.tile + 1, m.tile + 2]
          : m.type === 'pong' ? [m.tile, m.tile, m.tile] : [m.tile, m.tile, m.tile, m.tile];
        if (dir < 0) ks = ks.slice().reverse();
        for (let i = ks.length - 1; i >= 0; i--) {
          const down = m.type === 'ankong' && !shown && (pid !== 0 || i === 0 || i === 3);
          add(ks[i], jit(flat(pid, mx, ROW, down), 3000 + pid * 1000 + Math.round(mx * 3), 0.03, 0.012), 'meld',
            { owner: pid, idx: mi * 4 + (dir < 0 ? ks.length - 1 - i : i) });
          mx -= al;
        }
        mx -= 0.9;
      });
      const right = p.melds.length ? mx + al / 2 - 0.3 : EDGE;

      // 手牌：自己的放大一些；攤開時改成平躺
      const sc = pid === 0 && !shown ? rig.my : 1, step = shown ? al : PITCH * sc;
      const gap = gapLast ? 1.6 : 0, cnt = hand.length;
      const width = cnt * step + gap;
      let cx = 0;
      if (cx + width / 2 > right) cx = right - width / 2;
      if (cx - width / 2 < -EDGE) cx = -EDGE + width / 2;
      hand.forEach((t, i) => {
        const last = gapLast && i === cnt - 1;
        let pl;
        if (shown) {
          // 攤開的牌照我的閱讀方向排，胡的那張隔開放在最後
          const j = dir > 0 ? i : cnt - 1 - i;
          const hx = cx - width / 2 + step / 2 + j * step + (dir > 0 ? (last ? gap : 0) : (gapLast && !last ? gap : 0));
          pl = flat(pid, hx, ROW);
        } else {
          const hx = cx - width / 2 + step / 2 + i * step + (last ? gap : 0);
          if (pid === 0) {
            const lift = i === S.selected ? 1.5 : i === hover && S.pickable ? 0.5 : 0;
            const y = (H / 2 * Math.cos(LEAN) + D / 2 * Math.sin(LEAN)) * sc;
            pl = place(0, hx, y + lift * Math.cos(LEAN), ROW - lift * Math.sin(LEAN), Q_LEAN);
          } else pl = place(pid, hx, H / 2, ROW, Q_STAND);
        }
        add(t, pl, 'hand', { owner: pid, idx: i, scale: sc, win: winner && last });
      });

      const cols = pid % 2 ? 5 : 7;
      discards.forEach((t, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        add(t, jit(flat(pid, dir * (col - (cols - 1) / 2) * (al + 0.25), POOL_Z + dp / 2 + row * (dp + 0.2)), 1000 + pid * 100 + i, 0.08, 0.04), 'discard', { owner: pid, idx: i });
      });
    });
    return out;
  }

  // ---- 動畫 ----
  // o: dur 毫秒、arc 拋物線高度、spin 翻滾圈數、delay、pre 起飛前先提起的時間、land 落桌效果（true 或 'big'）
  function go(t, slot, o) {
    if (t.rest) endRest(t);
    t.home = null;
    if (t.phys) endPhys(t);
    // 剛摸進來還在飛的那張先歸位，手才不會伸到半空中去抓
    else if (o.grab && t.tw) { t.g.position.copy(t.pos); t.g.quaternion.copy(t.quat); }
    t.pos.copy(slot.pos); t.quat.copy(slot.quat);
    const s0 = t.g.scale.x;
    t.scale = slot.scale || 1;
    const k = S.reduced ? 0.4 : 1, pre = S.reduced ? 0 : o.pre || 0;
    const grab = pre && o.grab ? o.grab : 0;
    t.tw = {
      s0, pre, grab, phys: !!o.phys && !S.reduced, power: o.power == null ? null : o.power,
      p0: t.g.position.clone(), q0: t.g.quaternion.clone(),
      t0: performance.now() + (o.delay || 0) * k + pre,
      dur: o.dur * k, arc: (o.arc || 0) * k, spin: S.reduced ? 0 : o.spin || 0, land: o.land || false,
    };
    if (grab) reach(hands[slot.owner], t);
  }

  function motion(t, slot, dist) {
    const from = t.zone, to = slot.zone, other = slot.owner !== 0;
    const delay = S.dealing ? t.ring * 9 : 0;
    // 別家出牌：手先伸過去捏住，從手牌裡抽起來，再甩出去（手還沒載好就只有牌自己動）
    if (to === 'discard' && from !== 'discard') {
      const hand = other && hands[slot.owner];
      let power = null;
      if (!other && S.throwPower != null) { power = S.throwPower; S.throwPower = null; }
      // 自己快點出牌：不甩，直接擺到牌池該放的位置；按住蓄力才真的甩出去
      if (!other && power == null) return { dur: 380, arc: 4, land: true };
      return { phys: true, dur: 300, arc: 4, land: true, pre: hand ? 560 : other ? 240 : 0, grab: hand ? 340 : 0, power };
    }
    // 吃碰槓：被叫的那張貼著桌面滑過去，手裡的牌翻開跟上
    if (to === 'meld' && from === 'discard') return { dur: 430, arc: 1, land: true, pre: 150 };
    if (to === 'meld') return { dur: 460, arc: 5, land: true, pre: other ? 160 : 0 };
    if (to === 'flower') return { dur: 520, arc: 7, spin: 1, delay };
    if (to === 'hand' && from === 'wall') return { dur: 400, arc: 5, delay };
    if (slot.win) return { dur: 900, arc: 15, spin: 2, delay: 850, land: 'big' };
    if (to === 'hand' && (S.reveal || S.revealAll)) return { dur: 480, arc: 2.5, delay: slot.idx * 35 };
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

  // 被撞歪的牌記得原本該在哪，牌局沒變就不用搬它
  const homeOf = t => t.home || t;
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
          const d = homeOf(ms[i]).pos.distanceTo(s.pos);
          if (d > 0.01) cost += d + 0.5;
        }
        if (cost < bestCost) { bestCost = cost; best = perm; }
      }
      ms.forEach((t, i) => {
        const s = ss[best[i]];
        if (!s) return;
        const h = homeOf(t), dist = h.pos.distanceTo(s.pos);
        if (dist > 0.01 || h.quat.angleTo(s.quat) > 0.01 || t.scale !== s.scale) go(t, s, motion(t, s, dist));
        t.zone = s.zone; t.owner = s.owner; t.idx = s.idx; t.ring = s.ring;
      });
    }
    // 牌搬到新位置後，旁邊歪著放的牌可能會穿到它，再收一次
    settleRests([]);
    drawPlate();
  };

  // 連線時蓋著的牌只是佔位：把兩張實體牌的牌面對調，位置不動
  S.swapKinds = (a, b) => {
    const find = d => tiles.find(t => t.zone === d.zone && (d.zone === 'wall' ? t.ring === d.ring : t.owner === d.owner && t.idx === d.idx));
    const x = find(a), y = find(b);
    if (!x || !y || x.kind === y.kind) return;
    const fx = x.g.children[2], fy = y.g.children[2];
    [fx.material, fy.material] = [fy.material, fx.material];
    byKind[x.kind][byKind[x.kind].indexOf(x)] = y;
    byKind[y.kind][byKind[y.kind].indexOf(y)] = x;
    [x.kind, y.kind] = [y.kind, x.kind];
  };

  // 略過動畫，直接到位
  S.settle = () => {
    for (const t of tiles) {
      if (t.phys) endPhys(t);
      if (t.rest) endRest(t);
      t.tw = null; t.bounce = 0;
      t.g.position.copy(t.pos); t.g.quaternion.copy(t.quat); t.g.scale.setScalar(t.scale);
    }
    for (const a of props.splice(0)) a.obj.position.copy(a.p1);
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

  function hideDice() {
    for (const d of dice) {
      if (d.live) { world.removeBody(d.body); d.live = false; }
      d.m.visible = false;
    }
  }
  // 莊家擲三顆骰子，等它們停下來再讀朝上的點數
  async function rollDice(dealer) {
    dice.forEach((d, i) => {
      const from = place(dealer, (i - 1) * 3.4, 5 + i * 1.6, 10, Q_STAND).pos, b = d.body;
      b.position.set(from.x, from.y, from.z);
      b.quaternion.setFromEuler(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      b.velocity.set((rnd(-3, 3) - from.x) * 1.5, rnd(4, 12), (rnd(-3, 3) - from.z) * 1.5);
      b.angularVelocity.set(rnd(-25, 25), rnd(-25, 25), rnd(-25, 25));
      if (!d.live) { world.addBody(b); d.live = true; }
      b.wakeUp();
      d.m.visible = true;
    });
    const t0 = performance.now();
    while (performance.now() - t0 < 3200) {
      await sleep(120);
      if (performance.now() - t0 > 700 && dice.every(d => d.body.sleepState === 2)) break;
    }
    const q = new T.Quaternion();
    return dice.map(d => {
      q.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
      let best = 0, top = -2;
      DIE_AXES.forEach((a, i) => { const y = a.clone().applyQuaternion(q).y; if (y > top) { top = y; best = i; } });
      return DIE_FACES[best];
    });
  }

  // 立刻擺到定位，不播動畫
  function snap(t, pl) {
    t.pos.copy(pl.pos); t.quat.copy(pl.quat); t.scale = 1; t.tw = null;
    t.g.position.copy(pl.pos); t.g.quaternion.copy(pl.quat); t.g.scale.setScalar(1);
  }

  // 新的一局：洗牌 → 砌牌 → 擲骰開門 → 發牌
  S.deal = async () => {
    S.reveal = null; S.revealAll = false; S.mark = false; S.idle = false; S.selected = -1;
    S.seed = Math.random() * 1000;
    cam.yawTo = 0; cam.zoomTo = 1;
    hideDice();
    fly(dealerBlock, dealerSpot(game.dealer), { dur: 600, arc: 8 });
    // 從莊家起逆時針數到第 sum 家，再從那一面牆的右端數 sum 墩開門
    const breakAt = sum => (WALL_SIDES.indexOf((game.dealer + sum - 1) % 4) * 18 + sum) % 72;
    for (const t of tiles) { if (t.phys) endPhys(t); if (t.rest) endRest(t); t.home = null; t.zone = 'wall'; }

    if (S.reduced) {
      S.wallOffset = breakAt(3 + Math.floor(Math.random() * 16));
      S.sync();
      await sleep(500);
      return;
    }

    cam.yaw = Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw)) + 0.5;
    for (const t of tiles) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.sqrt(Math.random()) * 24;
      const q = new T.Quaternion().setFromAxisAngle(Y, Math.random() * Math.PI * 2).multiply(Q_DOWN);
      go(t, { pos: new T.Vector3(Math.cos(a) * r, D / 2 + Math.random() * 3, Math.sin(a) * r), quat: q },
        { dur: 520, arc: 5, spin: 1, delay: Math.random() * 200 });
    }
    sfx('shuffle', 0.8, () => { for (let i = 0; i < 16; i++) setTimeout(() => clack(0.25 + Math.random() * 0.35), Math.random() * 900); });
    await sleep(900);

    // 先把牌牆砌起來（這時還不知道從哪裡開門）
    S.wallOffset = 0;
    shuffled(tiles).forEach((t, i) => { t.ring = i; go(t, wallPlace(i, i % 2 === 0), { dur: 480, arc: 4, delay: i * 4 }); });
    await sleep(1200);

    const vals = await rollDice(game.dealer);
    const sum = vals[0] + vals[1] + vals[2];
    if (S.onDice) S.onDice(game.dealer, sum);
    await sleep(900);

    // 牌背看起來都一樣：開門位置定了之後，趁沒人看得出來把每張牌換到它真正的位置
    S.wallOffset = breakAt(sum);
    const n = game.wall.length, used = new Set(), free = [];
    for (let i = 0; i < 144; i++) if (i < game.taken || i >= game.taken + n) free.push(i);
    const put = (t, i) => { t.ring = i; snap(t, wallPlace(i, i % 2 === 0)); };
    for (let j = 0; j < n; j++) {
      const t = byKind[game.wall[j]].find(m => !used.has(m));
      used.add(t);
      put(t, game.taken + j);
    }
    tiles.filter(t => !used.has(t)).forEach((t, k) => put(t, free[k]));

    S.dealing = true;
    S.sync();
    S.dealing = false;
    await sleep(game.taken * 9 + 600);
    hideDice();
  };

  // 喊牌時鏡頭往那一家靠一下
  let focusTimer = 0;
  S.focus = (pid, ms) => {
    if (S.reduced) return;
    cam.yawTo = [0, 0.2, 0, -0.2][pid];
    cam.zoomTo = pid === 2 ? 0.93 : 0.95;
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => { if (!S.reveal) { cam.yawTo = 0; cam.zoomTo = 1; } }, ms);
  };

  // 胡牌：鏡頭轉向贏家、灑金粉
  S.celebrate = pid => {
    clearTimeout(focusTimer);
    if (!S.reduced) { cam.yawTo = [0, 0.32, 0, -0.32][pid]; cam.zoomTo = 0.93; }
    const c = place(pid, 0, 3, ROW - 4, Q_STAND).pos, pos = sparks.geometry.attributes.position;
    const wide = pid % 2 ? [6, 30] : [30, 6];
    sparkVel.forEach((v, i) => {
      pos.setXYZ(i, c.x + (Math.random() - 0.5) * wide[0], c.y, c.z + (Math.random() - 0.5) * wide[1]);
      v.set((Math.random() - 0.5) * 16, 14 + Math.random() * 22, (Math.random() - 0.5) * 16);
    });
    pos.needsUpdate = true;
    sparkLife = 2.6;
    sparks.visible = true;
    S.handPose(pid, 'cheer', 2800);
  };
  // 結算看完，鏡頭歸位
  S.rest = () => { cam.yawTo = 0; cam.zoomTo = 1; };

  function ring(pos, big) {
    const r = rings.find(x => x.userData.t0 < 0) || rings[0];
    r.position.set(pos.x, 0.06, pos.z);
    r.userData.t0 = performance.now();
    r.userData.big = big ? 2.6 : 1;
  }

  // ---- 音效 ----
  let actx = null;
  S.audio = () => {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  };
  // sounds/ 資料夾裡放了同名的 mp3 就播錄音，否則退回合成音
  const samples = {};
  for (const name of ['discard', 'shuffle', 'dice', 'win']) {
    const a = new Audio('sounds/' + name + '.mp3');
    a.addEventListener('canplaythrough', () => { samples[name] = a; }, { once: true });
  }
  function sfx(name, vol, fallback) {
    if (S.muted) return;
    const a = samples[name];
    if (!a) { fallback(); return; }
    const c = a.cloneNode();
    c.volume = Math.min(1, vol);
    c.play().catch(() => {});
  }
  // 牌敲桌面
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
  // 一聲短音：freq 赫茲、dur 秒
  function tone(freq, dur, vol, type) {
    if (!actx || S.muted) return;
    const o = actx.createOscillator(), gain = actx.createGain(), t = actx.currentTime;
    o.type = type || 'sine';
    o.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gain); gain.connect(actx.destination);
    o.start(t); o.stop(t + dur);
  }
  S.tick = () => tone(880, 0.12, 0.15, 'triangle');
  S.fanfare = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.5, 0.16, 'triangle'), i * 110));
  // 喊牌：有中文語音就念出來，沒有就用幾聲短音代替（吃一聲、碰兩聲、槓三聲）
  S.say = text => {
    if (S.muted) return;
    const word = text.includes('胡') ? '胡' : text.includes('槓') ? '槓' : text;
    const synth = window.speechSynthesis;
    const voice = synth && synth.getVoices().find(v => /^zh/i.test(v.lang));
    if (voice) {
      const u = new SpeechSynthesisUtterance(word);
      u.voice = voice; u.lang = voice.lang; u.rate = 1.15; u.volume = 0.9;
      synth.cancel();
      synth.speak(u);
      return;
    }
    const n = { 吃: 1, 碰: 2, 槓: 3 }[word] || 1;
    for (let i = 0; i < n; i++) setTimeout(() => tone(word === '胡' || word === '自摸' ? 660 : 440, 0.18, 0.2, 'square'), i * 130);
  };

  // ---- 中央資訊牌 ----
  function drawPlate() {
    const c = plateCtx;
    c.clearRect(0, 0, 512, 512);
    // 方框、雙金線、四角折角，與介面一致
    c.fillStyle = 'rgba(8, 26, 25, 0.72)';
    c.fillRect(16, 16, 480, 480);
    c.strokeStyle = 'rgba(227, 178, 60, 0.45)';
    c.lineWidth = 3;
    c.strokeRect(17.5, 17.5, 477, 477);
    c.strokeStyle = 'rgba(227, 178, 60, 0.25)';
    c.lineWidth = 2;
    c.strokeRect(38, 38, 436, 436);
    c.fillStyle = '#e3b23c';
    for (const [x, y] of [[16, 16], [496, 16], [16, 496], [496, 496]]) {
      const sx = x < 256 ? 1 : -1, sy = y < 256 ? 1 : -1;
      c.fillRect(Math.min(x, x + sx * 64), Math.min(y, y + sy * 9), 64, 9);
      c.fillRect(Math.min(x, x + sx * 9), Math.min(y, y + sy * 64), 9, 64);
    }
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

  // ---- 對手的手 ----
  // 三位對手各兩隻浮在桌上的手：WebXR 的 generic-hand 模型（單位公尺），沒有手臂，手腕漸漸淡掉。
  // 每家的膚色、手的大小與粗細、皺紋、指甲和配件（手錶、玉鐲、金戒指）都不一樣。
  // 出牌用右手；平時兩隻手靜靜擱在桌緣，胡牌時握拳揮動。
  // 模型的關節全是平輩，載入後照手指重新串成父子，才能一節一節彎。
  // 模型沒載到（例如直接開檔案）就沒有手，牌照舊自己飛。
  // 現在預設換成貓掌（見下面「貓掌」）；網址加 ?hands=human 換回人手。
  const HAND_KIND = /[?&]hands=human\b/.test(location.search) ? 'human' : 'cat';
  const HAND_SCALE = 102;                   // 桌上一單位約 0.9 公分
  // 三家各自的手：膚色、大小、手指粗細、老化（皺紋）、斑點、指甲顏色、配件（L/R 戴在哪隻手）
  const LOOKS = [null,
    { skin: 0xb27b58, size: 1.06, thick: 1.12, age: 0.35, blotch: 0.5, nail: 0xd8b4a2, polish: false, gear: { L: 'watch' } },   // 阿明
    { skin: 0xf0c6a6, size: 0.9, thick: 0.86, age: 0.05, blotch: 0.2, nail: 0xa8102a, polish: true, gear: { L: 'bangle' } },   // 美玲
    { skin: 0xa9765a, size: 1.0, thick: 0.98, age: 1, blotch: 1, nail: 0xcdb09c, polish: false, gear: { R: 'ring' } },          // 老陳
  ];
  const hands = [];                         // 各家的右手（出牌那隻）
  const allHands = [];
  // 每節往掌心彎的角度：[放鬆, 捏牌]，依序是近節、中節、遠節
  const CURL = {
    index: [[0.2, 0.75], [0.3, 0.75], [0.15, 0.35]],
    middle: [[0.25, 0.8], [0.3, 0.8], [0.15, 0.35]],
    ring: [[0.3, 1.25], [0.35, 1.2], [0.2, 0.6]],
    pinky: [[0.35, 1.35], [0.35, 1.2], [0.2, 0.6]],
  };
  // 模型裡手指朝 -Y、拇指在 -Z，右手掌心朝 -X、左手朝 +X；轉成手指朝 -z、掌心朝下。
  // side：右手 1、左手 -1，左手的一切都是右手對 x 鏡射
  const handBasis = side => new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4().makeBasis(new T.Vector3(0, side, 0), new T.Vector3(0, 0, 1), new T.Vector3(side, 0, 0)));
  const handTurn = (side, yaw, pitch, roll) =>
    new T.Quaternion().setFromAxisAngle(Y, yaw * side).multiply(rotX(pitch)).multiply(new T.Quaternion().setFromAxisAngle(Z, roll * side));

  // 手的姿勢。p：捏點在座位座標的位置（x 以右手為準，左手自動鏡射）；yaw/pitch/roll：手的轉向；
  // c：手指彎多少（0 放鬆、1 捏牌）
  const EDGE_REST = { p: [40, 3.6, 54], yaw: 0.45, pitch: -0.25, roll: 0, c: 0 };
  const STANCES = {
    rest: { R: EDGE_REST, L: EDGE_REST },
    // 胡牌：兩手握拳在牌上方揮動
    cheer: {
      R: { p: [12, 11, 48], yaw: 0.2, pitch: 1.35, roll: -1.3, c: 1.35, pump: true },
      L: { p: [12, 11, 48], yaw: 0.2, pitch: 1.35, roll: -1.3, c: 1.35, pump: true },
    },
  };
  const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky', 'thumb'];

  // 皮膚：模型沒有貼圖，膚色不均、斑點、關節皺紋、指尖泛紅、指甲都用綁定姿勢的座標在 shader 裡算。
  // 手腕用網點淡出。marks 是綁定姿勢裡的指尖、指甲、關節位置。
  const SKIN_GLSL = `
    varying vec3 vHandPos;
    varying vec3 vHandNrm;
    uniform vec3 uTips[5];
    uniform vec3 uNails[5];
    uniform vec3 uNailDir[5];
    uniform vec3 uKnuck[14];
    uniform vec3 uDorsal;
    uniform vec3 uNail;
    uniform float uAge, uBlotch, uPolish;
    float hHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float hNoise(vec3 x) {
      vec3 i = floor(x), f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hHash(i), hHash(i + vec3(1, 0, 0)), f.x), mix(hHash(i + vec3(0, 1, 0)), hHash(i + vec3(1, 1, 0)), f.x), f.y),
                 mix(mix(hHash(i + vec3(0, 0, 1)), hHash(i + vec3(1, 0, 1)), f.x), mix(hHash(i + vec3(0, 1, 1)), hHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
  `;
  const SKIN_COLOR = `
    #include <color_fragment>
    float hFade = 1.0 - smoothstep(0.022, 0.07, vHandPos.y);
    if (hFade < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
    vec3 hn = normalize(vHandNrm);
    float back = smoothstep(0.1, 0.6, dot(hn, uDorsal));
    // 膚色不均與斑點（老人手背多）
    float blot = hNoise(vHandPos * 150.0) * 0.6 + hNoise(vHandPos * 400.0) * 0.4;
    diffuseColor.rgb *= 1.0 + (blot - 0.5) * 0.24 * (0.5 + uBlotch);
    float spots = smoothstep(0.8, 0.9, hNoise(vHandPos * 260.0 + 7.0)) * uBlotch * back;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.74, 0.6, 0.5), spots * 0.55);
    // 關節泛紅，手背那面有一圈圈皺紋
    float kn = 0.0;
    for (int i = 0; i < 14; i++) kn = max(kn, 1.0 - smoothstep(0.003, 0.011, distance(vHandPos, uKnuck[i])));
    float lines = pow(0.5 + 0.5 * sin(vHandPos.y * 2400.0 + hNoise(vHandPos * 300.0) * 5.0), 5.0);
    diffuseColor.rgb *= 1.0 - kn * back * lines * (0.2 + 0.45 * uAge);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.04, 0.8, 0.74), kn * 0.4);
    // 指尖泛紅
    float tipR = 0.0;
    for (int i = 0; i < 5; i++) tipR = max(tipR, 1.0 - smoothstep(0.003, 0.016, distance(vHandPos, uTips[i])));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.04, 0.8, 0.76), tipR * 0.45);
    // 指甲
    float hNail = 0.0;
    for (int i = 0; i < 5; i++) {
      float d = distance(vHandPos, uNails[i]);
      float r = i == 3 ? 0.8 : i == 2 ? 0.92 : i == 4 ? 1.12 : 1.0;
      hNail = max(hNail, (1.0 - smoothstep(0.0048 * r, 0.006 * r, d)) * smoothstep(0.3, 0.6, dot(hn, uNailDir[i])));
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, uNail, hNail);
  `;

  function skinMaterial(look, marks) {
    const m = new T.MeshPhysicalMaterial({
      color: look.skin, roughness: 0.58, sheen: 0.5, sheenColor: new T.Color(0xff9c80), sheenRoughness: 0.55,
      clearcoat: 0.06, clearcoatRoughness: 0.5, envMapIntensity: 0.35,
    });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, {
        uTips: { value: marks.tips }, uNails: { value: marks.nails }, uNailDir: { value: marks.nailDir }, uKnuck: { value: marks.knuck },
        uDorsal: { value: marks.dorsal }, uNail: { value: new T.Color(look.nail) },
        uAge: { value: look.age }, uBlotch: { value: look.blotch }, uPolish: { value: look.polish ? 1 : 0 },
      });
      sh.vertexShader = 'varying vec3 vHandPos;\nvarying vec3 vHandNrm;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHandPos = position;\nvHandNrm = normal;');
      sh.fragmentShader = SKIN_GLSL + sh.fragmentShader
        .replace('#include <color_fragment>', SKIN_COLOR)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, uPolish > 0.5 ? 0.12 : 0.32, hNail);')
        .replace('#include <tonemapping_fragment>', `
          // 透光感：邊緣帶一點血色
          float hRim = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);
          gl_FragColor.rgb += vec3(0.3, 0.07, 0.03) * hRim * 0.4 * (1.0 - hNail);
          #include <tonemapping_fragment>`);
    };
    return m;
  }

  // 配件都以綁定姿勢（公尺）擺好，再掛到骨頭上跟著動
  const GEAR_MATS = {};
  const gearMat = (k, o) => GEAR_MATS[k] || (GEAR_MATS[k] = new T.MeshPhysicalMaterial(o));
  function addGear(kind, mesh, at, wristBone, ringBone, side) {
    const pos = mesh.geometry.attributes.position, v = new T.Vector3();
    // 某一段的截面：中心與半徑（x 是手掌厚度方向、z 是手寬）
    const section = test => {
      const c = new T.Vector3(), lo = new T.Vector3(1, 1, 1), hi = new T.Vector3(-1, -1, -1);
      let n = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (!test(v)) continue;
        c.add(v); lo.min(v); hi.max(v); n++;
      }
      return { c: c.divideScalar(n || 1), half: hi.sub(lo).multiplyScalar(0.5) };
    };
    const g = new T.Group();
    let bone;
    if (kind === 'ring') {
      const a = at('ring-finger-phalanx-proximal'), b = at('ring-finger-phalanx-intermediate');
      const axis = b.clone().sub(a).normalize(), mid = a.clone().lerp(b, 0.5);
      const sec = section(p => Math.abs(p.clone().sub(mid).dot(axis)) < 0.003 && p.distanceTo(mid) < 0.016);
      const r = Math.max(sec.half.x, sec.half.z) * 1.05;
      const band = new T.Mesh(new T.TorusGeometry(r, 0.0017, 10, 40),
        gearMat('gold', { color: 0xd4a347, metalness: 1, roughness: 0.25, envMapIntensity: 1.2 }));
      band.position.copy(sec.c);
      band.quaternion.setFromUnitVectors(Z, axis);
      g.add(band);
      bone = ringBone;
    } else {
      const sec = section(p => p.y > 0.022 && p.y < 0.036);
      const ring = (ax, az, tube, width, mat) => {
        const m = new T.Mesh(new T.TorusGeometry(1, tube, 12, 48).rotateX(Math.PI / 2), mat);
        m.scale.set(ax, width / tube, az);
        m.position.copy(sec.c);
        g.add(m);
        return m;
      };
      if (kind === 'bangle') {
        // 玉鐲：鬆鬆地套在手腕上
        ring(sec.half.x * 1.3, sec.half.z * 1.18, 0.12, 0.0055,
          gearMat('jade', { color: 0x4f9a68, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.9 }));
      } else {
        // 手錶：皮錶帶＋手背那面的金色錶面
        ring(sec.half.x * 1.06, sec.half.z * 1.04, 0.1, 0.009, gearMat('strap', { color: 0x2b1b12, roughness: 0.7 }));
        const face = new T.Group();
        const cas = new T.Mesh(new T.CylinderGeometry(0.0135, 0.0135, 0.006, 32),
          gearMat('gold', { color: 0xd4a347, metalness: 1, roughness: 0.25, envMapIntensity: 1.2 }));
        const dial = new T.Mesh(new T.CylinderGeometry(0.011, 0.011, 0.0062, 32), gearMat('dial', { color: 0xf3eee2, roughness: 0.3, clearcoat: 1 }));
        face.add(cas, dial);
        face.quaternion.setFromUnitVectors(Y, new T.Vector3(side, 0, 0));
        face.position.copy(sec.c).add(new T.Vector3(side * (sec.half.x * 1.06 + 0.002), 0, 0));
        g.add(face);
      }
      bone = wristBone;
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // 綁定姿勢 → 骨頭底下：乘上那根骨頭的 boneInverse
    const sk = mesh.skeleton;
    g.applyMatrix4(sk.boneInverses[sk.bones.indexOf(bone)]);
    bone.add(g);
  }

  function buildHands() {
    if (HAND_KIND === 'cat') {
      for (let pid = 1; pid < 4; pid++) {
        for (const side of [1, -1]) {
          const h = makePaw(pid, side);
          allHands.push(h);
          if (side > 0) hands[pid] = h;
        }
      }
      return;
    }
    if (!T.GLTFLoader) return;
    for (let pid = 1; pid < 4; pid++) {
      for (const side of [1, -1]) {
        new T.GLTFLoader().load(side > 0 ? 'models/hand-right.glb' : 'models/hand-left.glb', gltf => {
          const h = makeHand(pid, side, gltf.scene);
          allHands.push(h);
          if (side > 0) hands[pid] = h;
        }, undefined, () => {});
      }
    }
  }

  function makeHand(pid, side, model) {
    const bone = {};
    model.updateMatrixWorld(true);
    let mesh;
    model.traverse(o => {
      if (o.isBone) bone[o.name] = o;
      if (o.isSkinnedMesh) { mesh = o; o.castShadow = true; o.frustumCulled = false; }
    });
    // 綁定姿勢裡各關節的位置（節點的靜止姿勢跟網格對不上，要用 boneInverses 反推）
    const sk = mesh.skeleton, look = LOOKS[pid];
    const at = name => new T.Vector3().setFromMatrixPosition(sk.boneInverses[sk.bones.indexOf(bone[name])].clone().invert());
    const tipName = f => f === 'thumb' ? 'thumb-tip' : f + '-finger-tip';
    const lastName = f => f === 'thumb' ? 'thumb-phalanx-distal' : f + '-finger-phalanx-distal';
    const dorsal = new T.Vector3(side, 0, 0);
    // 「指尖」關節其實在最後一節中間，真正的指尖要往外再找網格上最遠的點；
    // 指甲中心放在離指尖 6 公釐那圈截面上最靠手背的點（拇指的指甲朝外側）
    const verts = mesh.geometry.attributes.position, pv = new T.Vector3();
    const tips = [], nails = [], nailDir = [];
    FINGER_NAMES.forEach(f => {
      const joint = at(tipName(f)), dir = joint.clone().sub(at(lastName(f))).normalize();
      const out = (f === 'thumb' ? new T.Vector3(side * 0.55, 0, -0.85) : dorsal.clone()).normalize();
      const end = joint.clone(), nail = new T.Vector3(), mid = new T.Vector3();
      let far = -Infinity, top = -Infinity, n = 0;
      for (let i = 0; i < verts.count; i++) {
        pv.fromBufferAttribute(verts, i);
        if (pv.distanceTo(joint) < 0.02 && pv.dot(dir) > far) { far = pv.dot(dir); end.copy(pv); }
      }
      // 網格很粗，取前後 4 公釐一段來估手指的中軸與手背那面的高度
      const ring = end.clone().addScaledVector(dir, -0.006), up = out.addScaledVector(dir, -out.dot(dir)).normalize();
      for (let i = 0; i < verts.count; i++) {
        pv.fromBufferAttribute(verts, i);
        if (Math.abs(pv.clone().sub(ring).dot(dir)) > 0.004 || pv.distanceTo(ring) > 0.013) continue;
        mid.add(pv); n++;
      }
      if (n) mid.divideScalar(n).addScaledVector(dir, ring.clone().sub(mid).dot(dir));
      else mid.copy(ring);
      for (let i = 0; i < verts.count; i++) {
        pv.fromBufferAttribute(verts, i);
        if (Math.abs(pv.clone().sub(ring).dot(dir)) > 0.004 || pv.distanceTo(ring) > 0.013) continue;
        top = Math.max(top, pv.clone().sub(mid).dot(up));
      }
      nail.copy(mid).addScaledVector(up, top > 0 ? top : 0.006);
      tips.push(end.addScaledVector(dir, -0.003));
      nails.push(nail);
      nailDir.push(up);
    });
    const marks = {
      dorsal, nailDir, tips, nails,
      knuck: [].concat(...FINGER_NAMES.map(f => f === 'thumb'
        ? [at('thumb-phalanx-proximal'), at('thumb-phalanx-distal')]
        : ['proximal', 'intermediate', 'distal'].map(seg => at(`${f}-finger-phalanx-${seg}`)))),
    };
    mesh.material = skinMaterial(look, marks);
    const gear = look.gear[side > 0 ? 'R' : 'L'];
    if (gear) addGear(gear, mesh, at, bone.wrist, bone['ring-finger-phalanx-proximal'], side);
    const wq = o => o.getWorldQuaternion(new T.Quaternion());
    const wp = o => o.getWorldPosition(new T.Vector3());
    // 關節：接到上一節底下，記住原本的角度，以及在上一節座標裡的彎曲軸
    const joints = [];
    const hinge = (name, parent, axis, bend) => {
      const b = bone[name];
      parent.attach(b);
      const fi = FINGER_NAMES.findIndex(n => name.startsWith(n));
      joints.push({ b, fi, q0: b.quaternion.clone(), ax: axis.clone().applyQuaternion(wq(parent).invert()), bend });
      return b;
    };
    const flex = new T.Vector3(0, 0, -side), none = [0, 0];
    for (const f in CURL) {
      let p = hinge(f + '-finger-metacarpal', bone.wrist, flex, none);
      ['proximal', 'intermediate', 'distal'].forEach((seg, i) => { p = hinge(`${f}-finger-phalanx-${seg}`, p, flex, CURL[f][i]); });
      p.attach(bone[f + '-finger-tip']);
    }
    // ex：每根手指（食、中、無名、小、拇）額外多彎的量
    const pose = (c, ex) => {
      for (const j of joints) j.b.quaternion.setFromAxisAngle(j.ax, j.bend[0] + (j.bend[1] - j.bend[0]) * (c + (ex ? ex[j.fi] : 0))).multiply(j.q0);
    };
    // 拇指：繞著「拇指根 → 食指中指指尖」這個平面轉過去對捏
    pose(1);
    model.updateMatrixWorld(true);
    const pads = () => wp(bone['index-finger-tip']).lerp(wp(bone['middle-finger-tip']), 0.5);
    const base = wp(bone['thumb-metacarpal']);
    const along = wp(bone['thumb-tip']).sub(base), want = pads().sub(base);
    const swing = along.clone().cross(want).normalize(), ang = along.angleTo(want);
    let p = hinge('thumb-metacarpal', bone.wrist, swing, [0, ang * 0.72]);
    p = hinge('thumb-phalanx-proximal', p, swing, [0.05, 0.25]);
    p = hinge('thumb-phalanx-distal', p, swing, [0.05, 0.2]);
    p.attach(bone['thumb-tip']);

    // 手腕放在原點
    const g = new T.Group(), fit = new T.Group();
    fit.quaternion.copy(handBasis(side));
    // 大小與手指粗細：模型的 x 是手掌厚度、y 沿手指、z 是手寬
    const sz = HAND_SCALE * look.size;
    fit.scale.set(sz * look.thick, sz, sz * look.thick);
    fit.position.copy(wp(bone.wrist)).multiply(fit.scale).applyQuaternion(fit.quaternion).negate();
    fit.add(model);
    g.add(fit);
    // 捏牌時拇指與食指中指之間的那一點，相對手腕的位置
    pose(1);
    g.updateMatrixWorld(true);
    const grip = pads().lerp(wp(bone['thumb-tip']), 0.5);
    pose(0);

    scene.add(g);
    return { pid, side, g, pose, grip, p: new T.Vector3(), ip: new T.Vector3(), q: new T.Quaternion(), c: 0, fresh: true, job: null,
      qGrab: handTurn(side, 0.1, -0.95, 0), stances: STANCES };
  }

  // ---- 貓掌 ----
  // 程式產生，不用模型檔。座標直接用桌上單位，跟 handBasis 轉完的人手一樣：腳趾朝 -z、肉球朝下、手腕在原點。
  // 掌、手腕、前腳、四根腳趾是一團團橢球，合成一個蒙皮網格，四根腳趾各掛一根骨頭來彎。
  // 毛用外殼法：同一份網格沿法線往外疊 FUR_SHELLS 層，越外層留下的毛越少，疊出一根根尖尖的毛。
  // 肉球和爪子是另外的小網格，掛在骨頭上；爪子只有抓牌時才伸出來。
  // 三家的貓：毛色、虎斑條紋色與濃淡、掌底與肚子的顏色、白手套、肉球顏色、大小
  const CATS = [null,
    { fur: 0xf0a560, stripe: 0xc8743a, belly: 0xfbe6c8, stripes: 0.8, mitten: 0, bean: 0xf7a0a4, size: 0.92 },  // 阿明：橘虎斑
    { fur: 0xfbf7f1, stripe: 0xefe2d0, belly: 0xffffff, stripes: 0.3, mitten: 0, bean: 0xffb3c1, size: 0.8 },  // 美玲：白貓
    { fur: 0x2a272d, stripe: 0x1f1d22, belly: 0x36323a, stripes: 0, mitten: 1, bean: 0xf6a3b0, size: 0.86 },   // 老陳：賓士貓，白手套
  ];
  const CAT_REST = { p: [33, 1.2, 55], yaw: 0.3, pitch: 0.05, roll: 0, c: 0 };
  const CAT_STANCES = {
    // 平常兩隻前腳搭在桌緣，腳趾掛在邊上
    rest: { R: CAT_REST, L: CAT_REST },
    // 胡牌：舉起前腳，肉球朝桌心招手
    cheer: {
      R: { p: [14, 12, 47], yaw: 0.15, pitch: 1.0, roll: 0, c: 1.55, beckon: true },
      L: { p: [14, 12, 47], yaw: 0.15, pitch: 1.0, roll: 0, c: 1.55, beckon: true },
    },
  };
  const FUR_SHELLS = 22, FUR_LEN = 0.6;
  const WRIST = new T.Vector3(0, 2.4, 0.6), LEG_DIR = new T.Vector3(0, 0.42, 1).normalize();
  const TOES = [[-2.2, -5.0], [-0.76, -5.85], [0.76, -5.85], [2.2, -5.0]];   // 各腳趾中心的 x、z
  const TOE_Y = 1.05;

  // 一團團橢球 → 一份含 FUR_SHELLS 層的網格；aShell 是第幾層（0 是皮、1 是毛尖）
  function pawGeometry() {
    const parts = [];
    // 每團要疊 FUR_SHELLS 層，面數省著用：小團（腳趾）分段少一點
    const blob = (bone, at, r) => {
      const seg = r[0] > 2 ? 24 : 16;
      parts.push({ bone, g: new T.SphereGeometry(1, seg, seg * 0.7 | 0).scale(r[0], r[1], r[2]).translate(at[0], at[1], at[2]) });
    };
    // 圓滾滾的：掌胖胖的像饅頭，腳趾大顆擠在一起
    blob(0, [0, 1.85, -2.6], [3.3, 1.9, 3.4]);            // 掌
    blob(0, [0, 2.5, 0.4], [2.85, 2.3, 2.8]);             // 手腕
    // 前腳：從手腕往後上方伸出去，在 FUR 的 shader 裡淡掉
    const leg = new T.CapsuleGeometry(2.55, 16, 8, 24).scale(1.08, 1, 1)
      .applyQuaternion(new T.Quaternion().setFromUnitVectors(Y, LEG_DIR));
    leg.translate(WRIST.x + LEG_DIR.x * 8, WRIST.y + LEG_DIR.y * 8, WRIST.z + LEG_DIR.z * 8);
    parts.push({ bone: 0, g: leg });
    TOES.forEach(([x, z], i) => blob(i + 1, [x, TOE_Y, z], i === 0 || i === 3 ? [1.08, 0.95, 1.1] : [1.14, 0.98, 1.15]));

    const pos = [], nrm = [], skin = [], wt = [], shell = [], idx = [];
    let base = 0;
    for (let s = 0; s < FUR_SHELLS; s++) {
      for (const { bone, g } of parts) {
        const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array, cnt = p.length / 3;
        for (let i = 0; i < p.length; i++) { pos.push(p[i]); nrm.push(n[i]); }
        for (let i = 0; i < cnt; i++) { skin.push(bone, 0, 0, 0); wt.push(1, 0, 0, 0); shell.push(s / (FUR_SHELLS - 1)); }
        for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
        base += cnt;
      }
    }
    for (const { g } of parts) g.dispose();
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(skin, 4));
    geo.setAttribute('skinWeight', new T.Float32BufferAttribute(wt, 4));
    geo.setAttribute('aShell', new T.Float32BufferAttribute(shell, 1));
    geo.setIndex(new T.Uint32BufferAttribute(idx, 1));
    return geo;
  }

  const FUR_GLSL = `
    varying vec3 vFurPos;
    varying vec3 vFurNrm;
    varying float vFurH;
    uniform vec3 uFur, uStripe, uBelly, uWrist, uLegDir;
    uniform float uStripes, uMitten;
    float fHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float fNoise(vec3 x) {
      vec3 i = floor(x), f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(fHash(i), fHash(i + vec3(1, 0, 0)), f.x), mix(fHash(i + vec3(0, 1, 0)), fHash(i + vec3(1, 1, 0)), f.x), f.y),
                 mix(mix(fHash(i + vec3(0, 0, 1)), fHash(i + vec3(1, 0, 1)), f.x), mix(fHash(i + vec3(0, 1, 1)), fHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
  `;
  const FUR_COLOR = `
    #include <color_fragment>
    // 前腳往後漸漸淡掉（網點）
    float legT = dot(vFurPos - uWrist, uLegDir);
    if (1.0 - smoothstep(4.5, 10.0, legT) < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
    // 一根毛一個小格子，每根長短不一；根部密、毛尖細細的散開，看起來蓬蓬的
    vec3 fCell = floor(vFurPos * 26.0), fIn = fract(vFurPos * 26.0) - 0.5;
    float strand = fHash(fCell), tip = vFurH / (0.3 + 0.7 * strand);
    if (vFurH > 0.0 && (tip > 1.0 || length(fIn) > 0.9 * pow(1.0 - tip, 0.5))) discard;
    // 花色：背上的虎斑一圈圈繞著腳（邊緣糊糊的），掌底和肚子比較淡，賓士貓的白手套
    vec3 n0 = normalize(vFurNrm);
    float nz = fNoise(vFurPos * 0.8);
    float under = smoothstep(0.0, -0.7, n0.y);
    float band = smoothstep(0.1, 0.95, sin(legT * 1.6 + nz * 3.5 + vFurPos.x * 0.35)) * uStripes * (1.0 - under);
    vec3 fc = mix(uFur, uStripe, band);
    fc = mix(fc, uBelly, under * 0.8);
    float mitten = uMitten * smoothstep(1.4, 0.2, legT + (nz - 0.5) * 2.0);
    fc = mix(fc, vec3(0.93, 0.91, 0.88), mitten);
    // 每根毛深淺略有不同；毛根處被擋住光，比較暗；毛尖透光，亮亮軟軟的
    fc *= 0.95 + 0.1 * fHash(fCell + 3.1);
    fc *= mix(0.8, 1.0, pow(vFurH, 0.6));
    fc = mix(fc, min(fc * 1.15 + 0.05, vec3(1.0)), vFurH * vFurH);
    diffuseColor.rgb = fc;
  `;
  const FUR_MATS = [];
  function furMaterial(pid) {
    if (FUR_MATS[pid]) return FUR_MATS[pid];
    const cat = CATS[pid];
    const m = new T.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.9, sheen: 1, sheenRoughness: 0.5,
      sheenColor: new T.Color(cat.fur).lerp(new T.Color(0xffffff), 0.6), envMapIntensity: 0.3,
    });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, {
        uFur: { value: new T.Color(cat.fur) }, uStripe: { value: new T.Color(cat.stripe) }, uBelly: { value: new T.Color(cat.belly) },
        uStripes: { value: cat.stripes }, uMitten: { value: cat.mitten },
        uWrist: { value: WRIST }, uLegDir: { value: LEG_DIR }, uFurLen: { value: FUR_LEN },
      });
      sh.vertexShader = FUR_GLSL + 'attribute float aShell;\nuniform float uFurLen;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vFurPos = position; vFurNrm = normal; vFurH = aShell;
          // 掌底的毛短；毛一撮一撮長短不一，輪廓毛茸茸的；往後（前腳的方向）輕輕梳，微微下垂
          float fClump = fNoise(position * 1.4);
          float fLen = uFurLen * mix(0.3, 1.0, smoothstep(-0.7, 0.1, normal.y)) * (0.6 + 0.8 * fClump) * aShell;
          vec3 fFlow = vec3(0.0, -0.2, 0.35) + (vec3(fNoise(position * 0.9 + 7.0), fNoise(position * 0.9 + 3.0), fNoise(position * 0.9 + 1.0)) - 0.5) * 0.5;
          transformed += normal * fLen + fFlow * fLen * aShell;`);
      sh.fragmentShader = FUR_GLSL + sh.fragmentShader.replace('#include <color_fragment>', FUR_COLOR);
    };
    return (FUR_MATS[pid] = m);
  }
  // 影子：前腳淡掉的那段不要投影
  let furDepth;
  function furDepthMaterial() {
    if (furDepth) return furDepth;
    furDepth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    furDepth.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uWrist: { value: WRIST }, uLegDir: { value: LEG_DIR } });
      sh.vertexShader = 'varying vec3 vFurPos;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurPos = position;');
      sh.fragmentShader = 'varying vec3 vFurPos;\nuniform vec3 uWrist, uLegDir;\n' +
        sh.fragmentShader.replace('void main() {', 'void main() {\n  if (dot(vFurPos - uWrist, uLegDir) > 7.5) discard;');
    };
    return furDepth;
  }

  const PAW_MATS = {};
  let padGeo;
  const pawMat = (k, o) => PAW_MATS[k] || (PAW_MATS[k] = new T.MeshPhysicalMaterial(o));
  function makePaw(pid, side) {
    const cat = CATS[pid];
    const mesh = new T.SkinnedMesh(pawGeometry(), furMaterial(pid));
    mesh.castShadow = true;
    mesh.customDepthMaterial = furDepthMaterial();
    mesh.frustumCulled = false;
    const root = new T.Bone(), toes = [];
    mesh.add(root);
    // 腳趾的骨頭放在趾根，繞 x 往下彎
    TOES.forEach(([x, z]) => {
      const b = new T.Bone();
      b.position.set(x * 0.85, TOE_Y + 0.4, z + 1.6);
      root.add(b);
      toes.push(b);
    });
    mesh.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton([root, ...toes]));

    // 肉球：粉粉嫩嫩、Q彈亮亮的，從毛裡凸出來；座標是掛上去那根骨頭的座標
    const bean = pawMat('bean' + pid, {
      color: cat.bean, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.25,
      sheen: 0.6, sheenColor: new T.Color(0xffe0e6), envMapIntensity: 0.5,
    });
    const pad = (parent, at, r) => {
      const m = new T.Mesh(padGeo || (padGeo = new T.SphereGeometry(1, 20, 14)), bean);
      m.scale.set(r[0], r[1], r[2]);
      m.position.set(at[0], at[1], at[2]).sub(parent.position);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    // 掌心的大肉球：三瓣的愛心形
    const mainPad = pad(root, [0, 0.05, -2.45], [1.25, 0.46, 1.0]);
    pad(root, [-0.95, 0.12, -2.8], [0.8, 0.42, 0.76]);
    pad(root, [0.95, 0.12, -2.8], [0.8, 0.42, 0.76]);
    const claw = pawMat('claw', { color: 0xf3ede2, roughness: 0.3, clearcoat: 0.6 });
    const claws = [], beans = [];
    TOES.forEach(([x, z], i) => {
      const b = toes[i];
      beans.push(pad(b, [x, TOE_Y - 0.8, z + 0.1], [0.68, 0.4, 0.72]));
      // 爪子：小小的，藏在腳趾前端，抓牌時伸出來
      const c = new T.Mesh(new T.ConeGeometry(0.11, 0.5, 8).translate(0, 0.25, 0).rotateX(-Math.PI / 2 - 0.5), claw);
      c.position.set(x, TOE_Y - 0.3, z - 0.95).sub(b.position);
      c.scale.setScalar(0.001);
      b.add(c);
      claws.push(c);
    });

    // c：0 放鬆、1 抓牌（腳趾張開往下扣、爪子伸出）、更大是握起來（招手）
    const pose = c => {
      const curl = -0.12 - 0.5 * Math.min(c, 1) - 0.55 * Math.max(0, c - 1);
      const spread = Math.max(0, Math.min(c, 1) - 3 * Math.max(0, c - 1));
      const out = smooth(Math.min(1, Math.max(0, (c - 0.55) / 0.45))) * (1 - smooth(Math.min(1, Math.max(0, (c - 1.02) / 0.2))));
      toes.forEach((b, i) => {
        b.rotation.set(curl, -(i - 1.5) * 0.12 * spread, 0);
        claws[i].scale.setScalar(Math.max(0.001, out));
      });
    };

    const g = new T.Group(), fit = new T.Group();
    fit.scale.setScalar(cat.size);
    fit.add(mesh);
    g.add(fit);
    // 抓牌那一點：大肉球與腳趾肉球之間、肉球底下再低 1（牌頂往下 1 就是肉球剛好壓在牌頂）
    pose(1);
    g.updateMatrixWorld(true);
    const wp = o => o.getWorldPosition(new T.Vector3());
    const grip = wp(mainPad).lerp(wp(beans[1]).lerp(wp(beans[2]), 0.5), 0.45);
    grip.y -= 0.45 * cat.size + 1;
    pose(0);

    scene.add(g);
    return { pid, side, g, pose, grip, p: new T.Vector3(), ip: new T.Vector3(), q: new T.Quaternion(), c: 0, fresh: true, job: null,
      qGrab: handTurn(side, 0.05, -0.3, 0), stances: CAT_STANCES };
  }

  const hQ = new T.Quaternion(), hA = new T.Vector3();
  // 把捏點放到 h.p，手的轉向是座位座標裡的 q；c 從 0（放鬆）到 1（捏住）
  function setHand(h, q, c, ex) {
    h.pose(c, ex);
    hQ.copy(q).premultiply(seatQ[h.pid]);
    h.g.quaternion.copy(hQ);
    h.g.position.copy(h.p).sub(hA.copy(h.grip).applyQuaternion(hQ));
  }

  // 伸手去拿 t：tw.grab 毫秒內到位捏住，跟著牌提起，起飛時順勢往前一送，之後回到桌緣
  function reach(h, t) {
    if (!h) return;
    const lift = t.tw.t0, from = lift - t.tw.pre;
    h.job = { t, from, at: from + t.tw.grab, lift, sent: lift + 170, p0: null, p1: new T.Vector3(), p2: null };
  }
  // 各家現在擺什麼姿勢：平常都擱在桌緣，指定的姿勢（胡牌歡呼）維持到時間到
  const mood = [];
  const stanceOf = (pid, now) => (mood[pid] && now < mood[pid].until ? mood[pid].name : 'rest');
  S.handPose = (pid, name, ms) => { mood[pid] = { name, until: performance.now() + (ms || 3000) }; };

  let handNow = 0;
  const hT = new T.Vector3(), hQ2 = new T.Quaternion();
  function moveHands(now) {
    const dt = handNow ? Math.min(0.1, (now - handNow) / 1000) : 0;
    handNow = now;
    const k = 1 - Math.exp(-dt * 3.2);
    for (const h of allHands) {
      // 往目前姿勢慢慢靠過去
      const st = h.stances[stanceOf(h.pid, now)], spec = h.side > 0 ? st.R : st.L;
      hT.set(spec.p[0] * h.side, spec.p[1], spec.p[2]).applyQuaternion(seatQ[h.pid]);
      const key = 'q' + h.side, q = spec[key] || (spec[key] = handTurn(h.side, spec.yaw, spec.pitch, spec.roll));
      if (h.fresh) { h.ip.copy(hT); h.q.copy(q); h.c = spec.c; h.fresh = false; }
      h.ip.lerp(hT, k);
      h.q.slerp(q, k);
      h.c += (spec.c - h.c) * k;

      const j = h.job;
      if (j && now >= j.from) {
        let c = 0;
        if (now < j.lift) {
          // 捏在牌的上半截
          j.p1.copy(j.t.g.position);
          j.p1.y += H / 2 - 1;
          if (!j.p0) j.p0 = h.p.clone();
          c = Math.min(1, (now - j.from) / (j.at - j.from));
          const e = smooth(c);
          h.p.lerpVectors(j.p0, j.p1, e);
          h.p.y += 14 * e * (1 - e);
        } else {
          if (!j.p2) {
            // 往落點的方向送一小段
            j.p2 = j.t.pos.clone().sub(j.p1).setY(0);
            j.p2.multiplyScalar(Math.min(0.3, 10 / (j.p2.length() || 1))).add(j.p1).setY(j.p1.y + 2.5);
          }
          const e = Math.min(1, (now - j.lift) / (j.sent - j.lift));
          h.p.lerpVectors(j.p1, j.p2, e * (2 - e));
          c = 1 - e;
          // 送完了，從這裡慢慢回到桌緣
          if (e === 1) { h.job = null; h.ip.copy(h.p); }
        }
        setHand(h, hQ2.copy(h.q).slerp(h.qGrab, c), c);
        continue;
      }

      // 閒著就停在原位；歡呼時拳頭上下揮，貓掌則像招財貓一勾一勾
      h.p.copy(h.ip);
      if (spec.pump) h.p.y += 3 * Math.abs(Math.sin(now / 170 + h.side * 0.6));
      setHand(h, h.q, spec.beckon ? h.c + 0.35 * Math.sin(now / 140 + h.side * 0.8) : h.c);
    }
  }

  // ---- 每一幀 ----
  const vTmp = new T.Vector3();
  const tmpQ = new T.Quaternion(), spinAxis = new T.Vector3(1, 0.25, 0).normalize();
  const PRE_LIFT = 1.5;
  let lastNow = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;

    world.step(1 / 120, dt, 4);
    for (const t of tiles) {
      const tw = t.tw, g = t.g;
      if (t.phys) {
        // 物理接手中：照抄剛體的位置，時間到了再推正
        const p = t.phys;
        if (p.kick) {
          p.b.velocity.y = p.kick;
          p.b.angularVelocity.x += rnd(-9, 9) * p.pw;
          p.b.angularVelocity.z += rnd(-9, 9) * p.pw;
          p.kick = 0;
        }
        wakeNear(p.b);
        g.position.set(p.b.position.x, p.b.position.y, p.b.position.z);
        g.quaternion.set(p.b.quaternion.x, p.b.quaternion.y, p.b.quaternion.z, p.b.quaternion.w);
        g.scale.setScalar(g.scale.x + (1 - g.scale.x) * 0.25);
        if (now > p.until) go(t, { pos: t.pos.clone(), quat: t.quat.clone(), scale: t.scale }, { dur: 260, arc: 0.6 });
        continue;
      }
      if (t.rest) {
        // 桌上的牌被撞醒或被震起來：照剛體走
        const r = t.rest, b = r.b;
        if (r.kickAt && now > r.kickAt) {
          b.wakeUp();
          b.velocity.y += r.kick;
          if (r.push) { b.velocity.x += r.push.x; b.velocity.z += r.push.z; r.push = null; }
          b.angularVelocity.set(rnd(-1, 1) * r.kick * 0.08, rnd(-1, 1) * r.kick * 0.05, rnd(-1, 1) * r.kick * 0.08);
          r.kickAt = 0;
        }
        if (b.sleepState !== C.Body.SLEEPING) { r.moved = true; wakeNear(b); }
        if (r.moved) {
          g.position.set(b.position.x, b.position.y, b.position.z);
          g.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        }
        continue;
      }
      if (tw) {
        let k = (now - tw.t0) / tw.dur;
        if (k < 0) {
          // 起飛前先提起
          const lift0 = tw.t0 - tw.pre + tw.grab;
          if (tw.pre && now > lift0) {
            g.position.copy(tw.p0);
            g.position.y += PRE_LIFT * smooth((now - lift0) / (tw.pre - tw.grab));
          }
          continue;
        }
        if (tw.phys) { launch(t, now); continue; }
        if (k >= 1) k = 1;
        // 大力拍下的那張：前段慢、最後加速砸下
        const e = tw.land === 'big' ? k * k * k : smooth(k);
        g.position.lerpVectors(tw.p0, t.pos, e);
        g.position.y += tw.arc * 4 * k * (1 - k) + (tw.pre ? PRE_LIFT * (1 - e) : 0);
        g.quaternion.slerpQuaternions(tw.q0, t.quat, e);
        g.scale.setScalar(tw.s0 + (t.scale - tw.s0) * e);
        if (tw.spin) g.quaternion.multiply(tmpQ.setFromAxisAngle(spinAxis, Math.PI * 2 * tw.spin * e));
        if (k === 1) {
          t.tw = null;
          if (tw.land === 'big') {
            ring(t.pos, true); clack(1); tone(85, 0.35, 0.5); sfx('win', 0.9, S.fanfare);
            cam.shake = 1;
            if (!S.reduced) blast(t.owner);
          } else if (tw.land) { ring(t.pos); sfx('discard', 0.8, () => clack(0.8)); t.bounce = now; }
        }
      } else if (t.bounce) {
        // 落桌後輕彈一下
        const b = (now - t.bounce) / 170;
        if (b >= 1) { t.bounce = 0; t.bounceAmp = 0; g.position.copy(t.pos); }
        else if (b > 0) g.position.y = t.pos.y + (t.bounceAmp || 0.55) * Math.sin(Math.PI * b) * (1 - b);
      }
    }

    // 沒有牌在飛、被撞的也都停了，就把桌上的剛體收掉
    if (resting.length && !tiles.some(t => t.phys)) {
      const calm = resting.every(t => t.rest.b.sleepState === C.Body.SLEEPING && !t.rest.kickAt);
      if (calm || now > restUntil) settleRests(resting.slice());
    }

    // 蓄力中：牌提起來越抖越兇，上方顯示力道條
    if (charge) {
      const held = now - charge.t0, t = myTile(charge.idx);
      charge.live = held > CHARGE_DELAY && S.pickable && !!t;
      if (charge.live) {
        const u = ((held - CHARGE_DELAY) / CHARGE_MS) % 2, p = charge.p = u < 1 ? u : 2 - u;
        // 蓄力時拿在手上，不再交給剛體
        if (t.rest) endRest(t);
        if (!t.tw && !t.phys) {
          const shake = 0.35 * p * p;
          t.g.position.set(t.pos.x + rnd(-shake, shake), t.pos.y + 0.8 + 1.8 * p, t.pos.z + rnd(-shake, shake));
        }
        const s = toScreen(vTmp.set(t.pos.x, 7 * rig.my, ROW - 2));
        meter.style.left = s.x + 'px';
        meter.style.top = s.y + 'px';
        meter.style.setProperty('--p', (p * 100).toFixed(1) + '%');
        meter.style.setProperty('--c', `hsl(${Math.round(120 - 120 * p)} 85% 55%)`);
        meter.classList.toggle('max', p > 0.9);
        meter.hidden = false;
      }
    }

    moveHands(now);

    for (const d of dice) {
      if (!d.live) continue;
      d.m.position.set(d.body.position.x, d.body.position.y, d.body.position.z);
      d.m.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
    }

    for (let i = props.length - 1; i >= 0; i--) {
      const a = props[i];
      let k = (now - a.t0) / a.dur;
      if (k < 0) continue;
      if (k >= 1) k = 1;
      a.obj.position.lerpVectors(a.p0, a.p1, smooth(k));
      a.obj.position.y += a.arc * 4 * k * (1 - k);
      if (a.flip) a.obj.rotation.x = Math.PI * 2 * a.flip * smooth(k);
      if (k === 1) { props.splice(i, 1); if (a.flip) a.obj.rotation.x = 0; if (a.done) a.done(); }
    }
    // 拖著的籌碼跟著游標，往前拖時微微往前傾
    if (toy && toy.drag) {
      const c = toy.chip, vx = toy.to.x - c.position.x, vz = toy.to.z - c.position.z;
      c.position.lerp(toy.to, Math.min(1, dt * 18));
      c.rotation.set(Math.max(-0.5, Math.min(0.5, vz * 0.08)), 0, Math.max(-0.5, Math.min(0.5, -vx * 0.08)));
    }
    if (now > nextFall) { nextFall = now + 250; dropLoose(); }

    // 牌底的貼地暗影：牌離桌面越高越淡
    for (const t of tiles) {
      const g = t.g, sh = t.sh, s = g.scale.x;
      const up = Math.abs(vTmp.set(0, 1, 0).applyQuaternion(g.quaternion).y);
      const bottom = g.position.y - (H / 2 * up + D / 2 * (1 - up)) * s;
      const o = 0.55 * Math.max(0, 1 - Math.abs(bottom) / 2.5);
      sh.visible = o > 0.02;
      if (!sh.visible) continue;
      sh.material.opacity = o;
      vTmp.set(1, 0, 0).applyQuaternion(g.quaternion);
      sh.position.set(g.position.x, 0.02, g.position.z);
      sh.rotation.set(-Math.PI / 2, Math.atan2(-vTmp.z, vTmp.x), 0);
      sh.scale.set((W + 1.7) * s, (H * (1 - up) + D * up + 1.7) * s, 1);
    }

    for (const r of rings) {
      if (r.userData.t0 < 0) continue;
      const k = (now - r.userData.t0) / (480 * (r.userData.big > 1 ? 1.6 : 1));
      if (k >= 1) { r.userData.t0 = -1; r.material.opacity = 0; continue; }
      r.scale.setScalar((1 + k * 2.2) * r.userData.big);
      r.material.opacity = 0.75 * (1 - k);
    }

    // 標記最後打出的那張
    let show = false;
    if (game && S.mark && game.lastDiscard) {
      const from = game.lastDiscard.from, ds = game.players[from].discards;
      const t = tiles.find(x => x.zone === 'discard' && x.owner === from && x.idx === ds.length - 1);
      if (t && !t.tw && !t.phys) {
        show = true;
        marker.position.set(t.pos.x, 4.4 + Math.sin(now / 260) * 0.45, t.pos.z);
        marker.rotation.y += dt * 3.2;
      }
    }
    marker.visible = show;

    // 同種牌的光暈：只亮桌上翻開的牌（牌河、吃碰槓、花、攤牌），蓋著的不亮
    haloMat.opacity = 0.65 + Math.sin(now / 220) * 0.25;
    for (const t of tiles) {
      let on = false;
      if (hoverKind >= 0 && t.kind === hoverKind && t.zone !== 'wall' && !(t.zone === 'hand' && t.owner === 0)) {
        up.set(0, 0, 1).applyQuaternion(t.g.quaternion);
        on = up.y > 0.7;
      }
      t.g.children[3].visible = on;
    }

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
    setCamera(cam.yaw, cam.zoom * cam.fit);
    if (cam.shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * cam.shake * 1.6;
      camera.position.y += (Math.random() - 0.5) * cam.shake * 1.6;
      cam.shake *= Math.pow(0.002, dt);
    }
    renderer.render(scene, camera);
  }
})();
