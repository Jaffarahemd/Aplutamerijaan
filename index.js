/* =========================================================
   PROFESSIONAL WHATSAPP SERVER (RENDER MASTER FIXED)
   - One-time pairing
   - Persistent session
   - Render safe
   - LINE BY LINE TXT sending
   - Prefix + Delay + Stop
   - Anti duplicate loops
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
process.on("unhandledRejection", e => console.error("REJECTION:", e));
process.on("uncaughtException", e => console.error("EXCEPTION:", e));

/* ================= SERVER ================= */
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

/* ================= SESSION ================= */
const SESSION_PATH = process.env.SESSION_PATH || "./session";
if (!fs.existsSync(SESSION_PATH)) {
  fs.mkdirSync(SESSION_PATH, { recursive: true });
}

/* ================= GLOBAL STATE ================= */
let sock = null;
let isConnected = false;
let isReconnecting = false;
let stopSending = false;
let isSending = false;

/* ================= UI ================= */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp Bot Control</title>
<style>
body{
  background:#0f172a;
  font-family:Segoe UI;
  color:white;
  display:flex;
  justify-content:center;
  padding:20px
}
.card{
  width:100%;
  max-width:600px;
  background:#111827;
  padding:20px;
  border-radius:20px
}
input,button{
  width:100%;
  padding:12px;
  margin:6px 0;
  border-radius:10px;
  border:none
}
button{
  background:#22c55e;
  font-weight:bold;
  cursor:pointer
}
.stop{
  background:red;
  color:white
}
#logs{
  background:black;
  height:220px;
  overflow:auto;
  padding:10px;
  border-radius:10px;
  font-family:monospace
}
.grp{
  padding:8px;
  border:1px solid #333;
  margin:4px 0;
  cursor:pointer;
  border-radius:8px
}
</style>
</head>
<body>
<div class="card">
<h2>WhatsApp Bot Control Panel</h2>

<div id="status">Status: Unknown</div>

<input id="phone" placeholder="91xxxxxxxxxx">
<button onclick="pair()">Get Pairing Code</button>

<div id="pairBox"></div>

<h3>Groups</h3>
<div id="groups">Login required</div>

<input id="target" placeholder="Target JID">
<input id="prefix" placeholder="Prefix (optional)">
<input id="delay" placeholder="Delay seconds (default 10)">
<input type="file" id="file" accept=".txt">

<button onclick="start()">START</button>
<button class="stop" onclick="stopMsg()">STOP</button>

<div id="logs"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
let msgs = "";

function pair(){
  if(!phone.value) return alert("Enter phone number");
  socket.emit("pair", phone.value);
}

function stopMsg(){
  socket.emit("stop");
}

file.onchange = e => {
  const file = e.target.files[0];
  if(!file) return;

  const reader = new FileReader();
  reader.onload = () => msgs = reader.result;
  reader.readAsText(file);
};

function start(){
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
  pairBox.innerText = c;
});

socket.on("groups", g => {
  groups.innerHTML = g.map(x =>
    \`<div class='grp' onclick="target.value='\${x.id}'">\${x.subject}</div>\`
  ).join("");
});

socket.on("log", m => {
  logs.innerHTML += "<div>> " + m + "</div>";
  logs.scrollTop = logs.scrollHeight;
});
</script>
</body>
</html>`;

app.get("/", (_, res) => res.send(html));

/* ================= HELPERS ================= */
async function fetchGroupsSafe() {
  try {
    if (!sock || !isConnected) return [];
    const groups = await sock.groupFetchAllParticipating();

    return Object.entries(groups).map(([id, g]) => ({
      id,
      subject: g.subject || "Unnamed Group"
    }));
  } catch (err) {
    console.error("Group Fetch Error:", err.message);
    return [];
  }
}

/* ================= WHATSAPP ================= */
async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.ubuntu("Chrome"),
      logger: pino({ level: "silent" })
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {

      if (connection === "open") {
        isConnected = true;
        isReconnecting = false;

        io.emit("status", "Connected");

        const groups = await fetchGroupsSafe();
        io.emit("groups", groups);

        console.log("WhatsApp Connected");
      }

      if (connection === "close") {
        isConnected = false;
        io.emit("status", "Disconnected");

        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (statusCode !== DisconnectReason.loggedOut) {
          if (!isReconnecting) {
            isReconnecting = true;

            io.emit("status", "Reconnecting...");
            console.log("Reconnecting in 5s...");

            setTimeout(() => {
              startWhatsApp();
            }, 5000);
          }
        } else {
          console.log("Logged out. Delete session and pair again.");
        }
      }
    });

  } catch (err) {
    console.error("WhatsApp Init Failed:", err);

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
      ? "Reconnecting..."
      : "Disconnected"
  );

  if (isConnected) {
    fetchGroupsSafe().then(groups => {
      socket.emit("groups", groups);
    });
  }

  /* ===== Pair ===== */
  socket.on("pair", async raw => {
    try {
      if (!sock) {
        return socket.emit("log", "Socket not ready yet");
      }

      if (isConnected) {
        return socket.emit("log", "Already paired");
      }

      const phone = String(raw).replace(/\D/g, "");

      if (!phone || phone.length < 10) {
        return socket.emit("log", "Invalid phone number");
      }

      const code = await sock.requestPairingCode(phone);

      socket.emit("code", code);
      socket.emit("log", "Pairing code generated");

    } catch (err) {
      socket.emit("log", "Pairing failed: " + err.message);
    }
  });

  /* ===== Start Sending ===== */
  socket.on("start", async cfg => {
    try {
      if (!sock || !isConnected) {
        return socket.emit("log", "Not connected");
      }

      if (isSending) {
        return socket.emit("log", "Already sending. Stop first.");
      }

      if (!cfg.target || !cfg.target.includes("@")) {
        return socket.emit("log", "Invalid target JID");
      }

      if (!cfg.msgs || !cfg.msgs.trim()) {
        return socket.emit("log", "TXT file empty");
      }

      stopSending = false;
      isSending = true;

      /* LINE BY LINE */
      const lines = cfg.msgs
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

      if (!lines.length) {
        isSending = false;
        return socket.emit("log", "No valid lines found");
      }

      let index = 0;

      const delayMs =
        Math.max(10, parseInt(cfg.delay) || 10) * 1000;

      socket.emit("log", \`Loaded \${lines.length} lines\`);
      socket.emit("log", \`Delay: \${delayMs / 1000}s\`);

      async function sendNext() {
        if (stopSending) {
          isSending = false;
          socket.emit("log", "Stopped successfully");
          return;
        }

        try {
          const line = lines[index];

          const text = cfg.prefix
            ? \`*\${cfg.prefix}*\\n\\n\${line}\`
            : line;

          await sock.sendMessage(cfg.target, { text });

          socket.emit(
            "log",
            \`Sent line \${index + 1}/\${lines.length}\`
          );

          index = (index + 1) % lines.length;

          const randomExtra = Math.floor(Math.random() * 3000);

          setTimeout(sendNext, delayMs + randomExtra);

        } catch (err) {
          socket.emit("log", "Send failed: " + err.message);

          setTimeout(sendNext, delayMs);
        }
      }

      sendNext();

    } catch (err) {
      isSending = false;
      socket.emit("log", "Start failed: " + err.message);
    }
  });

  /* ===== Stop ===== */
  socket.on("stop", () => {
    stopSending = true;
    isSending = false;

    socket.emit("log", "Stop request received");
  });
});

/* ================= START ================= */
server.listen(PORT, "0.0.0.0", () => {
  console.log(\`Server running on port \${PORT}\`);
});
