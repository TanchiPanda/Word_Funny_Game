// ===== 云同步模块（Backblaze B2 S3）=====
// 路径：users/{userId}/wordgame-sync.json

// ===== 常量 =====
const B2_KEY = {
    enabled: "wordGameB2Enabled",
    preset: "wordGameB2Preset",
    endpoint: "wordGameB2Endpoint",
    bucket: "wordGameB2Bucket",
    keyId: "wordGameB2KeyId",
    appKey: "wordGameB2AppKey"
};

const R6T5_DEFAULTS = {
    endpoint: "s3.us-east-005.backblazeb2.com",
    bucket: "R6T5Data",
    keyId: "c54e99fa0348",
    appKey: "005543fcad6847de92fac91554e897acf3493c9a00"
};

const SKIP_KEYS = [
    "wordGameGitHubUser",
    "wordGameMSAToken", "wordGameMSARefresh", "wordGameMSAExpires",
    B2_KEY.keyId, B2_KEY.appKey
];

// ===== 状态 =====
var _state = "off";
var _error = "";
var _lastOk = "";
var _listeners = [];

function onSyncStateChange(fn) {
    _listeners.push(fn);
    fn(_state, _error, _lastOk);
}
function _setState(s, err) {
    _state = s;
    _error = (s === "error") ? (err || "未知错误") : "";
    if (s === "idle") _lastOk = new Date().toLocaleTimeString();
    for (var i = 0; i < _listeners.length; i++) {
        try { _listeners[i](_state, _error, _lastOk); } catch(e) {}
    }
}
function getSyncState() { return { state: _state, error: _error, lastOk: _lastOk }; }
function isSyncEnabled() { return localStorage.getItem(B2_KEY.enabled) === "1"; }

function getUserId() {
    try {
        var u = JSON.parse(localStorage.getItem("wordGameGitHubUser") || "null");
        return (u && u.id) ? u.id : null;
    } catch(e) { return null; }
}

function _getConfig() {
    if (localStorage.getItem(B2_KEY.preset) === "1") return { ...R6T5_DEFAULTS };
    return {
        endpoint: (localStorage.getItem(B2_KEY.endpoint) || "").trim(),
        bucket: (localStorage.getItem(B2_KEY.bucket) || "").trim(),
        keyId: (localStorage.getItem(B2_KEY.keyId) || "").trim(),
        appKey: (localStorage.getItem(B2_KEY.appKey) || "").trim()
    };
}

// ===== SDK 加载 =====
var _s3 = null; // { client, GetObjectCommand, PutObjectCommand }

function _loadSDK() {
    if (_s3) return Promise.resolve(_s3);
    return new Promise(function(resolve, reject) {
        if (window.__AWS_S3) { _s3 = window.__AWS_S3; resolve(_s3); return; }
        var s = document.createElement("script");
        s.type = "module";
        s.textContent =
            'import { S3Client, GetObjectCommand, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.525.0?target=web";' +
            'window.__AWS_S3 = { S3Client, GetObjectCommand, PutObjectCommand };' +
            'window.dispatchEvent(new Event("aws-s3-ready"));';
        window.addEventListener("aws-s3-ready", function() {
            _s3 = window.__AWS_S3;
            resolve(_s3);
        });
        s.onerror = function() { reject(new Error("SDK 加载失败")); };
        document.head.appendChild(s);
        setTimeout(function() { reject(new Error("SDK 加载超时")); }, 20000);
    });
}

async function _getClient() {
    var cfg = _getConfig();
    if (!cfg.keyId || !cfg.appKey || !cfg.endpoint || !cfg.bucket) throw new Error("未配置 B2 参数");
    var sdk = await _loadSDK();
    return new sdk.S3Client({
        region: "us-east-005",
        endpoint: "https://" + cfg.endpoint,
        credentials: { accessKeyId: cfg.keyId, secretAccessKey: cfg.appKey },
        forcePathStyle: true
    });
}

