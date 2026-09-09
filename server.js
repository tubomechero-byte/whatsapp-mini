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

const MESSAGES_FILE =
    path.join(DATA_DIR, "messages.json");

const POSTS_FILE =
    path.join(DATA_DIR, "posts.json");

fs.mkdirSync(
    DATA_DIR,
    { recursive: true }
);

if(!fs.existsSync(MESSAGES_FILE)){
    fs.writeFileSync(
        MESSAGES_FILE,
        "[]",
        "utf8"
    );
}

if(!fs.existsSync(POSTS_FILE)){
    fs.writeFileSync(
        POSTS_FILE,
        "[]",
        "utf8"
    );
}


function loadJSON(file){

    try{

        return JSON.parse(
            fs.readFileSync(
                file,
                "utf8"
            )
        );

    }catch{

        return [];

    }

}


function saveJSON(
    file,
    data,
    limit
){

    fs.writeFileSync(
        file,
        JSON.stringify(
            data.slice(-limit),
            null,
            2
        ),
        "utf8"
    );

}


app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


/*
================================
USUARIOS
================================
*/

const users =
    new Map();


function broadcastUsers(){

    const list =
        [...users.entries()]
            .map(
                ([id, data]) => ({

                    id:id,

                    name:data.name

                })
            );


    io.emit(
        "users",
        list
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
            loadJSON(
                MESSAGES_FILE
            )
        );


        socket.emit(
            "posts history",
            loadJSON(
                POSTS_FILE
            )
        );


        /*
        ================================
        ENTRAR
        ================================
        */

        socket.on(
            "join",
            name => {

                name =
                    String(name || "")
                        .trim()
                        .slice(0,24);


                if(!name){

                    return;

                }


                users.set(
                    socket.id,
                    {
                        name:name
                    }
                );


                broadcastUsers();


                io.emit(
                    "system",
                    `${name} se ha conectado`
                );

            }
        );


        /*
        ================================
        MENSAJES
        ================================
        */

        socket.on(
            "chat message",
            text => {

                const user =
                    users.get(
                        socket.id
                    );


                if(!user){

                    return;

                }


                text =
                    String(text || "")
                        .trim()
                        .slice(0,1000);


                if(!text){

                    return;

                }


                const msg = {

                    id:
                        Date.now() +
                        Math.random(),

                    user:
                        user.name,

                    text:
                        text,

                    time:
                        new Date().toISOString()

                };


                const messages =
                    loadJSON(
                        MESSAGES_FILE
                    );


                messages.push(
                    msg
                );


                saveJSON(
                    MESSAGES_FILE,
                    messages,
                    1000
                );


                io.emit(
                    "chat message",
                    msg
                );

            }
        );


        /*
        ================================
        PUBLICACIONES
        ================================
        */

        socket.on(
            "new post",
            post => {

                const user =
                    users.get(
                        socket.id
                    );


                if(!user){

                    return;

                }


                if(
                    !post ||
                    typeof post.archivo !==
                    "string"
                ){

                    return;

                }


                if(
                    post.archivo.length >
                    25 * 1024 * 1024
                ){

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
                        post.tipo ===
                        "video"
                        ? "video"
                        : "imagen",

                    archivo:
                        post.archivo,

                    descripcion:
                        String(
                            post.descripcion || ""
                        )
                        .trim()
                        .slice(0,1000),

                    likes:0,

                    comentarios:[],

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
                    posts,
                    200
                );


                io.emit(
                    "new post",
                    nuevoPost
                );

            }
        );


        /*
        ================================
        LIKE
        ================================
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


                if(!post){

                    return;

                }


                post.likes =
                    Number(
                        post.likes || 0
                    ) + 1;


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


        /*
        ================================
        COMENTARIOS
        ================================
        */

        socket.on(
            "comment post",
            data => {

                const user =
                    users.get(
                        socket.id
                    );


                if(!user){

                    return;

                }


                const id =
                    data &&
                    data.id;


                const comentario =
                    String(
                        data &&
                        data.comentario ||
                        ""
                    )
                    .trim()
                    .slice(0,500);


                if(!comentario){

                    return;

                }


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


                if(!post){

                    return;

                }


                if(
                    !Array.isArray(
                        post.comentarios
                    )
                ){

                    post.comentarios =
                        [];

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
                    posts,
                    200
                );


                io.emit(
                    "post updated",
                    post
                );

            }
        );


        /*
        ================================
        BORRAR PUBLICACIÓN
        ================================
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
                    posts,
                    200
                );


                io.emit(
                    "post deleted",
                    id
                );

            }
        );


        /*
        ================================
        LLAMADAS
        ================================
        */

        socket.on(
            "call-user",
            data => {

                if(!data){

                    return;

                }


                const destino =
                    io.sockets.sockets.get(
                        data.to
                    );


                if(!destino){

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
                            String(
                                data.fromName ||
                                "Usuario"
                            )
                            .slice(0,24),

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


        /*
        ================================
        SEÑALES WEBRTC
        ================================
        */

        socket.on(
            "call-signal",
            data => {

                if(!data || !data.to){

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


        /*
        ================================
        RECHAZAR LLAMADA
        ================================
        */

        socket.on(
            "call-rejected",
            data => {

                if(
                    !data ||
                    !data.to
                ){

                    return;

                }


                io.to(
                    data.to
                ).emit(
                    "call-rejected"
                );

            }
        );


        /*
        ================================
        TERMINAR LLAMADA
        ================================
        */

        socket.on(
            "call-ended",
            data => {

                if(
                    !data ||
                    !data.to
                ){

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
        ================================
        DESCONECTAR
        ================================
        */

        socket.on(
            "disconnect",
            () => {

                const user =
                    users.get(
                        socket.id
                    );


                users.delete(
                    socket.id
                );


                broadcastUsers();


                if(user){

                    io.emit(
                        "system",
                        `${user.name} se ha desconectado`
                    );

                }

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
