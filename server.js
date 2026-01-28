import http from "http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  res.end("WebSocket server running");
});

const wss = new WebSocketServer({ server });

let nextId = 1;
const clients = new Map(); // ws -> player

function broadcastState() {
  const players = [...clients.values()];
  const msg = JSON.stringify({ type: "state", players });
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on("connection", (ws) => {
    // ✅ Limit to 8 players
  if (clients.size >= 8) {
    ws.send(JSON.stringify({ type: "full" }));
    ws.close();
    return;
  }

  const id = String(nextId++);
  const index = clients.size; // 0..7

  const colors = ["green","blue","red","orange","purple","cyan","magenta","brown"];

  const player = {
    id,
    x: 400,
    y: 250,
    angle: 0,
    color: colors[index],
    label: `Player${index + 1}`
  };


  clients.set(ws, player);

  ws.send(JSON.stringify({ type: "welcome", id }));
  broadcastState();

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "move") {
      const p = clients.get(ws);
      if (!p) return;
      p.x = msg.x;
      p.y = msg.y;
      p.angle = msg.angle;
      broadcastState();
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    broadcastState();
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Listening on", PORT);
});
