import http from "http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  res.end("WebSocket server running");
});

const wss = new WebSocketServer({ server });

const MAX_PLAYERS = 8;
const rooms = []; // each room = { clients: Map() }
let nextId = 1;

const colors = ["green","blue","red","orange","purple","cyan","magenta","brown"];

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

wss.on("connection", (ws) => {
  const room = findRoom();
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
    room: rooms.indexOf(room) + 1
  }));

  broadcastRoom(room);

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === "move") {
      const p = room.clients.get(ws);
      if (!p) return;
      p.x = msg.x;
      p.y = msg.y;
      p.angle = msg.angle;
      broadcastRoom(room);
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    broadcastRoom(room);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Listening on", PORT);
});
