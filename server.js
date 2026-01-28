import http from "http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  res.end("WebSocket server running");
});
const wss = new WebSocketServer({ server });

/* =========================
   SETTINGS
========================= */
const W = 800;
const H = 500;

const MAX_PLAYERS = 8;

const rooms = []; // each: { clients: Map(ws->player), hazards: [], nextHazardId, lastSpawn }
let nextId = 1;

const colors = ["green", "blue", "red", "orange", "purple", "cyan", "magenta", "brown"];

/* Enemies */
const MAX_HAZARDS = 14;
const SPAWN_EVERY_MS = 900;   // spawn rate
const HAZARD_SPEED = 2.3;
const HAZARD_SIZE = 10;
const TICK_MS = 33;          // ~30 fps

/* Out rule */
const OUT_MS = 5000;
const PLAYER_HIT_RADIUS = 18; // collision radius

/* =========================
   BAD WORD FILTER + BOT
========================= */

const BAD_WORDS = [
  "fuck",
  "motherfucker",
  "shit",
  "bitch",
  "asshole",
  "puta",
  "mierda",
  "pendejo",
  "cabron"
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanText(text) {
  let result = String(text ?? "").slice(0, 160);
  for (const word of BAD_WORDS) {
    const rx = new RegExp(escapeRegExp(word), "gi");
    result = result.replace(rx, "*".repeat(word.length));
  }
  return result;
}

function containsBadWord(text) {
  const lower = String(text ?? "").toLowerCase();
  return BAD_WORDS.some(word => lower.includes(word));
}

/* =========================
   HELPERS
========================= */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function now() {
  return Date.now();
}

function findRoom() {
  for (const room of rooms) {
    if (room.clients.size < MAX_PLAYERS) return room;
  }
  const newRoom = {
    clients: new Map(),
    hazards: [],
    nextHazardId: 1,
    lastSpawn: 0
  };
  rooms.push(newRoom);
  return newRoom;
}

function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of room.clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function broadcastChat(room, from, text) {
  broadcast(room, { type: "chat", from, text });
}

function buildState(room) {
  const players = [...room.clients.values()].map(p => ({
    id: p.id,
    x: p.x,
    y: p.y,
    angle: p.angle,
    color: p.color,
    label: p.label,
    outUntil: p.outUntil || 0
  }));

  const hazards = room.hazards.map(h => ({
    id: h.id,
    x: h.x,
    y: h.y,
    vx: h.vx,
    vy: h.vy,
    size: h.size
  }));

  return { type: "state", players, hazards };
}

function sendState(room) {
  broadcast(room, buildState(room));
}

/* =========================
   HAZARDS (ENEMIES)
========================= */
function spawnHazard(room) {
  // pick an edge: 0=top,1=right,2=bottom,3=left
  const edge = Math.floor(Math.random() * 4);

  let x, y;
  if (edge === 0) { x = Math.random() * W; y = -20; }
  if (edge === 1) { x = W + 20; y = Math.random() * H; }
  if (edge === 2) { x = Math.random() * W; y = H + 20; }
  if (edge === 3) { x = -20; y = Math.random() * H; }

  // aim toward center-ish (adds chaos)
  const tx = W * 0.5 + (Math.random() * 140 - 70);
  const ty = H * 0.5 + (Math.random() * 140 - 70);

  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy) || 1;

  const vx = (dx / len) * HAZARD_SPEED;
  const vy = (dy / len) * HAZARD_SPEED;

  room.hazards.push({
    id: String(room.nextHazardId++),
    x, y, vx, vy,
    size: HAZARD_SIZE,
    born: now()
  });
}

