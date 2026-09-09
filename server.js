const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 25 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, "[]", "utf8");
}

if (!fs.existsSync(POSTS_FILE)) {
  fs.writeFileSync(POSTS_FILE, "[]", "utf8");
}

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function saveJSON(file, data, limit) {
  fs.writeFileSync(
    file,
    JSON.stringify(data.slice(-limit), null, 2),
    "utf8"
  );
}

const users = new Map();

app.use(express.static(path.join(__dirname, "public")));

/* =========================
   SOCKET.IO
========================= */

io.on("connection", (socket) => {

  socket.emit("history", loadJSON(MESSAGES_FILE));
  socket.emit("posts history", loadJSON(POSTS_FILE));

  /* ===== CHAT ===== */

  socket.on("join", (name) => {

    name = String(name || "")
      .trim()
      .slice(0, 24);

    if (!name) return;

    users.set(socket.id, name);

    io.emit("users", [...users.values()]);
    io.emit("system", `${name} se ha conectado`);
  });


  socket.on("chat message", (text) => {

    const name = users.get(socket.id);

    text = String(text || "")
      .trim()
      .slice(0, 1000);

    if (!name || !text) return;

    const msg = {
      id: Date.now() + Math.random(),
      user: name,
      text: text,
      time: new Date().toISOString()
    };

    const messages = loadJSON(MESSAGES_FILE);

    messages.push(msg);

    saveJSON(
      MESSAGES_FILE,
      messages,
      1000
    );

    io.emit("chat message", msg);
  });


  /* ===== PUBLICACIONES ===== */

  socket.on("new post", (post) => {

    const nombre =
      users.get(socket.id) || "Usuario";


    if (!post || typeof post.archivo !== "string") {
      return;
    }


    if (post.archivo.length > 25 * 1024 * 1024) {

      socket.emit(
        "post error",
        "El archivo es demasiado grande."
      );

      return;
    }


    const nuevoPost = {

      id:
        Date.now() + Math.random(),

      tipo:
        post.tipo === "video"
          ? "video"
          : "imagen",

      archivo:
        post.archivo,

      descripcion:
        String(post.descripcion || "")
          .trim()
          .slice(0, 1000),

      likes: 0,

      comentarios: [],

      autor: nombre,

      time:
        new Date().toISOString()
    };


    const posts =
      loadJSON(POSTS_FILE);

    posts.push(nuevoPost);

    saveJSON(
      POSTS_FILE,
      posts,
      200
    );


    // La reciben TODOS
    io.emit(
      "new post",
      nuevoPost
    );
  });


  /* ===== LIKES ===== */

  socket.on("like post", (id) => {

    const posts =
      loadJSON(POSTS_FILE);

    const post =
      posts.find(
        p => String(p.id) === String(id)
      );

    if (!post) return;

    post.likes =
      Number(post.likes || 0) + 1;

    saveJSON(
      POSTS_FILE,
      posts,
      200
    );

    io.emit(
      "post updated",
      post
    );
  });


  /* ===== COMENTARIOS ===== */

  socket.on(
    "comment post",
    ({ id, comentario }) => {

      comentario =
        String(comentario || "")
          .trim()
          .slice(0, 500);

      if (!comentario) return;

      const posts =
        loadJSON(POSTS_FILE);

      const post =
        posts.find(
          p => String(p.id) === String(id)
        );

      if (!post) return;

      if (!Array.isArray(post.comentarios)) {
        post.comentarios = [];
      }

      post.comentarios.push(comentario);

      saveJSON(
        POSTS_FILE,
        posts,
        200
      );

      io.emit(
        "post updated",
        post
      );
    }
  );


  /* ===== BORRAR ===== */

  socket.on("delete post", (id) => {

    let posts =
      loadJSON(POSTS_FILE);

    posts =
      posts.filter(
        p =>
          String(p.id) !== String(id)
      );

    saveJSON(
      POSTS_FILE,
      posts,
      200
    );

    io.emit(
      "post deleted",
      id
    );
  });


  /* ===== DESCONECTAR ===== */

  socket.on("disconnect", () => {

    const name =
      users.get(socket.id);

    users.delete(socket.id);

    io.emit(
      "users",
      [...users.values()]
    );

    if (name) {
      io.emit(
        "system",
        `${name} se ha desconectado`
      );
    }
  });

});


server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Servidor funcionando en puerto ${PORT}`
    );
  }
);
