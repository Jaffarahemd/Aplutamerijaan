/* =========================================================
   PROFESSIONAL WHATSAPP SERVER (RENDER SAFE FIXED)
   - One-time pairing
   - Persistent session
   - Refresh safe UI
   - Render compatible
   - Block-by-block sending
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
process.on("unhandledRejection", e => console.error("REJECTION:", e));
process.on("uncaughtException", e => console.error("EXCEPTION:", e));

/* ================= SERVER ================= */
const app = express();
const server = createServer(app);
const io = new Server(server);
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

/* ================= HTML UI ================= */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp Control Panel</title>
<style>
body{background:#0f172a;font-family:Segoe UI;color:white;display:flex;justify-content:center;padding:20px}
.card{background:#111827;width:100%;max-width:600px;padding:20px;border-radius:20px}
input,button{width:100%;padding:12px;margin:8px 0;border-radius:10px;border:none}
input{background:#1f2937;color:white}
button{background:#22c55e;color:black;font-weight:bold;cursor:pointer}
.stop{background:#ef4444;color:white}
#logs{background:black;color:#22c55e;height:180px;overflow:auto;padding:10px;border-radius:10px;font-family:monospace}
.grp{padding:8px;background:#1f2937;margin:4px 0;border-radius:8px;cursor:pointer}
</style>
</head>
<body>
<div class="card">
<h2>WhatsApp Bot Panel</h2>
<div id="status">Status: Loading...</div>
<input id="phone" placeholder="Phone number (91xxxxxxxxxx)">
<button onclick="pair()">Get Pairing Code</button>
<div id="pairBox"></div>
<h3>Groups</h3>
<div id="groups">Login required</div>
<input id="target" placeholder="Target JID">
<input id="prefix" placeholder="Prefix / Name">
<input id="delay" placeholder="Delay seconds (default 10)">
<input type="file" id="file" accept=".txt">
<button onclick="start()">START</button>
<button class="stop" onclick="stopMsg()">STOP</button>
<div id="logs"></div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket=io();
let msgs="";
function pair(){ if(!phone.value) return alert("Enter number"); socket.emit("pair",phone.value); }
function stopMsg(){ socket.emit("stop"); }
socket.on("status",s=>status.innerText="Status: "+s);
socket.on("code",c=>{pairBox.innerText="Pair Code: "+c;});
socket.on("groups",g=>{
  groups.innerHTML=g.map(x=>'<div class="grp" onclick="target.value=\\''+x.id+'\\'">'+x.subject+'</div>').join("");
});
file.onchange=e=>{
  const r=new FileReader();
  r.onload=()=>msgs=r.result;
  r.readAsText(e.target.files[0]);
};
function start(){
  socket.emit("start",{
    target:target.value.trim(),
    prefix:prefix.value.trim(),
    delay:delay.value.trim(),
    msgs
  });
}
socket.on("log",m=>{
  logs.innerHTML+="<div>> "+m+"</div>";
  logs.scrollTop=logs.scrollHeight;
});
</script>
</body>
</html>`;

app.get("/", (_, res) => res.send(html));

/* ================= WHATSAPP INIT ================= */
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
        console.log("WhatsApp Connected");

        const groups = await sock.groupFetchAllParticipating();
        io.emit("groups", Object.entries(groups).map(([id, g]) => ({ id, subject: g.subject })));
      }

      if (connection === "close") {
        isConnected = false;
        console.log("Connection Closed");

        if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
          isReconnecting = true;
          setTimeout(startWhatsApp, 5000);
        }
      }
    });

  } catch (err) {
    console.error("WhatsApp Start Error:", err);
    setTimeout(startWhatsApp, 5000);
  }
}
startWhatsApp();

/* ================= SOCKET ================= */
io.on("connection", socket => {

  socket.emit("status",
    isConnected ? "Connected" :
    isReconnecting ? "Reconnecting" :
    "Disconnected"
  );

  socket.on("pair", async raw => {
    try {
      if (!sock) return socket.emit("log", "Socket not ready");
      if (isConnected) return socket.emit("log", "Already paired");

      const phone = raw.replace(/\D/g, "");
      const code = await sock.requestPairingCode(phone);
      socket.emit("code", code);

    } catch (err) {
      socket.emit("log", "Pairing failed: " + err.message);
    }
  });

  socket.on("start", async cfg => {
    try {
      if (!isConnected || !sock) {
        return socket.emit("log", "Not connected");
      }

      if (!cfg.target || !cfg.target.includes("@")) {
        return socket.emit("log", "Invalid target JID");
      }

      stopSending = false;

                  // LINE BY LINE MODE (Render safe, minimal change)
      const blocks = cfg.msgs
        .split(/
?
/)
        .filter(line => line.trim());

      if (!blocks.length) {
        return socket.emit("log", "No valid message lines found");
      }

      let index = 0;
      const delayMs = Math.max(10, parseInt(cfg.delay) || 10) * 1000;

      socket.emit("log", `Loaded ${blocks.length} lines | Delay ${delayMs/1000}s`);

      async function sendNext() {
        if (stopSending) {
          socket.emit("log", "Stopped successfully");
          return;
        }

        try {
          const block = blocks[index];

          const text = cfg.prefix
            ? `*${cfg.prefix}*\n\n${block}`
            : block;

          await sock.sendMessage(cfg.target, { text });

          socket.emit("log", `Sent line ${index + 1}/${blocks.length}`);

          index = (index + 1) % blocks.length;

          const randomExtra = Math.floor(Math.random() * 3000);
          setTimeout(sendNext, delayMs + randomExtra);

        } catch (err) {
          socket.emit("log", "Send failed: " + err.message);
          setTimeout(sendNext, delayMs);
        }
      }

      sendNext();

    } catch (err) {
      socket.emit("log", "Start failed: " + err.message);
    }
  });

  socket.on("stop", () => {
    stopSending = true;
  });
});

/* ================= START ================= */
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
