// ===== 云同步模块（Cloudflare R2 S3 / AWS SDK v2）=====

const B2_KEY = {
    enabled: "wordGameB2Enabled",
    preset: "wordGameB2Preset",
    endpoint: "wordGameB2Endpoint",
    bucket: "wordGameB2Bucket",
    keyId: "wordGameB2KeyId",
    appKey: "wordGameB2AppKey"
};

const R6T5_DEFAULTS = {
    endpoint: "014ac5e0260517557de20af45ca52d27.r2.cloudflarestorage.com",
    bucket: "r6t5-hub-data",
    keyId: "c23b354df1895fe8fb71fc31c21d3205",
    appKey: "ab5b6ecf76420b49634623849576db6282fd0703575e590dbcd3428e8cdf274a"
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

// ===== SDK 加载（AWS SDK v2 浏览器版）=====
var _s3 = null;

function _loadSDK() {
    if (_s3) return Promise.resolve(_s3);
    return new Promise(function(resolve, reject) {
        if (window.AWS && window.AWS.S3) {
            _s3 = _makeClient(window.AWS);
            resolve(_s3);
            return;
        }
        var s = document.createElement("script");
        s.src = "https://sdk.amazonaws.com/js/aws-sdk-2.1692.0.min.js";
        s.onload = function() {
            if (window.AWS && window.AWS.S3) {
                _s3 = _makeClient(window.AWS);
                resolve(_s3);
            } else {
                reject(new Error("AWS SDK 加载后不可用"));
            }
        };
        s.onerror = function() { reject(new Error("SDK 加载失败")); };
        document.head.appendChild(s);
        setTimeout(function() { reject(new Error("SDK 加载超时")); }, 20000);
    });
}

function _makeClient(AWS) {
    var cfg = _getConfig();
    var ep = cfg.endpoint.startsWith("http") ? cfg.endpoint : "https://" + cfg.endpoint;
    return new AWS.S3({
        region: "auto",
        endpoint: ep,
        accessKeyId: cfg.keyId,
        secretAccessKey: cfg.appKey,
        s3ForcePathStyle: true,
        signatureVersion: "v4"
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
        var s3 = await _loadSDK();
        var key = _userPath("wordgame-sync.json");

        var data = await s3.getObject({ Bucket: cfg.bucket, Key: key }).promise();
        var body = data.Body.toString("utf-8");
        var parsed = JSON.parse(body);
        var n = _apply(parsed);
        _setState("idle");
        if (onStatus) onStatus("✅ 已拉取 " + n + " 项");
    } catch (e) {
        var code = e.code || e.statusCode;
        if (code === "NoSuchKey" || code === 404) {
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
        var s3 = await _loadSDK();
        var key = _userPath("wordgame-sync.json");
        var body = JSON.stringify(_collect());

        await s3.putObject({
            Bucket: cfg.bucket,
            Key: key,
            Body: body,
            ContentType: "application/json"
        }).promise();
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
    r.push("后端: " + (isSyncEnabled() ? "Cloudflare R2" : "未开启"));
    r.push("Endpoint: " + (cfg.endpoint || "(空)"));
    r.push("Bucket: " + (cfg.bucket || "(空)"));
    r.push("User: " + (getUserId() || "(未登录)"));

    if (!cfg.keyId) { r.push("→ 请先配置参数"); return r.join("\n"); }

    try {
        var s3 = await _loadSDK();
        var key = _userPath("wordgame-sync.json");
        r.push("→ 测试 GET: " + key);
        await s3.getObject({ Bucket: cfg.bucket, Key: key }).promise();
        r.push("→ ✅ 连接正常");
    } catch (e) {
        var code = e.code || e.statusCode;
        if (code === "NoSuchKey" || code === 404) {
            r.push("→ 文件不存在，首次同步将自动创建");
        } else {
            r.push("→ ⚠️ " + (e.message || JSON.stringify(e)));
        }
    }
    return r.join("\n");
}
