import http from "http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  res.end("WebSocket server running");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ connected: true }));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log("Listening on", PORT);
});
