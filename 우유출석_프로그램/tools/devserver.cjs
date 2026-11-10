/* ============================================================
   devserver.cjs  -  내 컴퓨터에서 시험해 보기 위한 작은 서버
   ------------------------------------------------------------
   카메라는 https 또는 localhost 에서만 켜집니다.
   파일을 두 번 눌러서 (file:// 로) 열면 카메라가 안 켜지므로,
   이 서버를 켜고 http://localhost:8777 로 들어가야 합니다.

   [사용법]  node tools/devserver.cjs
             (포트를 바꾸려면)  node tools/devserver.cjs 9000
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');          // 프로젝트 폴더
const PORT = Number(process.argv[2]) || 8777;

// 확장자별 파일 종류 (브라우저가 알아보게 알려주는 값)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
  // 주소에서 ? 뒷부분을 떼고, 한글 폴더 이름을 알아볼 수 있게 되돌림
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  // 프로젝트 폴더 밖의 파일을 못 읽게 막기
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('403');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('파일을 찾을 수 없어요: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',   // 고친 내용이 바로 보이게
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`우유 출석부 서버가 켜졌어요 -> http://localhost:${PORT}`);
  console.log('끄려면 이 창에서 Ctrl + C');
});
