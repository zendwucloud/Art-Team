這個資料夾是「AI 去背」工具裡「BiRefNet 精細版」選項要用的模型檔案存放位置。

首次使用前，請在「有網路」的環境下，於專案資料夾(跟 index.html 同一層)執行一次：

    node download-birefnet-model.js

執行完成後，這個資料夾底下會多出：
  - manifest.json          模型切片的清單(檔名、總大小)
  - shards/                模型本體，切成好幾片 45MB 以內的檔案
                            (每一片單獨開啟都是壞的、不能用，一定要靠網站
                             程式在瀏覽器裡照順序讀回來、重新組成完整的
                             .onnx 檔案，才能拿去給 onnxruntime-web 使用)

下載＋切片完成後，把整個 vendor/birefnet/ 資料夾(含 manifest.json 跟 shards/)
一起加入 Git、commit、推上 GitHub，網站上的「BiRefNet 精細版」選項就能正常使用了。
之後除非要換模型或模型有更新，否則不用再重新執行這個腳本。

模型來源：runes/birefnet-lite-webgpu 的 model_fp16.onnx
        (權重就是 ZhengPeng7/BiRefNet_lite，MIT 授權，可商用)

⚠️ 使用前提：
   1. 網站使用這個選項時需要「網路連線」(執行引擎 onnxruntime-web 是從 CDN 載入的)
   2. 瀏覽器要支援 WebGPU(較新的 Chrome / Edge)

   原版的 onnx-community/BiRefNet_lite-ONNX 在瀏覽器裡會因為記憶體不足跑不起來，
   所以改用社群重寫過圖結構的版本(權重完全一樣，只是能在 WebGPU 上正常執行)。
   如果你之前用舊版腳本下載過，重新執行一次就會自動覆蓋掉，不用手動清除。
