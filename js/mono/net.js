// 大富翁連線（玩家端）：跟麻將用同一台主機、同一套 SSE / POST，只是多帶 game=mono
// 大富翁沒有藏起來的牌，主機給的狀態直接就能畫
(function (g) {
  'use strict';
  const MONO = g.MONO;

  // 區域網路上只有一桌；放在網路上時每桌一個代碼，寫進網址好分享給朋友
  const LOCAL = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  function room() {
    const q = new URLSearchParams(location.search);
    if (!q.get('room') && !LOCAL.test(location.hostname)) {
      q.set('room', Math.random().toString(36).slice(2, 7));
      history.replaceState(null, '', '?' + q);
    }
    return q.get('room') || 'lan';
  }
  let es = null, id = null;

  MONO.net = {
    available: () => fetch('api/ping').then(r => r.json()).then(j => !!j.monopoly, () => false),
    open(name, handle) {
      id = sessionStorage.monoId || (sessionStorage.monoId = Math.random().toString(36).slice(2));
      const mine = es = new EventSource(`api/events?game=mono&room=${encodeURIComponent(room())}&id=${id}&name=${encodeURIComponent(name)}`);
      // 訊息依序處理：前一則的動畫播完才輪下一則
      let chain = Promise.resolve();
      mine.onmessage = e => {
        const m = JSON.parse(e.data);
        chain = chain.then(() => es === mine && handle(m)).catch(err => console.error(err));
      };
    },
    links: urls => (/^(localhost$|127\.)/.test(location.hostname) ? urls.map(u => u + '/monopoly.html') : [location.href]),
    send(msg) {
      fetch('api/send', { method: 'POST', body: JSON.stringify({ game: 'mono', room: room(), id, msg }) });
    },
    close() {
      if (es) es.close();
      es = null;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
