import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + error.code, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 服务器已启动！`);
  console.log(`📱 访问地址: http://localhost:${PORT}`);
  console.log(`\n✨ 请使用支持 WebGPU 的浏览器 (Chrome 113+) 打开`);
  console.log(`\n控制说明:`);
  console.log(`  🖱️ 左键拖拽 - 旋转相机`);
  console.log(`  🖱️ 滚轮 - 缩放`);
  console.log(`  🖱️ 点击光球 - 选中/交换`);
  console.log(`\n匹配规则:`);
  console.log(`  🎨 同色三连 - 任意材质，相同颜色`);
  console.log(`  ⚙️ 同材质三连 - 任意颜色，相同材质`);
  console.log(`  ⚡ 序列三连 - 金属→玻璃→发光体`);
  console.log(`\n按 Ctrl+C 停止服务器\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`端口 ${PORT} 已被占用，尝试端口 ${PORT + 1}...`);
    server.close();
    server.listen(PORT + 1);
  }
});
