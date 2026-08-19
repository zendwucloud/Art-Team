/**
 * 這個檔案原本是 coi-serviceworker，用途是在 GitHub Pages 上補 COOP/COEP 標頭，
 * 讓「影片壓縮工具」需要的 SharedArrayBuffer 可以啟用。
 *
 * 但它的作法是攔截整個網站發出的所有網路請求並改寫標頭，
 * 這會連帶把 Google 登入與 Firestore 雲端資料的連線也一起弄壞(登入會一直繞回登入畫面)。
 * 因為登入與雲端資料比線上版的影片壓縮重要，所以改成不使用它。
 *
 * Service Worker 一旦註冊過就會常駐在使用者的瀏覽器裡，
 * 光是把 index.html 裡引用它的那行刪掉並不會讓它消失。
 * 因此這個檔案的內容被換成「自我移除」的版本：
 * 瀏覽器之後再檢查這個檔案時，就會執行下面的程式碼把自己註銷掉，
 * 已經裝了舊版的人也會自動被清乾淨，不需要每個人手動去開發者工具移除。
 *
 * 影片壓縮工具在本機用 node server.js 開啟時仍然完全正常(server.js 會直接送出正確標頭)，
 * 只有部署在 GitHub Pages 的線上版無法使用該功能。
 */

if (typeof window === 'undefined') {
    // Service Worker 端：安裝後立刻接管，然後把自己註銷，並重新整理所有正在使用的分頁
    self.addEventListener('install', () => self.skipWaiting());

    self.addEventListener('activate', (event) => {
        event.waitUntil((async () => {
            try {
                await self.registration.unregister();
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach((client) => client.navigate(client.url));
            } catch (e) {
                // 就算註銷失敗也不要拋錯，下次瀏覽器再檢查時還會再試一次
            }
        })());
    });

    // 不再攔截任何請求：沒有 fetch 監聽器，所有連線都會照原樣直接送出，
    // Google 登入與 Firestore 就不會再被改寫標頭而失敗。

} else {
    // 網頁端：如果這個檔案不小心又被載入，主動把所有已註冊的 Service Worker 清掉
    if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
            registrations.forEach((registration) => registration.unregister());
        }).catch(() => {});
    }
}
