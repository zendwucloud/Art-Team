/**
 * 本機靜態網頁伺服器，專門給「影片壓縮工具」用。
 *
 * 影片壓縮引擎(ffmpeg.wasm)需要瀏覽器開啟 SharedArrayBuffer 這個進階功能，
 * 而瀏覽器只有在伺服器回應「同時」帶有以下兩個標頭時才會開啟：
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 * 一般常見的 VS Code Live Server、雙擊開檔(file://)都不會加這兩個標頭，
 * 影片壓縮功能就會卡住不動。這個小伺服器只做一件事：把這兩個標頭加上去。
 *
 * 使用方式：
 *   1. 電腦要先安裝 Node.js (https://nodejs.org 下載 LTS 版本即可，安裝好會有 node 指令)
 *   2. 把這個 server.js 放到跟 index.html 同一層資料夾
 *   3. 在這個資料夾裡開終端機(cmd / PowerShell / Terminal)，輸入：
 *        node server.js
 *   4. 看到「伺服器已啟動」的訊息後，瀏覽器打開：
 *        http://localhost:8080
 *   5. 用這個網址操作，「圖片壓縮工具」「影片壓縮工具」都可以正常運作。
 *
 * 不需要安裝任何額外套件，純 Node.js 內建功能就能跑。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
};

const server = http.createServer((req, res) => {
    // 影片壓縮功能需要的關鍵標頭
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(ROOT, urlPath);

    // 簡單防呆：避免存取到資料夾外的檔案
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 找不到檔案：' + urlPath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        res.writeHead(200);
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log('----------------------------------------------------');
    console.log('伺服器已啟動！請用瀏覽器打開：');
    console.log(`  http://localhost:${PORT}`);
    console.log('要停止伺服器，回到這個視窗按 Ctrl + C');
    console.log('----------------------------------------------------');
});
