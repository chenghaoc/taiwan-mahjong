# Multiplayer

`server.js` hosts the table. It runs the same `MJ.Game` as solo play and can run on your own computer (same Wi-Fi) or on Render (online). Solo play needs no server; a static copy of the site simply doesn't show the 連線對戰 button.

## Same Wi-Fi

One computer hosts the table; everyone else joins from a browser.

1. On the host: `node server.js` (Node 18+, no `npm install` needed).
2. It prints two addresses. The host opens `http://localhost:3000`; everyone else on the same Wi-Fi opens the `http://192.168.x.x:3000` one. Windows may ask to allow Node through the firewall the first time — allow it for private networks.
3. Everyone picks 連線對戰, enters a name, and lands in the waiting room. The first person in is the host and starts the game; empty seats are filled by the computer.

## Online, on Render

Setup, once: in the Render dashboard choose New → Web Service, pick this repository and the branch that has `server.js`, runtime Node, build command `npm install`, start command `node server.js`, instance type Free. (New → Blueprint does the same from `render.yaml`.) An existing static site cannot be converted in place; delete it or leave it as a solo-only copy.

Playing: open the service's link and pick 連線對戰. The page adds a table code to the address (`?room=abc12`) and the waiting room shows that link — send it to friends and they land at the same table. Solo play works on the same link.

Limits: the free instance sleeps after about 15 idle minutes (the first visitor waits up to a minute), and a restart or deploy drops games in progress because tables live in memory. At most 200 tables at once; empty tables are removed.

## Leaderboard

Online games can keep a lifetime leaderboard in Postgres. After every hand, each human player's win or loss is added to their total under their name; computer players are not recorded. The waiting room shows the top 10. Without `DATABASE_URL` the server runs as before and the leaderboard is hidden.

Setup, once:

1. Create a free database at [neon.tech](https://neon.tech) (it doesn't expire, unlike Render's free Postgres) and copy its connection string (`postgresql://...?sslmode=require`).
2. In the Render dashboard open the web service → Environment → add `DATABASE_URL` with that string → save (Render redeploys).

The `scores` table is created automatically. Any Postgres works, including Supabase or Render Postgres. Names are not accounts: two people who use the same name share one row. Solo games aren't recorded.

## How it works

- Each remote player is an agent whose `turn()` / `claim()` ask the browser and wait for the reply.
- Each player is sent only what their seat may see: other hands, concealed kongs and the wall arrive as counts. `js/net.js` fills those with placeholder tiles so the 3D table can still draw 144 tiles.
- Server → browser is server-sent events (`/api/events`); browser → server is `POST /api/send`. Replies are checked against the options the server offered.
- Claims (吃碰槓胡) time out after 15 seconds and count as a pass. A player who disconnects for 15 seconds is played by the computer until they come back; if every human leaves, the game ends.

Tests: `npm test`, or `node test/sim.js` (rules + AI) and `node test/lan.js` (full games over HTTP with two simulated players).

## Not done yet

- Hardening for strangers: server-issued player tokens, per-IP connection and message limits, a turn timer for discards (today only claims time out).
- Reconnect polish: rejoin automatically on page reload, and show who is disconnected or being played by the computer.

Not planned: peer-to-peer (the host's browser would hold every hand) and pass-and-play on one device (claims need a private answer from up to three players after every discard).