// ===== 数据收集/恢复 =====
function _collect() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (SKIP_KEYS.indexOf(k) >= 0) continue;
        data[k] = localStorage.getItem(k);
    }
    return data;
}

function _apply(data) {
    if (!data || typeof data !== "object") return 0;
    var n = 0;
    Object.keys(data).forEach(function(k) {
        if (SKIP_KEYS.indexOf(k) >= 0) return;
        localStorage.setItem(k, String(data[k]));
        n++;
    });
    return n;
}

function _userPath(file) {
    var uid = getUserId();
    if (!uid) throw new Error("未登录");
    return "users/" + uid + "/" + file;
}

// ===== 拉取 =====
async function syncPull(onStatus) {
    if (!isSyncEnabled()) { _setState("off"); return; }
    var uid = getUserId();
    if (!uid) { _setState("error", "未登录"); if(onStatus) onStatus("⚠️ 请先登录"); return; }

    _setState("syncing");
    try {
        if (onStatus) onStatus("📥 正在拉取…");
        var cfg = _getConfig();
        var client = await _getClient();
        var sdk = await _loadSDK();
        var key = _userPath("wordgame-sync.json");

        var obj = await client.send(new sdk.GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        var body = await obj.Body.transformToString();
        var data = JSON.parse(body);
        var n = _apply(data);
        _setState("idle");
        if (onStatus) onStatus("✅ 已拉取 " + n + " 项");
    } catch (e) {
        var code = e.name || (e.$metadata && e.$metadata.httpStatusCode);
        if (code === "NoSuchKey" || code === 404) {
            // 文件不存在，首次推送
            if (onStatus) onStatus("📤 首次同步，推送…");
            await syncPush(onStatus);
        } else {
            var msg = e.message || String(e);
            _setState("error", msg);
            if (onStatus) onStatus("⚠️ " + msg);
        }
    }
}

// ===== 推送 =====
async function syncPush(onStatus) {
    if (!isSyncEnabled()) { _setState("off"); return; }
    var uid = getUserId();
    if (!uid) { _setState("error", "未登录"); if(onStatus) onStatus("⚠️ 请先登录"); return; }

    _setState("syncing");
    try {
        if (onStatus) onStatus("📤 正在推送…");
        var cfg = _getConfig();
        var client = await _getClient();
        var sdk = await _loadSDK();
        var key = _userPath("wordgame-sync.json");
        var body = JSON.stringify(_collect());

        await client.send(new sdk.PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: body,
            ContentType: "application/json"
        }));
        _setState("idle");
        if (onStatus) onStatus("✅ 已推送");
    } catch (e) {
        var msg = e.message || String(e);
        _setState("error", msg);
        if (onStatus) onStatus("⚠️ " + msg);
    }
}

// ===== 防抖推送 =====
var _timer = null;
function syncPushDebounced(ms) {
    if (!isSyncEnabled()) return;
    clearTimeout(_timer);
    _timer = setTimeout(function() { syncPush(); }, ms || 1500);
}

// ===== 诊断 =====
async function syncDiagnose() {
    var r = [];
    var cfg = _getConfig();
    r.push("后端: " + (isSyncEnabled() ? "Backblaze B2" : "未开启"));
    r.push("Endpoint: " + (cfg.endpoint || "(空)"));
    r.push("Bucket: " + (cfg.bucket || "(空)"));
    r.push("User: " + (getUserId() || "(未登录)"));

    if (!cfg.keyId) { r.push("→ 请先配置参数"); return r.join("\n"); }

    try {
        var client = await _getClient();
        var sdk = await _loadSDK();
        var key = _userPath("wordgame-sync.json");
        r.push("→ 测试 GET: " + key);
        await client.send(new sdk.GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        r.push("→ ✅ 连接正常");
    } catch (e) {
        var code = e.name || (e.$metadata && e.$metadata.httpStatusCode);
        if (code === "NoSuchKey" || code === 404) {
            r.push("→ 文件不存在，首次同步将自动创建");
        } else {
            r.push("→ ⚠️ " + (e.message || JSON.stringify(e)));
        }
    }
    return r.join("\n");
}
