這個資料夾放「AI 去背工具」需要的檔案。

index.mjs
    去背引擎的程式碼(已經放好，不用另外下載)。

resources.json、models/、onnxruntime-web/ (要另外下載，這裡預設還沒有)
    AI 模型與 WASM 執行檔，體積較大(依畫質約 45～90MB)，沒有隨專案一起放。

第一次使用「AI 去背工具」之前，請先在「有網路」的環境下，
於專案根目錄(跟 index.html 同一層)執行一次：

    node download-bgremove-model.js

執行完成後，這個資料夾裡應該會多出 resources.json、models、onnxruntime-web 等檔案，
之後「AI 去背工具」就會完全離線在瀏覽器裡執行，不會再連網路。

如果之後想要重新整理環境給別人使用，只要把整個專案資料夾(含這個 vendor/bgremove/
裡已經下載好的檔案)一起複製過去即可，不需要在新環境再下載一次。
