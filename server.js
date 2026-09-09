const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const DATA = path.join(__dirname, "data", "messages.json");
fs.mkdirSync(path.dirname(DATA), { recursive: true });

if (!fs.existsSync(DATA)) {
  fs.writeFileSync(DATA, "[]", "utf8");
}

function loadMessages() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return []; }
}
function saveMessages(messages) {
  fs.writeFileSync(DATA, JSON.stringify(messages.slice(-1000), null, 2), "utf8");
}

app.use(express.static(path.join(__dirname, "public")));

const users = new Map(); // socket.id -> user

io.on("connection", (socket) => {
  socket.emit("history", loadMessages());

  socket.on("join", (name) => {
    name = String(name || "").trim().slice(0, 24);
    if (!name) return;
    users.set(socket.id, name);
    io.emit("users", [...users.values()]);
    io.emit("system", `${name} se ha conectado`);
  });

  socket.on("chat message", (text) => {
    const name = users.get(socket.id);
    text = String(text || "").trim().slice(0, 1000);
    if (!name || !text) return;

    const msg = {
      id: Date.now() + Math.random(),
      user: name,
      text,
      time: new Date().toISOString()
    };

    const messages = loadMessages();
    messages.push(msg);
    saveMessages(messages);
    io.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    const name = users.get(socket.id);
    users.delete(socket.id);
    io.emit("users", [...users.values()]);
    if (name) io.emit("system", `${name} se ha desconectado`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mini WhatsApp: http://localhost:${PORT}`);
});
