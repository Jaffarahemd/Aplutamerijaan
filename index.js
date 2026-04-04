/* =========================================================
   PROFESSIONAL WHATSAPP SERVER (UPGRADED)
   - One-time pairing
   - Persistent session
   - Multi-target (Group + Personal ✅ NEW)
   - Refresh safe UI
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
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* ================= SESSION ================= */
const SESSION_PATH = process.env.SESSION_PATH || "./session";
if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });

/* ================= GLOBAL STATE ================= */
let sock = null;
let isConnected = false;
let isReconnecting = false;
let stopSending = false;

/* ================= HTML UI ================= */
const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>WhatsApp Control</title>
<style>
body{background:#0f172a;font-family:Segoe UI;color:#e5e7eb;display:flex;justify-content:center;padding:20px}
.card{background:#020617;width:480px;padding:24px;border-radius:14px;box-shadow:0 0 40px #000}
h2{text-align:center;color:#22c55e;margin:0}
input,button{width:100%;padding:12px;margin:6px 0;border-radius:8px;border:none}
input{background:#020617;border:1px solid #1e293b;color:#fff}
button{background:#22c55e;font-weight:bold;cursor:pointer}
.stop{background:#ef4444}
#pairBox{display:none;font-size:22px;text-align:center;border:1px dashed #22c55e;padding:10px;margin:10px 0}
#logs{background:#000;color:#22c55e;height:140px;overflow:auto;font-family:monospace;font-size:12px;padding:8px;border-radius:8px}
.grp{font-size:12px;border:1px solid #1e293b;padding:6px;margin:4px 0;cursor:pointer}
</style>
</head>
<body>
<div class="card">
<h2>WhatsApp Server</h2>
<div id="status">Status: Unknown</div>

<input id="phone" placeholder="Phone number (91xxxxxxxxxx)">
<button onclick="pair()">Get Pairing Code</button>
<div id="pairBox"></div>

<h4>Groups</h4>
<div id="groups">Login required</div>

<input id="target" placeholder="GroupID OR number OR multiple (comma separated)">
<input id="prefix" placeholder="Prefix / Name">
<input id="delay" placeholder="Delay seconds">

<input type="file" id="file" accept=".txt">

<button onclick="start()">START</button>
<button class="stop" onclick="stop()">STOP</button>

<div id="logs"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
let msgs = "";

function pair(){
  if(!phone.value) return alert("Enter number");
  socket.emit("pair", phone.value);
}

function stop(){
  socket.emit("stop");
}

socket.on("status", s=>{
  status.innerText = "Status: " + s;
});

socket.on("code", c=>{
  pairBox.innerText = c;
  pairBox.style.display = "block";
});

socket.on("groups", g=>{
  groups.innerHTML = g.map(x =>
    '<div class="grp" onclick="target.value=\\''+x.id+'\\'">'+x.subject+'</div>'
  ).join("");
});

file.onchange=e=>{
  const r=new FileReader();
  r.onload=()=>msgs=r.result;
  r.readAsText(e.target.files[0]);
};

function start(){
  socket.emit("start",{
    target:target.value,
    prefix:prefix.value,
    delay:delay.value,
    msgs
  });
}

socket.on("log", m=>{
  logs.innerHTML += "<div>> "+m+"</div>";
  logs.scrollTop = logs.scrollHeight;
});
</script>
</body>
</html>
`;

app.get("/", (_, res) => res.send(html));

/* ================= WHATSAPP INIT ================= */
async function startWhatsApp() {
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
      console.log("✅ WhatsApp connected");

      const groups = await sock.groupFetchAllParticipating();
      io.emit("groups",
        Object.entries(groups).map(([id, g]) => ({
          id,
          subject: g.subject
        }))
      );
    }

    if (connection === "close") {
      isConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code !== DisconnectReason.loggedOut) {
        isReconnecting = true;
        console.log("🔁 Reconnecting...");
        setTimeout(startWhatsApp, 3000);
      } else {
        console.log("❌ Logged out. Delete session to re-pair.");
      }
    }
  });
}

startWhatsApp();

/* ================= SOCKET ================= */
io.on("connection", socket => {

  socket.emit("status",
    isConnected ? "🟢 Connected" :
    isReconnecting ? "🟡 Reconnecting" :
    "🔴 Disconnected"
  );

  if (isConnected && sock) {
    sock.groupFetchAllParticipating().then(groups => {
      socket.emit("groups",
        Object.entries(groups).map(([id, g]) => ({
          id,
          subject: g.subject
        }))
      );
    });
  }

  socket.on("pair", async raw => {
    if (isConnected) {
      return socket.emit("log", "Already paired.");
    }
    try {
      const phone = raw.replace(/\D/g, "");
      const code = await sock.requestPairingCode(phone);
      socket.emit("code", code);
    } catch (e) {
      socket.emit("log", "Pairing failed: " + e.message);
    }
  });

  /* ================= UPDATED START ================= */
  socket.on("start", async cfg => {
    if (!isConnected) return socket.emit("log", "Not connected");

    stopSending = false;
    const list = cfg.msgs.split("\n").filter(Boolean);
    let i = 0;

    // 🔥 MULTI TARGET SUPPORT
    const targets = cfg.target.split(",").map(t => t.trim()).filter(Boolean);

    while (!stopSending) {
      const text = [cfg.prefix, list[i]].filter(Boolean).join(" ");

      for (const t of targets) {
        let jid = t;

        // Convert number → personal chat
        if (/^\\d{10,15}$/.test(t)) {
          jid = t + "@s.whatsapp.net";
        }

        try {
          await sock.sendMessage(jid, { text });
          socket.emit("log", "Sent → " + jid);
        } catch (e) {
          socket.emit("log", "Failed → " + jid);
        }
      }

      i = (i + 1) % list.length;

      await new Promise(r =>
        setTimeout(r, Math.max(3, cfg.delay) * 1000)
      );
    }

    socket.emit("log", "Stopped");
  });

  socket.on("stop", () => {
    stopSending = true;
  });
});

/* ================= START ================= */
server.listen(PORT, () =>
  console.log("🚀 Server running on port", PORT)
);
