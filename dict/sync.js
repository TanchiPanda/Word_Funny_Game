// ===== WebDAV 云同步模块 =====
const SYNC_ENABLED = "wordGameWebdavEnabled";
const SYNC_URL = "wordGameWebdavUrl";
const SYNC_USER = "wordGameWebdavUser";
const SYNC_PASS = "wordGameWebdavPass";
const SYNC_INSECURE = "wordGameWebdavInsecure";
const SYNC_SKIP_KEYS = ["wordGameAccess", "wordGameParentPin"];

// ===== 同步状态机 =====
// state: off | idle | syncing | error
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

function isSyncEnabled() {
    return localStorage.getItem(SYNC_ENABLED) === "1";
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

// 从 WebDAV 拉取数据合并到本地
async function syncPull(onStatus) {
    if (!isSyncEnabled()) { setSyncState("off"); return; }
    const cfg = getSyncConfig();
    if (!cfg.url) { setSyncState("error", "未配置 WebDAV 地址"); if (onStatus) onStatus("⚠️ 未配置 WebDAV 地址"); return; }
    setSyncState("syncing");
    try {
        if (onStatus) onStatus("📥 正在从 WebDAV 拉取…");
        const resp = await fetch(cfg.url, {
            method: "GET",
            headers: syncHeaders(cfg.user, cfg.pass)
        });
        if (resp.status === 404) {
            await syncPush(onStatus);
            return;
        }
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("远端数据格式错误");
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
        console.warn("[WebDAV] pull failed:", e.message);
    }
}

// 推送本地数据到 WebDAV
async function syncPush(onStatus) {
    if (!isSyncEnabled()) { setSyncState("off"); return; }
    const cfg = getSyncConfig();
    if (!cfg.url) { setSyncState("error", "未配置 WebDAV 地址"); if (onStatus) onStatus("⚠️ 未配置 WebDAV 地址"); return; }
    setSyncState("syncing");
    try {
        if (onStatus) onStatus("📤 正在推送到 WebDAV…");
        const body = JSON.stringify(collectSyncData());
        const resp = await fetch(cfg.url, {
            method: "PUT",
            headers: syncHeaders(cfg.user, cfg.pass),
            body: body
        });
        if (!resp.ok && resp.status !== 204) throw new Error("HTTP " + resp.status);
        setSyncState("idle");
        if (onStatus) onStatus("✅ 已推送本地配置到 WebDAV");
    } catch (e) {
        setSyncState("error", e.message);
        if (onStatus) onStatus("⚠️ 推送失败：" + e.message);
        console.warn("[WebDAV] push failed:", e.message);
    }
}

// 防抖：游戏中频繁变更时合并推送
let syncPushTimer = null;
function syncPushDebounced(delayMs) {
    if (!isSyncEnabled()) return;
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(() => { syncPush(); }, delayMs || 1500);
}

// ===== 诊断：测试连接并返回详细信息 =====
async function syncDiagnose() {
    const cfg = getSyncConfig();
    const report = [];
    report.push("同步开关: " + (isSyncEnabled() ? "已开启" : "未开启"));
    report.push("地址: " + (cfg.url || "(空)"));
    report.push("用户名: " + (cfg.user || "(空)"));
    report.push("无TLS模式: " + (cfg.insecure ? "是" : "否"));
    if (!cfg.url) { report.push("→ 结果: 请先填写 WebDAV 地址"); return report.join("\n"); }
    // 检查协议
    if (/^http:\/\//.test(cfg.url) && !cfg.insecure) {
        report.push("→ 警告: 使用 HTTP 但未勾选「不使用 HTTPS」");
    }
    try {
        report.push("→ 正在测试 GET …");
        const resp = await fetch(cfg.url, { method: "GET", headers: syncHeaders(cfg.user, cfg.pass) });
        report.push("→ GET 响应: HTTP " + resp.status);
        if (resp.status === 401 || resp.status === 403) {
            report.push("→ 诊断: 认证失败，请检查用户名/密码");
        } else if (resp.status === 404) {
            report.push("→ 诊断: 远端文件不存在，首次同步将自动创建");
        } else if (!resp.ok) {
            report.push("→ 诊断: 服务器返回错误");
        } else {
            report.push("→ 诊断: 连接正常");
        }
    } catch (e) {
        report.push("→ 诊断: 网络错误 — " + e.message);
        if (/Failed to fetch|NetworkError/i.test(e.message)) {
            report.push("→ 可能原因: CORS 未放行 / 地址错误 / 服务器不可达 / HTTPS 页面请求 HTTP 被拦截");
        }
    }
    return report.join("\n");
}
