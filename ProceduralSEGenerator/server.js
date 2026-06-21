/* server.js — zero-dependency static server + a tiny settings API.
 *
 * Run:  node server.js [port]   (default 5599)
 *
 * Serves this folder, plus:
 *   GET  /api/settings  -> contents of settings.json (or {})
 *   POST /api/settings  -> overwrites settings.json with the JSON body
 *
 * Settings live in a file inside this folder, so copying the app folder to
 * another machine carries the preferences (e.g. the Japanese-names toggle).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = parseInt(process.argv[2] || '5599', 10);
const root = __dirname;
const SETTINGS = path.join(root, 'settings.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');

  // ---- settings API ----
  if (u.pathname === '/api/settings') {
    if (req.method === 'GET') {
      let data = '{}';
      try { data = fs.readFileSync(SETTINGS, 'utf8'); } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data);
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          JSON.parse(body); // validate before writing
          fs.writeFileSync(SETTINGS, body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"ok":false}');
        }
      });
      return;
    }
    res.writeHead(405); res.end(); return;
  }

  // ---- static files ----
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const fp = path.normalize(path.join(root, p));
  if (!fp.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(port, () => console.log('Procedural SE Generator -> http://localhost:' + port));
