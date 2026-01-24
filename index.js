import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
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
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

/* ================= SERVER ================= */
const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* ================= SESSION ================= */
const SESSION_PATH = process.env.SESSION_PATH || "./session";

/* ================= GLOBAL STATE ================= */
let sock = null;
let isConnected = false;
let isReconnecting = false;

/* ===== REAL TASK CONTROLLER ===== */
let activeTask = null;

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
.shayari{
  color:#facc15;
  font-size:14px;
  text-align:center;
  margin:10px 0 18px;
  line-height:1.6;
}
input,button{width:100%;padding:12px;margin:6px 0;border-radius:8px;border:none}
input{background:#020617;border:1px solid #1e293b;color:#fff}
button{background:#22c55e;font-weight:bold;cursor:pointer}
.stop{background:#ef4444}
#logs{background:#000;color:#22c55e;height:140px;overflow:auto;font-family:monospace;font-size:12px;padding:8px;border-radius:8px}
.grp{font-size:12px;border:1px solid #1e293b;padding:6px;margin:4px 0;cursor:pointer}
</style>
</head>
<body>
<div class="card">
<h2>Chodu Yadav</h2>

<div class="shayari">
"Hum jo khamosh hain,<br>
iska matlab ye nahi ke dard nahi,<br>
bas awaaz dene ka hunar chhod diya hai."<br><br>
— Faiz / Jaun / Ahmad (ruuh se)
</div>

<div id="status">Status: Unknown</div>

<input id="phone" placeholder="Phone (91xxxxxxxxxx)">
<button onclick="pair()">Get Pair Code</button>
<div id="pairBox"></div>

<button onclick="ping()">PING</button>

<h4>Groups</h4>
<div id="groups">Waiting...</div>

<input id="target" placeholder="Target JID">
<input id="name" placeholder="Prefix (optional)">
<input id="delay" placeholder="Delay (seconds)">
<input type="file" id="file" accept=".txt">

<button onclick="start()">START</button>
<button class="stop" onclick="stopTask()">STOP</button>

<div id="logs"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
let msgs = "";

function pair(){
  socket.emit("pair", phone.value);
}
function ping(){
  socket.emit("ping");
}
function stopTask(){
  socket.emit("stop");
}

socket.on("pong", s=>{
  status.innerText = "Status: " + s;
});

socket.on("code", c=>{
  pairBox.innerText = c;
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

/* ================= WHATSAPP ================= */
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
      if (
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut
      ) {
        isReconnecting = true;
        setTimeout(startWhatsApp, 3000);
      }
    }
  });
}
startWhatsApp();

/* ================= SOCKET ================= */
io.on("connection", socket => {

  const statusText = () =>
    isConnected ? "🟢 Connected" :
    isReconnecting ? "🟡 Reconnecting" :
    "🔴 Disconnected";

  socket.emit("pong", statusText());

  socket.on("ping", () => {
    socket.emit("pong", statusText());
  });

  socket.on("pair", async raw => {
    if (isConnected) return socket.emit("log", "Already logged in");
    try {
      const phone = raw.replace(/\\D/g, "");
      const code = await sock.requestPairingCode(phone);
      socket.emit("code", code);
    } catch {
      socket.emit("log", "Pairing failed");
    }
  });

  socket.on("start", async cfg => {
    if (!isConnected) return socket.emit("log", "Not connected");
    if (activeTask) return socket.emit("log", "Task already running");

    const messages = (cfg.msgs || "")
      .split("\\n")
      .map(x => x.trim())
      .filter(Boolean);

    if (!messages.length) return socket.emit("log", "No messages loaded");

    const delay = Math.max(3, Number(cfg.delay) || 3);

    // 🔥 PREFIX FIX (NO undefined POSSIBLE)
    const prefix =
      typeof cfg.name === "string" && cfg.name.trim()
        ? cfg.name.trim() + " "
        : "";

    const target = cfg.target;

    let cancelled = false;
    activeTask = { cancel: () => (cancelled = true) };

    let i = 0;
    socket.emit("log", "Task started");

    while (!cancelled) {
      const text = prefix + messages[i];
      await sock.sendMessage(target, { text });
      socket.emit("log", "Sent");
      i = (i + 1) % messages.length;
      await new Promise(r => setTimeout(r, delay * 1000));
    }

    activeTask = null;
    socket.emit("log", "Task stopped");
  });

  socket.on("stop", () => {
    if (activeTask) {
      activeTask.cancel();
      activeTask = null;
      socket.emit("log", "Stopping task...");
    } else {
      socket.emit("log", "No active task");
    }
  });
});

/* ================= RENDER KEEP ALIVE ================= */
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    https.get(process.env.RENDER_EXTERNAL_URL).on("error", () => {});
  }, 1000 * 60 * 5); // 5 minutes – correct & safe
}

/* ================= START ================= */
server.listen(PORT, () =>
  console.log("🚀 Chodu Yadav server running on", PORT)
);
