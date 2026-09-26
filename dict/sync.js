// ===== 云同步模块（WebDAV / OneDrive 双后端）=====
const SYNC_ENABLED = "wordGameWebdavEnabled";
const SYNC_URL = "wordGameWebdavUrl";
const SYNC_USER = "wordGameWebdavUser";
const SYNC_PASS = "wordGameWebdavPass";
const SYNC_INSECURE = "wordGameWebdavInsecure";
const ONEDRIVE_ENABLED = "wordGameOneDriveEnabled";
const SYNC_SKIP_KEYS = ["wordGameAccess", "wordGameParentPin", "wordGameGitHubUser", "wordGameMSAToken"];

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

function isOneDriveEnabled() {
    return localStorage.getItem(ONEDRIVE_ENABLED) === "1";
}
function isWebdavEnabled() {
    return localStorage.getItem(SYNC_ENABLED) === "1";
}
// 整体同步是否开启：OneDrive 优先，其次 WebDAV
function isSyncEnabled() {
    return isOneDriveEnabled() || isWebdavEnabled();
}
function getSyncConfig() {
    return {
        url: (localStorage.getItem(SYNC_URL) || "").trim(),
        user: (localStorage.getItem(SYNC_USER) || "").trim(),
        pass: localStorage.getItem(SYNC_PASS) || "",
        insecure: localStorage.getItem(SYNC_INSECURE) === "1"
    };
}
function collectSyncData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (SYNC_SKIP_KEYS.includes(k)) continue;
        data[k] = localStorage.getItem(k);
    }
    return data;
}
function syncHeaders(user, pass) {
    const h = { "Content-Type": "application/json" };
    if (user) h["Authorization"] = "Basic " + btoa(user + ":" + pass);
    return h;
}

// ===== OneDrive 同步 =====
const ONEDRIVE_FILE = "wordgame-sync.json";
function getAccessToken() {
    return localStorage.getItem("wordGameMSAToken");
}
function onedriveHeaders() {
    return { "Authorization": "Bearer " + getAccessToken() };
}
async function onedriveRequest(method, onStatus) {
    const url = "https://graph.microsoft.com/v1.0/me/drive/root:/" + ONEDRIVE_FILE + ":/content";
    // 第一次请求
    let resp = await fetch(url, { method, headers: onedriveHeaders() });
    // 401 → 自动刷新 token 后重试一次
    if (resp.status === 401 && typeof refreshAccessToken === "function") {
        if (onStatus) onStatus("🔄 Token 过期，正在自动刷新…");
        const ok = await refreshAccessToken();
        if (ok) {
            resp = await fetch(url, { method, headers: onedriveHeaders() });
        }
    }
    return resp;
}

async function onedrivePull(onStatus) {
    setSyncState("syncing");
    try {
        if (onStatus) onStatus("📥 正在从 OneDrive 拉取…");
        const resp = await onedriveRequest("GET", onStatus);
        if (resp.status === 404) {
            await onedrivePush(onStatus);
            return;
        }
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        if (!data || typeof data !== "object") throw new Error("远端数据格式错误");
        let count = 0;
        Object.keys(data).forEach(k => {
            if (SYNC_SKIP_KEYS.includes(k)) return;
            localStorage.setItem(k, String(data[k]));
            count++;
        });
        setSyncState("idle");
        if (onStatus) onStatus("✅ 已从 OneDrive 拉取 " + count + " 项配置");
    } catch (e) {
        setSyncState("error", e.message);
        if (onStatus) onStatus("⚠️ OneDrive 拉取失败：" + e.message);
        console.warn("[OneDrive] pull failed:", e.message);
    }
}
async function onedrivePush(onStatus) {
    setSyncState("syncing");
    try {
        if (onStatus) onStatus("📤 正在推送到 OneDrive…");
        const body = JSON.stringify(collectSyncData());
        const resp = await fetch(
            "https://graph.microsoft.com/v1.0/me/drive/root:/" + ONEDRIVE_FILE + ":/content",
            { method: "PUT", headers: onedriveHeaders(), body: body }
        );
        if (resp.status === 401 && typeof refreshAccessToken === "function") {
            if (onStatus) onStatus("🔄 Token 过期，正在自动刷新…");
            const ok = await refreshAccessToken();
            if (ok) {
                const resp2 = await fetch(
                    "https://graph.microsoft.com/v1.0/me/drive/root:/" + ONEDRIVE_FILE + ":/content",
                    { method: "PUT", headers: onedriveHeaders(), body: body }
                );
                if (!resp2.ok && resp2.status !== 200 && resp2.status !== 201) throw new Error("HTTP " + resp2.status);
                setSyncState("idle");
                if (onStatus) onStatus("✅ 已推送本地配置到 OneDrive");
                return;
            }
        }
        if (!resp.ok && resp.status !== 200 && resp.status !== 201) throw new Error("HTTP " + resp.status);
        setSyncState("idle");
        if (onStatus) onStatus("✅ 已推送本地配置到 OneDrive");
    } catch (e) {
        setSyncState("error", e.message);
        if (onStatus) onStatus("⚠️ OneDrive 推送失败：" + e.message);
        console.warn("[OneDrive] push failed:", e.message);
    }
}

