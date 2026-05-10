/* =========================================================
   PROFESSIONAL WHATSAPP SERVER
   - One-time pairing
   - Persistent session
   - Refresh safe UI
   - Render compatible
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

/* ================= HTML UI (UNCHANGED) ================= */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CHODU YADAV | Aaj Bhi Tumhe Yaad Karta Hu</title>

<style>
body{
  background:radial-gradient(circle at top,#020617,#000);
  font-family:Segoe UI,system-ui;
  color:#e5e7eb;
  display:flex;
  justify-content:center;
  padding:20px
}
.card{
  background:#020617;
  width:100%;
  max-width:540px;
  padding:22px;
  border-radius:20px;
  box-shadow:0 0 80px #000
}
.brand{text-align:center;margin-bottom:18px}
.brand h1{
  margin:0;
  font-size:34px;
  letter-spacing:3px;
  color:#22c55e;
  text-shadow:0 0 10px #22c55e,0 0 25px #22c55e55
}
.brand p{
  margin-top:6px;
  font-size:13px;
  color:#a7f3d0;
  font-style:italic
}
.banner{
  background:linear-gradient(90deg,#22c55e33,#000);
  border:1px solid #22c55e66;
  padding:14px;
  border-radius:14px;
  text-align:center;
  font-size:14px;
  margin-bottom:18px;
  color:#d1fae5
}
.shayari-box{
  background:#000;
  border-radius:14px;
  padding:18px;
  height:110px;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  font-size:15px;
  line-height:1.7;
  border:1px solid #1e293b;
  margin-bottom:18px;
  overflow:hidden
}
.shayari-text{opacity:0;transition:opacity 1s ease;color:#c7d2fe}
.shayari-text.show{opacity:1}
h3{margin:14px 0 6px;font-size:14px;color:#22c55e}
input,button{
  width:100%;
  padding:12px;
  margin:6px 0;
  border-radius:10px;
  border:none;
  font-size:14px
}
input{
  background:#020617;
  border:1px solid #1e293b;
  color:#fff
}
button{background:#22c55e;font-weight:600;cursor:pointer}
.stop{background:#ef4444}
#pairBox{
  display:none;
  text-align:center;
  font-size:22px;
  border:1px dashed #22c55e;
  padding:10px;
  margin:10px 0;
  border-radius:10px
}
#logs{
  background:#000;
  color:#22c55e;
  height:120px;
  overflow:auto;
  font-family:monospace;
  font-size:12px;
  padding:8px;
  border-radius:10px;
  margin-top:10px
}
.grp{
  font-size:12px;
  border:1px solid #1e293b;
  padding:6px;
  margin:4px 0;
  border-radius:8px;
  cursor:pointer
}
.footer{
  text-align:center;
  font-size:11px;
  color:#64748b;
  margin-top:14px
}
</style>
</head>

<body>
<div class="card">

<div class="brand">
  <h1>CHODU YADAV</h1>
  <p>Aaj bhi tumhe yaad karta hu</p>
</div>

<div class="banner">
  "Zindagi mein sab milta hai Chodu,
  bas woh nahi milta jisse mohabbat hoti hai."
</div>

<div class="shayari-box">
  <div id="shayari" class="shayari-text"></div>
</div>

<h3>WhatsApp Control Panel</h3>
<div id="status">Status: Unknown</div>

<input id="phone" placeholder="Phone number (91xxxxxxxxxx)">
<button onclick="pair()">Get Pairing Code</button>
<div id="pairBox"></div>

<h3>Groups</h3>
<div id="groups">Login required</div>

<input id="target" placeholder="Target JID">
<input id="prefix" placeholder="Prefix / Name">
<input id="delay" placeholder="Delay seconds">
<input type="file" id="file" accept=".txt">

<button onclick="start()">START</button>
<button class="stop" onclick="stop()">STOP</button>

<div id="logs"></div>

<div class="footer">© CHODU YADAV • Dil se broken, system se dangerous</div>

</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const shayariList=[
"Hum haste rahe duniya ke liye, andar sab kuch toot raha tha.",
"Tum online dikho aur dil offline ho jaye.",
"Mohabbat chhod di humne, ya mohabbat ne hume chhod diya.",
"Jo apne the, wahi sabse zyada dard de gaye.",
"Aaj bhi tera naam dil ko heavy kar deta hai."
];
let i=0;
const el=document.getElementById("shayari");
function rotate(){
  el.classList.remove("show");
  setTimeout(()=>{
    el.innerText=shayariList[i];
    el.classList.add("show");
    i=(i+1)%shayariList.length;
  },500);
}
rotate();
setInterval(rotate,4000);

const socket=io();
let msgs="";
function pair(){ if(!phone.value) return alert("Number daalo"); socket.emit("pair",phone.value); }
function stop(){ socket.emit("stop"); }

socket.on("status",s=>status.innerText="Status: "+s);
socket.on("code",c=>{pairBox.innerText=c;pairBox.style.display="block";});
socket.on("groups",g=>{
  groups.innerHTML=g.map(x=>'<div class="grp" onclick="target.value=\\''+x.id+'\\'">'+x.subject+'</div>').join("");
});
file.onchange=e=>{
  const r=new FileReader();
  r.onload=()=>msgs=r.result;
  r.readAsText(e.target.files[0]);
};
function start(){
  socket.emit("start",{target:target.value,prefix:prefix.value,delay:delay.value,msgs});
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
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        isReconnecting = true;
        setTimeout(startWhatsApp, 3000);
      }
    }
  });
}
startWhatsApp();

/* ================= SOCKET ================= */
io.on("connection", socket => {

  socket.emit("status",
    isConnected ? "Connected" :
    isReconnecting ? "Reconnecting" :
    "Disconnected"
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
    if (isConnected) return socket.emit("log","Already paired");
    const phone = raw.replace(/\D/g,"");
    const code = await sock.requestPairingCode(phone);
    socket.emit("code", code);
  });

  socket.on("start", async cfg => {
    if (!isConnected) return socket.emit("log","Not connected");

    stopSending=false;
    const list=cfg.msgs.split("\n").filter(Boolean);
    let i=0;

    while(!stopSending){
      const text=[cfg.prefix,list[i]].filter(Boolean).join(" ");
      await sock.sendMessage(cfg.target,{text});
      socket.emit("log","Sent");
      i=(i+1)%list.length;
      await new Promise(r=>setTimeout(r,Math.max(3,cfg.delay)*1000));
    }
  });

  socket.on("stop",()=>stopSending=true);
});

/* ================= START ================= */
server.listen(PORT, () =>
  console.log("🚀 Server running on port", PORT)
);
