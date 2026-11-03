#!/usr/bin/env node
/*
 * Wayan 3D Menu — tiny server (no dependencies, Node 18+)
 *
 *   ADMIN_PASSWORD="something-long" node self-host/server.cjs
 *
 * Alternative to the Vercel deployment for any VPS / Node host.
 *
 * Serves index.html, stores the menu in ./data/menu.json and uploaded
 * models/posters in ./uploads. When index.html is opened through this server
 * it switches automatically from "demo / this browser" mode to "live" mode,
 * so every change the admin saves is visible to every guest.
 * Put it behind HTTPS (AR on phones requires a secure origin).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SITE = path.join(__dirname, '..');           // index.html, models/, vendor/
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
const MENU_FILE = path.join(DATA, 'menu.json');
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_UPLOAD = (+process.env.MAX_UPLOAD_MB || 30) * 1048576;
const SESSION_MS = 12 * 3600 * 1000;

if (!PASSWORD || PASSWORD.length < 8) {
  console.error('\n  Set ADMIN_PASSWORD (8+ characters), e.g.\n  ADMIN_PASSWORD="choose-a-long-one" node self-host/server.cjs\n');
  process.exit(1);
}
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary', '.usdz': 'model/vnd.usdz+zip', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const UPLOAD_EXT = new Set(['.glb', '.usdz', '.webp', '.png', '.jpg', '.jpeg']);

const sessions = new Map(); // token -> expiry
const attempts = new Map(); // ip -> [timestamps]

function send(res, code, body, headers = {}) {
  const isObj = body && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? MIME['.json'] : 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function authed(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const exp = t && sessions.get(t);
  if (!exp || exp < Date.now()) { if (t) sessions.delete(t); return false; }
  sessions.set(t, Date.now() + SESSION_MS);
  return true;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function slug(s) { return String(s).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file'; }

async function serveFile(req, res, file, cache) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return send(res, 404, 'Not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? +range[1] : st.size - +range[2];
      const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      if (start >= st.size || start < 0) return send(res, 416, '', { 'Content-Range': `bytes */${st.size}` });
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
  } catch { send(res, 404, 'Not found'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const ip = req.socket.remoteAddress || '';
  try {
    // ---------- API ----------
    if (p === '/api/health') return send(res, 200, { wayanMenu: true, storage: 'fs', adminReady: true, version: 2 });

    if (p === '/api/menu' && req.method === 'GET') {
      try { const j = await fsp.readFile(MENU_FILE); return send(res, 200, j, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); }
      catch { return send(res, 404, { error: 'No menu saved yet' }); }
    }
    if (p === '/api/menu' && req.method === 'PUT') {
      if (!authed(req)) return send(res, 401, { error: 'Unauthorized' });
      const body = await readBody(req, 4 * 1048576);
      let menu; try { menu = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
      if (!menu || !Array.isArray(menu.items) || !Array.isArray(menu.tabs)) return send(res, 400, { error: 'Not a menu' });
      // keep the last 20 versions
      try { await fsp.copyFile(MENU_FILE, path.join(DATA, `menu-${Date.now()}.json`)); } catch {}
      const old = (await fsp.readdir(DATA)).filter(f => /^menu-\d+\.json$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 20))) fsp.unlink(path.join(DATA, f)).catch(() => {});
      const tmp = MENU_FILE + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(menu, null, 1));
      await fsp.rename(tmp, MENU_FILE);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const now = Date.now(), list = (attempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
      if (list.length >= 10) return send(res, 429, { error: 'Too many attempts, try again in a few minutes' });
      let pw = ''; try { pw = JSON.parse(await readBody(req, 4096)).password || ''; } catch {}
      if (!safeEqual(pw, PASSWORD)) { list.push(now); attempts.set(ip, list); return send(res, 401, { error: 'Wrong password' }); }
      attempts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, now + SESSION_MS);
      return send(res, 200, { token });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      sessions.delete((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      return send(res, 200, { ok: true });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      if (!authed(req)) return send(res, 401, { error: 'Unauthorized' });
      const name = url.searchParams.get('filename') || 'file.bin';
      const ext = path.extname(name).toLowerCase();
      if (!UPLOAD_EXT.has(ext)) return send(res, 415, { error: 'File type not allowed' });
      const buf = await readBody(req, MAX_UPLOAD);
      if (ext === '.glb' && buf.slice(0, 4).toString('latin1') !== 'glTF') return send(res, 415, { error: 'Not a GLB file' });
      if (ext === '.usdz' && buf.slice(0, 2).toString('latin1') !== 'PK') return send(res, 415, { error: 'Not a USDZ file' });
      const file = `${slug(name)}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      await fsp.writeFile(path.join(UPLOADS, file), buf);
      return send(res, 200, { url: `uploads/${file}` });
    }
    if (p === '/api/upload' && req.method === 'DELETE') {
      if (!authed(req)) return send(res, 401, { error: 'Unauthorized' });
      const f = path.basename(url.searchParams.get('file') || '');
      if (f) await fsp.unlink(path.join(UPLOADS, f)).catch(() => {});
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });

    // ---------- static ----------
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (p.startsWith('/uploads/')) {
      const f = path.join(UPLOADS, path.basename(p));
      return serveFile(req, res, f, 'public, max-age=31536000, immutable');
    }
    if (p === '/' || p === '/index.html') return serveFile(req, res, path.join(SITE, 'index.html'), 'no-cache');
    if (/^\/(models|vendor)\/[\w.-]+$/.test(p)) return serveFile(req, res, path.join(SITE, p), 'public, max-age=86400');
    return send(res, 404, 'Not found');
  } catch (e) {
    if (!res.headersSent) send(res, e.code === 413 ? 413 : 500, { error: e.code === 413 ? 'File too large' : 'Server error' });
    if (e.code !== 413) console.error(e);
  }
});

server.listen(PORT, HOST, () => console.log(`Wayan 3D menu → http://localhost:${PORT}  (admin: open the page and click “Staff”, or go to /#admin)`));
