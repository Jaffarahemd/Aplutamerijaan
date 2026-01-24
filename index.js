import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";
import pino from "pino";

/* ================= SAFETY ================= */
process.on("unhandledRejection", e => console.error(e));
process.on("uncaughtException", e => console.error(e));

/* ================= SERVER ================= */
const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* ================= HTML UI ================= */
const html = `<!DOCTYPE html>
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
#logs{background:#000;color:#22c55e;height:120px;overflow:auto;font-family:monospace;font-size:12px;padding:8px;border-radius:8px}
.grp{font-size:12px;border:1px solid #1e293b;padding:6px;margin:4px 0;cursor:pointer}
</style>
</head>
<body>
<div class="card">
<h2>Chodu Yadav</h2>
<div class="sh">
"Na bheed ka shor, na jhootha show,<br>
Jo real hai wahi bole – Chodu Yadav bro."
</div>

<div id="status">Status: Offline</div>

<input id="phone" placeholder="Phone number (91xxxxxxxxxx)">
<button onclick="requestPair()">Get Pairing Code</button>
<div id="pairBox"></div>

<h4>Groups</h4>
<div id="groups">Login to load</div>

<input id="target" placeholder="Target JID">
<input id="name" placeholder="Prefix / Name">
<input id="delay" placeholder="Delay seconds">

<input type="file" id="file" accept=".txt">

<button onclick="startBot()">START</button>
<button class="stop" onclick="socket.emit('stop')">STOP</button>

<div id="logs"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
let msgs = "";

function requestPair(){
  const num = phone.value.trim();
  if(!num) return alert("Enter number");
  socket.emit("pair", num);
}

socket.on("code", c=>{
  const box = document.getElementById("pairBox");
  box.innerText = c;
  box.style.display = "block";
});

socket.on("status", s=>{
  status.innerText = "Status: " + s;
});

socket.on("groups", g=>{
  groups.innerHTML = g.map(x =>
    '<div class="grp" onclick="target.value=\\''+x.id+'\\'">'+x.subject+'</div>'
  ).join("");
});

file.onchange = e=>{
  const r = new FileReader();
  r.onload = ()=> msgs = r.result;
  r.readAsText(e.target.files[0]);
};

function startBot(){
  socket.emit("start",{
    target: target.value,
    name: name.value,
    delay: delay.value,
    msgs
  });
}

socket.on("log", m=>{
  logs.innerHTML += "<div>> " + m + "</div>";
  logs.scrollTop = logs.scrollHeight;
});
</script>
</body>
</html>`;

/* ================= ROUTE ================= */
app.get("/", (_, res) => res.send(html));

/* ================= WA STATE ================= */
let sock;
let running = false;
let sent = 0;

/* ================= SOCKET ================= */
io.on("connection", socket => {

  socket.on("pair", async raw => {
    const phone = raw.replace(/\D/g, "");
    socket.emit("status", "Initializing…");

    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      logger: pino({ level: "silent" }),
      printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    let pairingSent = false;

    sock.ev.on("connection.update", async u => {

      if (
        !pairingSent &&
        !sock.authState.creds.registered &&
        u.connection !== "close"
      ) {
        pairingSent = true;
        try {
          const code = await sock.requestPairingCode(phone);
          socket.emit("code", code);
          socket.emit("status", "Pairing code generated");
        } catch (e) {
          socket.emit("log", "Pairing failed: " + e.message);
        }
      }

      if (u.connection === "open") {
        socket.emit("status", "Connected");
        const g = await sock.groupFetchAllParticipating();
        socket.emit("groups", Object.values(g));
      }

      if (
        u.connection === "close" &&
        u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      ) {
        socket.emit("status", "Reconnecting");
      }
    });
  });

  socket.on("start", async cfg => {
    if (!sock) return socket.emit("log", "Not connected");

    const list = cfg.msgs.split("\n").filter(Boolean);
    let i = 0;
    running = true;

    while (running) {
      await sock.sendMessage(cfg.target, {
        text: (cfg.name + " " + list[i]).trim()
      });
      sent++;
      socket.emit("log", `Sent (${sent})`);
      i = (i + 1) % list.length;
      await new Promise(r =>
        setTimeout(r, Math.max(3, cfg.delay) * 1000)
      );
    }
  });

  socket.on("stop", () => running = false);
});

/* ================= START ================= */
server.listen(PORT, () =>
  console.log("🚀 Chodu Yadav server running on", PORT)
);
