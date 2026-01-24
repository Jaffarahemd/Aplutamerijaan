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
   GLOBAL SAFETY (RENDER)
======================= */
process.on('unhandledRejection', reason => {
  console.error('UNHANDLED REJECTION:', reason);
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
   BASIC HTML UI
   (keep backend clean)
======================= */
app.get('/', (req, res) => {
  res.send('<h2>Server is running. UI connected.</h2>');
});

/* =======================
   WHATSAPP STATE
======================= */
let sock = null;
let isRunning = false;
let isPairing = false;
let isConnected = false;

/* =======================
   SOCKET.IO
======================= */
io.on('connection', socket => {
  console.log('🔌 Client connected');

  socket.emit('status', 'Offline');

  socket.on('request-pairing', async phoneNumber => {
    try {
      if (isPairing) {
        socket.emit('log', '⚠️ Pairing already in progress');
        return;
      }

      isPairing = true;

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
        const clean = phoneNumber.replace(/\D/g, '');
        const code = await sock.requestPairingCode(clean);
        socket.emit('pairing-code', code);
      }

      sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          isConnected = true;
          isPairing = false;
          socket.emit('status', '✅ Online');

          const groups = await sock.groupFetchAllParticipating();
          socket.emit('group-list', Object.values(groups));
        }

        if (connection === 'close') {
          isConnected = false;
          const reason = lastDisconnect?.error?.output?.statusCode;
          if (reason !== DisconnectReason.loggedOut) {
            socket.emit('status', '🔄 Disconnected');
          }
        }
      });
    } catch (err) {
      isPairing = false;
      console.error(err);
      socket.emit('log', '❌ Pairing failed');
    }
  });

  socket.on('start-bot', async config => {
    if (!sock || !isConnected) {
      socket.emit('log', '❌ WhatsApp not connected');
      return;
    }

    const { targetJid, haterName, delay, messages } = config;

    if (!targetJid || !messages) {
      socket.emit('log', '❌ Invalid input');
      return;
    }

    const msgList = messages.split('\n').map(m => m.trim()).filter(Boolean);
    if (msgList.length === 0) {
      socket.emit('log', '❌ Message file empty');
      return;
    }

    const safeDelay = Math.max(3, Number(delay) || 5);

    isRunning = true;
    let i = 0;

    while (isRunning) {
      try {
        const text = `${haterName || ''} ${msgList[i]}`.trim();
        await sock.sendMessage(targetJid, { text });
        socket.emit('log', `Sent: ${text}`);
        i = (i + 1) % msgList.length;
        await new Promise(r => setTimeout(r, safeDelay * 1000));
      } catch (err) {
        console.error(err);
        socket.emit('log', '❌ Send error');
        isRunning = false;
      }
    }
  });

  socket.on('stop-bot', () => {
    isRunning = false;
    socket.emit('log', '⛔ Bot stopped');
  });
});

/* =======================
   START SERVER
======================= */
server.listen(PORT, () => {
  console.log('==============================');
  console.log('🚀 Server LIVE');
  console.log('🌐 Port:', PORT);
  console.log('==============================');
});
