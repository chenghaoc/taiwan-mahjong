// 喊牌語音：四家各有一個聲音，阿嬤、阿伯那種牌桌上的喊法。
// 音檔由 tools/gen_voice.py 產生，放在 audio/voice/<角色>/<喊法><編號>.mp3
(() => {
  'use strict';
  const MJ = window.MJ, S = MJ.scene;

  // 座位 → 角色：你、阿明、美玲、老陳
  const VOICES = ['asang', 'aming', 'ama', 'abei'];
  // 喊法 → 有幾句可以挑
  const LINES = { chi: 2, pong: 2, kong: 2, ankong: 1, jiakong: 1, hu: 2, zimo: 2, qiang: 2 };
  const KEY = { 吃: 'chi', 碰: 'pong', 槓: 'kong', 暗槓: 'ankong', 加槓: 'jiakong', 胡: 'hu', 自摸: 'zimo', 搶槓胡: 'qiang' };

  // 先全部載好，喊的時候才不會慢半拍
  const clips = {};
  for (const who of new Set(VOICES)) {
    for (const key in LINES) {
      for (let i = 0; i < LINES[key]; i++) {
        const a = new Audio(`audio/voice/${who}/${key}${i}.mp3`);
        a.preload = 'auto';
        clips[`${who}/${key}${i}`] = a;
      }
    }
  }

  // 沒有音檔可放的時候，退回 scene 原本的喊法（如果有）
  const fallback = S.say;
  let playing = null;

  S.say = (text, pid = 0) => {
    if (S.muted) return;
    const key = KEY[text];
    if (!key) return;
    const a = clips[`${VOICES[pid]}/${key}${Math.floor(Math.random() * LINES[key])}`];
    if (playing) playing.pause();
    playing = a;
    a.currentTime = 0;
    // 每次高低快慢差一點點，聽起來才不像錄音機
    a.preservesPitch = false;
    a.playbackRate = 0.95 + Math.random() * 0.1;
    a.play().catch(() => { if (fallback) fallback(text); });
  };

  // 喊牌事件從 Game 發出來，在這裡接，才知道是哪一家喊的
  const emit = MJ.Game.prototype.emit;
  let fromGame = false;
  const say = S.say;
  MJ.Game.prototype.emit = function (type, d) {
    if (type === 'call') say(d.text, d.pid);
    fromGame = true;
    try { return emit.call(this, type, d); } finally { fromGame = false; }
  };
  // ui 自己同步呼叫的 S.say 就不必再喊一次
  S.say = (text, pid) => { if (!fromGame) say(text, pid); };
})();