// ===== 统一入口：根据后端选择路由 =====
async function syncPull(onStatus) {
    if (isOneDriveEnabled()) {
        if (!getAccessToken()) { setSyncState("error", "未登录微软账号"); if (onStatus) onStatus("⚠️ 请先登录微软账号"); return; }
        await onedrivePull(onStatus);
        return;
    }
    if (!isWebdavEnabled()) { setSyncState("off"); return; }
    const cfg = getSyncConfig();
    if (!cfg.url) { setSyncState("error", "未配置 WebDAV 地址"); if (onStatus) onStatus("⚠️ 未配置 WebDAV 地址"); return; }
    setSyncState("syncing");
    try {
        if (onStatus) onStatus("📥 正在从 WebDAV 拉取…");
        const resp = await fetch(cfg.url, { method: "GET", headers: syncHeaders(cfg.user, cfg.pass) });
        if (resp.status === 404) { await syncPush(onStatus); return; }
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        if (!data || typeof data !== "object") throw new Error("远端数据格式错误");
        let count = 0;
        Object.keys(data).forEach(k => {
            if (SYNC_SKIP_KEYS.includes(k)) return;
            localStorage.setItem(k, String(data[k]));
            count++;
        });
        setSyncState("idle");
        if (onStatus) onStatus("✅ 已拉取 " + count + " 项配置");
    } catch (e) {
        setSyncState("error", e.message);
        if (onStatus) onStatus("⚠️ 拉取失败：" + e.message);
    }
}

async function syncPush(onStatus) {
    if (isOneDriveEnabled()) {
        if (!getAccessToken()) { setSyncState("error", "未登录微软账号"); if (onStatus) onStatus("⚠️ 请先登录微软账号"); return; }
        await onedrivePush(onStatus);
        return;
    }
    if (!isWebdavEnabled()) { setSyncState("off"); return; }
    const cfg = getSyncConfig();
    if (!cfg.url) { setSyncState("error", "未配置 WebDAV 地址"); if (onStatus) onStatus("⚠️ 未配置 WebDAV 地址"); return; }
    setSyncState("syncing");
    try {
        if (onStatus) onStatus("📤 正在推送到 WebDAV…");
        const body = JSON.stringify(collectSyncData());
        const resp = await fetch(cfg.url, { method: "PUT", headers: syncHeaders(cfg.user, cfg.pass), body: body });
        if (!resp.ok && resp.status !== 204) throw new Error("HTTP " + resp.status);
        setSyncState("idle");
        if (onStatus) onStatus("✅ 已推送本地配置到 WebDAV");
    } catch (e) {
        setSyncState("error", e.message);
        if (onStatus) onStatus("⚠️ 推送失败：" + e.message);
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
    report.push("同步后端: " + (isOneDriveEnabled() ? "OneDrive" : (isWebdavEnabled() ? "WebDAV" : "未开启")));
    if (isOneDriveEnabled()) {
        report.push("OneDrive 文件: /" + ONEDRIVE_FILE);
        if (!getAccessToken()) { report.push("→ 结果: 未登录微软账号，请先登录"); return report.join("\n"); }
        try {
            report.push("→ 正在测试 OneDrive GET …");
            const resp = await fetch(
                "https://graph.microsoft.com/v1.0/me/drive/root:/" + ONEDRIVE_FILE + ":/content",
                { method: "GET", headers: onedriveHeaders() }
            );
            report.push("→ GET 响应: HTTP " + resp.status);
            if (resp.status === 401 || resp.status === 403) report.push("→ 诊断: 授权过期，请重新登录");
            else if (resp.status === 404) report.push("→ 诊断: 文件不存在，首次同步将自动创建");
            else if (resp.ok) report.push("→ 诊断: OneDrive 连接正常");
            else report.push("→ 诊断: 错误 HTTP " + resp.status);
        } catch (e) {
            report.push("→ 诊断: 网络错误 — " + e.message);
        }
        return report.join("\n");
    }
    const cfg = getSyncConfig();
    report.push("WebDAV 地址: " + (cfg.url || "(空)"));
    if (!cfg.url) { report.push("→ 结果: 请先填写 WebDAV 地址"); return report.join("\n"); }
    try {
        const resp = await fetch(cfg.url, { method: "GET", headers: syncHeaders(cfg.user, cfg.pass) });
        report.push("→ GET 响应: HTTP " + resp.status);
        if (resp.status === 401 || resp.status === 403) report.push("→ 诊断: 认证失败");
        else if (resp.status === 404) report.push("→ 诊断: 文件不存在，首次同步将自动创建");
        else report.push("→ 诊断: 连接正常");
    } catch (e) {
        report.push("→ 诊断: 网络错误 — " + e.message);
    }
    return report.join("\n");
}
