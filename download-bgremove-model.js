/**
 * 「AI 去背工具」模型檔案下載腳本 (只需要執行一次，之後就能離線使用去背功能)
 *
 * 去背用的 AI 模型檔案(依畫質約 45～90MB)因為體積較大，沒有隨這個專案一起放，
 * 需要你在「有網路」的環境下執行這個腳本一次，把模型檔案下載到 vendor/bgremove/ 資料夾。
 * 下載完成後，去背功能就跟「AI 圖片放大工具」一樣，完全離線在瀏覽器裡執行，
 * 不會再連網路，也不會把圖片上傳到任何伺服器。
 *
 * 使用方式：
 *   1. 確認電腦已安裝 Node.js 18 以上版本 (跟 server.js 需要的版本一樣)
 *   2. 在這個資料夾開終端機，輸入：
 *        node download-bgremove-model.js
 *   3. 等待下載完成(檔案較大，依網速可能要幾分鐘)，過程會印出進度
 *   4. 完成後，vendor/bgremove/ 資料夾裡應該會有 resources.json、models、onnxruntime-web 等檔案
 *   5. 之後就可以直接用「AI 去背工具」頁籤，不需要再執行這個腳本(除非之後升級版本)
 *
 * 這個腳本做的事：
 *   從 IMG.LY 官方 CDN 下載跟 vendor/bgremove/index.mjs 完全對應版本(1.7.0)的資料包，
 *   解壓縮後，把裡面的 dist 資料夾內容(模型、wasm)複製進 vendor/bgremove/，
 *   跟原本就放在那裡的 index.mjs(去背引擎程式碼)放在一起。
 *   官方文件參考：https://www.npmjs.com/package/@imgly/background-removal
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

// 這個版本號要跟 vendor/bgremove/index.mjs 是同一個版本(@imgly/background-removal 1.7.0)，
// 如果之後升級了 index.mjs，這裡也要跟著改成一樣的版本號。
const PACKAGE_VERSION = '1.7.0';
const DOWNLOAD_URL = `https://staticimgly.com/@imgly/background-removal-data/${PACKAGE_VERSION}/package.tgz`;

const PROJECT_ROOT = __dirname;
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor', 'bgremove');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bgremove-download-'));
const TGZ_PATH = path.join(TMP_DIR, 'package.tgz');

function download(url, destPath) {
    return new Promise((resolve, reject) => {
        console.log(`下載中：${url}`);
        const file = fs.createWriteStream(destPath);
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // 跟隨轉址
                file.close();
                fs.unlinkSync(destPath);
                download(res.headers.location, destPath).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`下載失敗，伺服器回應狀態碼：${res.statusCode}`));
                return;
            }
            const total = parseInt(res.headers['content-length'] || '0', 10);
            let downloaded = 0;
            let lastPercent = -1;
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total > 0) {
                    const percent = Math.floor((downloaded / total) * 100);
                    if (percent !== lastPercent && percent % 5 === 0) {
                        lastPercent = percent;
                        console.log(`  進度：${percent}% (${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB)`);
                    }
                }
            });
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve());
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => reject(err));
        });
    });
}

function checkTarAvailable() {
    try {
        execFileSync('tar', ['--version'], { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

async function main() {
    console.log('----------------------------------------------------');
    console.log('開始下載 AI 去背工具的模型檔案...');
    console.log(`來源：${DOWNLOAD_URL}`);
    console.log('----------------------------------------------------');

    if (!checkTarAvailable()) {
        console.error(
            '❌ 找不到 tar 指令，無法自動解壓縮。\n' +
            'Windows 10/11、macOS、大部分 Linux 都內建 tar，如果你看到這個訊息，\n' +
            '請改用手動方式：直接用瀏覽器打開下面這個網址下載 package.tgz，\n' +
            '解壓縮後把裡面 package/dist/ 資料夾底下的所有檔案，複製到本專案的 vendor/bgremove/ 資料夾裡\n' +
            '(跟原本就在那裡的 index.mjs 放在一起，不要覆蓋掉 index.mjs)：\n' +
            DOWNLOAD_URL
        );
        process.exit(1);
    }

    fs.mkdirSync(VENDOR_DIR, { recursive: true });

    await download(DOWNLOAD_URL, TGZ_PATH);
    console.log('下載完成，開始解壓縮...');

    execFileSync('tar', ['-xzf', TGZ_PATH, '-C', TMP_DIR], { stdio: 'inherit' });

    const extractedDist = path.join(TMP_DIR, 'package', 'dist');
    if (!fs.existsSync(extractedDist)) {
        console.error('❌ 解壓縮後找不到 package/dist 資料夾，下載的檔案可能不完整或格式有變，請重新執行一次，或回報這個問題。');
        process.exit(1);
    }

    console.log('複製模型檔案到 vendor/bgremove/ ...');
    copyDirContents(extractedDist, VENDOR_DIR);

    // 清理暫存檔
    fs.rmSync(TMP_DIR, { recursive: true, force: true });

    console.log('----------------------------------------------------');
    console.log('✅ 完成！AI 去背工具的模型檔案已經放進 vendor/bgremove/。');
    console.log('現在可以離線使用「✂️ AI 去背工具」頁籤了。');
    console.log('----------------------------------------------------');
}

// 把 srcDir 底下所有檔案/子資料夾複製到 destDir，若目的地已存在同名檔案會覆蓋(index.mjs 不受影響，因為來源裡沒有這個檔案)
function copyDirContents(srcDir, destDir) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            copyDirContents(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

main().catch((err) => {
    console.error('❌ 下載或安裝過程發生錯誤：', err.message || err);
    console.error('可以重新執行一次 node download-bgremove-model.js 再試一次。');
    process.exit(1);
});
