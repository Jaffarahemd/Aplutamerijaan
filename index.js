/* =========================================================
   PROFESSIONAL WHATSAPP SERVER (RENDER SAFE FIXED)
   - One-time pairing
   - Persistent session
   - Refresh safe UI
   - Render compatible
   - LINE-BY-LINE sending
   - Prefix support
   - 10s default delay
========================================================= */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import pino from "pino";

import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} from "@whiskeysockets/baileys";

/* ================= SAFETY ================= */

process.on("unhandledRejection", err => {
  console.error("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", err => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

/* ================= SERVER ================= */

const app = express();

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;

/* ================= SESSION ================= */

const SESSION_PATH =
  process.env.SESSION_PATH || "./session";

if (!fs.existsSync(SESSION_PATH)) {
  fs.mkdirSync(SESSION_PATH, {
    recursive: true
  });
}

/* ================= GLOBAL ================= */

let sock = null;

let isConnected = false;

let isReconnecting = false;

let stopSending = false;

/* ================= HTML ================= */

const html = `
<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
/>

<title>WhatsApp Panel</title>

<style>

body{
  background:#0f172a;
  color:white;
  font-family:Segoe UI;
  display:flex;
  justify-content:center;
  padding:20px;
}

.card{
  background:#111827;
  width:100%;
  max-width:650px;
  border-radius:20px;
  padding:20px;
}

input,button{
  width:100%;
  padding:12px;
  margin-top:10px;
  border:none;
  border-radius:10px;
  box-sizing:border-box;
}

input{
  background:#1f2937;
  color:white;
}

button{
  background:#22c55e;
  color:black;
  font-weight:bold;
  cursor:pointer;
}

.stop{
  background:#ef4444;
  color:white;
}

#logs{
  background:black;
  color:#22c55e;
  height:220px;
  overflow:auto;
  padding:10px;
  margin-top:15px;
  border-radius:10px;
  font-family:monospace;
}

.grp{
  background:#1f2937;
  padding:10px;
  margin-top:5px;
  border-radius:10px;
  cursor:pointer;
}

</style>

</head>

<body>

<div class="card">

<h2>WhatsApp Bot Panel</h2>

<div id="status">
Status: Loading...
</div>

<input
  id="phone"
  placeholder="Phone Number (91xxxxxxxxxx)"
/>

<button onclick="pair()">
GET PAIR CODE
</button>

<div id="pairBox"></div>

<h3>Groups</h3>

<div id="groups">
Login required
</div>

<input
  id="target"
  placeholder="Target JID"
/>

<input
  id="prefix"
  placeholder="Prefix / Name"
/>

<input
  id="delay"
  placeholder="Delay in seconds (default 10)"
/>

<input
  type="file"
  id="file"
  accept=".txt"
/>

<button onclick="startSend()">
START
</button>

<button
  class="stop"
  onclick="stopSend()"
>
STOP
</button>

<div id="logs"></div>

</div>

<script src="/socket.io/socket.io.js"></script>

<script>

const socket = io();

let msgs = "";

function addLog(text){

  logs.innerHTML += "<div>> " + text + "</div>";

  logs.scrollTop = logs.scrollHeight;
}

function pair(){

  const num = phone.value.trim();

  if(!num){
    alert("Enter phone number");
    return;
  }

  socket.emit("pair", num);
}

function stopSend(){

  socket.emit("stop");
}

function startSend(){

  socket.emit("start", {
    target: target.value.trim(),
    prefix: prefix.value.trim(),
    delay: delay.value.trim(),
    msgs
  });
}

socket.on("status", s => {

  status.innerText = "Status: " + s;
});

socket.on("code", c => {

  pairBox.innerText =
    "Pair Code: " + c;
});

socket.on("log", m => {

  addLog(m);
});

socket.on("groups", arr => {

  groups.innerHTML = "";

  arr.forEach(g => {

    const div =
      document.createElement("div");

    div.className = "grp";

    div.innerText = g.subject;

    div.onclick = () => {
      target.value = g.id;
    };

    groups.appendChild(div);
  });

});

file.onchange = e => {

  const fileObj =
    e.target.files[0];

  if(!fileObj) return;

  const reader =
    new FileReader();

  reader.onload = () => {

    msgs = reader.result || "";

    addLog("Text file loaded");
  };

  reader.readAsText(fileObj);
};

</script>

</body>
</html>
`;

app.get("/", (req, res) => {
  res.send(html);
});

/* ================= WHATSAPP ================= */

async function startWhatsApp() {

  try {

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      SESSION_PATH
    );

    const {
      version
    } = await fetchLatestBaileysVersion();

    sock = makeWASocket({

      auth: state,

      version,

      browser:
        Browsers.ubuntu("Chrome"),

      logger:
        pino({
          level: "silent"
        })
    });

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    sock.ev.on(
      "connection.update",
      async update => {

        const {
          connection,
          lastDisconnect
        } = update;

        if (connection === "open") {

          isConnected = true;

          isReconnecting = false;

          console.log(
            "WhatsApp Connected"
          );

          io.emit(
            "status",
            "Connected"
          );

          try {

            const groups =
              await sock.groupFetchAllParticipating();

            const list =
              Object.entries(groups).map(
                ([id, g]) => ({
                  id,
                  subject:
                    g.subject || "Unnamed"
                })
              );

            io.emit(
              "groups",
              list
            );

          } catch (e) {

            console.log(
              "Group fetch failed:",
              e.message
            );
          }
        }

        if (connection === "close") {

          isConnected = false;

          io.emit(
            "status",
            "Disconnected"
          );

          console.log(
            "Connection closed"
          );

          const code =
            lastDisconnect?.error
              ?.output?.statusCode;

          const shouldReconnect =
            code !== DisconnectReason.loggedOut;

          if (
            shouldReconnect &&
            !isReconnecting
          ) {

            isReconnecting = true;

            io.emit(
              "status",
              "Reconnecting"
            );

            console.log(
              "Reconnecting in 5s..."
            );

            setTimeout(() => {
              startWhatsApp();
            }, 5000);
          }
        }

      }
    );

  } catch (err) {

    console.error(
      "START ERROR:",
      err
    );

    setTimeout(() => {
      startWhatsApp();
    }, 5000);
  }
}

startWhatsApp();

/* ================= SOCKET ================= */

io.on("connection", socket => {

  socket.emit(
    "status",

    isConnected
      ? "Connected"
      : isReconnecting
      ? "Reconnecting"
      : "Disconnected"
  );

  /* ================= PAIR ================= */

  socket.on("pair", async raw => {

    try {

      if (!sock) {

        socket.emit(
          "log",
          "Socket not ready"
        );

        return;
      }

      if (isConnected) {

        socket.emit(
          "log",
          "Already connected"
        );

        return;
      }

      const phone =
        String(raw || "")
          .replace(/\D/g, "");

      if (!phone) {

        socket.emit(
          "log",
          "Invalid number"
        );

        return;
      }

      const code =
        await sock.requestPairingCode(
          phone
        );

      socket.emit(
        "code",
        code
      );

      socket.emit(
        "log",
        "Pair code generated"
      );

    } catch (err) {

      socket.emit(
        "log",
        "Pair failed: " + err.message
      );
    }

  });

  /* ================= START SEND ================= */

  socket.on("start", async cfg => {

    try {

      if (!sock || !isConnected) {

        socket.emit(
          "log",
          "WhatsApp not connected"
        );

        return;
      }

      if (
        !cfg.target ||
        !cfg.target.includes("@")
      ) {

        socket.emit(
          "log",
          "Invalid target JID"
        );

        return;
      }

      const rawText =
        String(cfg.msgs || "");

      /* ================= LINE SPLIT ================= */

      const lines = rawText
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

      if (!lines.length) {

        socket.emit(
          "log",
          "No valid lines found"
        );

        return;
      }

      stopSending = false;

      const delayMs =
        Math.max(
          10,
          parseInt(cfg.delay) || 10
        ) * 1000;

      socket.emit(
        "log",
        `Loaded ${lines.length} lines | Delay ${delayMs / 1000}s`
      );

      let index = 0;

      async function sendNext() {

        if (stopSending) {

          socket.emit(
            "log",
            "Stopped successfully"
          );

          return;
        }

        try {

          const line =
            lines[index];

          const text =
            cfg.prefix
              ? `*${cfg.prefix}* ${line}`
              : line;

          await sock.sendMessage(
            cfg.target,
            { text }
          );

          socket.emit(
            "log",
            `Sent line ${index + 1}/${lines.length}`
          );

          index =
            (index + 1) %
            lines.length;

          const extra =
            Math.floor(
              Math.random() * 3000
            );

          setTimeout(
            sendNext,
            delayMs + extra
          );

        } catch (err) {

          socket.emit(
            "log",
            "Send failed: " + err.message
          );

          setTimeout(
            sendNext,
            delayMs
          );
        }

      }

      sendNext();

    } catch (err) {

      socket.emit(
        "log",
        "Start failed: " + err.message
      );
    }

  });

  /* ================= STOP ================= */

  socket.on("stop", () => {

    stopSending = true;

    socket.emit(
      "log",
      "Stopping..."
    );

  });

});

/* ================= START SERVER ================= */

server.listen(PORT, () => {

  console.log(
    "Server running on port " + PORT
  );

});
