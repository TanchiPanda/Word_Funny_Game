// ===== 云同步模块（Backblaze B2 / S3 兼容）=====
// 存储路径：users/{userId}/wordgame-sync.json
//           users/{userId}/books/{bookId}.json（>200MB 跳过）

const B2_KEY_ID = "wordGameB2KeyId";
const B2_APP_KEY = "wordGameB2AppKey";
const B2_ENDPOINT = "wordGameB2Endpoint";
const B2_BUCKET = "wordGameB2Bucket";
const B2_ENABLED = "wordGameB2Enabled";
const B2_PRESET = "wordGameB2Preset";

const BOOK_SIZE_LIMIT = 200 * 1024 * 1024; // 200MB

const SYNC_SKIP_KEYS = [
    "wordGameGitHubUser", "wordGameMSAToken", "wordGameMSARefresh", "wordGameMSAExpires",
    B2_KEY_ID, B2_APP_KEY
];

// R6T5 共享 B2 参数
const R6T5_B2 = {
    endpoint: "s3.us-east-005.backblazeb2.com",
    bucket: "R6T5-Hub",
    keyId: "005c54e99fa03480000000001",
    appKey: "K005Zw12BLILAG9/jGP53wV61uQ8QMk"
};

// ===== 同步状态机 =====
let syncState = "off";
let syncError = "";
let syncLastOk = "";
const syncListeners = [];
function onSyncStateChange(fn) { syncListeners.push(fn); fn(syncState, syncError, syncLastOk); }
function setSyncState(state, errMsg) {
    syncState = state;
    if (state === "error") syncError = errMsg || "未知错误";
    if (state === "idle") { syncError = ""; syncLastOk = new Date().toLocaleTimeString(); }
    syncListeners.forEach(fn => fn(syncState, syncError, syncLastOk));
}
function getSyncState() { return { state: syncState, error: syncError, lastOk: syncLastOk }; }

// ===== B2 配置 =====
function isSyncEnabled() {
    return localStorage.getItem(B2_ENABLED) === "1";
}
function getB2Config() {
    const preset = localStorage.getItem(B2_PRESET) === "1";
    if (preset) return { ...R6T5_B2 };
    return {
        keyId: (localStorage.getItem(B2_KEY_ID) || "").trim(),
        appKey: (localStorage.getItem(B2_APP_KEY) || "").trim(),
        endpoint: (localStorage.getItem(B2_ENDPOINT) || "").trim(),
        bucket: (localStorage.getItem(B2_BUCKET) || "").trim()
    };
}
function getUserId() {
    try {
        const u = JSON.parse(localStorage.getItem("wordGameGitHubUser") || "null");
        return (u && u.id) ? u.id : null;
    } catch (e) { return null; }
}

// ===== S3 client（懒加载 AWS SDK v3）=====
let s3Client = null;
async function getS3Client() {
    const cfg = getB2Config();
    if (!cfg.keyId || !cfg.appKey || !cfg.endpoint || !cfg.bucket) return null;
    if (s3Client) return s3Client;
    if (!window.AWS || !window.AWS.S3Client) {
        await loadScript("https://cdn.jsdelivr.net/npm/@aws-sdk/client-s3@3.525.0/dist/index.min.js");
    }
    s3Client = new window.AWS.S3Client({
        region: "us-east-005",
        endpoint: "https://" + cfg.endpoint,
        credentials: { accessKeyId: cfg.keyId, secretAccessKey: cfg.appKey },
        forcePathStyle: true
    });
    return s3Client;
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}

// ===== 路径工具 =====
function userPath(file) {
    const uid = getUserId();
    if (!uid) throw new Error("未登录");
    return "users/" + uid + "/" + file;
}

// ===== 收集/恢复数据 =====
function collectSyncData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (SYNC_SKIP_KEYS.includes(k)) continue;
        data[k] = localStorage.getItem(k);
    }
    return data;
}
function applySyncData(data) {
    if (!data || typeof data !== "object") return 0;
    let count = 0;
    Object.keys(data).forEach(k => {
        if (SYNC_SKIP_KEYS.includes(k)) return;
        localStorage.setItem(k, String(data[k]));
        count++;
    });
    return count;
}

