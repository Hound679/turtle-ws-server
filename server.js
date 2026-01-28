// server.js (FULL) ✅ Rooms + Chat + Badwords + 3 warnings kick + Enemies + Sword kills + Score saved by token + LEADERBOARD

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
const SPAWN_EVERY_MS = 900;   // spawn rate (lower = faster)
const HAZARD_SPEED = 2.3;     // move speed
const HAZARD_SIZE = 10;       // size
const TICK_MS = 33;           // ~30 fps

/* Out rule */
const OUT_MS = 30000;
const PLAYER_HIT_RADIUS = 18;

/* Sword */
const SWORD_REACH = 44;       // sword tip distance in front (match nicer sword)
const SWORD_HIT_RADIUS = 10;  // sword tip hit radius

/* Score persistence in memory (by token) */
const tokenScores = new Map(); // token -> score

/* Leaderboard */
const LEADERBOARD_SIZE = 10;

/* =========================
   BAD WORD FILTER
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
function now() { return Date.now(); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function getLeaderboard() {
  return [...tokenScores.entries()]
    .map(([token, score]) => ({ token, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, LEADERBOARD_SIZE);
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
    outUntil: p.outUntil || 0,
    score: p.score || 0
  }));

  const hazards = room.hazards.map(h => ({
    id: h.id,
    x: h.x,
    y: h.y,
    vx: h.vx,
    vy: h.vy,
    size: h.size
  }));

  const leaderboard = getLeaderboard();
  return { type: "state", players, hazards, leaderboard };
}

function sendState(room) {
  broadcast(room, buildState(room));
}

/* =========================
   HAZARDS (ENEMIES)
========================= */
function spawnHazard(room) {
  const edge = Math.floor(Math.random() * 4);
  let x, y;

  if (edge === 0) { x = Math.random() * W; y = -20; }
  if (edge === 1) { x = W + 20; y = Math.random() * H; }
  if (edge === 2) { x = Math.random() * W; y = H + 20; }
  if (edge === 3) { x = -20; y = Math.random() * H; }

  const tx = W * 0.5 + (Math.random() * 140 - 70);
  const ty = H * 0.5 + (Math.random() * 140 - 70);

  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy) || 1;

  room.hazards.push({
    id: String(room.nextHazardId++),
    x, y,
    vx: (dx / len) * HAZARD_SPEED,
    vy: (dy / len) * HAZARD_SPEED,
    size: HAZARD_SIZE
  });
}

function swordTip(p) {
  return {
    tx: p.x + Math.cos(p.angle) * SWORD_REACH,
    ty: p.y + Math.sin(p.angle) * SWORD_REACH
  };
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

  // remove hazards far away
  room.hazards = room.hazards.filter(h => h.x > -80 && h.x < W + 80 && h.y > -80 && h.y < H + 80);

  // SWORD KILLS
  const remaining = [];
  for (const h of room.hazards) {
    let killedBy = null;

    for (const p of room.clients.values()) {
      if ((p.outUntil || 0) > t) continue;

      const { tx, ty } = swordTip(p);
      if (dist(tx, ty, h.x, h.y) <= (h.size + SWORD_HIT_RADIUS)) {
        killedBy = p;
        break;
      }
    }

    if (killedBy) {
      killedBy.score = (killedBy.score || 0) + 1;
      if (killedBy.token) tokenScores.set(killedBy.token, killedBy.score);
      broadcastChat(room, "ServerBot", `${killedBy.label} killed an enemy! (+1)`);
    } else {
      remaining.push(h);
    }
  }
  room.hazards = remaining;

  // ENEMY TOUCHES PLAYER -> OUT 30 sec
  for (const p of room.clients.values()) {
    if ((p.outUntil || 0) > t) continue;

    for (const h of room.hazards) {
      if (dist(p.x, p.y, h.x, h.y) <= PLAYER_HIT_RADIUS + h.size) {
        p.outUntil = t + OUT_MS;
        p.x = W / 2;
        p.y = H / 2;
        p.angle = 0;
        broadcastChat(room, "ServerBot", `${p.label} is OUT for 30 seconds!`);
        break;
      }
    }
  }

  sendState(room);
}

/* =========================
   REMINDER BOT (optional)
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
  }, 20000);
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
    token: null,
    x: W / 2,
    y: H / 2,
    angle: 0,
    color: colors[index % colors.length],
    label: `Player${index + 1}`,
    warnings: 0,
    outUntil: 0,
    score: 0
  };

  room.clients.set(ws, player);

  ws.send(JSON.stringify({ type: "welcome", id, room: roomNumber }));
  broadcastChat(room, "Server", `${player.label} joined (Room ${roomNumber})`);
  sendState(room);

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // HELLO (token for score)
    if (msg.type === "hello") {
      const p = room.clients.get(ws);
      if (!p) return;

      const token = String(msg.token ?? "").slice(0, 80);
      if (!token) return;

      p.token = token;
      p.score = tokenScores.get(token) ?? 0;

      ws.send(JSON.stringify({ type: "score", score: p.score }));
      return;
    }

    // MOVE
    if (msg.type === "move") {
      const p = room.clients.get(ws);
      if (!p) return;
      if ((p.outUntil || 0) > now()) return;

      p.x = clamp(Number(msg.x), 0, W);
      p.y = clamp(Number(msg.y), 0, H);
      p.angle = Number(msg.angle) || 0;
      return;
    }

    // CHAT (filtered + warnings + kick)
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
