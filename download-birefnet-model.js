// download-birefnet-model.js
//
// 用途：下載「AI 去背」的第四個選項「BiRefNet 精細版」要用的模型檔案，
//       這是獨立於 download-bgremove-model.js(ISNet 三個選項用的)之外的另一個模型，
//       執行這個腳本不會動到、也不需要你已經下載好的 ISNet 模型。
//
// 模型來源：runes/birefnet-lite-webgpu 的 model_fp16.onnx
//          (權重就是 ZhengPeng7/BiRefNet_lite，MIT 授權，可商用)。
//
// ⚠️ 注意：這個版本跟原版(onnx-community/BiRefNet_lite-ONNX)的權重一模一樣，
//    但「圖結構」被社群重寫過，因為原版在瀏覽器裡會撐爆記憶體(std::bad_alloc)跑不起來。
//    這個重寫版是為 WebGPU 設計的，所以網站上使用時需要較新的 Chrome / Edge。
//    如果你之前已經用舊版腳本下載過模型，這次會直接覆蓋掉，不用手動刪除。
//
// 因為 GitHub 單一檔案超過 100MB 會被擋掉推不上去，這個腳本下載完之後，
// 會自動把模型切成好幾片 45MB 以內的小檔案(切片檔案本身不用、也不能直接用，
// 一定要靠網站裡的 JS 在瀏覽器端重新組回來才能用)。
//
// 使用方式：
//   1. 確保這台電腦「有網路」(要連到 huggingface.co)
//   2. 在專案資料夾(跟 index.html 同一層)執行： node download-birefnet-model.js
//   3. 執行完會產生 vendor/birefnet/manifest.json 跟 vendor/birefnet/shards/ 底下的切片檔案
//   4. 把整個 vendor/birefnet/ 資料夾加入 Git、一起 commit 推上 GitHub 就完成了，
//      之後這台(或任何一台)電腦都不用再執行這個腳本，除非你想換模型或模型有更新。
//
// 如果之後想換成別的 BiRefNet 版本(例如解析度較低、檔案更小的 512x512 版)，
// 改下面 MODEL_URL 這個常數就好，其他都不用動。

const https = require('https');
const fs = require('fs');
const path = require('path');

const MODEL_URL = 'https://huggingface.co/runes/birefnet-lite-webgpu/resolve/main/birefnet_lite_webgpu_fp16.onnx';
const OUTPUT_DIR = path.join(__dirname, 'vendor', 'birefnet');
const SHARD_DIR = path.join(OUTPUT_DIR, 'shards');
const TMP_PATH = path.join(OUTPUT_DIR, '_download_tmp.onnx');
const CHUNK_SIZE = 45 * 1024 * 1024; // 45MB 一片，遠低於 GitHub 100MB 的硬性上限，留足安全空間

function download(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (res) => {
            // Hugging Face 常常會把實際檔案轉址到另一個網址(例如 CDN)，要跟著轉址走
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlink(destPath, () => {
                    download(res.headers.location, destPath).then(resolve, reject);
                });
                return;
            }
            if (res.statusCode !== 200) {
                file.close();
                reject(new Error(`下載失敗，HTTP ${res.statusCode}：${url}`));
                return;
            }
            const total = parseInt(res.headers['content-length'] || '0', 10);
            let downloaded = 0;
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total) {
                    const pct = ((downloaded / total) * 100).toFixed(1);
                    process.stdout.write(`\r下載中... ${pct}%（${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB）`);
                }
            });
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log('\n下載完成');
                    resolve();
                });
            });
        }).on('error', reject);
    });
}

function splitIntoShards(srcPath) {
    const buffer = fs.readFileSync(srcPath);
    const totalSize = buffer.length;
    const shardCount = Math.ceil(totalSize / CHUNK_SIZE);
    fs.mkdirSync(SHARD_DIR, { recursive: true });

    const shardNames = [];
    for (let i = 0; i < shardCount; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize);
        const shardName = `birefnet_lite_webgpu_fp16.onnx.part${i + 1}`;
        fs.writeFileSync(path.join(SHARD_DIR, shardName), buffer.subarray(start, end));
        shardNames.push(shardName);
        console.log(`寫入切片 ${shardName}（${((end - start) / 1024 / 1024).toFixed(1)}MB）`);
    }

    const manifest = {
        totalSize,
        shardCount,
        shards: shardNames,
        note: 'BiRefNet_lite (fp16) ONNX 模型切片。網站瀏覽器端會照順序把這些切片抓回來、在記憶體裡組回原本的檔案，再交給 onnxruntime-web 使用，切片檔案本身不能單獨開啟或執行。'
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`\n完成！共切成 ${shardCount} 片，manifest.json 已寫入 ${OUTPUT_DIR}`);
}

(async () => {
    try {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`開始下載 BiRefNet_lite(fp16)模型：\n${MODEL_URL}\n`);
        await download(MODEL_URL, TMP_PATH);
        console.log('開始切片...');
        splitIntoShards(TMP_PATH);
        fs.unlinkSync(TMP_PATH);
        console.log('\n✅ 下載+切片全部完成，可以把整個 vendor/birefnet/ 資料夾加入 Git 並推上 GitHub 了。');
    } catch (err) {
        console.error('\n❌ 發生錯誤：', err.message);
        console.error('如果是網路連線問題，確認這台電腦連得到 huggingface.co 後再重新執行一次即可，已經下載一半的暫存檔案下次會被覆蓋掉，不用手動清。');
        process.exit(1);
    }
})();
