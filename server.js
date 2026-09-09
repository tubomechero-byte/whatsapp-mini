const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 25 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const PUSH_FILE = path.join(DATA_DIR, "push-subscriptions.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const CALLS_FILE = path.join(DATA_DIR, "pending-calls.json");
const VAPID_FILE = path.join(DATA_DIR, "vapid.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function ensureFile(file) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, "[]", "utf8");
    }
}

ensureFile(MESSAGES_FILE);
ensureFile(POSTS_FILE);
ensureFile(PUSH_FILE);
ensureFile(USERS_FILE);
ensureFile(CALLS_FILE);

let vapidKeys;

if (fs.existsSync(VAPID_FILE)) {
    try {
        vapidKeys = JSON.parse(
            fs.readFileSync(VAPID_FILE, "utf8")
        );
    } catch {
        vapidKeys = webpush.generateVAPIDKeys();
        fs.writeFileSync(
            VAPID_FILE,
            JSON.stringify(vapidKeys, null, 2),
            "utf8"
        );
    }
} else {
    vapidKeys = webpush.generateVAPIDKeys();

    fs.writeFileSync(
        VAPID_FILE,
        JSON.stringify(vapidKeys, null, 2),
        "utf8"
    );
}

webpush.setVapidDetails(
    "mailto:admin@example.com",
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

function loadJSON(file) {
    try {
        const value = JSON.parse(
            fs.readFileSync(file, "utf8")
        );

        return Array.isArray(value)
            ? value
            : [];
    } catch {
        return [];
    }
}

function saveJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

app.get(
    "/api/vapid-public-key",
    (req, res) => {
        res.json({
            publicKey: vapidKeys.publicKey
        });
    }
);

/*
================================
USUARIOS
================================
*/

const users = new Map();

const registeredUsers = new Map();

function loadRegisteredUsers() {
    const list = loadJSON(USERS_FILE);

    for (const item of list) {
        if (!item || !item.name) continue;

        registeredUsers.set(
            String(item.name).toLowerCase(),
            {
                name: String(item.name).slice(0, 24)
            }
        );
    }
}

function saveRegisteredUsers() {
    const list =
        [...registeredUsers.values()]
            .map(user => ({
                name: user.name
            }));

    saveJSON(
        USERS_FILE,
        list
    );
}

loadRegisteredUsers();

function getUserList() {
    return [...registeredUsers.values()]
        .map(user => {
            const liveEntry =
                [...users.entries()]
                    .find(
                        ([, item]) =>
                            item.name === user.name
                    );

            return {
                id:
                    liveEntry
                    ? liveEntry[0]
                    : null,

                name:
                    user.name,

                online:
                    Boolean(liveEntry)
            };
        })
        .sort(
            (a, b) =>
                a.name.localeCompare(b.name)
        );
}

function broadcastUsers() {
    io.emit(
        "users",
        getUserList()
    );
}

/*
================================
PUSH
================================
*/

function getPushSubscriptions() {
    return loadJSON(PUSH_FILE);
}

function savePushSubscriptions(list) {
    saveJSON(
        PUSH_FILE,
        list
    );
}

async function sendPushToUser(
    name,
    payload
) {
    const subscriptions =
        getPushSubscriptions();

    const survivors = [];

    for (const item of subscriptions) {
        if (
            !item ||
            !item.subscription ||
            !item.name
        ) {
            continue;
        }

        if (
            String(item.name).toLowerCase() !==
            String(name).toLowerCase()
        ) {
            survivors.push(item);
            continue;
        }

        try {
            await webpush.sendNotification(
                item.subscription,
                JSON.stringify(payload),
                {
                    TTL: 60 * 60 * 24
                }
            );

            survivors.push(item);
        } catch (error) {
            if (
                error.statusCode !== 404 &&
                error.statusCode !== 410
            ) {
                console.error(
                    "Error push:",
                    error.message
                );

                survivors.push(item);
            }
        }
    }

    savePushSubscriptions(
        survivors
    );
}

/*
================================
SOCKET.IO
================================
*/

io.on(
    "connection",
    socket => {

        console.log(
            "Usuario conectado:",
            socket.id
        );

        socket.emit(
            "history",
            loadJSON(MESSAGES_FILE)
        );

        socket.emit(
            "posts history",
            loadJSON(POSTS_FILE)
        );

        /*
        ==============================
        JOIN
        ==============================
        */

        socket.on(
            "join",
            name => {

                name =
                    String(name || "")
                        .trim()
                        .slice(0, 24);

                if (!name) return;

                const key =
                    name.toLowerCase();

                if (
                    !registeredUsers.has(key)
                ) {
                    registeredUsers.set(
                        key,
                        {
                            name
                        }
                    );

                    saveRegisteredUsers();
                }

                users.set(
                    socket.id,
                    {
                        name:
                            registeredUsers
                                .get(key)
                                .name
                    }
                );

                socket.emit(
                    "users",
                    getUserList()
                );

                broadcastUsers();

                /*
                ------------------------------
                LLAMADAS PENDIENTES
                ------------------------------
                */

                const pending =
                    loadJSON(CALLS_FILE);

                const index =
                    pending.findIndex(
                        call =>
                            String(call.targetName).toLowerCase() ===
                            String(name).toLowerCase()
                    );

                if (index !== -1) {

                    const call =
                        pending[index];

                    socket.emit(
                        "incoming-call-pending",
                        {
                            from:
                                call.fromSocketId,

                            fromName:
                                call.fromName,

                            video:
                                Boolean(
                                    call.video
                                ),

                            offer:
                                call.offer,

                            pendingId:
                                call.id
                        }
                    );
                }

                io.emit(
                    "system",
                    `${name} se ha conectado`
                );
            }
        );

        /*
        ==============================
        PUSH
        ==============================
        */

        socket.on(
            "subscribe-push",
            data => {

                const currentUser =
                    users.get(socket.id);

                if (
                    !currentUser ||
                    !data ||
                    !data.subscription
                ) {
                    return;
                }

                let subscriptions =
                    getPushSubscriptions();

                subscriptions =
                    subscriptions.filter(
                        item =>
                            item?.subscription?.endpoint !==
                            data.subscription.endpoint
                    );

                subscriptions.push({
                    name:
                        currentUser.name,

                    subscription:
                        data.subscription
                });

                savePushSubscriptions(
                    subscriptions
                );

                socket.emit(
                    "push-subscription-saved"
                );
            }
        );

        /*
        ==============================
        CHAT
        ==============================
        */

        socket.on(
            "chat message",
            text => {

                const user =
                    users.get(socket.id);

                if (!user) return;

                text =
                    String(text || "")
                        .trim()
                        .slice(0, 1000);

                if (!text) return;

                const msg = {
                    id:
                        Date.now() +
                        Math.random(),

                    user:
                        user.name,

                    text,

                    time:
                        new Date().toISOString()
                };

                const messages =
                    loadJSON(
                        MESSAGES_FILE
                    );

                messages.push(msg);

                saveJSON(
                    MESSAGES_FILE,
                    messages.slice(-1000)
                );

                io.emit(
                    "chat message",
                    msg
                );

                /*
                Push solo a usuarios desconectados.
                */

                const connected =
                    new Set(
                        [...users.values()]
                            .map(
                                item =>
                                    item.name.toLowerCase()
                            )
                    );

                for (
                    const registered
                    of registeredUsers.values()
                ) {
                    if (
                        !connected.has(
                            registered.name.toLowerCase()
                        )
                    ) {
                        sendPushToUser(
                            registered.name,
                            {
                                title:
                                    "Mini WhatsApp",

                                body:
                                    `${msg.user}: ${msg.text}`,

                                url:
                                    "/"
                            }
                        );
                    }
                }
            }
        );

        /*
        ==============================
        BORRAR MENSAJE
        ==============================
        */

        socket.on(
            "delete message",
            id => {

                const user =
                    users.get(socket.id);

                if (!user) return;

                let messages =
                    loadJSON(
                        MESSAGES_FILE
                    );

                const message =
                    messages.find(
                        m =>
                            String(m.id) ===
                            String(id)
                    );

                if (!message) return;

                if (
                    message.user !==
                    user.name
                ) {
                    return;
                }

                messages =
                    messages.filter(
                        m =>
                            String(m.id) !==
                            String(id)
                    );

                saveJSON(
                    MESSAGES_FILE,
                    messages.slice(-1000)
                );

                io.emit(
                    "message deleted",
                    id
                );
            }
        );

        /*
        ==============================
        LLAMADA A USUARIO OFFLINE
        ==============================
        */

        socket.on(
            "call-offline",
            async data => {

                const caller =
                    users.get(socket.id);

                if (!caller) return;

                const targetName =
                    String(
                        data?.targetName || ""
                    )
                    .trim()
                    .slice(0, 24);

                if (!targetName) return;

                const target =
                    [...registeredUsers.values()]
                        .find(
                            user =>
                                user.name.toLowerCase() ===
                                targetName.toLowerCase()
                        );

                if (!target) {

                    socket.emit(
                        "call-pending-error",
                        "Ese usuario todavía no está registrado."
                    );

                    return;
                }

                /*
                Si está online, redirigimos a la
                llamada normal.
                */

                const targetSocket =
                    [...users.entries()]
                        .find(
                            ([, user]) =>
                                user.name ===
                                target.name
                        );

                if (targetSocket) {

                    const destino =
                        io.sockets.sockets.get(
                            targetSocket[0]
                        );

                    if (destino) {

                        destino.emit(
                            "incoming-call",
                            {
                                from:
                                    socket.id,

                                fromName:
                                    caller.name,

                                video:
                                    Boolean(
                                        data.video
                                    ),

                                offer:
                                    data.offer
                            }
                        );

                        return;
                    }
                }

                /*
                IMPORTANTE:
                Solo tiene sentido guardar una oferta
                WebRTC si quien llama sigue conectado.
                */

                if (!data.offer) {

                    socket.emit(
                        "call-pending-error",
                        "La llamada no se pudo preparar. El usuario está desconectado."
                    );

                    return;
                }

                const pending =
                    loadJSON(
                        CALLS_FILE
                    );

                /*
                Solo una llamada pendiente por
                destinatario.
                */

                const cleaned =
                    pending.filter(
                        call =>
                            String(
                                call.targetName
                            ).toLowerCase() !==
                            String(
                                target.name
                            ).toLowerCase()
                    );

                const call = {
                    id:
                        Date.now() +
                        Math.random(),

                    targetName:
                        target.name,

                    fromName:
                        caller.name,

                    fromSocketId:
                        socket.id,

                    video:
                        Boolean(
                            data.video
                        ),

                    offer:
                        data.offer,

                    createdAt:
                        new Date().toISOString()
                };

                cleaned.push(
                    call
                );

                saveJSON(
                    CALLS_FILE,
                    cleaned.slice(-100)
                );

                await sendPushToUser(
                    target.name,
                    {
                        title:
                            call.video
                            ? "Videollamada"
                            : "Llamada",

                        body:
                            `${caller.name} te está llamando`,

                        url:
                            "/"
                    }
                );

                socket.emit(
                    "call-pending-saved",
                    {
                        targetName:
                            target.name,

                        video:
                            call.video
                    }
                );
            }
        );

        /*
        ==============================
        ELIMINAR LLAMADA PENDIENTE
        ==============================
        */

        socket.on(
            "call-pending-accepted",
            data => {

                if (!data?.pendingId) {
                    return;
                }

                let calls =
                    loadJSON(
                        CALLS_FILE
                    );

                calls =
                    calls.filter(
                        call =>
                            String(call.id) !==
                            String(data.pendingId)
                    );

                saveJSON(
                    CALLS_FILE,
                    calls
                );
            }
        );

        socket.on(
            "call-pending-rejected",
            data => {

                if (!data?.pendingId) {
                    return;
                }

                let calls =
                    loadJSON(
                        CALLS_FILE
                    );

                calls =
                    calls.filter(
                        call =>
                            String(call.id) !==
                            String(data.pendingId)
                    );

                saveJSON(
                    CALLS_FILE,
                    calls
                );
            }
        );

        /*
        ==============================
        PUBLICACIONES
        ==============================
        */

        socket.on(
            "new post",
            post => {

                const user =
                    users.get(socket.id);

                if (!user) return;

                if (
                    !post ||
                    typeof post.archivo !==
                    "string"
                ) {
                    return;
                }

                if (
                    post.archivo.length >
                    25 * 1024 * 1024
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
                        String(
                            post.descripcion || ""
                        )
                        .trim()
                        .slice(0, 1000),

                    likes: 0,

                    comentarios: [],

                    autor:
                        user.name,

                    time:
                        new Date().toISOString()
                };

                const posts =
                    loadJSON(
                        POSTS_FILE
                    );

                posts.push(
                    nuevoPost
                );

                saveJSON(
                    POSTS_FILE,
                    posts.slice(-200)
                );

                io.emit(
                    "new post",
                    nuevoPost
                );
            }
        );

        /*
        ==============================
        LIKE
        ==============================
        */

        socket.on(
            "like post",
            id => {

                const posts =
                    loadJSON(
                        POSTS_FILE
                    );

                const post =
                    posts.find(
                        p =>
                            String(p.id) ===
                            String(id)
                    );

                if (!post) return;

                post.likes =
                    Number(
                        post.likes || 0
                    ) + 1;

                saveJSON(
                    POSTS_FILE,
                    posts.slice(-200)
                );

                io.emit(
                    "post updated",
                    post
                );
            }
        );

        /*
        ==============================
        COMENTARIOS
        ==============================
        */

        socket.on(
            "comment post",
            data => {

                const user =
                    users.get(socket.id);

                if (!user) return;

                const id =
                    data &&
                    data.id;

                const comentario =
                    String(
                        (data &&
                        data.comentario) ||
                        ""
                    )
                    .trim()
                    .slice(0, 500);

                if (!comentario) return;

                const posts =
                    loadJSON(
                        POSTS_FILE
                    );

                const post =
                    posts.find(
                        p =>
                            String(p.id) ===
                            String(id)
                    );

                if (!post) return;

                if (
                    !Array.isArray(
                        post.comentarios
                    )
                ) {
                    post.comentarios = [];
                }

                post.comentarios.push({
                    autor:
                        user.name,

                    texto:
                        comentario,

                    time:
                        new Date().toISOString()
                });

                saveJSON(
                    POSTS_FILE,
                    posts.slice(-200)
                );

                io.emit(
                    "post updated",
                    post
                );
            }
        );

        /*
        ==============================
        BORRAR PUBLICACIÓN
        ==============================
        */

        socket.on(
            "delete post",
            id => {

                let posts =
                    loadJSON(
                        POSTS_FILE
                    );

                posts =
                    posts.filter(
                        p =>
                            String(p.id) !==
                            String(id)
                    );

                saveJSON(
                    POSTS_FILE,
                    posts
                );

                io.emit(
                    "post deleted",
                    id
                );
            }
        );

        /*
        ==============================
        LLAMADAS WEBRTC
        ==============================
        */

        socket.on(
            "call-user",
            data => {

                if (
                    !data ||
                    !data.to
                ) {
                    return;
                }

                const caller =
                    users.get(socket.id);

                if (!caller) {
                    return;
                }

                const destino =
                    io.sockets.sockets.get(
                        data.to
                    );

                if (!destino) {
                    socket.emit(
                        "call-rejected",
                        {
                            reason:
                                "offline"
                        }
                    );

                    return;
                }

                destino.emit(
                    "incoming-call",
                    {
                        from:
                            socket.id,

                        fromName:
                            caller.name,

                        video:
                            Boolean(
                                data.video
                            ),

                        offer:
                            data.offer
                    }
                );
            }
        );

        socket.on(
            "call-signal",
            data => {

                if (
                    !data ||
                    !data.to
                ) {
                    return;
                }

                io.to(
                    data.to
                ).emit(
                    "call-signal",
                    {
                        from:
                            socket.id,

                        type:
                            data.type,

                        answer:
                            data.answer,

                        candidate:
                            data.candidate
                    }
                );
            }
        );

        socket.on(
            "call-rejected",
            data => {

                if (
                    !data ||
                    !data.to
                ) {
                    return;
                }

                io.to(
                    data.to
                ).emit(
                    "call-rejected"
                );
            }
        );

        socket.on(
            "call-ended",
            data => {

                if (
                    !data ||
                    !data.to
                ) {
                    return;
                }

                io.to(
                    data.to
                ).emit(
                    "call-ended"
                );
            }
        );

        /*
        ==============================
        DESCONECTAR
        ==============================
        */

        socket.on(
            "disconnect",
            () => {

                const user =
                    users.get(socket.id);

                users.delete(
                    socket.id
                );

                broadcastUsers();

                if (user) {
                    io.emit(
                        "system",
                        `${user.name} se ha desconectado`
                    );
                }

                console.log(
                    "Usuario desconectado:",
                    socket.id
                );
            }
        );
    }
);

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `Servidor funcionando en puerto ${PORT}`
        );
    }
);
