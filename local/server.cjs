'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {newDocument, snapshot, mutate, normalizeConfig, normalizeAppearance, replay} = require('./scoring.cjs');
const {normalizeLogo, normalizeVideo, normalizeWebm, MAX_VIDEO_BYTES} = require('./logos.cjs');

function atomicWrite(file, value) {
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function createApp({dataDir, password, addresses = []}) {
  fs.mkdirSync(dataDir, {recursive: true});
  const stateFile = path.join(dataDir, 'match.json');
  let document = newDocument();
  if (fs.existsSync(stateFile)) {
    document = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (document.format !== 1 || !Number.isSafeInteger(document.revision) || !Array.isArray(document.events) || !Array.isArray(document.requests)) throw new Error('Saved match has an unsupported format.');
    if (document.config) document.config = normalizeConfig(document.config);
    document.appearance = normalizeAppearance(document.appearance); replay(document);
  }
  const sessions = new Map(), attempts = new Map(), listeners = new Set();
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase(), ...addresses]);
  const assets = {'/': ['index.html', 'text/html'], '/scoring': ['index.html', 'text/html'],
    '/overlay': ['overlay.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/media.js': ['media.js', 'text/javascript'],
    '/overlay.js': ['overlay.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
    '/overlay.css': ['overlay.css', 'text/css'], '/summary.js': ['summary.js', 'text/javascript'], '/summary.css': ['summary.css', 'text/css'],
    '/fonts/BarlowCondensed-Medium.ttf': ['fonts/BarlowCondensed-Medium.ttf', 'font/ttf'],
    '/fonts/BarlowCondensed-SemiBold.ttf': ['fonts/BarlowCondensed-SemiBold.ttf', 'font/ttf'],
    '/fonts/BarlowCondensed-Bold.ttf': ['fonts/BarlowCondensed-Bold.ttf', 'font/ttf'],
    '/fonts/BarlowCondensed-ExtraBold.ttf': ['fonts/BarlowCondensed-ExtraBold.ttf', 'font/ttf'],
    '/fonts/BarlowCondensed-Black.ttf': ['fonts/BarlowCondensed-Black.ttf', 'font/ttf']};
  const json = (res, code, data) => { res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
  const validSession = req => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const expiry = sessions.get(token);
    if (expiry && expiry > Date.now()) return true;
    sessions.delete(token); return false;
  };
  const publish = () => {
    const payload = `data: ${JSON.stringify(snapshot(document))}\n\n`;
    for (const res of listeners) { if (res.writableLength > 256 * 1024) res.destroy(); else res.write(payload); }
  };
  const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > limit) { chunks = []; reject(Object.assign(new Error('Request too large.'), {status: 413})); req.resume(); } else chunks.push(chunk); });
    req.on('end', () => { try { const value = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); resolve(value); } catch { reject(new Error('Invalid JSON object.')); } });
    req.on('error', reject);
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!allowed.has(url.hostname.toLowerCase())) return json(res, 421, {error: 'Use localhost or this computer’s LAN IP address.'});
      if (req.method === 'GET') {
        const logoPath = /^\/logos\/([a-f0-9]{64})\.(png|mp4|webm)$/.exec(url.pathname);
        if (logoPath) {
          const [, logoId, extension] = logoPath, image = document.logos?.[logoId];
          const referenced = ['home', 'away', 'channel', 'sponsor'].some(slot => document.appearance[slot + 'Logo'] === url.pathname);
          if (!referenced || typeof image !== 'string') return json(res, 404, {error: 'Logo not found.'});
          const bytes = Buffer.from(image, 'base64');
          const headers = {'Content-Type': extension === 'webm' ? 'video/webm' : extension === 'mp4' ? 'video/mp4' : 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable', 'Accept-Ranges': 'bytes'};
          if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            let start = range?.[1] ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : bytes.length - 1;
            if (range && !range[1] && range[2]) { start = Math.max(0, bytes.length - Number(range[2])); end = bytes.length - 1; }
            if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= bytes.length || end < start) {
              res.writeHead(416, {...headers, 'Content-Range': `bytes */${bytes.length}`}); return res.end();
            }
            end = Math.min(end, bytes.length - 1);
            res.writeHead(206, {...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`}); return res.end(bytes.subarray(start, end + 1));
          }
          res.writeHead(200, {...headers, 'Content-Length': bytes.length}); return res.end(bytes);
        }
        if (assets[url.pathname]) {
          const [name, mime] = assets[url.pathname]; res.writeHead(200, {'Content-Type': mime.startsWith('font/') ? mime : `${mime}; charset=utf-8`});
          return res.end(fs.readFileSync(path.join(__dirname, 'public', name)));
        }
        if (url.pathname === '/api/state') return json(res, 200, snapshot(document));
        if (url.pathname === '/api/info') return json(res, 200, {apiVersion: 3, videoLogos: true, webmLogos: true, addresses, port: server.address()?.port});
        if (url.pathname === '/api/session') return json(res, validSession(req) ? 200 : 401, {ok: validSession(req)});
        if (url.pathname === '/api/export') {
          if (!validSession(req)) return json(res, 401, {error: 'Sign in to export.'});
          res.setHeader('Content-Disposition', 'attachment; filename="cricket-match.json"'); return json(res, 200, document);
        }
        if (url.pathname === '/api/events') {
          if (listeners.size >= 32) return json(res, 503, {error: 'Too many connected displays.'});
          res.writeHead(200, {'Content-Type': 'text/event-stream', Connection: 'keep-alive'});
          listeners.add(res); res.write(`data: ${JSON.stringify(snapshot(document))}\n\n`);
          const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000);
          res.on('close', () => { clearInterval(timer); listeners.delete(res); }); return;
        }
        if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
        return json(res, 404, {error: 'Not found.'});
      }
      if (req.method !== 'POST') return json(res, 405, {error: 'Method not allowed.'});
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, {error: 'Cross-origin request rejected.'});
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, {error: 'Use JSON.'});
      if (url.pathname !== '/api/login' && !validSession(req)) return json(res, 401, {error: 'Sign in with the access code shown in the server terminal.'});
      const body = await readBody(req, url.pathname === '/api/logo' ? Math.ceil(MAX_VIDEO_BYTES / 3) * 4 + 4096 : 64 * 1024);
      if (url.pathname === '/api/login') {
        const ip = req.socket.remoteAddress, now = Date.now();
        const record = attempts.get(ip) || {count: 0, until: now + 600000};
        if (record.until < now) { record.count = 0; record.until = now + 600000; }
        if (record.count >= 5) return json(res, 429, {error: 'Too many attempts. Try again in 10 minutes.'});
        const a = crypto.createHash('sha256').update(String(body.password || '')).digest();
        const b = crypto.createHash('sha256').update(password).digest();
        if (!crypto.timingSafeEqual(a, b)) { record.count++; attempts.set(ip, record); return json(res, 401, {error: 'Incorrect access code.'}); }
        attempts.delete(ip);
        for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, now + 12 * 3600000);
        return json(res, 200, {token});
      }
      if (url.pathname === '/api/logout') { sessions.delete((req.headers.authorization || '').replace(/^Bearer /, '')); return json(res, 200, {ok: true}); }
      const action = url.pathname.replace('/api/', '');
      if (!['setup', 'appearance', 'event', 'undo', 'edit', 'logo'].includes(action)) return json(res, 404, {error: 'Not found.'});
      if (!/^[a-zA-Z0-9-]{12,80}$/.test(body.requestId || '')) return json(res, 400, {error: 'Missing request identifier.'});
      if (document.requests.includes(body.requestId)) return json(res, 200, {ok: true, state: snapshot(document)});
      if (body.revision !== document.revision) return json(res, 409, {error: 'The score changed in another tab. Check the updated score, then try again.', state: snapshot(document)});
      let next;
      if (action === 'logo') {
        if (!['home', 'away', 'channel', 'sponsor'].includes(body.side)) return json(res, 400, {error: 'Choose a team, channel or sponsor logo slot.'});
        const video = typeof body.data === 'string' && body.data.startsWith('data:video/mp4;');
        const webm = typeof body.data === 'string' && body.data.startsWith('data:video/webm;');
        const logo = body.data === null ? null : webm ? normalizeWebm(body.data) : video ? normalizeVideo(body.data) : normalizeLogo(body.data);
        next = mutate(document, 'appearance', {appearance: {[body.side + 'Logo']: logo ? `/logos/${logo.id}.${webm ? 'webm' : video ? 'mp4' : 'png'}` : ''}});
        const retained = new Set(['home', 'away', 'channel', 'sponsor'].map(slot => next.appearance[slot + 'Logo']));
        next.logos = Object.fromEntries(Object.entries(document.logos || {}).filter(([id]) => ['png', 'mp4', 'webm'].some(ext => retained.has(`/logos/${id}.${ext}`))));
        if (logo) next.logos[logo.id] = logo.data;
      } else next = mutate(document, action, body);
      next.requests = [...document.requests, body.requestId].slice(-200);
      if (action === 'setup' && document.config) {
        const archive = path.join(dataDir, 'archives'); fs.mkdirSync(archive, {recursive: true});
        atomicWrite(path.join(archive, `${Date.now()}-${document.revision}.json`), document);
      }
      atomicWrite(stateFile, next); // A failed disk write never changes the on-air state.
      document = next; publish(); json(res, 200, {ok: true, state: snapshot(document)});
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 400, {error: error.code ? 'Could not save the match. Check disk space and folder permissions.' : error.message});
      else res.end();
    }
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.maxHeadersCount = 50;
  server.on('close', () => { for (const res of listeners) res.destroy(); });
  server.stop = () => { for (const res of listeners) res.end(); server.close(); server.closeIdleConnections(); };
  return server;
}
if (require.main === module) {
  const args = process.argv.slice(2), lan = args.includes('--lan');
  const portIndex = args.indexOf('--port'), port = portIndex >= 0 ? Number(args[portIndex + 1]) : 5081;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || args.some((arg, i) => !['--lan', '--port'].includes(arg) && !(portIndex >= 0 && i === portIndex + 1))) { console.error('Usage: node local/server.cjs [--lan] [--port 5081]'); process.exit(1); }
  const addresses = Object.values(os.networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
  const dataDir = process.env.SCOREBOARD_DATA_DIR || path.join(__dirname, '..', '.local-scoreboard');
  fs.mkdirSync(dataDir, {recursive: true});
  const codeFile = path.join(dataDir, 'access-code.txt');
  if (!fs.existsSync(codeFile)) fs.writeFileSync(codeFile, crypto.randomBytes(9).toString('base64url'), {mode: 0o600});
  const password = process.env.SCOREBOARD_PASSWORD || fs.readFileSync(codeFile, 'utf8').trim();
  if (password.length < 8) { console.error('Access code must contain at least 8 characters.'); process.exit(1); }
  try {
    const server = createApp({dataDir, password, addresses});
    server.on('error', error => { console.error(`Could not start: ${error.message}`); process.exitCode = 1; });
    const start = () => server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
      console.log(`\nCricketStream Local\nScoring: http://127.0.0.1:${port}\nOBS overlay: http://127.0.0.1:${port}/overlay\nAccess code: ${password}\n`);
      if (lan) { for (const address of addresses) console.log(`LAN scoring: http://${address}:${port}`); console.log('Use a private network. Allow the firewall on Private networks only.'); }
      else console.log('Local access only. Use npm run start:lan for phone/tablet scoring.');
    });
    // An existing listener on loopback may coexist with a wildcard listener on
    // Windows. Detect that before listening so normal double-launches cannot
    // silently serve two independent copies of the scoring state.
    const probe = http.get({host: '127.0.0.1', port, path: '/api/info', timeout: 1200}, response => {
      response.resume(); console.error(`Port ${port} is already in use. Open http://127.0.0.1:${port}/scoring or close the existing app before restarting.`); process.exitCode = 1;
    });
    let decided = false;
    probe.on('timeout', () => { decided = true; probe.destroy(); console.error(`Port ${port} is occupied by a server that did not respond. Close it before restarting.`); process.exitCode = 1; });
    probe.on('error', error => { if (decided) return; decided = true; if (error.code === 'ECONNREFUSED') start(); else { console.error('Could not check the local port: ' + error.message); process.exitCode = 1; } });
    process.on('SIGINT', () => server.stop()); process.on('SIGTERM', () => server.stop());
  } catch (error) { console.error(`Could not load saved match; no files changed: ${error.message}`); process.exitCode = 1; }
}
module.exports = {createApp, atomicWrite};
