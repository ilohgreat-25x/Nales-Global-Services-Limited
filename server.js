const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const rootDir = __dirname;
const requestedPort = Number(process.env.PORT || 4042);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(rootDir, { index: 'index.html' }));

const clients = new Set();

function broadcast(payload) {
  const message = JSON.stringify(payload);
  clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

const wss = new WebSocketServer({ noServer: true });

let server;

function startServer(port) {
  server = app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Trying ${nextPort} instead.`);
      startServer(nextPort);
      return;
    }

    throw error;
  });

  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/ws') {
      wss.handleUpgrade(request, socket, head, (socketInstance) => {
        wss.emit('connection', socketInstance, request);
      });
    } else {
      socket.destroy();
    }
  });
}

startServer(requestedPort);

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'system', message: 'Realtime channel connected.' }));

  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      if (payload.type === 'presence') {
        broadcast({ type: 'presence', message: 'A visitor joined the live channel.' });
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'system', message: 'Invalid message format.' }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

app.post('/api/contact', (req, res) => {
  const payload = req.body || {};
  const meta = {
    ip: req.ip,
    ua: req.get('user-agent') || '',
    referer: req.get('referer') || ''
  };

  let responseSent = false;
  const sendJson = (statusCode, body) => {
    if (responseSent) return;
    responseSent = true;
    res.status(statusCode).json(body);
  };

  const php = spawn('php', ['api/contact.php'], {
    cwd: rootDir,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  php.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  php.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  php.on('error', () => {
    const result = {
      ok: true,
      blocked: false,
      message: 'PHP middleware unavailable, but the request passed the Node-side validation layer.',
      mode: 'node-fallback'
    };
    sendJson(200, result);
    broadcast({ type: 'contact', message: `Quote request received for ${payload.service || 'a service'}.` });
  });

  php.on('close', (code) => {
    if (code !== 0) {
      sendJson(500, { ok: false, message: 'Security middleware failed.', error: stderr.trim() });
      return;
    }

    try {
      const parsed = JSON.parse(stdout);
      sendJson(200, parsed);
      if (parsed.ok) {
        broadcast({ type: 'contact', message: `Quote request received for ${payload.service || 'a service'}.` });
      }
    } catch (error) {
      sendJson(500, { ok: false, message: 'Invalid response from PHP middleware.' });
    }
  });

  php.stdin.end(JSON.stringify({ payload, meta }));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'eng-web3-real-time' });
});
