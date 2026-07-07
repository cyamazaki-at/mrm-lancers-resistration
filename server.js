'use strict';
// MRM フリーランサー登録・管理システム Phase 1
// 外部依存なし（Node 22.5+ の標準モジュールのみ）。起動: node server.js

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { currentUser } = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const MAX_BODY = 1024 * 200; // 200KB

// ---- シンプルなルーター ----
const table = []; // { method, matcher(string|RegExp), handler }
const routes = {
  get: (matcher, handler) => table.push({ method: 'GET', matcher, handler }),
  post: (matcher, handler) => table.push({ method: 'POST', matcher, handler }),
};
require('./routes/public').register(routes);
require('./routes/admin').register(routes);

// ---- 静的ファイル ----
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/public\//, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.notFound();
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // レスポンスヘルパー
    res.html = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    };
    res.redirect = (to) => { res.writeHead(302, { Location: to }); res.end(); };
    res.notFound = () => res.html('<h1>404 Not Found</h1><p><a href="/">トップへ戻る</a></p>', 404);

    if (pathname.startsWith('/public/')) return serveStatic(req, res, pathname);

    req.cookies = parseCookies(req.headers.cookie);
    req.query = url.searchParams;
    req.user = currentUser(req);

    if (req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const raw = await readBody(req);
      req.form = ct.includes('application/x-www-form-urlencoded') ? new URLSearchParams(raw) : new URLSearchParams();
    }

    for (const r of table) {
      if (r.method !== req.method) continue;
      if (typeof r.matcher === 'string') {
        if (r.matcher === pathname) return r.handler(req, res);
      } else {
        const m = pathname.match(r.matcher);
        if (m) return r.handler(req, res, m);
      }
    }
    res.notFound();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    res.end('<h1>500 Internal Server Error</h1>');
  }
});

server.listen(PORT, () => {
  console.log(`MRM Phase1 server running: http://localhost:${PORT}`);
  console.log(`  ランサー向け:   http://localhost:${PORT}/`);
  console.log(`  社内管理画面:   http://localhost:${PORT}/admin`);
});
