const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Chodu Yadav</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);
  display:flex;
  align-items:center;
  justify-content:center;
  font-family:system-ui,-apple-system,Segoe UI,sans-serif;
  color:#eaeaea;
}
.card{
  width:420px;
  background:#111;
  border-radius:14px;
  padding:22px;
  box-shadow:0 20px 40px rgba(0,0,0,.6);
}
h1{
  margin:0;
  font-size:26px;
  text-align:center;
  letter-spacing:1px;
}
.subtitle{
  text-align:center;
  color:#aaa;
  margin-top:4px;
  font-size:14px;
}
.shayari{
  margin:14px 0 18px;
  padding:12px;
  background:#0b0b0b;
  border-left:3px solid #25d366;
  font-size:13px;
  color:#cfcfcf;
  line-height:1.5;
}
.status{
  text-align:center;
  margin-bottom:10px;
  font-weight:600;
}
input,button{
  width:100%;
  padding:11px;
  margin:6px 0;
  border-radius:8px;
  border:none;
  font-size:14px;
}
input{
  background:#1c1c1c;
  color:#fff;
}
button{
  background:#25d366;
  color:#000;
  font-weight:700;
  cursor:pointer;
}
button.stop{
  background:#ff4b4b;
  color:#fff;
}
#pair{
  text-align:center;
  font-size:22px;
  letter-spacing:2px;
  margin:6px 0;
  color:#25d366;
}
#groups{
  max-height:120px;
  overflow:auto;
  margin:8px 0;
  border:1px solid #222;
  border-radius:6px;
}
.group{
  padding:6px;
  border-bottom:1px solid #222;
  cursor:pointer;
  font-size:13px;
}
.group:hover{background:#1e1e1e}
#logs{
  background:#000;
  border-radius:8px;
  padding:8px;
  height:110px;
  overflow:auto;
  font-size:12px;
  color:#00ff90;
}
footer{
  margin-top:10px;
  text-align:center;
  font-size:11px;
  color:#666;
}
</style>
</head>
<body>
<div class="card">
  <h1>Chodu Yadav</h1>
  <div class="subtitle">Chodu ki Shayari</div>

  <div class="shayari">
    “Kuch log lafzon se zyada khamoshi mein bol jaate hain,<br>
    Aur kuch poori zindagi bolkar bhi samjha nahi paate.”
  </div>

  <div class="status">Status: <span id="status">Offline</span></div>

  <input id="phone" placeholder="Phone number (91XXXXXXXXXX)" />
  <button onclick="pair()">Get Pair Code</button>
  <div id="pair"></div>

  <div id="groups"></div>

  <input id="target" placeholder="Target JID" />
  <input id="name" placeholder="Name" />
  <input id="delay" type="number" placeholder="Delay (seconds)" />
  <input type="file" id="file" />

  <button onclick="start()">START</button>
  <button class="stop" onclick="stop()">STOP</button>

  <div id="logs"></div>
  <footer>Powered quietly.</footer>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const s = io();
let fileContent = "";

s.on("status", v => status.innerText = v);
s.on("pairing-code", c => pair.innerText = c);
s.on("group-list", g => {
  groups.innerHTML = g.map(x =>
    "<div class='group' onclick=target.value='"+x.id+"'>"+x.subject+"</div>"
  ).join("");
});
s.on("log", m => {
  logs.innerHTML += "<div>> "+m+"</div>";
  logs.scrollTop = logs.scrollHeight;
});

file.onchange = e => {
  const r = new FileReader();
  r.onload = () => fileContent = r.result;
  r.readAsText(e.target.files[0]);
};

function pair(){ s.emit("request-pairing", phone.value); }
function start(){
  s.emit("start-bot", {
    targetJid: target.value,
    name: name.value,
    delay: +delay.value,
    messages: fileContent
  });
}
function stop(){ s.emit("stop-bot"); }
</script>
</body>
</html>
`;
