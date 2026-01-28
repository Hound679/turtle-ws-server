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

// ✅ Safe starter list (add your own words here)
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

// Replace bad words with **** (case-insensitive)
function cleanText(text) {
  let result = String(text ?? "").slice(0, 160); // limit length
  for (const word of BAD_WORDS) {
    const rx = new RegExp(escapeRegExp(word), "gi");
    result = result.replace(rx, "*".repeat(word.length));
  }
  return result;
}

function findRoom() {
  for (const room of rooms) {
    if (room.clients.size < MAX_PLAYERS) return room;
  }
  const newRoom = { clients: new Map() };
  rooms.push(newRoom);
  return newRoom;
}

function broadcastRoom(room) {
  const players = [...room.clients.values()];
  const msg = JSON.stringify({ type: "state", players });

  for (const ws of room.clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

const BOT_MESSAGES = [
  "Reminder: Please be respectful. No swearing.",
  "Keep it friendly 🙂 No bad words.",
  "Chat rules: be kind, no insults, no swearing.",
  "Tip: If you're upset, take a break and try again."
];

// Sends one bot message to every room
function startBot() {
  setInterval(() => {
    for (const room of rooms) {
      if (!room || room.clients.size === 0) continue;

      const msg = BOT_MESSAGES[Math.floor(Math.random() * BOT_MESSAGES.length)];
      broadcastChat(room, "ServerBot", msg);
    }
  }, 6000); // ✅ every 60 seconds (change if you want)
}


function broadcastChat(room, from, text) {
  const msg = JSON.stringify({ type: "chat", from, text });

  for (const ws of room.clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on("connection", (ws) => {
  const room = findRoom();
  const roomNumber = rooms.indexOf(room) + 1;

  const index = room.clients.size; // 0..7 within room
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

    // MOVE
    if (msg.type === "move") {
      const p = room.clients.get(ws);
      if (!p) return;

      // small safety clamps
      p.x = Math.max(0, Math.min(800, Number(msg.x)));
      p.y = Math.max(0, Math.min(500, Number(msg.y)));
      p.angle = Number(msg.angle) || 0;

      broadcastRoom(room);
      return;
    }

    // CHAT (filtered)
    if (msg.type === "chat") {
      const p = room.clients.get(ws);
      if (!p) return;

      const filteredText = cleanText(msg.text);
      if (!filteredText.trim()) return;

      broadcastChat(room, p.label, filteredText);
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Listening on", PORT);
});
