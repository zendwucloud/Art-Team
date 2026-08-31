import config from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCDZDO6BbOiXsWT2KU0b92qJpUYq3aeA1M",
  authDomain: "art-team-scheduler.firebaseapp.com",
  projectId: "art-team-scheduler",
  storageBucket: "art-team-scheduler.firebasestorage.app",
  messagingSenderId: "267633786182",
  appId: "1:267633786182:web:0d050a11ab5b86ee5e3947"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const docRef = doc(db, 'scheduler', 'multiProjectsData');
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

document.addEventListener('DOMContentLoaded', () => {

    /* =========================================================
       登入 / Google 帳號驗證
       設計：整個平台一律可以進入，四個工具頁籤(圖片壓縮、影片壓縮、AI 放大、AI 去背)
       不需要登入就能使用；只有前三頁(工作分配表、工時試算表、專案執行進度表)
       牽涉到雲端資料，必須登入而且 email 在 allowedUsers 白名單裡才看得到。
    ========================================================= */
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    const authHint = document.getElementById('authHint');
    const userAvatar = document.getElementById('userAvatar');
    const authMenu = document.getElementById('authMenu');
    const userEmailLabel = document.getElementById('userEmailLabel');
    const logoutBtn = document.getElementById('logoutBtn');

    // 這三個頁籤的內容需要登入才能看
    const AUTH_REQUIRED_TABS = ['weeklyReport', 'assign', 'estimate', 'status', 'digest'];

    let appStarted = false;      // startApp() 只跑一次
    let subscribeData = null;    // startApp() 裡會把「開始接收雲端資料」的函式指定給它
    let unsubscribeData = null;  // onSnapshot 回傳的取消訂閱函式，登出時用
    let dataSubscribed = false;

    // 把每個需要登入的頁籤，原本的內容包進一層 wrapper，並在前面插入一段「請先登入」提示，
    // 之後只要切換這兩者的顯示狀態就好，不會動到內部元素原有的 display 設定。
    function prepareAuthGates() {
        AUTH_REQUIRED_TABS.forEach(tab => {
            const page = document.getElementById('page-' + tab);
            if (!page || page.querySelector('.auth-content-wrap')) return;

            const wrap = document.createElement('div');
            wrap.className = 'auth-content-wrap';
            while (page.firstChild) wrap.appendChild(page.firstChild);

            const notice = document.createElement('div');
            notice.className = 'auth-notice';
            notice.innerHTML = `
                <strong>🔒 這個頁面需要登入才能查看</strong>
                請使用公司核發的 Google 帳號登入。<br>
                如果登入後仍然看不到內容，代表你的帳號還沒被加入白名單，請聯絡管理者。
                <div><button class="login-btn auth-notice-login">Google 登入</button></div>
            `;
            notice.querySelector('.auth-notice-login').addEventListener('click', doLogin);

            page.appendChild(notice);
            page.appendChild(wrap);
        });
    }

    function setAuthGates(isLoggedIn) {
        AUTH_REQUIRED_TABS.forEach(tab => {
            const page = document.getElementById('page-' + tab);
            if (!page) return;
            const wrap = page.querySelector('.auth-content-wrap');
            const notice = page.querySelector('.auth-notice');
            if (wrap) wrap.style.display = isLoggedIn ? '' : 'none';
            if (notice) notice.style.display = isLoggedIn ? 'none' : 'block';
        });
    }

    // 用彈出視窗登入。
    // 為什麼不用 signInWithRedirect：整頁跳轉的流程需要跨網域讀取 firebaseapp.com 的儲存空間，
    // 而 Chrome 現在會封鎖這種第三方儲存存取，導致驗證狀態存不住、在 Google 那邊一直繞圈。
    // (這是 Firebase 官方記載的已知限制，只有把網站部署在 Firebase Hosting 上才不受影響。)
    // 彈出視窗的流程是直接把結果回傳給母頁面，不依賴跨網域儲存，剛好避開這個問題。
    async function doLogin() {
        authHint.textContent = '登入中...';
        authHint.classList.remove('error');
        try {
            await signInWithPopup(auth, googleProvider);
            // 成功後由 onAuthStateChanged 接手處理白名單驗證與畫面切換
        } catch (err) {
            console.error('Google 登入失敗：', err);
            if (err && err.code === 'auth/popup-blocked') {
                authHint.textContent = '彈出視窗被瀏覽器擋住，請允許後再試';
            } else if (err && err.code === 'auth/popup-closed-by-user') {
                authHint.textContent = '請先登入';
                authHint.classList.remove('error');
                return;
            } else {
                authHint.textContent = '登入失敗，請再試一次';
            }
            authHint.classList.add('error');
        }
    }

    googleLoginBtn.addEventListener('click', doLogin);

    // 仍然保留這段：如果之前有殘留的整頁跳轉登入流程沒走完，回到頁面時把結果收乾淨，
    // 避免舊的登入狀態卡在中間。正常情況下這裡不會有任何動作。
    getRedirectResult(auth).catch((err) => {
        console.error('殘留的跳轉登入流程處理失敗(可忽略)：', err);
    });

    // 點頭像開合小選單
    userAvatar.addEventListener('click', (e) => {
        e.stopPropagation();
        authMenu.style.display = authMenu.style.display === 'none' ? 'flex' : 'none';
    });
    document.addEventListener('click', () => { authMenu.style.display = 'none'; });
    authMenu.addEventListener('click', (e) => e.stopPropagation());

    logoutBtn.addEventListener('click', async () => {
        authMenu.style.display = 'none';
        if (unsubscribeData) {
            unsubscribeData();
            unsubscribeData = null;
            dataSubscribed = false;
        }
        await signOut(auth);
    });

    // 主動確認這個帳號有沒有讀取資料的權限(也就是有沒有在 allowedUsers 白名單裡)。
    // 用實際讀一次資料來判斷，比被動等 onSnapshot 報錯可靠，也不會有時間差問題。
    async function verifyAccess() {
        try {
            await getDoc(docRef);
            return true;
        } catch (err) {
            if (err && err.code === 'permission-denied') return false;
            console.error('確認權限時發生非權限類的錯誤：', err);
            return true; // 網路等暫時性問題不當成沒權限，避免誤擋
        }
    }

    function showLoggedOutUI() {
        authHint.style.display = '';
        googleLoginBtn.style.display = '';
        userAvatar.style.display = 'none';
        authMenu.style.display = 'none';
        setAuthGates(false);
    }

    function showLoggedInUI(user) {
        authHint.style.display = 'none';
        authHint.classList.remove('error');
        googleLoginBtn.style.display = 'none';
        userAvatar.style.display = 'flex';
        userEmailLabel.textContent = user.email || '';
        if (user.photoURL) {
            userAvatar.innerHTML = `<img src="${user.photoURL}" alt="">`;
        } else {
            userAvatar.textContent = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        }
        setAuthGates(true);
    }

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            showLoggedOutUI();
            return;
        }

        authHint.textContent = '確認權限中...';
        authHint.classList.remove('error');

        const allowed = await verifyAccess();
        if (!allowed) {
            authHint.textContent = `${user.email} 沒有權限`;
            authHint.classList.add('error');
            authHint.style.display = '';
            googleLoginBtn.style.display = '';
            userAvatar.style.display = 'none';
            setAuthGates(false);
            await signOut(auth);
            return;
        }

        showLoggedInUI(user);

        // 通過驗證後才開始接收雲端資料
        if (subscribeData && !dataSubscribed) {
            dataSubscribed = true;
            unsubscribeData = subscribeData();
        }
    });

    // 平台本身立刻啟動(四個工具不需要登入就能用)，前三頁的內容則由上面的驗證流程控制顯示
    prepareAuthGates();
    setAuthGates(false);
    if (!appStarted) {
        appStarted = true;
        startApp();
    }

    function startApp() {

    /* =========================================================
       共用狀態 / Firebase 存取
    ========================================================= */
    let allProjects = {};          // 頁籤二：工時試算表資料
    let assignmentSheet = { rows: [] }; // 頁籤一：專案人員分配表資料
    let weeklyReport = { weeks: [] };   // 頁籤零：美術組週進度報告資料
    let currentProjectName = "預設專案";

    async function saveData() {
        try {
            await setDoc(docRef, { projects: allProjects, assignmentSheet, weeklyReport });
        } catch (error) {
            console.error("雲端儲存失敗：", error);
        }
    }

    // 不在這裡直接訂閱，而是把訂閱動作交給外層的登入流程，
    // 確認「已登入且在白名單裡」之後才開始接收雲端資料，避免未登入時一直被規則擋下報錯。
    subscribeData = () => onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            allProjects = data.projects || {};
            assignmentSheet = data.assignmentSheet || { rows: [] };
            weeklyReport = data.weeklyReport || { weeks: [] };
        }

        let needsSave = false;

        if (Object.keys(allProjects).length === 0) {
            allProjects["預設專案"] = { discountTier: 1.0, assignments: {} };
            needsSave = true;
        }

        if (!assignmentSheet.rows || assignmentSheet.rows.length === 0) {
            assignmentSheet = { rows: [makeBlankRow()] };
            needsSave = true;
        }

        if (!weeklyReport.weeks) {
            weeklyReport = { weeks: [] };
        }

        // 向下相容：舊資料沒有 statusMeta 欄位的話補一個空物件
        assignmentSheet.rows.forEach(row => {
            if (!row.statusMeta) row.statusMeta = {};
        });

        if (needsSave) {
            saveData();
        }

        updateProjectSelectUI();
        renderEstimatePage();
        renderAssignPage();
        renderStatusPage();
        renderWeeklyPage();
        renderDigestPage();
    }, (error) => {
        console.error('讀取雲端資料失敗：', error);
    });

    /* =========================================================
       頁籤切換
    ========================================================= */
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`page-${btn.dataset.tab}`).classList.add('active');
        });
    });

    /* =========================================================
       頁籤零：美術組週進度報告
       比照原本 Excel 週報表：每週一列，每人一欄自由填寫，日期永遠自動往下延伸，不用手動輸入。
    ========================================================= */
    const weeklyTableHeader = document.getElementById('weeklyTableHeader');
    const weeklyTableBody = document.getElementById('weeklyTableBody');
    const weeklyTableScroll = document.getElementById('weeklyTableScroll');
    const weeklyAddWeekBtn = document.getElementById('weeklyAddWeekBtn');
    const weeklyToggleImportBtn = document.getElementById('weeklyToggleImportBtn');
    const weeklyImportPanel = document.getElementById('weeklyImportPanel');
    const weeklyImportText = document.getElementById('weeklyImportText');
    const weeklyImportConfirmBtn = document.getElementById('weeklyImportConfirmBtn');
    const weeklyImportCancelBtn = document.getElementById('weeklyImportCancelBtn');
    const weeklyCollapseDate = document.getElementById('weeklyCollapseDate');
    const weeklyCollapseApplyBtn = document.getElementById('weeklyCollapseApplyBtn');
    const weeklyCollapseClearBtn = document.getElementById('weeklyCollapseClearBtn');
    const weeklyCollapseStatus = document.getElementById('weeklyCollapseStatus');

    // 摺疊「某日期以前」的舊資料改成大家共用的設定(存在雲端 weeklyReport.collapseBeforeDate 裡)，
    // 這樣不只是你自己看到精簡畫面，任何人(包含第一次進來、還沒有任何本機設定的訪客)一開始就會是這個摺疊過的畫面，
    // 對第一次載入的速度也有幫助。

    // 欄位順序完全比照原本 Excel 週報表，這樣從 Excel 整塊複製貼上時順序才會對得起來
    const weeklyPersonColumns = ['可樂', '大寶', '溫仔', '昱婷', '寶哥', '欣儀', '逸筠', '安惠', '佩可', '中爺', '阿榮', '(暫)開會備註用'];
    const WEEKLY_FUTURE_COUNT = 10; // 最後一筆資料之後，永遠自動往下延伸幾個星期五

    function pad2(n) { return String(n).padStart(2, '0'); }

    // 內部一律用 'YYYY-MM-DD' 字串存日期(比較、排序都方便)，避免時區換算問題
    function dateToKey(d) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
    function keyToDate(key) {
        const [y, m, d] = key.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    function formatWeeklyDateLabel(key) {
        const d = keyToDate(key);
        const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 週${weekdayNames[d.getDay()]}`;
    }
    // 找出「基準日期」之後、且是星期五的下一個日期(如果基準日本身就是星期五，會直接跳到下一週的星期五)
    function nextFriday(baseDate) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + 1);
        while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
        return d;
    }

    function makeBlankWeek(dateKey) {
        const cells = {};
        weeklyPersonColumns.forEach(p => { cells[p] = ''; });
        return { id: 'week_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), date: dateKey, cells };
    }

    function getSortedWeeklyWeeks() {
        return [...(weeklyReport.weeks || [])].sort((a, b) => a.date.localeCompare(b.date));
    }

    // 算出目前該顯示的完整列表：真正存起來的週 + 自動延伸的 10 個未來星期五(這些延伸列不會存進雲端，
    // 只有使用者真的動手打字之後，才會在儲存那一刻「升格」成真正的一筆資料)。
    // 如果有設定摺疊日期，日期較早的「已存在」的週不會被放進結果裡(未來的延伸週不受摺疊影響)。
    function getWeeklyDisplayRows() {
        const stored = getSortedWeeklyWeeks();
        const lastDate = stored.length > 0 ? keyToDate(stored[stored.length - 1].date) : nextFriday(new Date());
        // 如果連一筆資料都還沒有，讓「今天」也當作候選的起點之一(才不會漏掉本週五)
        let cursor = stored.length > 0 ? lastDate : new Date(lastDate.getTime() - 7 * 86400000);

        const virtualRows = [];
        for (let i = 0; i < WEEKLY_FUTURE_COUNT; i++) {
            cursor = nextFriday(cursor);
            virtualRows.push({ id: 'virtual_' + dateToKey(cursor), date: dateToKey(cursor), cells: {}, isVirtual: true });
        }

        let visibleStored = stored;
        let hiddenCount = 0;
        if (weeklyReport.collapseBeforeDate) {
            visibleStored = stored.filter(w => w.date >= weeklyReport.collapseBeforeDate);
            hiddenCount = stored.length - visibleStored.length;
        }

        return { rows: [...visibleStored, ...virtualRows], hiddenCount };
    }

    function renderWeeklyHeader() {
        weeklyTableHeader.innerHTML = '';
        const thDate = document.createElement('th');
        thDate.className = 'weekly-date-header';
        thDate.textContent = '日期';
        weeklyTableHeader.appendChild(thDate);
        weeklyPersonColumns.forEach(p => {
            const th = document.createElement('th');
            th.className = 'weekly-person-header';
            th.textContent = p;
            weeklyTableHeader.appendChild(th);
        });
    }

    // 把某個「延伸中的虛擬週」升格成真正存進雲端的一筆資料(第一次在該週任何一欄打字時觸發)
    function promoteVirtualWeek(dateKey) {
        const already = weeklyReport.weeks.find(w => w.date === dateKey);
        if (already) return already;
        const week = makeBlankWeek(dateKey);
        weeklyReport.weeks.push(week);
        return week;
    }

    function renderWeeklyPage() {
        renderWeeklyHeader();
        weeklyTableBody.innerHTML = '';

        const { rows, hiddenCount } = getWeeklyDisplayRows();

        if (weeklyReport.collapseBeforeDate) {
            weeklyCollapseStatus.style.display = '';
            weeklyCollapseStatus.textContent = `📁 已摺疊 ${formatWeeklyDateLabel(weeklyReport.collapseBeforeDate)} 以前的資料，共隱藏 ${hiddenCount} 週(資料都還在，對所有人都是這樣的畫面，按「顯示全部」會恢復成大家都看得到完整列表)。`;
            weeklyCollapseClearBtn.style.display = '';
            weeklyCollapseDate.value = weeklyReport.collapseBeforeDate;
        } else {
            weeklyCollapseStatus.style.display = 'none';
            weeklyCollapseClearBtn.style.display = 'none';
        }

        rows.forEach((week, index) => {
            const tr = document.createElement('tr');
            if (index % 2 === 1) tr.classList.add('week-alt');
            if (week.isVirtual) tr.classList.add('week-virtual');

            const tdDate = document.createElement('td');
            tdDate.className = 'weekly-date-cell';
            tdDate.textContent = formatWeeklyDateLabel(week.date);
            tr.appendChild(tdDate);

            weeklyPersonColumns.forEach(person => {
                const td = document.createElement('td');
                td.className = 'weekly-content-cell';
                const textarea = document.createElement('textarea');
                textarea.value = week.isVirtual ? '' : (week.cells[person] || '');
                textarea.rows = 1;

                const autoResize = () => {
                    textarea.style.height = 'auto';
                    textarea.style.height = (textarea.scrollHeight) + 'px';
                };

                textarea.addEventListener('input', autoResize);

                textarea.addEventListener('change', () => {
                    // 虛擬(還沒存在)的週，只有在使用者真的打了內容才升格成正式資料，
                    // 避免每次渲染都把 10 個空白未來週塞進雲端資料庫
                    if (textarea.value.trim() === '' && week.isVirtual) return;
                    const realWeek = week.isVirtual ? promoteVirtualWeek(week.date) : week;
                    realWeek.cells[person] = textarea.value;
                    saveData();
                    if (week.isVirtual) {
                        week.isVirtual = false; // 避免使用者連續在同一列打好幾欄時，後面欄位又重複升格一次
                    }
                });

                td.appendChild(textarea);
                tr.appendChild(td);
                requestAnimationFrame(autoResize);
            });

            weeklyTableBody.appendChild(tr);
        });
    }

    weeklyAddWeekBtn.addEventListener('click', () => {
        const stored = getSortedWeeklyWeeks();
        const lastDate = stored.length > 0 ? keyToDate(stored[stored.length - 1].date) : new Date();
        const newWeek = makeBlankWeek(dateToKey(nextFriday(lastDate)));
        weeklyReport.weeks.push(newWeek);
        saveData();
        renderWeeklyPage();
    });

    weeklyToggleImportBtn.addEventListener('click', () => {
        weeklyImportPanel.style.display = weeklyImportPanel.style.display === 'none' ? 'block' : 'none';
    });
    weeklyImportCancelBtn.addEventListener('click', () => {
        weeklyImportPanel.style.display = 'none';
        weeklyImportText.value = '';
    });

    // 解析從 Excel 複製出來的內容。跟其他頁籤的匯入不同，這裡每個儲存格內容本身就常常是多行文字，
    // Excel 複製多行儲存格時會用雙引號把整格包起來(內部的雙引號變成兩個雙引號)，
    // 所以不能單純按「換行」切分，必須照 TSV/CSV 的引號規則來解析，才不會把一格內的換行誤判成新的一列。
    function parseExcelPasteWithQuotedNewlines(text) {
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;
        let i = 0;
        while (i < text.length) {
            const c = text[i];
            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                    inQuotes = false; i++; continue;
                }
                field += c; i++; continue;
            }
            if (c === '"') { inQuotes = true; i++; continue; }
            if (c === '\t') { row.push(field); field = ''; i++; continue; }
            if (c === '\r') { i++; continue; }
            if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
            field += c; i++; continue;
        }
        if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
        return rows.filter(r => r.some(f => f.trim() !== ''));
    }

    // 從貼上的第一欄文字判斷日期，支援「2026年3月27日 週五」跟「2026/3/27」兩種常見格式
    function parseWeeklyDateCell(text) {
        const t = (text || '').trim();
        let m = t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (m) return dateToKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        m = t.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (m) return dateToKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        return null;
    }

    weeklyImportConfirmBtn.addEventListener('click', () => {
        const raw = weeklyImportText.value;
        if (!raw.trim()) { alert('請先貼上資料。'); return; }

        const parsedRows = parseExcelPasteWithQuotedNewlines(raw);
        if (parsedRows.length === 0) { alert('沒有偵測到任何資料，請確認格式。'); return; }

        let importedCount = 0;
        let skippedCount = 0;

        parsedRows.forEach(cols => {
            const dateKey = parseWeeklyDateCell(cols[0]);
            if (!dateKey) { skippedCount++; return; } // 第一欄看不出日期的列(例如不小心貼到表頭)直接跳過

            let week = weeklyReport.weeks.find(w => w.date === dateKey);
            if (!week) {
                week = makeBlankWeek(dateKey);
                weeklyReport.weeks.push(week);
            }
            weeklyPersonColumns.forEach((person, idx) => {
                const value = cols[idx + 1]; // +1 是因為第 0 欄是日期
                if (value !== undefined) week.cells[person] = value;
            });
            importedCount++;
        });

        saveData();
        renderWeeklyPage();
        weeklyImportPanel.style.display = 'none';
        weeklyImportText.value = '';
        alert(`匯入完成：成功 ${importedCount} 週${skippedCount > 0 ? `，略過 ${skippedCount} 列(看不出日期)` : ''}。`);
    });

    weeklyCollapseApplyBtn.addEventListener('click', () => {
        if (!weeklyCollapseDate.value) {
            alert('請先選一個日期，會摺疊這個日期以前(不含這天)的週。');
            return;
        }
        weeklyReport.collapseBeforeDate = weeklyCollapseDate.value;
        saveData();
        renderWeeklyPage();
    });

    weeklyCollapseClearBtn.addEventListener('click', () => {
        weeklyReport.collapseBeforeDate = null;
        weeklyCollapseDate.value = '';
        saveData();
        renderWeeklyPage();
    });

    /* =========================================================
       頁籤一：美術專案工作分配表
    ========================================================= */
    const assignTableHeader = document.getElementById('assignTableHeader');
    const assignTableBody = document.getElementById('assignTableBody');
    const assignTableScroll = document.getElementById('assignTableScroll');
    const platformLegend = document.getElementById('platformLegend');
    const addRowBtn = document.getElementById('addRowBtn');
    const toggleImportBtn = document.getElementById('toggleImportBtn');
    const importPanel = document.getElementById('importPanel');
    const importText = document.getElementById('importText');
    const importConfirmBtn = document.getElementById('importConfirmBtn');
    const importCancelBtn = document.getElementById('importCancelBtn');
    const deleteRowsBtn = document.getElementById('deleteRowsBtn');

    // 點平台圖例(YGR / POP / 888 / APEX / A+ / Stake / 其他)，跳到該平台在表格裡的第一列。
    // 因為 getSortedRows() 本來就已經照平台分組排序好了，同一平台的列一定是連續的，
    // 只要找到「第一個符合這個平台」的 <tr>，把它捲動到可視範圍內就好。
    if (platformLegend) {
        platformLegend.addEventListener('click', (e) => {
            const target = e.target.closest('.platform-jump');
            if (!target) return;

            const key = target.dataset.platformKey;
            const targetRow = assignTableBody.querySelector(`tr[data-platform-key="${key}"]`);
            if (!targetRow) {
                alert('目前列表裡沒有這個平台的專案。');
                return;
            }

            // 表頭是 sticky 的，直接用 scrollIntoView 會被表頭蓋住一小截，
            // 所以改成手動計算捲動位置，扣掉表頭高度再捲，確保目標列剛好落在表頭下方。
            const headerHeight = assignTableHeader.parentElement.offsetHeight;
            const scrollTarget = targetRow.offsetTop - headerHeight;
            assignTableScroll.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });

            // 短暫閃一下黃色底色，讓使用者一眼看到跳到哪裡了
            targetRow.classList.add('row-jump-highlight');
            setTimeout(() => targetRow.classList.remove('row-jump-highlight'), 1200);
        });
    }

    // 頁籤一「美術組工作分配表」目前被勾選(準備刪除)的列，存 row.id，重新渲染時要保留這個狀態
    let selectedAssignRowIds = new Set();

    function makeBlankRow() {
        return {
            id: 'row_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            projectName: '',
            onlineDate: '',
            planner: '',
            cells: {},
            statusMeta: {} // { personName: { status: '準時'|'警戒'|'超時'|'特殊', completion: 0-100 } }
        };
    }

    function getRoleColor(text) {
        if (!text) return '';
        for (const role of config.assignmentSheet.roles) {
            if (text.includes(role.key)) return role.color;
        }
        return config.assignmentSheet.defaultColor;
    }

    // 依「執行狀況」調整底色：準時/特殊維持原色，警戒變同色系深色，超時變紅色，完成度滿 100% 一律變灰色
    function darkenColor(hex, amount = 0.32) {
        if (!hex) return hex;
        const clean = hex.replace('#', '');
        const r = parseInt(clean.substr(0, 2), 16);
        const g = parseInt(clean.substr(2, 2), 16);
        const b = parseInt(clean.substr(4, 2), 16);
        const dr = Math.max(0, Math.round(r * (1 - amount)));
        const dg = Math.max(0, Math.round(g * (1 - amount)));
        const db = Math.max(0, Math.round(b * (1 - amount)));
        const toHex = (n) => n.toString(16).padStart(2, '0');
        return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
    }

    const COMPLETED_COLOR = '#BFBFBF';
    const OVERDUE_COLOR = '#F87171';
    const SPECIAL_COLOR = config.assignmentSheet.defaultColor; // 紫色，跟「其他/特殊」共用同一色

    // options.showCompletionGray：完成度 100% 是否要顯示灰色。
    // 「美術專案工作分配表」不套用(false)，「美術組專案執行狀況」才套用(true)，
    // 且只有狀態是「準時」時，完成度 100% 才會變灰色；警戒/超時/特殊即使做到 100% 也維持該狀態該有的顏色。
    function computeCellDisplayColor(baseColor, statusMetaEntry, options = {}) {
        const status = (statusMetaEntry && statusMetaEntry.status) || '準時';
        const completion = (statusMetaEntry && statusMetaEntry.completion) || 0;
        if (options.showCompletionGray && completion >= 100 && status === '準時') return COMPLETED_COLOR;
        if (status === '超時') return OVERDUE_COLOR;
        if (status === '警戒') return darkenColor(baseColor || '#ffffff');
        if (status === '特殊') return SPECIAL_COLOR;
        return baseColor; // 準時：不改色
    }

    // 依專案名稱開頭的關鍵字分類分色，並取出名稱中的數字供排序使用
    const platformGroups = [
        { key: 'YGR', test: /^YGR/i, color: '#C9DAF8' },   // 藍
        { key: 'POP', test: /^POP/i, color: '#eedcf1' },   // 紅紫
        { key: '888', test: /^888/i, color: '#D0E0E3' },   // 青
        { key: 'APEX', test: /^APEX/i, color: '#FCE5CD' }, // 橘
        { key: 'A+', test: /^A\+/i, color: '#F4CCCC' },    // 粉紅
        { key: 'Stake', test: /^Stake/i, color: '#cfcaff' },    // 藍紫
    ];
    const otherGroupColor = '#E2E2E2'; // 其他(不符合以上關鍵字的專案，例如美術圖庫)

    function getPlatformGroup(projectName) {
        const name = (projectName || '').trim();
        for (let i = 0; i < platformGroups.length; i++) {
            if (platformGroups[i].test.test(name)) return { index: i, ...platformGroups[i] };
        }
        return { index: platformGroups.length, key: 'OTHER', color: otherGroupColor };
    }

    function extractSortNumber(projectName) {
        const match = (projectName || '').match(/\d+/);
        return match ? parseInt(match[0], 10) : -1; // 沒有數字的(如公版GUI)排最前面
    }

    function getSortedRows() {
        return [...assignmentSheet.rows].sort((a, b) => {
            const ga = getPlatformGroup(a.projectName).index;
            const gb = getPlatformGroup(b.projectName).index;
            if (ga !== gb) return ga - gb;
            return extractSortNumber(a.projectName) - extractSortNumber(b.projectName);
        });
    }

    // 讓輸入框寬度自動貼合文字內容(用 canvas 量測實際文字寬度，中英文長度都準)
    const _measureCanvas = document.createElement('canvas');
    const _measureCtx = _measureCanvas.getContext('2d');
    function autosizeInput(input, minPx = 50) {
        const style = window.getComputedStyle(input);
        _measureCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const text = input.value || input.placeholder || '';
        const textWidth = _measureCtx.measureText(text).width;
        const paddingLR = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        input.style.width = Math.max(minPx, Math.ceil(textWidth + paddingLR + 12)) + 'px';
    }

    function renderAssignHeader() {
        assignTableHeader.innerHTML = '';

        const thSelect = document.createElement('th');
        thSelect.className = 'col-select';
        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        selectAllCheckbox.title = '全選 / 取消全選';
        const sortedRowsForHeader = getSortedRows();
        selectAllCheckbox.checked = sortedRowsForHeader.length > 0 && sortedRowsForHeader.every(r => selectedAssignRowIds.has(r.id));
        selectAllCheckbox.addEventListener('change', () => {
            if (selectAllCheckbox.checked) {
                getSortedRows().forEach(r => selectedAssignRowIds.add(r.id));
            } else {
                selectedAssignRowIds.clear();
            }
            renderAssignPage();
        });
        thSelect.appendChild(selectAllCheckbox);
        assignTableHeader.appendChild(thSelect);

        const cols = ['專案名稱', '上線日期', '企劃'];
        cols.forEach(label => {
            const th = document.createElement('th');
            th.textContent = label;
            assignTableHeader.appendChild(th);
        });
        config.personnel.forEach(p => {
            const th = document.createElement('th');
            th.textContent = p.name;
            th.className = p.status === 'inactive' ? 'person-inactive' : 'person-active';
            assignTableHeader.appendChild(th);
        });
    }

    function renderAssignPage() {
        renderAssignHeader();
        assignTableBody.innerHTML = '';

        getSortedRows().forEach(row => {
            const tr = document.createElement('tr');
            tr.dataset.platformKey = getPlatformGroup(row.projectName).key;
            if (selectedAssignRowIds.has(row.id)) tr.classList.add('row-selected');

            // 勾選欄(取代原本的 ✕ 刪除按鈕)
            const tdSelect = document.createElement('td');
            tdSelect.className = 'col-select';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selectedAssignRowIds.has(row.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedAssignRowIds.add(row.id);
                } else {
                    selectedAssignRowIds.delete(row.id);
                }
                tr.classList.toggle('row-selected', checkbox.checked);
                const selectAllCheckbox = assignTableHeader.querySelector('th.col-select input[type="checkbox"]');
                if (selectAllCheckbox) {
                    const allRows = getSortedRows();
                    selectAllCheckbox.checked = allRows.length > 0 && allRows.every(r => selectedAssignRowIds.has(r.id));
                }
            });
            tdSelect.appendChild(checkbox);
            tr.appendChild(tdSelect);

            // 專案名稱 (依開頭關鍵字自動分色) / 上線日期 / 企劃
            const projectCell = makeTextCell(row, 'projectName', 'col-project');
            const projectInput = projectCell.querySelector('input');
            const applyGroupColor = () => {
                projectCell.style.backgroundColor = getPlatformGroup(projectInput.value).color;
            };
            applyGroupColor();
            projectInput.addEventListener('input', applyGroupColor);
            tr.appendChild(projectCell);
            tr.appendChild(makeTextCell(row, 'onlineDate', 'col-date'));
            tr.appendChild(makeTextCell(row, 'planner', 'col-planner'));

            // 每位人員的角色欄位
            config.personnel.forEach(p => {
                const td = document.createElement('td');
                td.className = 'cell-role';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = row.cells[p.name] || '';
                input.placeholder = '';
                const applyColor = () => {
                    const baseColor = getRoleColor(input.value.trim());
                    td.style.backgroundColor = computeCellDisplayColor(baseColor, row.statusMeta[p.name]);
                };
                applyColor();
                input.addEventListener('input', () => {
                    applyColor();
                    autosizeInput(input);
                });
                input.addEventListener('change', () => {
                    row.cells[p.name] = input.value.trim();
                    saveData();
                });
                td.appendChild(input);
                tr.appendChild(td);
            });

            assignTableBody.appendChild(tr);
        });

        // 全部列都掛上 DOM 之後，統一重新量測寬度一次
        // (元素還沒掛上 DOM 前，getComputedStyle 量到的字型不準，量出來的寬度會太小、造成文字被切斷)
        assignTableBody.querySelectorAll('input[type="text"]').forEach(inp => autosizeInput(inp));
    }

    function makeTextCell(row, field, className) {
        const td = document.createElement('td');
        td.className = className;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = row[field] || '';
        input.addEventListener('input', () => autosizeInput(input));
        input.addEventListener('change', () => {
            row[field] = input.value;
            saveData();
        });
        td.appendChild(input);
        return td;
    }

    addRowBtn.addEventListener('click', () => {
        // 彈出對話框詢問專案名稱，比照工時試算表的做法
        const newProjName = prompt("請輸入新專案名稱 (例如：麻將大對決)：");
        
        // 如果使用者按取消或沒有輸入內容，就直接中斷，不新增資料列
        if (!newProjName || !newProjName.trim()) return;

        // 建立新的空白列物件
        const newRow = makeBlankRow();
        
        // 將使用者輸入並去除前後空白的名稱，指定給該列的 projectName 屬性
        newRow.projectName = newProjName.trim();
        
        // 將這筆新資料推入分配表陣列中並存檔
        assignmentSheet.rows.push(newRow);
        saveData();
    });

    deleteRowsBtn.addEventListener('click', () => {
        if (selectedAssignRowIds.size === 0) {
            alert('請先勾選要刪除的專案列(表格最左邊那一欄)。');
            return;
        }

        const targetRows = assignmentSheet.rows.filter(r => selectedAssignRowIds.has(r.id));
        const names = targetRows.map(r => r.projectName || '(未命名專案)').join('、');
        if (!confirm(`確定要刪除已勾選的 ${targetRows.length} 個項目嗎？且無法復原。\n\n${names}`)) return;

        assignmentSheet.rows = assignmentSheet.rows.filter(r => !selectedAssignRowIds.has(r.id));
        selectedAssignRowIds.clear();
        saveData();
    });

    toggleImportBtn.addEventListener('click', () => {
        importPanel.style.display = importPanel.style.display === 'block' ? 'none' : 'block';
    });

    importCancelBtn.addEventListener('click', () => {
        importText.value = '';
        importPanel.style.display = 'none';
    });

    importConfirmBtn.addEventListener('click', () => {
        const raw = importText.value;
        if (!raw.trim()) { importPanel.style.display = 'none'; return; }

        const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
        const newRows = lines.map(line => {
            const fields = line.split('\t');
            const row = makeBlankRow();
            row.projectName = (fields[0] || '').trim();
            row.onlineDate = (fields[1] || '').trim();
            row.planner = (fields[2] || '').trim();
            config.personnel.forEach((p, idx) => {
                const val = (fields[3 + idx] || '').trim();
                if (val) row.cells[p.name] = val;
            });
            return row;
        });

        assignmentSheet.rows = assignmentSheet.rows.concat(newRows);
        saveData();
        importText.value = '';
        importPanel.style.display = 'none';
    });

    /* =========================================================
       頁籤二：美術組工作分配與進度表 (工時試算)
    ========================================================= */
    const projectSelect = document.getElementById('projectSelect');
    const categorySelect = document.getElementById('categorySelect');
    const addProjectBtn = document.getElementById('addProjectBtn');
    const renameProjectBtn = document.getElementById('renameProjectBtn');
    const deleteProjectBtn = document.getElementById('deleteProjectBtn');
    const discountSelect = document.getElementById('discountSelect');
    const taskTableBody = document.querySelector('#taskTable tbody');
    const toggleImportBtnEstimate = document.getElementById('toggleImportBtnEstimate');
    const copyEstimateBtn = document.getElementById('copyEstimateBtn');
    const copyQtyBtn = document.getElementById('copyQtyBtn');
    const importPanelEstimate = document.getElementById('importPanelEstimate');
    const importTextEstimate = document.getElementById('importTextEstimate');
    const importConfirmBtnEstimate = document.getElementById('importConfirmBtnEstimate');
    const importCancelBtnEstimate = document.getElementById('importCancelBtnEstimate');
    const importTargetProjectName = document.getElementById('importTargetProjectName');

    config.discountTiers.forEach(tier => {
        const option = document.createElement('option');
        option.value = tier.value;
        option.textContent = tier.label;
        discountSelect.appendChild(option);
    });

    // 分類篩選：先選平台分類，再選該分類底下的專案
    const categoryOptions = [
        { value: 'ALL', label: '全部' },
        ...platformGroups.map(g => ({ value: g.key, label: g.key })),
        { value: 'OTHER', label: '其他' }
    ];
    categoryOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        categorySelect.appendChild(option);
    });
    categorySelect.value = 'ALL';

    function getFilteredSortedProjectNames() {
        const selectedCategory = categorySelect.value;
        return Object.keys(allProjects)
            .filter(name => selectedCategory === 'ALL' || getPlatformGroup(name).key === selectedCategory)
            .sort((a, b) => {
                const ga = getPlatformGroup(a).index;
                const gb = getPlatformGroup(b).index;
                if (ga !== gb) return ga - gb;
                return extractSortNumber(a) - extractSortNumber(b);
            });
    }

    function updateProjectSelectUI() {
        projectSelect.innerHTML = '';

        const names = getFilteredSortedProjectNames();
        let hasCurrent = false;
        names.forEach(projName => {
            const option = document.createElement('option');
            option.value = projName;
            option.textContent = projName;
            if (projName === currentProjectName) {
                option.selected = true;
                hasCurrent = true;
            }
            projectSelect.appendChild(option);
        });

        if (!hasCurrent && names.length > 0) {
            currentProjectName = names[0];
            projectSelect.value = currentProjectName;
        }
    }

    categorySelect.addEventListener('change', () => {
        updateProjectSelectUI();
        renderEstimatePage();
    });

    // 依「專案名稱」比對頁籤一的分配表，自動取得該專案已指派的人員名單，
    // 依角色關鍵字分成 設定/動畫/廣宣 三組
    function getProjectAssignees(projectName) {
        const settingSet = new Set();
        const animationSet = new Set();
        const promoSet = new Set();

        assignmentSheet.rows
            .filter(row => (row.projectName || '').trim() === projectName.trim())
            .forEach(row => {
                config.personnel.forEach(p => {
                    const val = (row.cells[p.name] || '').trim();
                    if (!val) return;
                    if (val.includes('前製設定')) settingSet.add(p.name);
                    if (val.includes('後製動畫')) animationSet.add(p.name);
                    if (val.includes('廣宣')) promoSet.add(p.name);
                });
            });

        return {
            setting: [...settingSet],
            animation: [...animationSet],
            promo: [...promoSet]
        };
    }

    function assigneesForCategory(projectAssignees, categoryKey) {
        if (categoryKey === 'setting') return projectAssignees.setting;
        if (categoryKey === 'animation') return projectAssignees.animation;
        if (categoryKey === 'promo') return projectAssignees.promo;
        // shared：設定與動畫都可能參與，兩邊取聯集
        return [...new Set([...projectAssignees.setting, ...projectAssignees.animation])];
    }

    // 依目前的折數與數量，算出每一列(工項 + 結算列 + 總計列)的設定/動畫預估工時，
    // 順序跟畫面上顯示的一致，給「複製設定/動畫預估」按鈕使用
    function computeEstimateRows(currentProj, tierKey) {
        const assignments = currentProj.assignments || {};
        const rows = [];
        let grandSetting = 0;
        let grandAnimation = 0;
        let subtotalInserted = false;

        for (const [taskName, taskData] of Object.entries(config.baseTasks)) {
            if (taskData.category === 'promo' && !subtotalInserted) {
                rows.push({ setting: grandSetting, animation: grandAnimation });
                subtotalInserted = true;
            }
            const taskInfo = assignments[taskName] || { qty: 1 };
            const qty = taskInfo.qty !== undefined ? taskInfo.qty : 1;
            const settingBase = taskData.setting[tierKey] !== undefined ? taskData.setting[tierKey] : 0;
            const animationBase = taskData.animation[tierKey] !== undefined ? taskData.animation[tierKey] : 0;
            const settingEstimated = parseFloat((settingBase * qty).toFixed(2));
            const animationEstimated = parseFloat((animationBase * qty).toFixed(2));
            grandSetting += settingEstimated;
            grandAnimation += animationEstimated;
            rows.push({ setting: settingEstimated, animation: animationEstimated });
        }

        if (!subtotalInserted) {
            rows.push({ setting: grandSetting, animation: grandAnimation });
        }
        rows.push({ setting: grandSetting, animation: grandAnimation }); // 專案開發加總(加上廣宣)

        return rows;
    }

    function renderEstimatePage() {
        if (!allProjects[currentProjectName]) return;

        const currentProj = allProjects[currentProjectName];
        importTargetProjectName.textContent = currentProjectName;

        // 折數與專案綁定：每個專案各自記住自己的折數，切換專案時一定要跟著換，
        // 沒設定過的專案預設為 10折 (100%)
        const projectTier = currentProj.discountTier !== undefined ? currentProj.discountTier : 1.0;
        discountSelect.value = projectTier;
        if (currentProj.discountTier === undefined) {
            currentProj.discountTier = projectTier;
        }

        const currentTier = projectTier;
        const tierKey = String(currentTier);
        const projectAssignees = getProjectAssignees(currentProjectName);

        taskTableBody.innerHTML = '';
        let grandTotalSetting = 0;
        let grandTotalAnimation = 0;
        const assignments = currentProj.assignments || {};
        let subtotalInserted = false;

        function appendSubtotalRow(label, settingTotal, animationTotal) {
            const subtotalRow = document.createElement('tr');
            subtotalRow.style.backgroundColor = '#FFF3CD';
            subtotalRow.innerHTML = `
                <td colspan="4" style="text-align: right; font-weight: bold;">${label}：</td>
                <td style="color: #b8860b; font-weight: bold;">${settingTotal.toFixed(2)} 天</td>
                <td style="color: #b8860b; font-weight: bold;">${animationTotal.toFixed(2)} 天</td>
                <td></td>
            `;
            taskTableBody.appendChild(subtotalRow);
        }

        for (const [taskName, taskData] of Object.entries(config.baseTasks)) {
            const categoryKey = taskData.category;
            const bgColor = config.categories[categoryKey].bgColor;

            // 比照 Excel，在「CP會議調整項目」與「廣宣製作」之間插入一個結算列：
            // 「專案開發加總」= 廣宣類工項以外，目前累積的設定/動畫工時小計
            if (categoryKey === 'promo' && !subtotalInserted) {
                appendSubtotalRow('專案開發加總', grandTotalSetting, grandTotalAnimation);
                subtotalInserted = true;
            }

            const taskInfo = assignments[taskName] || { qty: 1 };
            const currentQty = taskInfo.qty !== undefined ? taskInfo.qty : 1;

            // 該折數下的基礎工時 (比照 Excel，每個折數各自登記的數字，而非用比例硬算)
            const settingBase = taskData.setting[tierKey] !== undefined ? taskData.setting[tierKey] : 0;
            const animationBase = taskData.animation[tierKey] !== undefined ? taskData.animation[tierKey] : 0;

            // 設定預估與動畫預估分開計算 (該折數的基礎工時 x 數量)
            const settingEstimated = (settingBase * currentQty).toFixed(2);
            const animationEstimated = (animationBase * currentQty).toFixed(2);

            grandTotalSetting += parseFloat(settingEstimated);
            grandTotalAnimation += parseFloat(animationEstimated);

            const tr = document.createElement('tr');
            const rowBg = currentQty === 0 ? "#f2f2f2" : bgColor;

            const qtyHTML = `<input type="number" class="qty-input" data-task="${taskName}" value="${currentQty}" min="0" step="1">`;

            const assignees = assigneesForCategory(projectAssignees, categoryKey);
            const assigneeHTML = assignees.length
                ? `<div class="assignee-tags">${assignees.map(name => `<span class="assignee-tag">${name}</span>`).join('')}</div>`
                : `<span class="assignee-empty">尚未在分配表指派</span>`;

            tr.innerHTML = `
                <td class="col-base">${taskName}</td>
                <td class="col-base">${settingBase}</td>
                <td class="col-base">${animationBase}</td>
                <td class="col-divider" style="background-color:${rowBg};">${qtyHTML}</td>
                <td style="background-color:${rowBg}; color: ${currentQty === 0 ? '#999' : '#2c662d'}; font-weight: bold;">${settingEstimated}</td>
                <td style="background-color:${rowBg}; color: ${currentQty === 0 ? '#999' : '#2c662d'}; font-weight: bold;">${animationEstimated}</td>
                <td style="background-color:${rowBg};">${assigneeHTML}</td>
            `;
            taskTableBody.appendChild(tr);
        }

        // 萬一清單裡完全沒有 promo 類工項(理論上不會發生)，保底還是要顯示這個小計列
        if (!subtotalInserted) {
            appendSubtotalRow('專案開發加總', grandTotalSetting, grandTotalAnimation);
        }

        const totalRow = document.createElement('tr');
        totalRow.style.backgroundColor = '#FFF3CD';
        totalRow.innerHTML = `
            <td colspan="4" style="text-align: right; font-weight: bold;">專案開發加總(加上廣宣)：</td>
            <td style="color: #d32f2f; font-weight: bold; font-size: 1.05em;">設定: ${grandTotalSetting.toFixed(2)} 天</td>
            <td style="color: #d32f2f; font-weight: bold; font-size: 1.05em;">動畫: ${grandTotalAnimation.toFixed(2)} 天</td>
            <td></td>
        `;
        taskTableBody.appendChild(totalRow);

        document.querySelectorAll('.qty-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const task = e.target.getAttribute('data-task');
                if (!allProjects[currentProjectName].assignments[task]) {
                    allProjects[currentProjectName].assignments[task] = { qty: 1 };
                }
                allProjects[currentProjectName].assignments[task].qty = parseFloat(e.target.value) || 0;
                saveData();
            });
        });
    }

    discountSelect.addEventListener('change', (e) => {
        if (allProjects[currentProjectName]) {
            allProjects[currentProjectName].discountTier = parseFloat(e.target.value);
            saveData();
        } else {
            renderEstimatePage();
        }
    });

    projectSelect.addEventListener('change', (e) => {
        currentProjectName = e.target.value;
        renderEstimatePage();
    });

    addProjectBtn.addEventListener('click', () => {
        const newProjName = prompt("請輸入新專案名稱 (例如：麻將大對決)：");
        if (!newProjName || !newProjName.trim()) return;

        const trimmedName = newProjName.trim();
        if (allProjects[trimmedName]) {
            alert("此專案名稱已存在！");
            return;
        }

        allProjects[trimmedName] = {
            discountTier: 1.0,
            assignments: {}
        };

        // 同步在頁籤一「美術組工作分配表」建立同名的空白列，
        // 避免每次開新專案要分別在兩個頁籤各新增一次。如果分配表裡已經有同名的列(例如反過來，
        // 先在分配表建立了專案，才來這裡建工時試算)，就不重複新增。
        const alreadyInAssignSheet = assignmentSheet.rows.some(r => (r.projectName || '').trim() === trimmedName);
        if (!alreadyInAssignSheet) {
            const newRow = makeBlankRow();
            newRow.projectName = trimmedName;
            assignmentSheet.rows.push(newRow);
        }

        currentProjectName = trimmedName;
        categorySelect.value = 'ALL';
        saveData();
    });

    renameProjectBtn.addEventListener('click', () => {
        if (!allProjects[currentProjectName]) return;

        const newProjName = prompt("請輸入新的專案名稱：", currentProjectName);
        if (!newProjName || !newProjName.trim()) return;

        const trimmedName = newProjName.trim();
        if (trimmedName === currentProjectName) return;

        if (allProjects[trimmedName]) {
            alert("此專案名稱已存在！");
            return;
        }

        allProjects[trimmedName] = allProjects[currentProjectName];
        delete allProjects[currentProjectName];

        // 同步更新頁籤一「美術組工作分配表」裡同名的列，讓兩邊的專案名稱保持一致
        // (理論上專案名稱不會重複，但為了保險，符合的列全部一起改名)
        assignmentSheet.rows.forEach(r => {
            if ((r.projectName || '').trim() === currentProjectName) {
                r.projectName = trimmedName;
            }
        });

        currentProjectName = trimmedName;
        categorySelect.value = 'ALL';
        saveData();
    });

    deleteProjectBtn.addEventListener('click', () => {
        if (!allProjects[currentProjectName]) return;

        // 注意：這裡故意不自動刪除頁籤一「美術組工作分配表」裡同名的列，
        // 因為那一列除了專案名稱以外，通常還有上線日期、企劃、每個人的任務分配等資料，
        // 直接連動刪除風險較高(誤刪就救不回來)，所以只在確認訊息裡提醒使用者，交由使用者自行決定是否要手動刪除。
        if (!confirm(`確定要刪除專案「${currentProjectName}」嗎？這個專案的工時試算資料會一併刪除，且無法復原。\n\n(提醒：「美術組工作分配表」裡同名的那一列不會被自動刪除，如果也不需要了，請自行到那邊手動刪除)`)) return;

        delete allProjects[currentProjectName];

        const remaining = Object.keys(allProjects);
        if (remaining.length > 0) {
            categorySelect.value = 'ALL';
            currentProjectName = getFilteredSortedProjectNames()[0] || remaining[0];
        } else {
            currentProjectName = "預設專案";
            allProjects[currentProjectName] = { discountTier: 1.0, assignments: {} };
        }
        saveData();
    });

    toggleImportBtnEstimate.addEventListener('click', () => {
        importTargetProjectName.textContent = currentProjectName;
        importPanelEstimate.style.display = importPanelEstimate.style.display === 'block' ? 'none' : 'block';
    });

    copyEstimateBtn.addEventListener('click', async () => {
        if (!allProjects[currentProjectName]) return;

        const currentProj = allProjects[currentProjectName];
        const tier = currentProj.discountTier !== undefined ? currentProj.discountTier : 1.0;
        const rows = computeEstimateRows(currentProj, String(tier));
        const text = rows.map(r => `${r.setting.toFixed(2)}\t${r.animation.toFixed(2)}`).join('\n');

        try {
            await navigator.clipboard.writeText(text);
            alert(`已複製「${currentProjectName}」的設定/動畫預估工時(共 ${rows.length} 列，含「專案開發加總」與「專案開發加總(加上廣宣)」結算列)到剪貼簿。\n\n可以直接貼到 Excel 對應專案的「設定工時」「動畫工時」兩欄，列的順序跟原本工項清單一致。`);
        } catch (err) {
            console.error('複製到剪貼簿失敗：', err);
            alert('複製失敗，你的瀏覽器可能不允許自動存取剪貼簿。請改用手動選取表格內容複製。');
        }
    });

    copyQtyBtn.addEventListener('click', async () => {
        if (!allProjects[currentProjectName]) return;

        const currentProj = allProjects[currentProjectName];
        const assignments = currentProj.assignments || {};
        const rows = [];

        // 依序抓出所有工項名稱與對應的數量
        for (const taskName of Object.keys(config.baseTasks)) {
            const taskInfo = assignments[taskName] || { qty: 1 };
            // 如果數量沒被修改過，預設就是 1
            const qty = taskInfo.qty !== undefined ? taskInfo.qty : 1; 
            // 結合成 "工項名稱(Tab)數量" 的格式，正好對應匯入功能
            rows.push(`${taskName}\t${qty}`);
        }

        const text = rows.join('\n');

        try {
            await navigator.clipboard.writeText(text);
            alert(`已複製「${currentProjectName}」的數量設定到剪貼簿。\n\n可以直接貼到 Excel，或是用「從 Excel 貼上匯入」功能貼回來。`);
        } catch (err) {
            console.error('複製到剪貼簿失敗：', err);
            alert('複製失敗，你的瀏覽器可能不允許自動存取剪貼簿。請改用手動選取表格內容複製。');
        }
    });

    importCancelBtnEstimate.addEventListener('click', () => {
        importTextEstimate.value = '';
        importPanelEstimate.style.display = 'none';
    });

    importConfirmBtnEstimate.addEventListener('click', () => {
        if (!allProjects[currentProjectName]) return;

        const raw = importTextEstimate.value;
        if (!raw.trim()) { importPanelEstimate.style.display = 'none'; return; }

        // 工項名稱比對用：忽略前後空白
        const taskNameLookup = {};
        Object.keys(config.baseTasks).forEach(name => {
            taskNameLookup[name.trim()] = name;
        });

        const assignments = allProjects[currentProjectName].assignments;
        const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
        const notMatched = [];
        let matchedCount = 0;

        lines.forEach(line => {
            const fields = line.split('\t');
            const rawName = (fields[0] || '').trim();
            const qty = parseFloat(fields[1]);
            if (!rawName || isNaN(qty)) return;

            const taskName = taskNameLookup[rawName];
            if (!taskName) {
                notMatched.push(rawName);
                return;
            }
            if (!assignments[taskName]) {
                assignments[taskName] = { qty: 1 };
            }
            assignments[taskName].qty = qty;
            matchedCount++;
        });

        saveData();
        importTextEstimate.value = '';
        importPanelEstimate.style.display = 'none';

        if (notMatched.length > 0) {
            alert(`已匯入 ${matchedCount} 筆數量。\n\n以下 ${notMatched.length} 個工項名稱在清單裡找不到對應項目，請確認名稱是否一致：\n` + notMatched.join('、'));
        } else {
            alert(`已匯入 ${matchedCount} 筆數量到「${currentProjectName}」。`);
        }
    });

    /* =========================================================
       頁籤三：美術組專案執行狀況
    ========================================================= */
    const personPicker = document.getElementById('personPicker');
    const statusTableBody = document.getElementById('statusTableBody');
    const statusEmptyMsg = document.getElementById('statusEmptyMsg');

    let selectedPerson = null;

    function renderPersonPicker() {
        const activePeople = config.personnel.filter(p => p.status === 'active');

        if (!selectedPerson && activePeople.length > 0) {
            selectedPerson = activePeople[0].name;
        }

        personPicker.innerHTML = '';
        activePeople.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'person-btn' + (p.name === selectedPerson ? ' active' : '');
            btn.textContent = p.name;
            btn.addEventListener('click', () => {
                selectedPerson = p.name;
                renderStatusPage();
            });
            personPicker.appendChild(btn);
        });
    }

    // 算出某專案在工時試算表裡的目前折數下、含廣宣的總預估工時 (若這個專案還沒建立試算資料則回傳 null)
    function getProjectTotalEstimate(projectName) {
        const proj = allProjects[projectName];
        if (!proj) return null;
        const tier = proj.discountTier !== undefined ? proj.discountTier : 1.0;
        const rows = computeEstimateRows(proj, String(tier));
        const grandTotal = rows[rows.length - 1]; // 專案開發加總(加上廣宣)
        return { setting: grandTotal.setting, animation: grandTotal.animation };
    }

    function renderStatusPage() {
        renderPersonPicker();
        statusTableBody.innerHTML = '';

        if (!selectedPerson) {
            statusEmptyMsg.style.display = 'block';
            statusEmptyMsg.textContent = '目前沒有在職人員資料。';
            return;
        }

        const rows = getSortedRows().filter(row => (row.cells[selectedPerson] || '').trim() !== '');

        statusEmptyMsg.style.display = rows.length === 0 ? 'block' : 'none';
        statusEmptyMsg.textContent = '這個人目前在「美術專案工作分配表」裡沒有被指派任何專案。';

        rows.forEach(row => {
            const roleText = (row.cells[selectedPerson] || '').trim();
            const baseColor = getRoleColor(roleText);
            if (!row.statusMeta[selectedPerson]) {
                row.statusMeta[selectedPerson] = { status: '準時', completion: 0 };
            }
            const meta = row.statusMeta[selectedPerson];

            const tr = document.createElement('tr');
            const displayColor = computeCellDisplayColor(baseColor, meta, { showCompletionGray: true });
            tr.style.backgroundColor = displayColor;

            const tdName = document.createElement('td');
            tdName.textContent = row.projectName || '(未命名專案)';
            tdName.style.fontWeight = 'bold';
            tr.appendChild(tdName);

            // 上線日期：直接讀取「美術專案工作分配表」同一筆資料的 onlineDate，
            // 兩邊本來就是同一份 row 物件，這裡只是多顯示一欄，資料永遠自動同步，不用另外處理連動。
            const tdOnlineDate = document.createElement('td');
            tdOnlineDate.textContent = row.onlineDate || '--';
            tr.appendChild(tdOnlineDate);

            const tdRole = document.createElement('td');
            tdRole.textContent = roleText;
            tr.appendChild(tdRole);

            const tdTotal = document.createElement('td');
            const totalEstimate = getProjectTotalEstimate(row.projectName);
            tdTotal.textContent = totalEstimate
                ? `設定 ${totalEstimate.setting.toFixed(2)} 天／動畫 ${totalEstimate.animation.toFixed(2)} 天`
                : '尚未建立試算資料';
            tr.appendChild(tdTotal);

            const tdStatus = document.createElement('td');
            const statusSelect = document.createElement('select');
            config.executionStatusOptions.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                if (opt === meta.status) option.selected = true;
                statusSelect.appendChild(option);
            });
            statusSelect.addEventListener('change', () => {
                row.statusMeta[selectedPerson].status = statusSelect.value;
                saveData();
            });
            tdStatus.appendChild(statusSelect);
            tr.appendChild(tdStatus);

            const tdCompletion = document.createElement('td');
            const completionInput = document.createElement('input');
            completionInput.type = 'number';
            completionInput.min = '0';
            completionInput.max = '100';
            completionInput.step = '5';
            completionInput.value = meta.completion;
            completionInput.addEventListener('change', () => {
                let val = parseFloat(completionInput.value);
                if (isNaN(val)) val = 0;
                val = Math.max(0, Math.min(100, val));
                completionInput.value = val;
                row.statusMeta[selectedPerson].completion = val;
                saveData();
            });
            tdCompletion.appendChild(completionInput);
            tdCompletion.appendChild(document.createTextNode(' %'));
            tr.appendChild(tdCompletion);

            statusTableBody.appendChild(tr);
        });
    }

    /* =========================================================
       頁籤四：美術組預計工作項目
       完全是「即時算出來的檢視畫面」，不另外存資料：
       - 人員週報：取自頁籤零(週進度報告)最近兩個星期五
       - 待辦事項：專案清單取自頁籤一(工作分配表)，進度取自頁籤三(專案執行進度表)的前製設定/後製動畫完成度各佔 50%
    ========================================================= */
    const digestPersonTableHeader = document.getElementById('digestPersonTableHeader');
    const digestPersonTableBody = document.getElementById('digestPersonTableBody');
    const digestTodoTableBody = document.getElementById('digestTodoTableBody');
    const digestExportBtn = document.getElementById('digestExportBtn');

    // 找出「本週」的星期五(以今天所在的那個星期一~星期五為準)，跟「上週」的星期五(往前推 7 天)
    function getDigestWeekFridays(baseDate) {
        const d = new Date(baseDate);
        const day = d.getDay(); // 0=週日, 1=週一, ..., 6=週六
        const diffToMonday = (day === 0) ? -6 : (1 - day);
        const monday = new Date(d);
        monday.setDate(d.getDate() + diffToMonday);
        const thisFriday = new Date(monday);
        thisFriday.setDate(monday.getDate() + 4);
        const lastFriday = new Date(thisFriday);
        lastFriday.setDate(thisFriday.getDate() - 7);
        return { lastFriday, thisFriday };
    }

    function formatWeekRangeLabel(fridayDate) {
        const monday = new Date(fridayDate);
        monday.setDate(fridayDate.getDate() - 4);
        const fmt = d => `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
        return `${fmt(monday)}~${fmt(fridayDate)}`;
    }

    function getDigestPersonWeekData() {
        const { lastFriday, thisFriday } = getDigestWeekFridays(new Date());
        const lastKey = dateToKey(lastFriday);
        const thisKey = dateToKey(thisFriday);
        const weeks = weeklyReport.weeks || [];
        const lastWeek = weeks.find(w => w.date === lastKey);
        const thisWeek = weeks.find(w => w.date === thisKey);
        const activePeople = config.personnel.filter(p => p.status === 'active').map(p => p.name);
        return {
            lastLabel: formatWeekRangeLabel(lastFriday),
            thisLabel: formatWeekRangeLabel(thisFriday),
            people: activePeople,
            getCell: (person, which) => {
                const week = which === 'last' ? lastWeek : thisWeek;
                return week ? (week.cells[person] || '') : '';
            }
        };
    }

    function renderDigestPersonTable() {
        const data = getDigestPersonWeekData();

        digestPersonTableHeader.innerHTML = '';
        ['人員', `上週\n${data.lastLabel}`, `本週\n${data.thisLabel}`].forEach(label => {
            const th = document.createElement('th');
            th.style.whiteSpace = 'pre-line';
            th.textContent = label;
            digestPersonTableHeader.appendChild(th);
        });

        digestPersonTableBody.innerHTML = '';
        data.people.forEach(person => {
            const tr = document.createElement('tr');

            const tdName = document.createElement('td');
            tdName.className = 'digest-person-name';
            tdName.textContent = person;
            tr.appendChild(tdName);

            ['last', 'this'].forEach(which => {
                const td = document.createElement('td');
                td.className = 'digest-week-cell';
                td.textContent = data.getCell(person, which);
                tr.appendChild(td);
            });

            digestPersonTableBody.appendChild(tr);
        });
    }

    // 專案整體完成度 = 前製設定完成度(平均) * 50% + 後製動畫完成度(平均) * 50%
    // 找不到對應角色的人時，那一半視為 0%(尚未開始)
    function computeProjectOverallCompletion(row) {
        const settingCompletions = [];
        const animationCompletions = [];
        Object.keys(row.cells || {}).forEach(person => {
            const roleText = (row.cells[person] || '').trim();
            if (!roleText) return;
            const meta = row.statusMeta && row.statusMeta[person];
            const completion = meta ? (meta.completion || 0) : 0;
            if (roleText.includes('前製設定')) settingCompletions.push(completion);
            if (roleText.includes('後製動畫')) animationCompletions.push(completion);
        });
        const avg = arr => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
        return avg(settingCompletions) * 0.5 + avg(animationCompletions) * 0.5;
    }

    function completionToStatusLabel(pct) {
        if (pct >= 100) return '已完成';
        if (pct >= 96) return 'CP反饋調整中';
        if (pct >= 91) return '等待與程式對接';
        if (pct >= 50) return '後製執行中';
        return '設定執行中';
    }

    function getDigestTodoRows() {
        return getSortedRows()
            .filter(row => (row.projectName || '').trim() !== '')
            .map(row => {
                const completion = computeProjectOverallCompletion(row);
                return {
                    name: row.projectName.trim(),
                    completion,
                    status: completionToStatusLabel(completion)
                };
            });
    }

    function renderDigestTodoTable() {
        digestTodoTableBody.innerHTML = '';
        getDigestTodoRows().forEach(item => {
            const tr = document.createElement('tr');

            const tdName = document.createElement('td');
            tdName.textContent = item.name;
            tr.appendChild(tdName);

            const tdProgress = document.createElement('td');
            tdProgress.className = 'digest-todo-progress';
            tdProgress.textContent = item.completion.toFixed(0) + '%';
            tr.appendChild(tdProgress);

            const tdStatus = document.createElement('td');
            tdStatus.className = 'digest-todo-status';
            tdStatus.textContent = item.status;
            tr.appendChild(tdStatus);

            digestTodoTableBody.appendChild(tr);
        });
    }

    function renderDigestPage() {
        renderDigestPersonTable();
        renderDigestTodoTable();
    }

    digestExportBtn.addEventListener('click', () => {
        if (typeof XLSX === 'undefined') {
            alert('匯出功能需要的函式庫載入失敗，請確認 vendor/xlsx/xlsx.full.min.js 是否存在。');
            return;
        }

        const personData = getDigestPersonWeekData();
        const todoRows = getDigestTodoRows();

        const aoa = [];
        aoa.push(['人員', personData.lastLabel, personData.thisLabel]);
        personData.people.forEach(person => {
            aoa.push([person, personData.getCell(person, 'last'), personData.getCell(person, 'this')]);
        });
        aoa.push([]);
        aoa.push([]);
        aoa.push(['待辦事項', '項目', '項目進度', '狀態']);
        todoRows.forEach(item => {
            aoa.push(['', item.name, Math.round(item.completion) / 100, item.status]);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 12 }, { wch: 55 }, { wch: 55 }, { wch: 18 }];

        const today = new Date();
        const dateStamp = `${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(today.getDate())}`;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, dateStamp);
        XLSX.writeFile(wb, `美術組預計工作項目${dateStamp}.xlsx`);
    });

    /* =========================================================
       頁籤四：圖片壓縮工具 (純前端，圖片不會上傳到任何地方)
    ========================================================= */
    const compressFileInput = document.getElementById('compressFileInput');
    const compressDropzone = document.getElementById('compressDropzone');
    const compressFormatSelect = document.getElementById('compressFormatSelect');
    const compressFormatHint = document.getElementById('compressFormatHint');
    const compressQuality = document.getElementById('compressQuality');
    const compressQualityValue = document.getElementById('compressQualityValue');
    const compressStartBtn = document.getElementById('compressStartBtn');
    const compressDownloadAllBtn = document.getElementById('compressDownloadAllBtn');
    const compressClearBtn = document.getElementById('compressClearBtn');
    const compressFileCount = document.getElementById('compressFileCount');
    const compressResults = document.getElementById('compressResults');

    let selectedImageFiles = [];
    let compressedResults = []; // 這一輪壓縮成功的 {filename, blob}，給打包下載用

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // 通用的「拖進來之後、還沒開始處理前」縮圖預覽列，圖片/影片/放大三個頁籤共用。
    // container：放縮圖的容器 DOM；files：目前的檔案陣列；onRemove(index)：按 X 移除某一張時要做的事。
    function renderQueuePreview(container, files, onRemove) {
        container.innerHTML = '';
        files.forEach((file, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'queue-thumb';

            const isVideo = file.type.startsWith('video/');
            const media = document.createElement(isVideo ? 'video' : 'img');
            media.src = URL.createObjectURL(file);
            if (isVideo) {
                media.muted = true;
                media.preload = 'metadata';
                media.addEventListener('loadedmetadata', () => {
                    // 影片預設是黑畫面，強制跳到中間那一幀，讓縮圖看得出內容
                    media.currentTime = Math.min(0.5, (media.duration || 1) / 2);
                });
            }
            thumb.appendChild(media);

            const name = document.createElement('div');
            name.className = 'queue-thumb-name';
            name.textContent = file.name;
            thumb.appendChild(name);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'queue-thumb-remove';
            removeBtn.textContent = '✕';
            removeBtn.title = '從清單移除';
            removeBtn.addEventListener('click', () => onRemove(index));
            thumb.appendChild(removeBtn);

            container.appendChild(thumb);
        });
    }

    const compressQualityLabel = document.getElementById('compressQualityLabel');
    const compressQueuePreview = document.getElementById('compressQueuePreview');

    const formatHints = {
        auto: '',
        webp: '',
        jpeg: '',
        'png-lossy': '會把顏色數量降到指定色階(跟 TinyPNG 的調色盤壓縮原理相同)，右邊滑桿改成控制「保留色彩豐富度」；輸出仍是標準 PNG 檔，遊戲引擎可以直接用，透明也完整保留。',
        png: '⚠️ PNG 是無損格式，「畫質」設定不會影響它，重新編碼後常常反而比原檔大，這是正常現象，建議改選「PNG 最佳化」才能維持 PNG 格式又有效壓縮。'
    };
    function updateFormatHint() {
        compressFormatHint.textContent = formatHints[compressFormatSelect.value] || '';
        compressQualityLabel.textContent = compressFormatSelect.value === 'png-lossy' ? '保留色彩：' : '畫質：';
    }
    compressFormatSelect.addEventListener('change', updateFormatHint);
    updateFormatHint();

    function updateCompressFileCount() {
        compressFileCount.textContent = selectedImageFiles.length > 0
            ? `目前共 ${selectedImageFiles.length} 張圖片，按「開始壓縮」處理(可以繼續拖曳或選檔加入更多)`
            : '';
        renderQueuePreview(compressQueuePreview, selectedImageFiles, (index) => {
            selectedImageFiles.splice(index, 1);
            updateCompressFileCount();
        });
    }


    // 把新選到的檔案加進清單(累加，不會蓋掉之前拖進來的)，只留下圖片檔
    function addFilesToQueue(fileList) {
        const files = Array.from(fileList || []).filter(f => f.type === 'image/png' || f.type === 'image/jpeg');
        if (files.length === 0) return;
        selectedImageFiles = selectedImageFiles.concat(files);
        updateCompressFileCount();
    }

    compressQuality.addEventListener('input', () => {
        compressQualityValue.textContent = compressQuality.value;
    });

    compressFileInput.addEventListener('change', () => {
        addFilesToQueue(compressFileInput.files);
        compressFileInput.value = ''; // 清空 input，讓同一批檔案可以重複選取觸發 change
    });

    compressDropzone.addEventListener('click', () => {
        compressFileInput.click();
    });

    compressDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        compressDropzone.classList.add('dragover');
    });

    compressDropzone.addEventListener('dragleave', () => {
        compressDropzone.classList.remove('dragover');
    });

    compressDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        compressDropzone.classList.remove('dragover');
        addFilesToQueue(e.dataTransfer.files);
    });

    compressClearBtn.addEventListener('click', () => {
        selectedImageFiles = [];
        compressedResults = [];
        compressFileInput.value = '';
        compressFileCount.textContent = '';
        compressQueuePreview.innerHTML = '';
        compressResults.innerHTML = '';
    });

    function resolveOutputMime(file, formatChoice) {
        if (formatChoice === 'webp') return 'image/webp';
        if (formatChoice === 'jpeg') return 'image/jpeg';
        if (formatChoice === 'png') return 'image/png';
        // auto：PNG 建議走「PNG 最佳化」(維持 PNG 格式、有損調色盤壓縮)，JPG 維持 JPEG
        return file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    }

    // 畫質(10~95) 換算成調色盤色階數(16~256)，給「PNG 最佳化」模式用
    function qualityToColorCount(qualityPercent) {
        const clamped = Math.min(95, Math.max(10, qualityPercent));
        return Math.round(16 + ((clamped - 10) / (95 - 10)) * (256 - 16));
    }

    function compressOneImage(file, formatChoice, qualityPercent) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');

                    const usePngLossy = formatChoice === 'png-lossy'
                        || (formatChoice === 'auto' && file.type === 'image/png');
                    const outputMime = usePngLossy ? 'image/png' : resolveOutputMime(file, formatChoice);

                    // JPEG 不支援透明，畫布預設是透明的，轉 JPEG 前先鋪白色底，避免變黑底
                    if (outputMime === 'image/jpeg') {
                        ctx.fillStyle = '#FFFFFF';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }
                    ctx.drawImage(img, 0, 0);

                    if (usePngLossy) {
                        if (typeof UPNG === 'undefined') {
                            URL.revokeObjectURL(objectUrl);
                            reject(new Error('PNG 最佳化功能需要載入 UPNG 函式庫，請確認網路連線後重新整理頁面。'));
                            return;
                        }
                        const colorCount = qualityToColorCount(qualityPercent);
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const pngBuffer = UPNG.encode([imageData.data.buffer], canvas.width, canvas.height, colorCount);
                        URL.revokeObjectURL(objectUrl);
                        resolve({
                            blob: new Blob([pngBuffer], { type: 'image/png' }),
                            mime: 'image/png',
                            width: canvas.width,
                            height: canvas.height,
                            extraNote: `${colorCount} 色調色盤(類似 TinyPNG)`
                        });
                        return;
                    }

                    const quality = Math.min(1, Math.max(0.1, qualityPercent / 100));
                    canvas.toBlob((blob) => {
                        URL.revokeObjectURL(objectUrl);
                        if (!blob) {
                            reject(new Error('瀏覽器不支援輸出這個格式'));
                            return;
                        }
                        resolve({
                            blob,
                            mime: outputMime,
                            width: canvas.width,
                            height: canvas.height
                        });
                    }, outputMime, quality);
                } catch (err) {
                    URL.revokeObjectURL(objectUrl);
                    reject(err);
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('圖片讀取失敗'));
            };
            img.src = objectUrl;
        });
    }

    function extensionForMime(mime) {
        if (mime === 'image/webp') return 'webp';
        if (mime === 'image/jpeg') return 'jpg';
        if (mime === 'image/png') return 'png';
        return 'img';
    }

    function stripExtension(filename) {
        const idx = filename.lastIndexOf('.');
        return idx > 0 ? filename.slice(0, idx) : filename;
    }

    function makeStatusCard(file) {
        const card = document.createElement('div');
        card.className = 'compress-card';
        const statusLine = document.createElement('div');
        statusLine.className = 'status-line';
        statusLine.textContent = `⏳ 壓縮中：${file.name}`;
        card.appendChild(statusLine);
        return { card, statusLine };
    }

    function fillResultCard(card, file, result, downloadName) {
        card.innerHTML = '';

        const img = document.createElement('img');
        img.src = URL.createObjectURL(result.blob);
        card.appendChild(img);

        const info = document.createElement('div');
        info.className = 'info';

        const fname = document.createElement('div');
        fname.className = 'fname';
        fname.textContent = file.name;
        info.appendChild(fname);

        const originalRow = document.createElement('div');
        originalRow.className = 'size-row';
        originalRow.textContent = `原始：${formatBytes(file.size)}`;
        info.appendChild(originalRow);

        const compressedRow = document.createElement('div');
        compressedRow.className = 'size-row';
        compressedRow.textContent = `壓縮後：${formatBytes(result.blob.size)} (${result.mime.replace('image/', '')})`;
        info.appendChild(compressedRow);

        if (result.extraNote) {
            const noteRow = document.createElement('div');
            noteRow.className = 'size-row';
            noteRow.textContent = result.extraNote;
            info.appendChild(noteRow);
        }

        const savedPercent = file.size > 0 ? (1 - result.blob.size / file.size) * 100 : 0;
        const savedRow = document.createElement('div');
        if (savedPercent >= 0) {
            savedRow.className = 'saved';
            savedRow.textContent = `省下 ${savedPercent.toFixed(0)}%`;
        } else {
            savedRow.className = 'saved warn';
            let reason;
            if (result.extraNote) {
                reason = '(可以把「保留色彩」調低一點，色階數愈少檔案愈小)';
            } else if (result.mime === 'image/png') {
                reason = '(PNG 是無損格式，重新編碼常常反而變大，建議改選「PNG 最佳化」或 WebP)';
            } else {
                reason = '(可調低畫質或換格式)';
            }
            savedRow.textContent = `比原檔還大 ${Math.abs(savedPercent).toFixed(0)}% ${reason}`;
        }
        info.appendChild(savedRow);

        card.appendChild(info);

        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'download-btn';
        downloadBtn.textContent = '⬇ 下載';
        downloadBtn.href = URL.createObjectURL(result.blob);
        downloadBtn.download = downloadName;
        card.appendChild(downloadBtn);
    }

    compressStartBtn.addEventListener('click', async () => {
        if (selectedImageFiles.length === 0) {
            alert('請先選擇要壓縮的圖片(JPG 或 PNG)。');
            return;
        }

        compressResults.innerHTML = '';
        compressedResults = [];
        const formatChoice = compressFormatSelect.value;
        const qualityPercent = parseInt(compressQuality.value, 10);

        const cardRefs = selectedImageFiles.map(file => {
            const { card } = makeStatusCard(file);
            compressResults.appendChild(card);
            return card;
        });

        for (let i = 0; i < selectedImageFiles.length; i++) {
            const file = selectedImageFiles[i];
            const card = cardRefs[i];
            try {
                const result = await compressOneImage(file, formatChoice, qualityPercent);
                const downloadName = `${stripExtension(file.name)}_compressed.${extensionForMime(result.mime)}`;
                fillResultCard(card, file, result, downloadName);
                compressedResults.push({ filename: downloadName, blob: result.blob });
            } catch (err) {
                console.error('壓縮失敗：', file.name, err);
                const reason = (err && err.message) ? err.message : '未知錯誤';
                card.innerHTML = `<div class="status-line">❌ ${file.name} 壓縮失敗<br>${reason}</div>`;
            }
        }
    });

    compressDownloadAllBtn.addEventListener('click', async () => {
        if (compressedResults.length === 0) {
            alert('目前還沒有壓縮完成的圖片，請先按「開始壓縮」。');
            return;
        }
        if (typeof JSZip === 'undefined') {
            alert('打包功能需要載入 JSZip 函式庫，請確認網路連線正常後重新整理頁面再試一次。');
            return;
        }

        compressDownloadAllBtn.disabled = true;
        compressDownloadAllBtn.textContent = '打包中...';

        try {
            const zip = new JSZip();
            const usedNames = new Set();

            compressedResults.forEach(item => {
                let name = item.filename;
                let counter = 1;
                while (usedNames.has(name)) {
                    name = item.filename.replace(/(\.[^.]+)$/, `_${counter}$1`);
                    counter++;
                }
                usedNames.add(name);
                zip.file(name, item.blob);
            });

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `壓縮圖片_${compressedResults.length}張.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('打包失敗：', err);
            alert('打包失敗，請稍後再試一次。');
        } finally {
            compressDownloadAllBtn.disabled = false;
            compressDownloadAllBtn.textContent = '📦 打包下載全部(ZIP)';
        }
    });

    /* =========================================================
       頁籤五：影片壓縮工具 (純前端，用 ffmpeg.wasm 在瀏覽器裡跑)
    ========================================================= */
    const videoFileInput = document.getElementById('videoFileInput');
    const videoDropzone = document.getElementById('videoDropzone');
    const videoFormatSelect = document.getElementById('videoFormatSelect');
    const videoQuality = document.getElementById('videoQuality');
    const videoQualityValue = document.getElementById('videoQualityValue');
    const videoStartBtn = document.getElementById('videoStartBtn');
    const videoDownloadAllBtn = document.getElementById('videoDownloadAllBtn');
    const videoClearBtn = document.getElementById('videoClearBtn');
    const videoFileCount = document.getElementById('videoFileCount');
    const videoEngineStatus = document.getElementById('videoEngineStatus');
    const videoResults = document.getElementById('videoResults');
    const videoDiagLine = document.getElementById('videoDiagLine');
    const videoDebugLog = document.getElementById('videoDebugLog');

    let selectedVideoFiles = [];
    let compressedVideoResults = [];
    let ffmpegInstance = null;
    let ffmpegLoadPromise = null;

    // 把診斷訊息同時寫進畫面上的記錄框跟瀏覽器主控台，不用開 F12 也看得到
    function logVideoDebug(msg) {
        const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        const line = `[${time}] ${msg}`;
        console.log('[影片壓縮]', msg);
        if (videoDebugLog) {
            videoDebugLog.textContent += line + '\n';
            videoDebugLog.scrollTop = videoDebugLog.scrollHeight;
        }
    }

    // 頁面一載入就先記錄環境資訊，方便之後排查問題。
    // 注意：改用單執行緒核心之後，crossOriginIsolated / SharedArrayBuffer 已經「不再是必要條件」，
    // 這裡只做記錄，不再因為它們是 false 就判定環境有問題。
    function runVideoEnvironmentCheck() {
        const coi = window.crossOriginIsolated === true;
        const hasSAB = typeof SharedArrayBuffer !== 'undefined';
        logVideoDebug(`環境檢查：crossOriginIsolated=${coi}, SharedArrayBuffer=${hasSAB}, 目前網址=${window.location.href}`);

        videoDiagLine.className = 'ok';
        videoDiagLine.textContent =
            '✅ 影片引擎使用單執行緒版本，不需要特殊的伺服器設定，任何開啟方式都可以使用(速度會比多執行緒版慢一些)。';
    }
    runVideoEnvironmentCheck();

    // Worker 內部如果發生沒被接住的錯誤，預設不會讓 ffmpeg.load() 的 Promise 失敗(只會卡住)，
    // 但瀏覽器通常還是會把這種錯誤丟到 window 的全域事件上，這裡攔截起來寫進看得到的記錄框
    window.addEventListener('error', (e) => {
        logVideoDebug(`⚠️ 全域錯誤事件：${e.message || e} ${e.filename ? '(' + e.filename + ':' + e.lineno + ')' : ''}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
        logVideoDebug(`⚠️ 未處理的 Promise 錯誤：${(e.reason && e.reason.message) || e.reason}`);
    });

    videoQuality.addEventListener('input', () => {
        videoQualityValue.textContent = videoQuality.value;
    });

    const videoQueuePreview = document.getElementById('videoQueuePreview');

    function updateVideoFileCount() {
        videoFileCount.textContent = selectedVideoFiles.length > 0
            ? `目前共 ${selectedVideoFiles.length} 支影片，按「開始壓縮」處理(可以繼續拖曳或選檔加入更多)`
            : '';
        renderQueuePreview(videoQueuePreview, selectedVideoFiles, (index) => {
            selectedVideoFiles.splice(index, 1);
            updateVideoFileCount();
        });
    }

    function addVideoFilesToQueue(fileList) {
        const files = Array.from(fileList || []).filter(f => f.type.startsWith('video/'));
        if (files.length === 0) return;
        selectedVideoFiles = selectedVideoFiles.concat(files);
        updateVideoFileCount();
    }

    videoFileInput.addEventListener('change', () => {
        addVideoFilesToQueue(videoFileInput.files);
        videoFileInput.value = '';
    });

    videoDropzone.addEventListener('click', () => {
        videoFileInput.click();
    });

    videoDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        videoDropzone.classList.add('dragover');
    });

    videoDropzone.addEventListener('dragleave', () => {
        videoDropzone.classList.remove('dragover');
    });

    videoDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        videoDropzone.classList.remove('dragover');
        addVideoFilesToQueue(e.dataTransfer.files);
    });

    videoClearBtn.addEventListener('click', () => {
        selectedVideoFiles = [];
        compressedVideoResults = [];
        videoFileInput.value = '';
        videoFileCount.textContent = '';
        videoQueuePreview.innerHTML = '';
        videoResults.innerHTML = '';
    });

    // 把本機檔案(或任何網址)轉成 blob 網址給 ffmpeg 用，不需要再依賴 @ffmpeg/util
    async function toLocalBlobURL(url, mimeType) {
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        return URL.createObjectURL(new Blob([buf], { type: mimeType }));
    }

    // 影片引擎(ffmpeg.wasm)第一次使用才載入，之後同一次瀏覽都直接沿用，不用重複下載。
    // 引擎檔案(約 30MB)已經放在同資料夾的 vendor/ 底下，不用連外部 CDN，速度跟穩定度都比較好掌握。
    async function getFFmpeg() {
        if (ffmpegInstance) return ffmpegInstance;
        if (ffmpegLoadPromise) return ffmpegLoadPromise;

        ffmpegLoadPromise = (async () => {
            // 現在使用的是「單執行緒版」的 ffmpeg 核心(@ffmpeg/core)，
            // 它不需要 SharedArrayBuffer，也就不需要 COOP/COEP 這兩個特殊標頭，
            // 因此不管是本機直接開、Live Server 還是部署在 GitHub Pages 都能正常運作。
            // (先前用的是多執行緒版 @ffmpeg/core-mt，速度較快但必須要有那兩個標頭，
            //  而補標頭用的 Service Worker 會連帶把 Google 登入與雲端資料的連線弄壞，因此改用單執行緒版。)
            runVideoEnvironmentCheck();

            videoEngineStatus.textContent = '⏳ 第一次使用，正在讀取本機影片處理引擎(約 30MB)，請稍候...';

            logVideoDebug('開始載入 FFmpeg 類別 (./vendor/ffmpeg/index.js)');
            const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
            logVideoDebug('FFmpeg 類別載入成功');

            const ffmpeg = new FFmpeg();
            ffmpeg.on('log', ({ message }) => logVideoDebug('[核心] ' + message));

            // 現在 core/worker 檔案都跟網頁放在同一個網域(本機)，不需要再轉成 blob 網址繞過跨網域限制，
            // 直接給本機檔案的絕對網址即可(絕對網址比相對路徑可靠，尤其是在 Worker 內部解析時)
            const coreURL = new URL('./vendor/ffmpeg-core/ffmpeg-core.js', window.location.href).href;
            const wasmURL = new URL('./vendor/ffmpeg-core/ffmpeg-core.wasm', window.location.href).href;
            logVideoDebug(`本機檔案網址：coreURL=${coreURL}`);
            logVideoDebug(`本機檔案網址：wasmURL=${wasmURL}`);
            logVideoDebug('準備呼叫 ffmpeg.load()(不指定 classWorkerURL，讓它用預設方式在同資料夾找 worker.js)...');

            const LOAD_TIMEOUT_MS = 90000;
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(
                        `引擎初始化超過 ${LOAD_TIMEOUT_MS / 1000} 秒沒有回應，判定為卡住。` +
                        `引擎檔案約 30MB，第一次載入需要一點時間，如果網路較慢可以重新整理再試一次。` +
                        `若多試幾次都一樣，可能是瀏覽器或防毒軟體封鎖了 Worker/WASM，` +
                        `可以換一台電腦或換 Chrome/Edge 最新版試試看。`
                    ));
                }, LOAD_TIMEOUT_MS);
            });

            await Promise.race([
                // 故意不傳 classWorkerURL：讓 ffmpeg.wasm 用它自己內建的預設邏輯，
                // 以「./vendor/ffmpeg/index.js 的位置」為基準去找同資料夾的 worker.js，
                // 因為現在都是本機同網域檔案，這樣最單純、最不容易出錯
                ffmpeg.load({ coreURL, wasmURL }),
                timeoutPromise
            ]);

            logVideoDebug('ffmpeg.load() 完成！引擎已就緒');
            ffmpegInstance = ffmpeg;
            videoEngineStatus.textContent = '✅ 影片處理引擎已就緒';
            return ffmpeg;
        })();

        try {
            return await ffmpegLoadPromise;
        } catch (err) {
            ffmpegLoadPromise = null; // 失敗的話讓下次可以重新嘗試載入
            const reason = (err && err.message) || '未知錯誤';
            logVideoDebug('❌ 載入失敗：' + reason);
            videoEngineStatus.textContent = '❌ 影片處理引擎載入失敗：' + reason;
            throw err;
        }
    }

    // 畫質(10~95) 換算成 CRF，數值愈低畫質愈好(x264 常用 18~32、VP9 常用 15~50)
    function qualityToCrf(qualityPercent, codec) {
        const clamped = Math.min(95, Math.max(10, qualityPercent));
        const ratio = (clamped - 10) / (95 - 10); // 0(低畫質) ~ 1(高畫質)
        if (codec === 'vp9') {
            return Math.round(50 - ratio * (50 - 15));
        }
        return Math.round(32 - ratio * (32 - 18));
    }

    async function compressOneVideo(file, formatChoice, qualityPercent, index, onProgress) {
        const ffmpeg = await getFFmpeg();

        const inputExt = (file.name.split('.').pop() || 'mp4').toLowerCase();
        const inputName = `input_${index}.${inputExt}`;
        const isWebm = formatChoice === 'webm';
        const outputName = isWebm ? `output_${index}.webm` : `output_${index}.mp4`;
        const outputMime = isWebm ? 'video/webm' : 'video/mp4';

        const progressHandler = ({ progress }) => {
            if (typeof progress === 'number' && progress >= 0 && progress <= 1) {
                onProgress(Math.round(progress * 100));
            }
        };
        ffmpeg.on('progress', progressHandler);

        try {
            const inputBytes = new Uint8Array(await file.arrayBuffer());
            await ffmpeg.writeFile(inputName, inputBytes);

            const crf = qualityToCrf(qualityPercent, isWebm ? 'vp9' : 'x264');
            const args = isWebm
                ? ['-i', inputName, '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-c:a', 'libopus', outputName]
                : ['-i', inputName, '-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', outputName];

            await ffmpeg.exec(args);

            const data = await ffmpeg.readFile(outputName);
            const blob = new Blob([data.buffer], { type: outputMime });

            // 清乾淨這輪用到的檔案，避免虛擬檔案系統越堆越大
            try { await ffmpeg.deleteFile(inputName); } catch (e) { /* 忽略 */ }
            try { await ffmpeg.deleteFile(outputName); } catch (e) { /* 忽略 */ }

            return { blob, mime: outputMime, ext: isWebm ? 'webm' : 'mp4' };
        } finally {
            ffmpeg.off('progress', progressHandler);
        }
    }

    function makeVideoStatusCard(file) {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.innerHTML = `
            <div class="status-line">⏳ 排隊中：${file.name}</div>
            <div class="progress-bar-outer"><div class="progress-bar-inner"></div></div>
        `;
        return card;
    }

    function fillVideoResultCard(card, file, result, downloadName) {
        card.innerHTML = '';

        const video = document.createElement('video');
        video.src = URL.createObjectURL(result.blob);
        video.controls = true;
        card.appendChild(video);

        const info = document.createElement('div');
        info.className = 'info';

        const fname = document.createElement('div');
        fname.className = 'fname';
        fname.textContent = file.name;
        info.appendChild(fname);

        const originalRow = document.createElement('div');
        originalRow.className = 'size-row';
        originalRow.textContent = `原始：${formatBytes(file.size)}`;
        info.appendChild(originalRow);

        const compressedRow = document.createElement('div');
        compressedRow.className = 'size-row';
        compressedRow.textContent = `壓縮後：${formatBytes(result.blob.size)} (${result.ext})`;
        info.appendChild(compressedRow);

        const savedPercent = file.size > 0 ? (1 - result.blob.size / file.size) * 100 : 0;
        const savedRow = document.createElement('div');
        if (savedPercent >= 0) {
            savedRow.className = 'saved';
            savedRow.textContent = `省下 ${savedPercent.toFixed(0)}%`;
        } else {
            savedRow.className = 'saved warn';
            savedRow.textContent = `比原檔還大 ${Math.abs(savedPercent).toFixed(0)}%(可調低畫質)`;
        }
        info.appendChild(savedRow);

        card.appendChild(info);

        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'download-btn';
        downloadBtn.textContent = '⬇ 下載';
        downloadBtn.href = URL.createObjectURL(result.blob);
        downloadBtn.download = downloadName;
        card.appendChild(downloadBtn);
    }

    videoStartBtn.addEventListener('click', async () => {
        if (selectedVideoFiles.length === 0) {
            alert('請先選擇要壓縮的影片。');
            return;
        }

        videoResults.innerHTML = '';
        compressedVideoResults = [];
        const formatChoice = videoFormatSelect.value;
        const qualityPercent = parseInt(videoQuality.value, 10);

        videoStartBtn.disabled = true;

        const cardRefs = selectedVideoFiles.map(file => {
            const card = makeVideoStatusCard(file);
            videoResults.appendChild(card);
            return card;
        });

        for (let i = 0; i < selectedVideoFiles.length; i++) {
            const file = selectedVideoFiles[i];
            const card = cardRefs[i];
            const statusLine = card.querySelector('.status-line');
            const progressInner = card.querySelector('.progress-bar-inner');
            if (statusLine) statusLine.textContent = `🎬 轉檔中：${file.name}`;

            try {
                const result = await compressOneVideo(file, formatChoice, qualityPercent, i, (pct) => {
                    if (progressInner) progressInner.style.width = pct + '%';
                    if (statusLine) statusLine.textContent = `🎬 轉檔中 ${pct}%：${file.name}`;
                });
                const downloadName = `${stripExtension(file.name)}_compressed.${result.ext}`;
                fillVideoResultCard(card, file, result, downloadName);
                compressedVideoResults.push({ filename: downloadName, blob: result.blob });
            } catch (err) {
                console.error('影片壓縮失敗：', file.name, err);
                const reason = (err && err.message) ? err.message : '未知錯誤';
                card.innerHTML = `<div class="status-line">❌ ${file.name} 壓縮失敗<br>${reason}</div>`;
            }
        }

        videoStartBtn.disabled = false;
    });

    videoDownloadAllBtn.addEventListener('click', async () => {
        if (compressedVideoResults.length === 0) {
            alert('目前還沒有壓縮完成的影片，請先按「開始壓縮」。');
            return;
        }
        if (typeof JSZip === 'undefined') {
            alert('打包功能需要載入 JSZip 函式庫，請確認網路連線正常後重新整理頁面再試一次。');
            return;
        }

        videoDownloadAllBtn.disabled = true;
        videoDownloadAllBtn.textContent = '打包中...';

        try {
            const zip = new JSZip();
            const usedNames = new Set();

            compressedVideoResults.forEach(item => {
                let name = item.filename;
                let counter = 1;
                while (usedNames.has(name)) {
                    name = item.filename.replace(/(\.[^.]+)$/, `_${counter}$1`);
                    counter++;
                }
                usedNames.add(name);
                zip.file(name, item.blob);
            });

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `壓縮影片_${compressedVideoResults.length}支.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('打包失敗：', err);
            alert('打包失敗，請稍後再試一次。');
        } finally {
            videoDownloadAllBtn.disabled = false;
            videoDownloadAllBtn.textContent = '📦 打包下載全部(ZIP)';
        }
    });

    /* =========================================================
       頁籤六：AI 圖片放大工具 (純前端，用 UpscalerJS + TensorFlow.js 在瀏覽器裡跑)
    ========================================================= */
    const upscaleFileInput = document.getElementById('upscaleFileInput');
    const upscaleDropzone = document.getElementById('upscaleDropzone');
    const upscaleStartBtn = document.getElementById('upscaleStartBtn');
    const upscaleDownloadAllBtn = document.getElementById('upscaleDownloadAllBtn');
    const upscaleClearBtn = document.getElementById('upscaleClearBtn');
    const upscaleFileCount = document.getElementById('upscaleFileCount');
    const upscaleEngineStatus = document.getElementById('upscaleEngineStatus');
    const upscaleResults = document.getElementById('upscaleResults');

    let selectedUpscaleFiles = [];
    let upscaledResults = [];
    let upscalerInstance = null;
    const upscaleQueuePreview = document.getElementById('upscaleQueuePreview');

    function updateUpscaleFileCount() {
        upscaleFileCount.textContent = selectedUpscaleFiles.length > 0
            ? `目前共 ${selectedUpscaleFiles.length} 張圖片，按「開始放大」處理(可以繼續拖曳或選檔加入更多)`
            : '';
        renderQueuePreview(upscaleQueuePreview, selectedUpscaleFiles, (index) => {
            selectedUpscaleFiles.splice(index, 1);
            updateUpscaleFileCount();
        });
    }

    function addUpscaleFilesToQueue(fileList) {
        const files = Array.from(fileList || []).filter(f => f.type === 'image/png' || f.type === 'image/jpeg');
        if (files.length === 0) return;
        selectedUpscaleFiles = selectedUpscaleFiles.concat(files);
        updateUpscaleFileCount();
    }

    upscaleFileInput.addEventListener('change', () => {
        addUpscaleFilesToQueue(upscaleFileInput.files);
        upscaleFileInput.value = '';
    });

    upscaleDropzone.addEventListener('click', () => {
        upscaleFileInput.click();
    });

    upscaleDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        upscaleDropzone.classList.add('dragover');
    });

    upscaleDropzone.addEventListener('dragleave', () => {
        upscaleDropzone.classList.remove('dragover');
    });

    upscaleDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        upscaleDropzone.classList.remove('dragover');
        addUpscaleFilesToQueue(e.dataTransfer.files);
    });

    upscaleClearBtn.addEventListener('click', () => {
        selectedUpscaleFiles = [];
        upscaledResults = [];
        upscaleFileInput.value = '';
        upscaleFileCount.textContent = '';
        upscaleQueuePreview.innerHTML = '';
        upscaleResults.innerHTML = '';
    });

    // 模型只需要初始化一次，之後同一次瀏覽都直接沿用
    function getUpscalerInstance() {
        if (upscalerInstance) return upscalerInstance;
        if (typeof Upscaler === 'undefined' || typeof tf === 'undefined' || typeof ESRGANThick2x === 'undefined') {
            throw new Error(
                'AI 放大函式庫載入失敗，請確認 vendor/upscaler 資料夾(tf.min.js、upscaler.min.js、' +
                'esrgan-thick-x2.min.js、model.json、group1-shard*of7.bin 共 7 個)是否跟 index.html 放在一起，並重新整理頁面。'
            );
        }
        upscaleEngineStatus.textContent = '⏳ 正在初始化 AI 模型(本機檔案，約 30MB，高品質模型初次讀取需要一點時間)...';
        // esrgan-thick 這個模型內部用了自訂神經網路層(MultiplyBeta、PixelShuffle)，
        // 一定要用它專屬的 ESRGANThick2x 設定物件(裡面有 setup() 會把自訂層註冊給 TensorFlow.js)，
        // 不然會出現 "Unknown layer" 的錯誤。這裡把路徑覆蓋成我們本機放的檔案位置
        // (同時覆蓋外層跟 _internals 裡面的 path，確保不管函式庫讀哪一個都吃得到本機路徑)。
        const localModelConfig = {
            ...ESRGANThick2x,
            path: './vendor/upscaler/model.json',
            _internals: {
                ...ESRGANThick2x._internals,
                path: './vendor/upscaler/model.json',
            },
        };
        upscalerInstance = new Upscaler({
            model: localModelConfig,
        });
        upscaleEngineStatus.textContent = '✅ AI 模型已就緒';
        return upscalerInstance;
    }

    function base64ToBlob(base64DataUrl) {
        const match = /^data:([^;]+);base64,(.*)$/.exec(base64DataUrl);
        const mime = match ? match[1] : 'image/png';
        const byteString = atob(match ? match[2] : base64DataUrl);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
        return { blob: new Blob([bytes], { type: mime }), mime };
    }

    function getImageDimensions(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
                URL.revokeObjectURL(url);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('圖片讀取失敗'));
            };
            img.src = url;
        });
    }

    async function upscaleOneImage(file, onProgress) {
        const upscaler = getUpscalerInstance();
        const { width, height } = await getImageDimensions(file);

        const objectUrl = URL.createObjectURL(file);
        try {
            const resultBase64 = await upscaler.upscale(objectUrl, {
                patchSize: 64,
                padding: 4,
                progress: (percent) => onProgress(Math.round(percent * 100)),
            });
            const { blob, mime } = base64ToBlob(resultBase64);
            return {
                blob,
                mime,
                ext: extensionForMime(mime),
                dimsText: `${width}x${height} → ${width * 2}x${height * 2}`
            };
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function makeUpscaleStatusCard(file) {
        const card = document.createElement('div');
        card.className = 'compress-card';
        card.innerHTML = `
            <div class="status-line">⏳ 排隊中：${file.name}</div>
            <div class="progress-bar-outer"><div class="progress-bar-inner"></div></div>
        `;
        return card;
    }

    function fillUpscaleResultCard(card, file, result, downloadName) {
        card.innerHTML = '';

        const img = document.createElement('img');
        img.src = URL.createObjectURL(result.blob);
        card.appendChild(img);

        const info = document.createElement('div');
        info.className = 'info';

        const fname = document.createElement('div');
        fname.className = 'fname';
        fname.textContent = file.name;
        info.appendChild(fname);

        const dimsRow = document.createElement('div');
        dimsRow.className = 'size-row';
        dimsRow.textContent = `尺寸：${result.dimsText}`;
        info.appendChild(dimsRow);

        const originalRow = document.createElement('div');
        originalRow.className = 'size-row';
        originalRow.textContent = `原始：${formatBytes(file.size)}`;
        info.appendChild(originalRow);

        const resultRow = document.createElement('div');
        resultRow.className = 'size-row';
        resultRow.textContent = `放大後：${formatBytes(result.blob.size)} (${result.ext})`;
        info.appendChild(resultRow);

        card.appendChild(info);

        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'download-btn';
        downloadBtn.textContent = '⬇ 下載';
        downloadBtn.href = URL.createObjectURL(result.blob);
        downloadBtn.download = downloadName;
        card.appendChild(downloadBtn);
    }

    upscaleStartBtn.addEventListener('click', async () => {
        if (selectedUpscaleFiles.length === 0) {
            alert('請先選擇要放大的圖片(JPG 或 PNG)。');
            return;
        }

        upscaleResults.innerHTML = '';
        upscaledResults = [];
        upscaleStartBtn.disabled = true;

        const cardRefs = selectedUpscaleFiles.map(file => {
            const card = makeUpscaleStatusCard(file);
            upscaleResults.appendChild(card);
            return card;
        });

        for (let i = 0; i < selectedUpscaleFiles.length; i++) {
            const file = selectedUpscaleFiles[i];
            const card = cardRefs[i];
            const statusLine = card.querySelector('.status-line');
            const progressInner = card.querySelector('.progress-bar-inner');
            if (statusLine) statusLine.textContent = `✨ 放大中：${file.name}`;

            try {
                const result = await upscaleOneImage(file, (pct) => {
                    if (progressInner) progressInner.style.width = pct + '%';
                    if (statusLine) statusLine.textContent = `✨ 放大中 ${pct}%：${file.name}`;
                });
                const downloadName = `${stripExtension(file.name)}_2x.${result.ext}`;
                fillUpscaleResultCard(card, file, result, downloadName);
                upscaledResults.push({ filename: downloadName, blob: result.blob });
            } catch (err) {
                console.error('放大失敗：', file.name, err);
                const reason = (err && err.message) || '未知錯誤';
                card.innerHTML = `<div class="status-line">❌ ${file.name} 放大失敗<br>${reason}</div>`;
            }
        }

        upscaleStartBtn.disabled = false;
    });

    upscaleDownloadAllBtn.addEventListener('click', async () => {
        if (upscaledResults.length === 0) {
            alert('目前還沒有放大完成的圖片，請先按「開始放大」。');
            return;
        }
        if (typeof JSZip === 'undefined') {
            alert('打包功能需要載入 JSZip 函式庫，請確認網路連線正常後重新整理頁面再試一次。');
            return;
        }

        upscaleDownloadAllBtn.disabled = true;
        upscaleDownloadAllBtn.textContent = '打包中...';

        try {
            const zip = new JSZip();
            const usedNames = new Set();

            upscaledResults.forEach(item => {
                let name = item.filename;
                let counter = 1;
                while (usedNames.has(name)) {
                    name = item.filename.replace(/(\.[^.]+)$/, `_${counter}$1`);
                    counter++;
                }
                usedNames.add(name);
                zip.file(name, item.blob);
            });

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `AI放大_${upscaledResults.length}張.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('打包失敗：', err);
            alert('打包失敗，請稍後再試一次。');
        } finally {
            upscaleDownloadAllBtn.disabled = false;
            upscaleDownloadAllBtn.textContent = '📦 打包下載全部(ZIP)';
        }
    });

    /* =========================================================
       頁籤七：AI 去背工具 (純前端，用 @imgly/background-removal 在瀏覽器裡跑)
       模型與 wasm 檔案放在 vendor/bgremove/，需要先執行 download-bgremove-model.js 下載一次。
    ========================================================= */
    const bgremoveFileInput = document.getElementById('bgremoveFileInput');
    const bgremoveDropzone = document.getElementById('bgremoveDropzone');
    const bgremoveModeSelect = document.getElementById('bgremoveModeSelect');
    const bgremoveModeHint = document.getElementById('bgremoveModeHint');
    const bgremoveModelGroup = document.getElementById('bgremoveModelGroup');
    const bgremoveModelSelect = document.getElementById('bgremoveModelSelect');
    const bgremoveToleranceGroup = document.getElementById('bgremoveToleranceGroup');
    const bgremoveTolerance = document.getElementById('bgremoveTolerance');
    const bgremoveToleranceValue = document.getElementById('bgremoveToleranceValue');
    const bgremoveFeatherGroup = document.getElementById('bgremoveFeatherGroup');
    const bgremoveFeather = document.getElementById('bgremoveFeather');
    const bgremoveFeatherValue = document.getElementById('bgremoveFeatherValue');
    const bgremoveSolidColorGroup = document.getElementById('bgremoveSolidColorGroup');
    const bgremoveSolidColorMode = document.getElementById('bgremoveSolidColorMode');
    const bgremoveSolidColorPickGroup = document.getElementById('bgremoveSolidColorPickGroup');
    const bgremoveSolidColorPicker = document.getElementById('bgremoveSolidColorPicker');
    const bgremoveBgSelect = document.getElementById('bgremoveBgSelect');
    const bgremoveColorGroup = document.getElementById('bgremoveColorGroup');
    const bgremoveColorPicker = document.getElementById('bgremoveColorPicker');
    const bgremoveStartBtn = document.getElementById('bgremoveStartBtn');
    const bgremoveDownloadAllBtn = document.getElementById('bgremoveDownloadAllBtn');
    const bgremoveClearBtn = document.getElementById('bgremoveClearBtn');
    const bgremoveFileCount = document.getElementById('bgremoveFileCount');
    const bgremoveEngineStatus = document.getElementById('bgremoveEngineStatus');
    const bgremoveResults = document.getElementById('bgremoveResults');
    const bgremoveQueuePreview = document.getElementById('bgremoveQueuePreview');
    const bgremoveMultiModal = document.getElementById('bgremoveMultiModal');
    const bgremoveMultiCanvas = document.getElementById('bgremoveMultiCanvas');
    const bgremoveMultiTitle = document.getElementById('bgremoveMultiTitle');
    const bgremoveMultiBoxCount = document.getElementById('bgremoveMultiBoxCount');
    const bgremoveMultiUndoBtn = document.getElementById('bgremoveMultiUndoBtn');
    const bgremoveMultiClearBtn = document.getElementById('bgremoveMultiClearBtn');
    const bgremoveMultiSkipBtn = document.getElementById('bgremoveMultiSkipBtn');
    const bgremoveMultiConfirmBtn = document.getElementById('bgremoveMultiConfirmBtn');

    let selectedBgremoveFiles = [];
    let bgremovedResults = [];
    let bgremoveModulePromise = null; // 引擎程式碼(index.mjs)只需要動態載入一次，函式庫本身內部也會快取已經讀好的模型，不用自己額外處理

    const bgremoveModeHints = {
        ai: '💡 AI 智慧去背：適合一般照片、背景複雜或有漸層，會抓「最顯著的一個主體」，畫面邊緣較不明顯的物件可能會被誤判成背景刪掉。',
        solid: '💡 純色背景移除：從圖片邊緣往內找「顏色接近、彼此相連」的區域整塊挖空，適合背景是均勻色塊(白底、單色底)的圖，可以正確保留畫面中多個獨立物件，不需要下載模型、瞬間出結果。',
        multi: '💡 多物件模式：適合背景複雜(例如場景照片)、畫面裡又有多個角色都要保留的情況。按「開始去背」後，每張圖會先跳出框選視窗，你手動框出每個角色，程式再把每個框個別交給 AI 去背、最後自動合成回一張透明 PNG。需要下載跟「AI 智慧去背」一樣的模型檔案。'
    };

    function updateBgremoveModeUI() {
        const mode = bgremoveModeSelect.value;
        bgremoveModelGroup.style.display = (mode === 'ai' || mode === 'multi') ? 'flex' : 'none';
        bgremoveToleranceGroup.style.display = mode === 'solid' ? 'flex' : 'none';
        bgremoveFeatherGroup.style.display = mode === 'solid' ? 'flex' : 'none';
        bgremoveSolidColorGroup.style.display = mode === 'solid' ? 'flex' : 'none';
        bgremoveSolidColorPickGroup.style.display = (mode === 'solid' && bgremoveSolidColorMode.value === 'manual') ? 'flex' : 'none';
        bgremoveModeHint.textContent = bgremoveModeHints[mode] || '';
    }
    bgremoveModeSelect.addEventListener('change', updateBgremoveModeUI);
    bgremoveSolidColorMode.addEventListener('change', updateBgremoveModeUI);
    updateBgremoveModeUI();

    bgremoveTolerance.addEventListener('input', () => {
        bgremoveToleranceValue.textContent = bgremoveTolerance.value;
    });
    bgremoveFeather.addEventListener('input', () => {
        bgremoveFeatherValue.textContent = bgremoveFeather.value;
    });

    function updateBgremoveFileCount() {
        bgremoveFileCount.textContent = selectedBgremoveFiles.length > 0
            ? `目前共 ${selectedBgremoveFiles.length} 張圖片，按「開始去背」處理(可以繼續拖曳或選檔加入更多)`
            : '';
        renderQueuePreview(bgremoveQueuePreview, selectedBgremoveFiles, (index) => {
            selectedBgremoveFiles.splice(index, 1);
            updateBgremoveFileCount();
        });
    }

    function addBgremoveFilesToQueue(fileList) {
        const files = Array.from(fileList || []).filter(f => f.type === 'image/png' || f.type === 'image/jpeg');
        if (files.length === 0) return;
        selectedBgremoveFiles = selectedBgremoveFiles.concat(files);
        updateBgremoveFileCount();
    }

    bgremoveFileInput.addEventListener('change', () => {
        addBgremoveFilesToQueue(bgremoveFileInput.files);
        bgremoveFileInput.value = '';
    });

    bgremoveDropzone.addEventListener('click', () => {
        bgremoveFileInput.click();
    });

    bgremoveDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        bgremoveDropzone.classList.add('dragover');
    });

    bgremoveDropzone.addEventListener('dragleave', () => {
        bgremoveDropzone.classList.remove('dragover');
    });

    bgremoveDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        bgremoveDropzone.classList.remove('dragover');
        addBgremoveFilesToQueue(e.dataTransfer.files);
    });

    bgremoveClearBtn.addEventListener('click', () => {
        selectedBgremoveFiles = [];
        bgremovedResults = [];
        bgremoveFileInput.value = '';
        bgremoveFileCount.textContent = '';
        bgremoveQueuePreview.innerHTML = '';
        bgremoveResults.innerHTML = '';
    });

    bgremoveBgSelect.addEventListener('change', () => {
        bgremoveColorGroup.style.display = bgremoveBgSelect.value === 'custom' ? 'flex' : 'none';
    });

    // 引擎程式碼(index.mjs)只需要動態載入一次；用動態載入是為了在模型檔案還沒下載好時，
    // 其他頁籤(工作分配表等)完全不受影響，只有真的點進這個頁籤操作才會嘗試載入。
    function loadBgremoveModule() {
        if (!bgremoveModulePromise) {
            bgremoveModulePromise = import('./vendor/bgremove/index.mjs')
                .then(mod => mod.removeBackground)
                .catch(err => {
                    bgremoveModulePromise = null; // 失敗的話下次再點還可以重試
                    throw new Error(
                        '去背引擎程式碼載入失敗，請確認 vendor/bgremove/index.mjs 是否存在(這個檔案應該已經在專案裡，不用另外下載)。原始錯誤：' + (err && err.message)
                    );
                });
        }
        return bgremoveModulePromise;
    }

    async function removeBackgroundFromFile(file, modelChoice, onProgress) {
        const removeBackground = await loadBgremoveModule();
        // publicPath 必須是絕對網址，直接給相對路徑字串會讓函式庫內部 new URL() 組路徑時失敗(Invalid base URL)
        const publicPath = new URL('./vendor/bgremove/', window.location.href).href;
        const resultBlob = await removeBackground(file, {
            publicPath: publicPath,
            device: 'cpu',
            model: modelChoice,
            output: { format: 'image/png', quality: 1 },
            progress: (key, current, total) => {
                if (total > 0) {
                    onProgress(Math.round((current / total) * 100), key);
                }
            }
        });
        return resultBlob;
    }

    // 把去背後的透明 PNG 疊在指定顏色的畫布上，做出「白色背景」「自訂顏色背景」的輸出選項
    function compositeOntoColor(blob, hexColor) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = hexColor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((outBlob) => {
                    URL.revokeObjectURL(objectUrl);
                    if (outBlob) resolve(outBlob);
                    else reject(new Error('合成背景顏色失敗'));
                }, 'image/png');
            };
            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('讀取去背結果圖片失敗'));
            };
            img.src = objectUrl;
        });
    }

    function hexToRgb(hex) {
        const clean = hex.replace('#', '');
        return {
            r: parseInt(clean.substring(0, 2), 16),
            g: parseInt(clean.substring(2, 4), 16),
            b: parseInt(clean.substring(4, 6), 16)
        };
    }

    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('圖片讀取失敗'));
            };
            img.src = objectUrl;
        });
    }

    /**
     * 純色背景移除：純 Canvas 運算，不需要任何 AI 模型。
     * 原理：從圖片四個邊緣開始，用「flood fill(區域擴散)」找出所有「跟邊緣相連、顏色跟背景色接近」的像素，整塊挖空。
     * 因為判斷依據是「顏色連通性」而不是「哪一塊是主角」，畫面上不管有幾個獨立物件、擺在哪個位置，
     * 只要背景是均勻色塊，都能正確保留每一個物件——這正是 AI 智慧去背(單一主體模型)的弱點。
     * 邊界的地方用 tolerance ~ tolerance+feather 這段範圍做出漸層透明度，避免鋸齒邊緣。
     * bgColorHex 為 null 時，會自動取圖片四個角落的平均色當作背景色。
     */
    async function removeSolidBackground(file, tolerance, feather, bgColorHex) {
        const img = await loadImageFromFile(file);
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        let bg;
        if (bgColorHex) {
            bg = hexToRgb(bgColorHex);
        } else {
            const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
            let sr = 0, sg = 0, sb = 0;
            corners.forEach(([x, y]) => {
                const i = (y * width + x) * 4;
                sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
            });
            bg = { r: Math.round(sr / 4), g: Math.round(sg / 4), b: Math.round(sb / 4) };
        }

        function colorDist(idx) {
            const dr = data[idx] - bg.r;
            const dg = data[idx + 1] - bg.g;
            const db = data[idx + 2] - bg.b;
            return Math.sqrt(dr * dr + dg * dg + db * db);
        }

        // flood fill 用比較寬鬆的門檻(tolerance + feather)找出「連通的背景候選區域」，
        // 之後再依實際色差算出漸層透明度，這樣邊界才會平滑，而不是硬邊。
        const reachThreshold = tolerance + feather;
        const total = width * height;
        const visited = new Uint8Array(total);
        const queue = new Int32Array(total);
        let qHead = 0, qTail = 0;

        function tryEnqueue(x, y) {
            if (x < 0 || y < 0 || x >= width || y >= height) return;
            const pixelIdx = y * width + x;
            if (visited[pixelIdx]) return;
            const dataIdx = pixelIdx * 4;
            if (colorDist(dataIdx) <= reachThreshold) {
                visited[pixelIdx] = 1;
                queue[qTail++] = pixelIdx;
            }
        }

        for (let x = 0; x < width; x++) {
            tryEnqueue(x, 0);
            tryEnqueue(x, height - 1);
        }
        for (let y = 0; y < height; y++) {
            tryEnqueue(0, y);
            tryEnqueue(width - 1, y);
        }

        while (qHead < qTail) {
            const pixelIdx = queue[qHead++];
            const x = pixelIdx % width;
            const y = (pixelIdx / width) | 0;
            tryEnqueue(x - 1, y);
            tryEnqueue(x + 1, y);
            tryEnqueue(x, y - 1);
            tryEnqueue(x, y + 1);
        }

        for (let pixelIdx = 0; pixelIdx < total; pixelIdx++) {
            if (!visited[pixelIdx]) continue;
            const dataIdx = pixelIdx * 4;
            const dist = colorDist(dataIdx);
            let alphaFactor;
            if (feather <= 0) {
                alphaFactor = dist <= tolerance ? 0 : 1;
            } else {
                alphaFactor = Math.min(1, Math.max(0, (dist - tolerance) / feather));
            }
            data[dataIdx + 3] = Math.round(data[dataIdx + 3] * alphaFactor);
        }

        ctx.putImageData(imageData, 0, 0);
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('產生去背結果失敗'));
            }, 'image/png');
        });
    }

    /**
     * 多物件模式 - 步驟一：彈出互動視窗，讓使用者在圖片上手動拖曳畫框，框出每一個要保留的角色。
     * 回傳 Promise：使用者按「完成」時 resolve 一個 boxes 陣列(座標已經換算回原圖尺寸)；
     * 按「跳過這張」時 resolve null。
     */
    function collectBoxesForImage(img, fileName, index, total) {
        return new Promise((resolve) => {
            bgremoveMultiModal.style.display = 'flex';
            bgremoveMultiTitle.textContent = `框選角色(第 ${index + 1} / ${total} 張)：${fileName}`;

            // 依視窗大小縮放顯示，但所有框選座標最後都會換算回原圖真實尺寸
            const maxW = Math.min(window.innerWidth * 0.85, 1100);
            const maxH = window.innerHeight * 0.6;
            const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
            const displayW = Math.max(1, Math.round(img.naturalWidth * scale));
            const displayH = Math.max(1, Math.round(img.naturalHeight * scale));

            bgremoveMultiCanvas.width = displayW;
            bgremoveMultiCanvas.height = displayH;
            const ctx = bgremoveMultiCanvas.getContext('2d');

            let boxes = []; // 原圖座標 {x, y, w, h}
            let dragging = false;
            let dragStart = null;
            let dragCurrent = null;

            function redraw() {
                ctx.clearRect(0, 0, displayW, displayH);
                ctx.drawImage(img, 0, 0, displayW, displayH);
                ctx.lineWidth = 2;
                ctx.font = 'bold 13px Arial';
                boxes.forEach((b, i) => {
                    const dx = b.x * scale, dy = b.y * scale, dw = b.w * scale, dh = b.h * scale;
                    ctx.strokeStyle = '#2c662d';
                    ctx.strokeRect(dx, dy, dw, dh);
                    ctx.fillStyle = 'rgba(44,102,45,0.9)';
                    ctx.fillRect(dx, dy, 20, 16);
                    ctx.fillStyle = 'white';
                    ctx.fillText(String(i + 1), dx + 5, dy + 12);
                });
                if (dragging && dragStart && dragCurrent) {
                    const x = Math.min(dragStart.x, dragCurrent.x);
                    const y = Math.min(dragStart.y, dragCurrent.y);
                    const w = Math.abs(dragCurrent.x - dragStart.x);
                    const h = Math.abs(dragCurrent.y - dragStart.y);
                    ctx.strokeStyle = '#4a6fa5';
                    ctx.setLineDash([5, 4]);
                    ctx.strokeRect(x, y, w, h);
                    ctx.setLineDash([]);
                }
                bgremoveMultiBoxCount.textContent = `已框選 ${boxes.length} 個角色`;
            }

            function getPos(e) {
                const rect = bgremoveMultiCanvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return {
                    x: Math.max(0, Math.min(displayW, clientX - rect.left)),
                    y: Math.max(0, Math.min(displayH, clientY - rect.top))
                };
            }

            function onDown(e) {
                e.preventDefault();
                dragging = true;
                dragStart = getPos(e);
                dragCurrent = dragStart;
                redraw();
            }
            function onMove(e) {
                if (!dragging) return;
                e.preventDefault();
                dragCurrent = getPos(e);
                redraw();
            }
            function onUp(e) {
                if (!dragging) return;
                dragging = false;
                const end = getPos(e);
                const x = Math.min(dragStart.x, end.x) / scale;
                const y = Math.min(dragStart.y, end.y) / scale;
                const w = Math.abs(end.x - dragStart.x) / scale;
                const h = Math.abs(end.y - dragStart.y) / scale;
                if (w * scale > 4 && h * scale > 4) { // 太小的框(通常是誤點)不採用
                    boxes.push({ x, y, w, h });
                }
                dragStart = null;
                dragCurrent = null;
                redraw();
            }

            bgremoveMultiCanvas.addEventListener('mousedown', onDown);
            bgremoveMultiCanvas.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            bgremoveMultiCanvas.addEventListener('touchstart', onDown, { passive: false });
            bgremoveMultiCanvas.addEventListener('touchmove', onMove, { passive: false });
            bgremoveMultiCanvas.addEventListener('touchend', onUp);

            function cleanup() {
                bgremoveMultiModal.style.display = 'none';
                bgremoveMultiCanvas.removeEventListener('mousedown', onDown);
                bgremoveMultiCanvas.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                bgremoveMultiCanvas.removeEventListener('touchstart', onDown);
                bgremoveMultiCanvas.removeEventListener('touchmove', onMove);
                bgremoveMultiCanvas.removeEventListener('touchend', onUp);
                bgremoveMultiUndoBtn.onclick = null;
                bgremoveMultiClearBtn.onclick = null;
                bgremoveMultiSkipBtn.onclick = null;
                bgremoveMultiConfirmBtn.onclick = null;
            }

            bgremoveMultiUndoBtn.onclick = () => { boxes.pop(); redraw(); };
            bgremoveMultiClearBtn.onclick = () => { boxes = []; redraw(); };
            bgremoveMultiSkipBtn.onclick = () => { cleanup(); resolve(null); };
            bgremoveMultiConfirmBtn.onclick = () => {
                if (boxes.length === 0) {
                    alert('請至少框選一個角色，或按「跳過這張」。');
                    return;
                }
                cleanup();
                resolve(boxes.slice());
            };

            redraw();
        });
    }

    /**
     * 多物件模式 - 步驟二：依照框選結果，把每個框裁切出來個別做 AI 去背，
     * 再依原始座標貼回一張跟原圖同尺寸的透明畫布，合成出最終結果。
     */
    async function removeBackgroundMultiObject(file, boxes, modelChoice, onProgress) {
        const img = await loadImageFromFile(file);
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = img.naturalWidth;
        finalCanvas.height = img.naturalHeight;
        const finalCtx = finalCanvas.getContext('2d');

        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            const cropW = Math.max(1, Math.round(box.w));
            const cropH = Math.max(1, Math.round(box.h));
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = cropW;
            cropCanvas.height = cropH;
            const cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, cropW, cropH);

            const cropBlob = await new Promise((resolve, reject) => {
                cropCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('裁切第 ' + (i + 1) + ' 個框失敗'))), 'image/png');
            });
            const cropFile = new File([cropBlob], `crop_${i}.png`, { type: 'image/png' });

            const mattedBlob = await removeBackgroundFromFile(cropFile, modelChoice, (pct) => {
                const overall = Math.round(((i + pct / 100) / boxes.length) * 100);
                onProgress(overall, i + 1, boxes.length);
            });
            const mattedImg = await loadImageFromFile(new File([mattedBlob], 'matted.png', { type: 'image/png' }));
            finalCtx.drawImage(mattedImg, box.x, box.y, box.w, box.h);
        }

        return new Promise((resolve, reject) => {
            finalCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('合成最終結果失敗'))), 'image/png');
        });
    }

    function makeBgremoveStatusCard(file) {
        const card = document.createElement('div');
        card.className = 'compress-card';
        card.innerHTML = `
            <div class="status-line">⏳ 排隊中：${file.name}</div>
            <div class="progress-bar-outer"><div class="progress-bar-inner"></div></div>
        `;
        return card;
    }

    function fillBgremoveResultCard(card, file, resultBlob, downloadName) {
        card.innerHTML = '';

        const img = document.createElement('img');
        img.src = URL.createObjectURL(resultBlob);
        card.appendChild(img);

        const info = document.createElement('div');
        info.className = 'info';

        const fname = document.createElement('div');
        fname.className = 'fname';
        fname.textContent = file.name;
        info.appendChild(fname);

        const originalRow = document.createElement('div');
        originalRow.className = 'size-row';
        originalRow.textContent = `原始：${formatBytes(file.size)}`;
        info.appendChild(originalRow);

        const resultRow = document.createElement('div');
        resultRow.className = 'size-row';
        resultRow.textContent = `去背後：${formatBytes(resultBlob.size)} (PNG)`;
        info.appendChild(resultRow);

        card.appendChild(info);

        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'download-btn';
        downloadBtn.textContent = '⬇ 下載';
        downloadBtn.href = URL.createObjectURL(resultBlob);
        downloadBtn.download = downloadName;
        card.appendChild(downloadBtn);
    }

    bgremoveStartBtn.addEventListener('click', async () => {
        if (selectedBgremoveFiles.length === 0) {
            alert('請先選擇要去背的圖片(JPG 或 PNG)。');
            return;
        }

        bgremoveResults.innerHTML = '';
        bgremovedResults = [];
        bgremoveStartBtn.disabled = true;
        const mode = bgremoveModeSelect.value;
        const modelChoice = bgremoveModelSelect.value;
        const bgChoice = bgremoveBgSelect.value;
        const bgColor = bgremoveColorPicker.value;
        const tolerance = parseInt(bgremoveTolerance.value, 10);
        const feather = parseInt(bgremoveFeather.value, 10);
        const solidColorHex = bgremoveSolidColorMode.value === 'manual' ? bgremoveSolidColorPicker.value : null;

        if (mode === 'ai' || mode === 'multi') {
            bgremoveEngineStatus.textContent = '⏳ 準備 AI 模型中(第一次使用、或切換畫質選項時需要讀取模型檔案，會比較久)...';
            try {
                await loadBgremoveModule();
            } catch (err) {
                bgremoveEngineStatus.textContent = '❌ ' + ((err && err.message) || '引擎載入失敗');
                bgremoveStartBtn.disabled = false;
                return;
            }
        } else {
            bgremoveEngineStatus.textContent = '';
        }

        const cardRefs = selectedBgremoveFiles.map(file => {
            const card = makeBgremoveStatusCard(file);
            bgremoveResults.appendChild(card);
            return card;
        });

        for (let i = 0; i < selectedBgremoveFiles.length; i++) {
            const file = selectedBgremoveFiles[i];
            const card = cardRefs[i];
            const statusLine = card.querySelector('.status-line');
            const progressInner = card.querySelector('.progress-bar-inner');

            try {
                let resultBlob;
                if (mode === 'ai') {
                    resultBlob = await removeBackgroundFromFile(file, modelChoice, (pct) => {
                        if (progressInner) progressInner.style.width = pct + '%';
                        if (statusLine) statusLine.textContent = `✂️ 去背中 ${pct}%：${file.name}`;
                    });
                } else if (mode === 'multi') {
                    if (statusLine) statusLine.textContent = `🖱️ 等待手動框選：${file.name}`;
                    const img = await loadImageFromFile(file);
                    const boxes = await collectBoxesForImage(img, file.name, i, selectedBgremoveFiles.length);
                    if (!boxes) {
                        card.innerHTML = `<div class="status-line">⏭️ 已跳過：${file.name}</div>`;
                        continue;
                    }
                    resultBlob = await removeBackgroundMultiObject(file, boxes, modelChoice, (pct, doneCount, totalCount) => {
                        if (progressInner) progressInner.style.width = pct + '%';
                        if (statusLine) statusLine.textContent = `✂️ 去背中(${doneCount}/${totalCount} 個框) ${pct}%：${file.name}`;
                    });
                } else {
                    if (statusLine) statusLine.textContent = `✂️ 去背中：${file.name}`;
                    if (progressInner) progressInner.style.width = '60%';
                    resultBlob = await removeSolidBackground(file, tolerance, feather, solidColorHex);
                    if (progressInner) progressInner.style.width = '100%';
                }

                if (bgChoice === 'white') {
                    resultBlob = await compositeOntoColor(resultBlob, '#ffffff');
                } else if (bgChoice === 'custom') {
                    resultBlob = await compositeOntoColor(resultBlob, bgColor);
                }

                const downloadName = `${stripExtension(file.name)}_去背.png`;
                fillBgremoveResultCard(card, file, resultBlob, downloadName);
                bgremovedResults.push({ filename: downloadName, blob: resultBlob });
            } catch (err) {
                console.error('去背失敗：', file.name, err);
                const reason = (err && err.message) || '未知錯誤';
                card.innerHTML = `<div class="status-line">❌ ${file.name} 去背失敗<br>${reason}</div>`;
            }
        }

        if (mode === 'ai') {
            bgremoveEngineStatus.textContent = bgremovedResults.length > 0 ? '✅ 處理完成' : '';
        } else if (mode === 'multi') {
            bgremoveEngineStatus.textContent = bgremovedResults.length > 0 ? '✅ 處理完成(多物件模式)' : '';
        } else {
            bgremoveEngineStatus.textContent = bgremovedResults.length > 0 ? '✅ 處理完成(純色背景移除，未使用 AI 模型)' : '';
        }
        bgremoveStartBtn.disabled = false;
    });

    bgremoveDownloadAllBtn.addEventListener('click', async () => {
        if (bgremovedResults.length === 0) {
            alert('目前還沒有去背完成的圖片，請先按「開始去背」。');
            return;
        }
        if (typeof JSZip === 'undefined') {
            alert('打包功能需要載入 JSZip 函式庫，請確認網路連線正常後重新整理頁面再試一次。');
            return;
        }

        bgremoveDownloadAllBtn.disabled = true;
        bgremoveDownloadAllBtn.textContent = '打包中...';

        try {
            const zip = new JSZip();
            const usedNames = new Set();

            bgremovedResults.forEach(item => {
                let name = item.filename;
                let counter = 1;
                while (usedNames.has(name)) {
                    name = item.filename.replace(/(\.[^.]+)$/, `_${counter}$1`);
                    counter++;
                }
                usedNames.add(name);
                zip.file(name, item.blob);
            });

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `去背圖片_${bgremovedResults.length}張.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('打包失敗：', err);
            alert('打包失敗，請稍後再試一次。');
        } finally {
            bgremoveDownloadAllBtn.disabled = false;
            bgremoveDownloadAllBtn.textContent = '📦 打包下載全部(ZIP)';
        }
    });

    } // startApp() 結束
});
