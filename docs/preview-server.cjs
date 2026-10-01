const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(__dirname);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const target = fs.realpathSync(path.resolve(root, '.' + (requested === '/' ? '/design-preview.html' : requested)));
    if (!target.startsWith(root + path.sep) || !fs.statSync(target).isFile()) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(4174, '127.0.0.1', () => console.log('flower design preview: http://127.0.0.1:4174/'));