function updateRoom(room) {
  const t = now();

  // spawn
  if (room.hazards.length < MAX_HAZARDS && t - room.lastSpawn >= SPAWN_EVERY_MS) {
    room.lastSpawn = t;
    spawnHazard(room);
  }

  // move hazards
  for (const h of room.hazards) {
    h.x += h.vx;
    h.y += h.vy;
  }

  // remove hazards that went far away
  room.hazards = room.hazards.filter(h => h.x > -80 && h.x < W + 80 && h.y > -80 && h.y < H + 80);

  // collisions hazard -> players
  for (const [ws, p] of room.clients.entries()) {
    const out = (p.outUntil || 0) > t;
    if (out) continue;

    for (const h of room.hazards) {
      const d = Math.hypot(p.x - h.x, p.y - h.y);
      if (d <= PLAYER_HIT_RADIUS + h.size) {
        // player is OUT for 30 seconds
        p.outUntil = t + OUT_MS;

        // reset position (optional but feels better)
        p.x = W / 2;
        p.y = H / 2;
        p.angle = 0;

        broadcastChat(room, "ServerBot", `${p.label} is OUT for 12 seconds!`);
        break;
      }
    }
  }

  // send state
  sendState(room);
}

/* =========================
   SERVER BOT REMINDERS (optional)
========================= */
const BOT_MESSAGES = [
  "Reminder: Please be respectful. No swearing.",
  "Keep it friendly 🙂",
  "Chat rules: be kind and respectful.",
  "No bad words please."
];

function startReminderBot() {
  setInterval(() => {
    for (const room of rooms) {
      if (!room || room.clients.size === 0) continue;
      const msg = BOT_MESSAGES[Math.floor(Math.random() * BOT_MESSAGES.length)];
      broadcastChat(room, "ServerBot", msg);
    }
  }, 20000); // every 20 seconds
}

/* =========================
   GAME LOOP
========================= */
setInterval(() => {
  for (const room of rooms) {
    if (!room || room.clients.size === 0) continue;
    updateRoom(room);
  }
}, TICK_MS);

/* =========================
   WEBSOCKET
========================= */
wss.on("connection", (ws) => {
  const room = findRoom();
  const roomNumber = rooms.indexOf(room) + 1;

  const index = room.clients.size;
  const id = String(nextId++);

  const player = {
    id,
    x: W / 2,
    y: H / 2,
    angle: 0,
    color: colors[index % colors.length],
    label: `Player${index + 1}`,
    warnings: 0,
    outUntil: 0
  };

  room.clients.set(ws, player);

  ws.send(JSON.stringify({ type: "welcome", id, room: roomNumber }));
  broadcastChat(room, "Server", `${player.label} joined (Room ${roomNumber})`);

  // Immediately send state
  sendState(room);

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // MOVE (server accepts position but blocks if OUT)
    if (msg.type === "move") {
      const p = room.clients.get(ws);
      if (!p) return;

      if ((p.outUntil || 0) > now()) return; // OUT players can't move

      p.x = clamp(Number(msg.x), 0, W);
      p.y = clamp(Number(msg.y), 0, H);
      p.angle = Number(msg.angle) || 0;
      return;
    }

    // CHAT (filtered + warning/kick system)
    if (msg.type === "chat") {
      const p = room.clients.get(ws);
      if (!p) return;

      const originalText = String(msg.text ?? "");
      const filteredText = cleanText(originalText);
      if (!filteredText.trim()) return;

      broadcastChat(room, p.label, filteredText);

      if (containsBadWord(originalText)) {
        p.warnings += 1;

        if (p.warnings >= 3) {
          broadcastChat(room, "ServerBot", `${p.label} was kicked (3 warnings).`);
          try { ws.close(4001, "Kicked for swearing"); } catch {}
          return;
        } else {
          broadcastChat(room, "ServerBot", `${p.label}, please do not swear. Warning ${p.warnings}/3.`);
        }
      }
      return;
    }
  });

  ws.on("close", () => {
    const p = room.clients.get(ws);
    room.clients.delete(ws);
    if (p) broadcastChat(room, "Server", `${p.label} left`);
    sendState(room);
  });
});

/* =========================
   START
========================= */
startReminderBot();

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Listening on", PORT);
});
