/* =========================================================
   PROFESSIONAL WHATSAPP SERVER
   - Persistent Login
   - Refresh Safe
   - Render Compatible
   - Line By Line Sender
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

/* ================= ERROR SAFETY ================= */
process.on("unhandledRejection", err => {
  console.log("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", err => {
  console.log("UNCAUGHT EXCEPTION:", err);
});

/* ================= EXPRESS ================= */
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;

/* ================= SESSION ================= */
const SESSION_PATH = "./session";

if (!fs.existsSync(SESSION_PATH)) {
  fs.mkdirSync(SESSION_PATH, { recursive: true });
}

/* ================= GLOBALS ================= */
let sock = null;
let isConnected = false;
let isConnecting = false;
let stopSending = false;

/* ================= HTML ================= */
const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp Panel</title>

<style>
body{
background:#0f172a;
font-family:Arial;
color:white;
padding:20px;
}

.box{
max-width:600px;
margin:auto;
background:#111827;
padding:20px;
border-radius:16px;
}

input,button{
width:100%;
padding:12px;
margin-top:10px;
border:none;
border-radius:10px;
}

input{
background:#1e293b;
color:white;
}

button{
background:#22c55e;
font-weight:bold;
cursor:pointer;
}

.stop{
background:#ef4444;
}

#logs{
height:220px;
overflow:auto;
background:black;
padding:10px;
margin-top:15px;
border-radius:10px;
font-size:12px;
font-family:monospace;
}

.grp{
padding:10px;
margin-top:5px;
background:#1e293b;
border-radius:8px;
cursor:pointer;
}

#pairBox{
padding:15px;
background:black;
margin-top:10px;
text-align:center;
font-size:25px;
border-radius:10px;
display:none;
}
</style>
</head>

<body>
<div class="box">

<h2>WhatsApp Control Panel</h2>

<div id="status">Checking...</div>

<input id="phone" placeholder="91xxxxxxxxxx">
<button onclick="pair()">GET PAIR CODE</button>

<div id="pairBox"></div>

<h3>Groups</h3>
<div id="groups"></div>

<input id="target" placeholder="Target JID">
<input id="prefix" placeholder="Prefix">
<input id="delay" placeholder="Delay in seconds">
<input type="file" id="file" accept=".txt">

<button onclick="start()">START</button>
<button class="stop" onclick="stopSend()">STOP</button>

<div id="logs"></div>

</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

let fileText = "";

function log(msg){
  logs.innerHTML += `<div>> ${msg}</div>`;
  logs.scrollTop = logs.scrollHeight;
}

socket.on("connect", ()=>{
  log("Connected to server");
});

socket.on("status", s=>{
  status.innerText = "Status: " + s;
});

socket.on("log", msg=>{
  log(msg);
});

socket.on("code", code=>{
  pairBox.style.display = "block";
  pairBox.innerText = code;
});

socket.on("groups", groups=>{
  groups.innerHTML = groups.map(g=>
    `<div class="grp" onclick="target.value='${g.id}'">${g.subject}</div>`
  ).join("");
});

file.onchange = e=>{
  const reader = new FileReader();

  reader.onload = ()=>{
    fileText = reader.result;
    log("File loaded successfully");
  };

  reader.readAsText(e.target.files[0]);
};

function pair(){
  if(!phone.value) return alert("Enter phone number");
  socket.emit("pair", phone.value);
}

function start(){
  socket.emit("start", {
    target: target.value,
    prefix: prefix.value,
    delay: delay.value,
    text: fileText
  });
}

function stopSend(){
  socket.emit("stop");
}
</script>
</body>
</html>
`;

/* ================= ROUTES ================= */
app.get("/", (_, res) => {
  res.send(html);
});

app.get("/health", (_, res) => {
  res.send("OK");
});

/* ================= WHATSAPP ================= */
async function startWhatsApp() {

  if (isConnecting) return;
  isConnecting = true;

  try {

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async update => {

      const { connection, lastDisconnect } = update;

      if (connection === "connecting") {
        console.log("Connecting...");
      }

      if (connection === "open") {

        console.log("WhatsApp Connected");

        isConnected = true;
        isConnecting = false;

        io.emit("status", "Connected");

        try {

          const groups = await sock.groupFetchAllParticipating();

          io.emit(
            "groups",
            Object.entries(groups).map(([id, g]) => ({
              id,
              subject: g.subject
            }))
          );

        } catch (e) {
          console.log("Group fetch error", e);
        }
      }

      if (connection === "close") {

        isConnected = false;
        isConnecting = false;

        io.emit("status", "Disconnected");

        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        console.log("Disconnected");

        if (shouldReconnect) {
          console.log("Reconnecting in 5 sec...");

          setTimeout(() => {
            startWhatsApp();
          }, 5000);
        }
      }
    });

  } catch (err) {

    console.log("WhatsApp Start Error", err);
    isConnecting = false;

    setTimeout(() => {
      startWhatsApp();
    }, 5000);
  }
}

startWhatsApp();

/* ================= SOCKET ================= */
io.on("connection", socket => {

  console.log("Browser Connected");

  socket.emit(
    "status",
    isConnected ? "Connected" : "Disconnected"
  );

  socket.on("pair", async number => {

    try {

      if (!sock) {
        return socket.emit("log", "WhatsApp not ready yet");
      }

      if (isConnected) {
        return socket.emit("log", "Already logged in");
      }

      const cleanNumber = number.replace(/\D/g, "");

      const code = await sock.requestPairingCode(cleanNumber);

      socket.emit("code", code);
      socket.emit("log", "Pair code generated");

    } catch (err) {
      console.log(err);
      socket.emit("log", "Pairing failed");
    }
  });

  socket.on("start", async cfg => {

    try {

      if (!isConnected) {
        return socket.emit("log", "WhatsApp not connected");
      }

      if (!cfg.target) {
        return socket.emit("log", "Target missing");
      }

      if (!cfg.text) {
        return socket.emit("log", "File empty");
      }

      stopSending = false;

      const delay = Math.max(1, Number(cfg.delay) || 3);

      const lines = cfg.text
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

      if (!lines.length) {
        return socket.emit("log", "No valid lines found");
      }

      socket.emit("log", `Loaded ${lines.length} lines`);

      let index = 0;

      while (!stopSending) {

        try {

          const currentLine = lines[index];

          const finalText = [cfg.prefix, currentLine]
            .filter(Boolean)
            .join(" ");

          await sock.sendMessage(cfg.target, {
            text: finalText
          });

          socket.emit(
            "log",
            `Sent line ${index + 1}/${lines.length}`
          );

          index++;

          if (index >= lines.length) {
            index = 0;
          }

          await new Promise(resolve =>
            setTimeout(resolve, delay * 1000)
          );

        } catch (sendErr) {

          console.log(sendErr);
          socket.emit("log", "Send failed, retrying...");

          await new Promise(resolve =>
            setTimeout(resolve, 5000)
          );
        }
      }

      socket.emit("log", "Stopped successfully");

    } catch (err) {
      console.log(err);
      socket.emit("log", "Start failed");
    }
  });

  socket.on("stop", () => {
    stopSending = true;
  });

  socket.on("disconnect", () => {
    console.log("Browser disconnected");
  });
});

/* ================= START ================= */
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
