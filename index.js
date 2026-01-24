<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chodu Yadav</title>

<style>
body{
  background:#0f172a;
  font-family:Segoe UI,system-ui;
  color:#e5e7eb;
  display:flex;
  justify-content:center;
  padding:20px
}
.card{
  background:#020617;
  width:100%;
  max-width:480px;
  padding:22px;
  border-radius:14px;
  box-shadow:0 0 40px #000
}
h2{
  text-align:center;
  color:#22c55e;
  margin:0 0 6px
}
.sub{
  font-size:13px;
  text-align:center;
  color:#94a3b8;
  margin-bottom:14px;
  line-height:1.5
}
input,button{
  width:100%;
  padding:12px;
  margin:6px 0;
  border-radius:8px;
  border:none;
  font-size:14px
}
input{
  background:#020617;
  border:1px solid #1e293b;
  color:#fff
}
button{
  background:#22c55e;
  font-weight:600;
  cursor:pointer
}
button.stop{
  background:#ef4444
}
#pairBox{
  display:none;
  text-align:center;
  font-size:22px;
  border:1px dashed #22c55e;
  padding:10px;
  margin:10px 0;
  color:#22c55e
}
#status{
  text-align:center;
  margin:8px 0;
  font-size:14px
}
#groups{
  max-height:120px;
  overflow:auto;
  margin-bottom:6px
}
.grp{
  font-size:12px;
  border:1px solid #1e293b;
  padding:6px;
  margin:4px 0;
  cursor:pointer;
  border-radius:6px
}
.grp:hover{
  background:#020617
}
#logs{
  background:#000;
  color:#22c55e;
  height:140px;
  overflow:auto;
  font-family:monospace;
  font-size:12px;
  padding:8px;
  border-radius:8px;
  margin-top:8px
}
</style>
</head>

<body>
<div class="card">

<h2>Chodu Yadav</h2>
<div class="sub">
Link-Device WhatsApp Sender<br>
Refresh safe • Prefix • Stop • Groups
</div>

<div id="status">Status: Unknown</div>

<input id="phone" placeholder="Phone number (91xxxxxxxxxx)">
<button onclick="pair()">Get Pair Code</button>

<div id="pairBox"></div>

<button onclick="ping()">PING</button>

<h4>Groups</h4>
<div id="groups">Login to load groups…</div>

<input id="target" placeholder="Target JID (user or group)">
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

/* ---------- BASIC ACTIONS ---------- */
function pair(){
  if(!phone.value) return alert("Enter phone number");
  socket.emit("pair", phone.value);
}
function ping(){
  socket.emit("ping");
}
function stopTask(){
  socket.emit("stop");
}

/* ---------- SOCKET EVENTS ---------- */
socket.on("pong", s=>{
  status.innerText = "Status: " + s;
});

socket.on("code", c=>{
  pairBox.innerText = c;
  pairBox.style.display = "block";
});

socket.on("groups", g=>{
  if(!g.length){
    groups.innerHTML = "No groups found";
    return;
  }
  groups.innerHTML = g.map(x =>
    `<div class="grp" onclick="target.value='${x.id}'">${x.subject}</div>`
  ).join("");
});

socket.on("log", m=>{
  const d = document.createElement("div");
  d.textContent = "> " + m;
  logs.appendChild(d);
  logs.scrollTop = logs.scrollHeight;
});

/* ---------- FILE LOAD ---------- */
file.onchange = e=>{
  const r = new FileReader();
  r.onload = () => msgs = r.result;
  r.readAsText(e.target.files[0]);
};

/* ---------- START ---------- */
function start(){
  socket.emit("start",{
    target: target.value,
    name: name.value,
    delay: delay.value,
    msgs
  });
}
</script>

</body>
</html>
