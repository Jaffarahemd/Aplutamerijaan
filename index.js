import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import https from "https";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} from "@whiskeysockets/baileys";
import pino from "pino";

/* ================= SAFETY ================= */
process.on("unhandledRejection", e => console.error("REJECTION:", e));
process.on("uncaughtException", e => console.error("EXCEPTION:", e));

/* ================= SERVER ================= */
const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* ================= SESSION PATH (RENDER) ================= */
const SESSION_PATH = process.env.SESSION_PATH || "./session";

/* ================= VIP ================= */
const VIP_PATH = "./VIP.json";
let VIP = new Set();

function loadVIP() {
  try {
    const data = JSON.parse(fs.readFileSync(VIP_PATH, "utf8"));
    VIP = new Set(data.vip || []);
    console.log("⭐ VIP loaded:", [...VIP]);
  } catch {
    console.log("⚠️ VIP.json missing or invalid");
    VIP = new Set();
  }
}
loadVIP();

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
<title>Chodu Yadav</title>
<style>
body{background:#0f172a;font-family:Segoe UI;color:#e5e7eb;display:flex;justify-content:center;padding:20px}
.card{background:#020617;width:480px;padding:24px;border-radius:14px;box-shadow:0 0 40px #000}
h2{text-align:center;color:#22c55e;margin:0}
.sh{font-size:13px;text-align:center;color:#94a3b8;margin:8px 0 16px}
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
<h2>Chodu Yadav</h2>
<div class="sh">Minimal. Persistent. No drama.</div>

<div id="status">Status: Unknown</div>

<input id="phone" placeholder="Phone number (91xxxxxxxxxx)">
<button onclick="pair()">Get Pairing Code</button>
<div id="pairBox"></div>

<button onclick="ping()">PING</button>

<h4>Groups</h4>
<div id="groups">Login to load</div>

<input id="target" placeholder="Target JID">
<input id="name" placeholder="Prefix (optional)">
<input id="delay" placeholder="Delay (seconds)">

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

function ping(){
  socket.emit("ping");
}

function stop(){
  socket.emit("stop");
}

socket.on("pong", s=>{
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
    name:name.value,
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
</html>`;

/* ================= ROUTE ================= */
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
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        isReconnecting = true;
        console.log("🔁 Reconnecting...");
        setTimeout(startWhatsApp, 3000);
      }
    }
  });
}

startWhatsApp();

/* ================= SOCKET.IO ================= */
io.on("connection", socket => {

  socket.emit(
    "pong",
    isConnected ? "🟢 Connected" :
    isReconnecting ? "🟡 Reconnecting" :
    "🔴 Disconnected"
  );

  socket.on("ping", () => {
    socket.emit("pong",
      isConnected ? "🟢 Connected" :
      isReconnecting ? "🟡 Reconnecting" :
      "🔴 Disconnected"
    );
  });

  socket.on("pair", async raw => {
    if (isConnected) {
      return socket.emit("log", "Already logged in");
    }
    try {
      const phone = raw.replace(/\D/g, "");
      const code = await sock.requestPairingCode(phone);
      socket.emit("code", code);
    } catch (e) {
      socket.emit("log", "Pairing failed");
    }
  });

  socket.on("start", async cfg => {
    if (!isConnected) return socket.emit("log", "Not connected");

    if (!VIP.has(sock.user.id)) {
      return socket.emit("log", "❌ Not VIP");
    }

    stopSending = false;

    const list = cfg.msgs.split("\n").filter(Boolean);
    const delay = Math.max(3, Number(cfg.delay) || 3);
    const prefix = String(cfg.name || "").trim();

    let i = 0;
    while (!stopSending) {
      const text = prefix ? `${prefix} ${list[i]}` : list[i];
      await sock.sendMessage(cfg.target, { text });
      socket.emit("log", "Sent");
      i = (i + 1) % list.length;
      await new Promise(r => setTimeout(r, delay * 1000));
    }

    socket.emit("log", "Stopped");
  });

  socket.on("stop", () => {
    stopSending = true;
  });
});

/* ================= RENDER KEEP-ALIVE ================= */
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    https.get(process.env.RENDER_EXTERNAL_URL);
  }, 1000 * 60 * 5); // every 5 minutes
}

/* ================= START ================= */
server.listen(PORT, () =>
  console.log("🚀 Server running on", PORT)
);
