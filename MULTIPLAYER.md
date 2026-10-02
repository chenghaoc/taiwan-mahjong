# Multiplayer

## Same Wi-Fi (built)

One computer hosts the table; everyone else joins from a browser.

1. On the host: `node server.js` (Node 18+, no `npm install` needed).
2. It prints two addresses. The host opens `http://localhost:3000`; everyone else on the same Wi-Fi opens the `http://192.168.x.x:3000` one. Windows may ask to allow Node through the firewall the first time — allow it for private networks.
3. Everyone picks 連線對戰, enters a name, and lands in the waiting room. The first person in is the host and starts the game; empty seats are filled by the computer.

Solo play is unchanged, and the static site (Render) simply doesn't show the 連線對戰 button because it has no table server.

How it works:

- `server.js` runs the same `MJ.Game` as solo play. Each remote player is an agent whose `turn()` / `claim()` ask the browser and wait for the reply.
- Each player is sent only what their seat may see: other hands, concealed kongs and the wall arrive as counts. `js/net.js` fills those with placeholder tiles so the 3D table can still draw 144 tiles.
- Server → browser is server-sent events (`/api/events`); browser → server is `POST /api/send`. Replies are checked against the options the server offered.
- Claims (吃碰槓胡) time out after 15 seconds and count as a pass. A player who disconnects for 15 seconds is played by the computer until they come back; if every human leaves, the game ends.

Tests: `node test/sim.js` (rules + AI), `node test/lan.js` (full games over HTTP with two simulated players).

## Online, hosted server (planned, not built)

The LAN server is already the authoritative server an online version needs, so this is mostly deployment plus hardening.

1. **Deploy.** Change `render.yaml` from `runtime: static` to a Node web service with `startCommand: node server.js`. The server already reads `PORT`. Add a minimal `package.json` (`"start": "node server.js"`, `engines.node >= 18`). Free Render instances sleep when idle, so the first visitor waits up to a minute.
2. **Rooms.** The server already keeps one `Room` per `?room=` key (LAN always uses `lan`). Add "create table" (random 4–5 character code) and "join by code" to the start screen, show the share link instead of LAN addresses, and delete a room once it is empty.
3. **Hardening for strangers.** Make the player id an unguessable server-issued token rather than a client-chosen one; cap rooms, connections per IP and message rate; add a turn timer for discards (today only claims time out).
4. **Reconnect polish.** Rejoin automatically on page reload instead of going through the start screen, and show who is disconnected or being played by the computer.
5. **Hosting limits.** One Node process holds all games in memory, so a restart or deploy drops games in progress. That is fine for friends; persisting games (or sticky multi-instance hosting) is only worth doing if this grows.

Not planned: peer-to-peer (the host's browser would hold every hand) and pass-and-play on one device (claims need a private answer from up to three players after every discard).