// ===== 主数据同步（游戏进度/设置）=====
async function syncPull(onStatus) {
    if (!isSyncEnabled()) { setSyncState("off"); return; }
    const cfg = getB2Config();
    if (!cfg.keyId) { setSyncState("error", "未配置 B2"); if (onStatus) onStatus("⚠️ 请先配置 B2"); return; }
    if (!getUserId()) { setSyncState("error", "未登录"); if (onStatus) onStatus("⚠️ 请先登录"); return; }
    setSyncState("syncing");
    try {
        if (onStatus) onStatus("📥 正在拉取…");
        const client = await getS3Client();
        const key = userPath("wordgame-sync.json");
        try {
            const { GetObjectCommand } = window.AWS;
            const obj = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
            const body = await obj.Body.transformToString();
            const data = JSON.parse(body);
            const count = applySyncData(data);
            setSyncState("idle");
            if (onStatus) onStatus("✅ 已拉取 " + count + " 项配置");
        } catch (e) {
            const code = e.name || e.Code || (e.$metadata && e.$metadata.httpStatusCode);
            if (code === "NoSuchKey" || code === 404 || code === "NotFound") {
                if (onStatus) onStatus("📤 首次同步，推送数据…");
                await syncPush(onStatus);
            } else {
                throw e;
            }
        }
    } catch (e) {
        const msg = e.message || String(e);
        setSyncState("error", msg);
        if (onStatus) onStatus("⚠️ 拉取失败：" + msg);
    }
}

async function syncPush(onStatus) {
    if (!isSyncEnabled()) { setSyncState("off"); return; }
    const cfg = getB2Config();
    if (!cfg.keyId) { setSyncState("error", "未配置 B2"); if (onStatus) onStatus("⚠️ 请先配置 B2"); return; }
    if (!getUserId()) { setSyncState("error", "未登录"); if (onStatus) onStatus("⚠️ 请先登录"); return; }
    setSyncState("syncing");
    try {
        if (onStatus) onStatus("📤 正在推送…");
        const client = await getS3Client();
        const key = userPath("wordgame-sync.json");
        const body = JSON.stringify(collectSyncData());
        const { PutObjectCommand } = window.AWS;
        await client.send(new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: body,
            ContentType: "application/json"
        }));
        setSyncState("idle");
        if (onStatus) onStatus("✅ 已推送本地配置");
    } catch (e) {
        const msg = e.message || String(e);
        setSyncState("error", msg);
        if (onStatus) onStatus("⚠️ 推送失败：" + msg);
    }
}

// ===== 词书同步（>200MB 跳过）=====
async function syncBook(bookId, bookData, onStatus) {
    if (!isSyncEnabled() || !getUserId()) return false;
    const cfg = getB2Config();
    if (!cfg.keyId) return false;
    try {
        const body = JSON.stringify(bookData);
        if (body.length > BOOK_SIZE_LIMIT) {
            if (onStatus) onStatus("⏭️ 词书 " + bookId + " 超过 200MB，跳过");
            return false;
        }
        const client = await getS3Client();
        const key = userPath("books/" + bookId + ".json");
        const { PutObjectCommand } = window.AWS;
        await client.send(new PutObjectCommand({
            Bucket: cfg.bucket, Key: key, Body: body, ContentType: "application/json"
        }));
        return true;
    } catch (e) {
        if (onStatus) onStatus("⚠️ 词书 " + bookId + " 同步失败：" + (e.message || e));
        return false;
    }
}

async function pullBook(bookId) {
    if (!isSyncEnabled() || !getUserId()) return null;
    const cfg = getB2Config();
    if (!cfg.keyId) return null;
    try {
        const client = await getS3Client();
        const key = userPath("books/" + bookId + ".json");
        const { GetObjectCommand } = window.AWS;
        const obj = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const body = await obj.Body.transformToString();
        return JSON.parse(body);
    } catch (e) {
        return null;
    }
}

// 防抖推送
let syncPushTimer = null;
function syncPushDebounced(delayMs) {
    if (!isSyncEnabled()) return;
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(() => { syncPush(); }, delayMs || 1500);
}

// ===== 诊断 =====
async function syncDiagnose() {
    const report = [];
    const cfg = getB2Config();
    report.push("同步后端: " + (isSyncEnabled() ? "Backblaze B2" : "未开启"));
    report.push("Endpoint: " + (cfg.endpoint || "(空)"));
    report.push("Bucket: " + (cfg.bucket || "(空)"));
    report.push("User: " + (getUserId() || "(未登录)"));
    if (!cfg.keyId) { report.push("→ 结果: 请先配置 B2 Key ID"); return report.join("\n"); }
    try {
        const client = await getS3Client();
        const key = userPath("wordgame-sync.json");
        report.push("→ 测试 GET: " + key);
        const { GetObjectCommand } = window.AWS;
        await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        report.push("→ 结果: ✅ 连接正常");
    } catch (e) {
        const code = e.name || e.Code || (e.$metadata && e.$metadata.httpStatusCode);
        if (code === "NoSuchKey" || code === 404 || code === "NotFound") {
            report.push("→ 结果: 文件不存在，首次同步将自动创建");
        } else {
            report.push("→ 结果: ⚠️ " + (e.message || JSON.stringify(e)));
        }
    }
    return report.join("\n");
}
