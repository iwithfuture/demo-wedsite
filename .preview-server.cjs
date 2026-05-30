const http = require('http');
const fs = require('fs');
const path = require('path');
const root = 'D:/code/copy-website';
const types = {'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.resolve(root, file);
  if (!full.startsWith(path.resolve(root))) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': types[path.extname(full)] || 'application/octet-stream'});
    res.end(data);
  });
});
server.listen(5173, '127.0.0.1');
