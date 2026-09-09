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

function saveJSON(file, data, limit = 1000) {
  fs.writeFileSync(
    file,
    JSON.stringify(data.slice(-limit), null, 2),
    "utf8"
  );
}

function loadMessages() {
  return loadJSON(MESSAGES_FILE);
}

function saveMessages(messages) {
  saveJSON(MESSAGES_FILE, messages, 1000);
}

function loadPosts() {
  return loadJSON(POSTS_FILE);
}

function savePosts(posts) {
  saveJSON(POSTS_FILE, posts, 200);
}

app.use(express.static(path.join(__dirname, "public")));

app.use("/data", express.static(DATA_DIR));

const users = new Map();

io.on("connection", (socket) => {

  // Enviar historial del chat
  socket.emit("history", loadMessages());

  // Enviar publicaciones existentes
  socket.emit("posts history", loadPosts());


  // =========================
  // CHAT
  // =========================

  socket.on("join", (name) => {

    name = String(name || "")
      .trim()
      .slice(0, 24);

    if (!name) return;

    users.set(socket.id, name);

    io.emit(
      "users",
      [...users.values()]
    );

    io.emit(
      "system",
      `${name} se ha conectado`
    );

  });


  socket.on("chat message", (text) => {

    const name = users.get(socket.id);

    text = String(text || "")
      .trim()
      .slice(0, 1000);

    if (!name || !text) return;

    const msg = {

      id:
        Date.now() +
        Math.random(),

      user: name,

      text,

      time:
        new Date().toISOString()

    };

    const messages =
      loadMessages();

    messages.push(msg);

    saveMessages(messages);

    io.emit(
      "chat message",
      msg
    );

  });


  // =========================
  // PUBLICACIONES
  // =========================

  socket.on("new post", (post) => {

    if (!post) return;

    if (
      typeof post.archivo !== "string" ||
      post.archivo.length > 25 * 1024 * 1024
    ) {
      socket.emit(
        "post error",
        "El archivo es demasiado grande."
      );
      return;
    }

    const nuevoPost = {

      id:
        Date.now() +
        Math.random(),

      tipo:
        post.tipo === "video"
          ? "video"
          : "imagen",

      archivo:
        post.archivo,

      descripcion:
        String(post.descripcion || "")
          .slice(0, 1000),

      likes: 0,

      comentarios: [],

      autor: "Anónimo",

      time:
        new Date().toISOString()

    };


    const posts =
      loadPosts();

    posts.push(nuevoPost);

    savePosts(posts);


    // Enviar publicación a TODO el mundo
    io.emit(
      "new post",
      nuevoPost
    );

  });


  // =========================
  // LIKE
  // =========================

  socket.on("like post", (id) => {

    const posts =
      loadPosts();

    const post =
      posts.find(
        p => String(p.id) === String(id)
      );

    if (!post) return;

    post.likes++;

    savePosts(posts);

    io.emit(
      "post updated",
      post
    );

  });


  // =========================
  // COMENTARIO
  // =========================

  socket.on(
    "comment post",
    ({ id, comentario }) => {

      comentario =
        String(comentario || "")
          .trim()
          .slice(0, 500);

      if (!comentario) return;

      const posts =
        loadPosts();

      const post =
        posts.find(
          p => String(p.id) === String(id)
        );

      if (!post) return;

      post.comentarios.push(
        comentario
      );

      savePosts(posts);

      io.emit(
        "post updated",
        post
      );

    }
  );


  // =========================
  // ELIMINAR PUBLICACIÓN
  // =========================

  socket.on("delete post", (id) => {

    let posts =
      loadPosts();

    posts =
      posts.filter(
        p =>
          String(p.id) !==
          String(id)
      );

    savePosts(posts);

    io.emit(
      "post deleted",
      id
    );

  });


  // =========================
  // DESCONECTAR
  // =========================

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
