import http from "http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  res.end("WebSocket server running");
});

const wss = new WebSocketServer({ server });

const MAX_PLAYERS = 8;
const rooms = []; // each room: { clients: Map() }
let nextId = 1;

const colors = ["green", "blue", "red", "orange", "purple", "cyan", "magenta", "brown"];

/* =========================
   BAD WORD SYSTEM
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
   ROOMS
========================= */

function findRoom() {
  for (const room of rooms) {
    if (room.clients.size < MAX_PLAYERS) return room;
  }
  const newRoom = { clients: new Map() };
  rooms.push(newRoom);
  return newRoom;
}

/* =========================
   BROADCAST HELPERS
========================= */

function broadcastRoom(room) {
  const players = [...room.clients.values()];
  const msg = JSON.stringify({ type: "state", players });

  for (const ws of room.clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function broadcastChat(room, from, text) {
  const msg = JSON.stringify({ type: "chat", from, text });
  for (const ws of room.clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

/* =========================
   SERVER BOT
========================= */

const BOT_MESSAGES = [
  "Reminder: Please be respectful. No swearing.",
  "Keep it friendly 🙂",
  "Chat rules: be kind and respectful.",
  "No bad words please."
];

function startBot() {
  setInterval(() => {
    for (const room of rooms) {
      if (!room || room.clients.size === 0) continue;
      const msg = BOT_MESSAGES[Math.floor(Math.random() * BOT_MESSAGES.length)];
      broadcastChat(room, "ServerBot", msg);
    }
  }, 15000); // every 15 seconds
}

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
    x: 400,
    y: 250,
    angle: 0,
    color: colors[index % colors.length],
    label: `Player${index + 1}`
  };

  room.clients.set(ws, player);

  ws.send(JSON.stringify({
    type: "welcome",
    id,
    room: roomNumber
  }));

  broadcastRoom(room);
  broadcastChat(room, "Server", `${player.label} joined (Room ${roomNumber})`);

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    /* MOVE */
    if (msg.type === "move") {
      const p = room.clients.get(ws);
      if (!p) return;

      p.x = Math.max(0, Math.min(800, Number(msg.x)));
      p.y = Math.max(0, Math.min(500, Number(msg.y)));
      p.angle = Number(msg.angle) || 0;

      broadcastRoom(room);
      return;
    }

    /* CHAT */
    if (msg.type === "chat") {
      const p = room.clients.get(ws);
      if (!p) return;

      const originalText = String(msg.text ?? "");
      const filteredText = cleanText(originalText);
      if (!filteredText.trim()) return;

      // Send cleaned message
      broadcastChat(room, p.label, filteredText);

      // 🚨 Bot calls out swearing player
      if (containsBadWord(originalText)) {
        broadcastChat(
          room,
          "ServerBot",
          `${p.label}, please do not swear.`
        );
      }
      return;
    }
  });

  ws.on("close", () => {
    const p = room.clients.get(ws);
    room.clients.delete(ws);

    broadcastRoom(room);
    if (p) broadcastChat(room, "Server", `${p.label} left`);
  });
});

/* =========================
   START
========================= */

startBot();

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Listening on", PORT);
});
