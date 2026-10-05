// 總排行榜：連線對戰每打完一局，把真人的輸贏累加到 Postgres。
// 有設定 DATABASE_URL 才會記錄；沒設（例如在自己電腦上玩）就什麼都不做。
'use strict';

const DB_URL = process.env.DATABASE_URL;
let ready = null;

function db() {
  if (!DB_URL) return null;
  if (!ready) {
    ready = Promise.resolve().then(() => {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: DB_URL, max: 3 });
      pool.on('error', e => console.error('排行榜資料庫：', e.message));
      return pool.query(`CREATE TABLE IF NOT EXISTS scores (
        name text PRIMARY KEY,
        total integer NOT NULL DEFAULT 0,
        hands integer NOT NULL DEFAULT 0,
        wins integer NOT NULL DEFAULT 0,
        updated timestamptz NOT NULL DEFAULT now())`).then(() => pool);
    });
    // 連不上就下次再試（免費資料庫閒置後要先醒來）
    ready.catch(e => { console.error('排行榜資料庫連不上：', e.message); ready = null; });
  }
  return ready;
}

// entries: [{ name, delta, win }]
async function add(entries) {
  const p = db();
  if (!p || !entries.length) return;
  try {
    const pool = await p;
    for (const e of entries) {
      await pool.query(`INSERT INTO scores (name, total, hands, wins) VALUES ($1, $2, 1, $3)
        ON CONFLICT (name) DO UPDATE SET total = scores.total + $2, hands = scores.hands + 1,
        wins = scores.wins + $3, updated = now()`, [e.name, e.delta, e.win ? 1 : 0]);
    }
  } catch (err) {
    console.error('排行榜寫入失敗：', err.message);
  }
}

async function top(n = 10) {
  const p = db();
  if (!p) return { enabled: false, rows: [] };
  try {
    const pool = await p;
    const { rows } = await pool.query('SELECT name, total, hands, wins FROM scores ORDER BY total DESC, hands ASC LIMIT $1', [n]);
    return { enabled: true, rows };
  } catch (err) {
    console.error('排行榜讀取失敗：', err.message);
    return { enabled: true, rows: [] };
  }
}

module.exports = { add, top };
