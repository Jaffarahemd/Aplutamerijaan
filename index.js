import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';

/* =======================
   RENDER SAFETY
======================= */
process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION:', err);
});
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

/* =======================
   SERVER SETUP
======================= */
const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* =======================
   FULL HTML UI
======================= */
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Chodu Yadav | WhatsApp Server</title>
<style>
body{
  font-family:Segoe UI,Arial;
  background:#0f172a;
  display:flex;
  justify-content:center;
  padding:20px;
  color:#e5e7eb
}
.card{
  background:#020617;
  width:460px;
  padding:24px;
  border-radius:14px;
  box-shadow:0 0 40px rgba(0,0,0,.6)
}
h2{margin:0;text-align:center;color:#22c55e}
.shayari{
  font-size:13px;
  color:#94a3b8;
  text-align:center;
  margin-bottom:14px
}
input,button{
  width:100%;
  margin:8px 0;
  padding:12px;
  border-radius:8px;
  border:none;
  box-sizing:border-box
}
input{background:#020617;color:#e5e7eb;border:1px solid #1e293b}
button{
  background:#22c55e;
  font-weight:bold;
  cursor:pointer
}
#pairing{
  display:none;
  background:#020617;
  border:1px dashed #22c55e;
  padding:10px;
  font-size:22px;
  text-align:center;
  margin:10px 0
}
#status{margin:10px 0;font-weight:bold;text-align:center}
.group-list{
  max-height:140px;
  overflow:auto;
  border:1px solid #1e293b;
  padding:8px;
  border-radius:8px
}
.group{
  background:#020617;
  padding:6px;
  margin-bottom:6px;
  cursor:pointer;
  font-size:12px;
  border:1px solid #1e293b
}
#logs{
  background:#000;
  color:#22c55e;
  font-family:monospace;
  height:120px;
  overflow:auto;
  padding:8px;
  margin-top:12px;
  border-radius:8px;
  font-size:12px
}
.stop{background:#ef4444}
</style>
</head>
<body>
<div class="card">
  <h2>Chodu Yadav</h2>
  <div class="shayari">
    "Na fake show ka shor hai,<br>
     Na bheed ki parwah,<br>
     Jo real hai wahi bolega,<br>
     Ye Chodu Yadav ka raasta hai."
  </div>

  <div id="status">Status: Offline</div>

  <input id="phone" placeholder="Phone number with country code">
  <button onclick="pair()">Get Pairing Code</button>
  <div id="pairing"></div>

  <h4>Groups</h4>
  <div id="groups" class="group-list">Login to load groups</div>

  <input id="target" placeholder="Target JID">
  <input id="name" placeholder="Prefix / Name">
  <input id="delay" placeholder="Delay seconds">

  <input type="file" id="file" accept=".txt">

  <button onclick="start()">START</button>
  <button class="stop" onclick="socket.emit('stop-bot')">STOP</button>

  <div id="logs"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
let messages = "";

function pair(){
  const num = phone.value;
  if(!num) return alert("Enter number");
  socket.emit("request-pairing", num);
}

socket.on("pairing-code", c=>{
  pairing.innerText = c;
  pairing.style.display="block";
});

socket.on("status", s=>{
  status.innerText = "Status: " + s;
});

socket.on("group-list", gs=>{
  groups.innerHTML = gs.map(g =>
    '<div class="group" onclick="target.value=\\''+g.id+'\\'">'+g.subject+'</div>'
  ).join("");
});

file.onchange = e=>{
  const r = new FileReader();
  r.onload = ()=> messages = r.result;
  r.readAsText(e.target.files[0]);
};

function start(){
  socket.emit("start-bot",{
    targetJid:target.value,
    haterName:name.value,
    delay:delay.value,
    messages
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

/* =======================
   ROUTE
======================= */
app.get('/', (req, res) => res.send(htmlContent));

/* =======================
   WHATSAPP STATE
======================= */
let sock;
let isRunning = false;
let connected = false;

/* =======================
   SOCKET LOGIC
======================= */
io.on('connection', socket => {

  socket.on('request-pairing', async phone => {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
      const code = await sock.requestPairingCode(phone.replace(/\\D/g,''));
      socket.emit('pairing-code', code);
    }

    sock.ev.on('connection.update', async u => {
      if (u.connection === 'open') {
        connected = true;
        socket.emit('status', 'Online');
        const g = await sock.groupFetchAllParticipating();
        socket.emit('group-list', Object.values(g));
      }
      if (u.connection === 'close') {
        connected = false;
        socket.emit('status', 'Disconnected');
      }
    });
  });

  socket.on('start-bot', async cfg => {
    if (!connected) return socket.emit('log','Not connected');
    const list = cfg.messages.split('\\n').filter(Boolean);
    let i = 0;
    isRunning = true;

    while(isRunning){
      await sock.sendMessage(cfg.targetJid,{
        text:(cfg.haterName+" "+list[i]).trim()
      });
      socket.emit('log','Sent');
      i=(i+1)%list.length;
      await new Promise(r=>setTimeout(r,Math.max(3,cfg.delay)*1000));
    }
  });

  socket.on('stop-bot', ()=> isRunning=false);
});

/* =======================
   START
======================= */
server.listen(PORT, ()=>{
  console.log("🚀 Chodu Yadav server live on", PORT);
});
