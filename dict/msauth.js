// ===== Microsoft 原生 OAuth 模块（MSAL.js 2.x）=====
// 登录 + Graph 令牌（OneDrive），不依赖任何第三方认证服务

var MS_CLIENT_ID = "037a7626-10a1-4dcf-a2c7-f5746fcba1df";
var MS_AUTHORITY = "https://login.microsoftonline.com/consumers";

// 登录 + OneDrive 权限一次授权
var MS_SCOPES = ["openid", "profile", "email", "User.Read", "Files.ReadWrite", "offline_access"];

var MS_USER_KEY = "wordGameGitHubUser";
var MS_TOKEN_KEY = "wordGameMSAToken";
var MS_EXP_KEY = "wordGameMSAExpires";

var _pca = null;
var _pcaRedirect = null;
var _msalPromise = null;

// ---------- 加载 MSAL 库 ----------
function _injectMsal() {
    if (_msalPromise) return _msalPromise;
    _msalPromise = new Promise(function (resolve, reject) {
        if (window.msal && window.msal.PublicClientApplication) return resolve();
        var urls = [
            "https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js",
            "https://unpkg.com/@azure/msal-browser@2.38.3/lib/msal-browser.min.js",
            "https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js"
        ];
        var i = 0;
        (function next() {
            if (i >= urls.length) return reject(new Error("MSAL 库加载失败，请检查网络"));
            var s = document.createElement("script");
            s.src = urls[i++];
            s.onload = function () {
                if (window.msal && window.msal.PublicClientApplication) resolve();
                else next();
            };
            s.onerror = next;
            document.head.appendChild(s);
        })();
    });
    return _msalPromise;
}

// ---------- 初始化 ----------
async function msInit(redirectUri) {
    await _injectMsal();
    if (_pca && _pcaRedirect === redirectUri) return _pca;
    _pcaRedirect = redirectUri;
    _pca = new msal.PublicClientApplication({
        auth: {
            clientId: MS_CLIENT_ID,
            authority: MS_AUTHORITY,
            redirectUri: redirectUri,
            navigateToLoginRequestUrl: false
        },
        cache: {
            cacheLocation: "localStorage",
            storeAuthStateInCookie: false
        }
    });
    return _pca;
}

// 默认回调地址：login.html
function msDefaultRedirect() {
    return location.origin + "/login.html";
}

// ---------- 本地存储 ----------
function _saveAuth(result) {
    var acct = result.account || {};
    var idt = result.idTokenClaims || {};
    var email = idt.preferred_username || idt.email || acct.username || "";
    var user = {
        id: acct.homeAccountId || acct.localAccountId || email,
        name: idt.name || acct.name || email,
        email: email,
        login: email,
        avatar_url: ""
    };
    localStorage.setItem(MS_USER_KEY, JSON.stringify(user));
    if (result.accessToken) localStorage.setItem(MS_TOKEN_KEY, result.accessToken);
    if (result.expiresOn) {
        localStorage.setItem(MS_EXP_KEY, String(new Date(result.expiresOn).getTime()));
    }
    _writeHubCookie("ms_user", JSON.stringify(user), 7);
    return user;
}

function msGetUser() {
    try {
        var u = JSON.parse(localStorage.getItem(MS_USER_KEY) || "null");
        if (u && (u.id || u.email)) return u;
    } catch (e) {}
    var c = _readHubCookie("ms_user");
    if (c) { try { return JSON.parse(c); } catch (e) {} }
    return null;
}

function msPeekToken() {
    var t = localStorage.getItem(MS_TOKEN_KEY) || "";
    var exp = parseInt(localStorage.getItem(MS_EXP_KEY) || "0", 10);
    if (t && exp && Date.now() < exp - 60000) return t;
    return null;
}

// 本地是否存在令牌（含已过期）
function msHasToken() {
    return !!localStorage.getItem(MS_TOKEN_KEY);
}

function msClearLocal() {
    localStorage.removeItem(MS_USER_KEY);
    localStorage.removeItem(MS_TOKEN_KEY);
    localStorage.removeItem(MS_EXP_KEY);
    _clearHubCookie("ms_user");
}

// ---------- 跨子域 cookie ----------
function _hubCookieDomain() {
    var h = location.hostname;
    var i = h.indexOf(".");
    return i >= 0 ? "." + h.slice(i + 1) : h;
}
function _writeHubCookie(name, value, days) {
    try {
        var d = new Date();
        d.setTime(d.getTime() + (days || 7) * 864e5);
        document.cookie = name + "=" + encodeURIComponent(value) +
            ";expires=" + d.toUTCString() + ";path=/;domain=" + _hubCookieDomain() + ";SameSite=Lax;Secure";
    } catch (e) {}
}
function _readHubCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
}
function _clearHubCookie(name) {
    try {
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=" + _hubCookieDomain() + ";Secure";
    } catch (e) {}
}

// ---------- 登录 ----------
// 跳转到微软登录页
async function msLogin(options) {
    var opt = options || {};
    var pca = await msInit(opt.redirectUri || msDefaultRedirect());
    // 记录返回页（跨重定向后 query 会丢失，故存本地）
    if (opt.returnTo) {
        try { localStorage.setItem("msReturnTo", opt.returnTo); } catch (e) {}
    }
    var req = {
        scopes: MS_SCOPES,
        prompt: opt.prompt || "select_account"
    };
    try {
        await pca.loginRedirect(req);
    } catch (e) {
        await pca.acquireTokenRedirect({ scopes: MS_SCOPES });
    }
}

// 读取并清除返回页
function msTakeReturnTo(def) {
    try {
        var v = localStorage.getItem("msReturnTo");
        localStorage.removeItem("msReturnTo");
        if (v) return v;
    } catch (e) {}
    return def || "index.html";
}

// 处理回调（在 redirectUri 页面调用）
async function msHandleRedirect(redirectUri) {
    var pca = await msInit(redirectUri || msDefaultRedirect());
    var resp = null;
    try {
        resp = await pca.handleRedirectPromise();
    } catch (e) {
        // 忽略，继续尝试用缓存账号
    }
    if (resp && resp.account) return _saveAuth(resp);

    var accts = pca.getAllAccounts();
    if (accts.length) {
        pca.setActiveAccount(accts[0]);
        var silent = await _silent(pca, accts[0]);
        if (silent) return _saveAuth(silent);
    }
    return null;
}

async function _silent(pca, account) {
    try {
        return await pca.acquireTokenSilent({ scopes: MS_SCOPES, account: account });
    } catch (e) {
        return null;
    }
}

// ---------- 获取令牌（给 OneDrive 等用）----------
// 返回 accessToken；失败返回 null
async function msGetToken(opts) {
    var opt = opts || {};
    var redirectUri = opt.redirectUri || msDefaultRedirect();
    var pca = await msInit(redirectUri);

    // 1. 本地缓存有效
    var cached = msPeekToken();
    if (cached && !opt.force) return cached;

    // 2. 静默刷新
    var accts = pca.getAllAccounts();
    if (accts.length) {
        pca.setActiveAccount(accts[0]);
        var silent = await _silent(pca, accts[0]);
        if (silent && silent.accessToken) {
            _saveAuth(silent);
            return silent.accessToken;
        }
    }

    // 3. 无交互跳转（用户已在微软登录态时无感）
    if (opt.noRedirect) return null;
    try { localStorage.setItem("msReturnTo", location.pathname + location.search); } catch (e) {}
    try {
        await pca.loginRedirect({ scopes: MS_SCOPES, prompt: "none" });
    } catch (e) {
        await pca.loginRedirect({ scopes: MS_SCOPES, prompt: "select_account" });
    }
    return null;
}

// ---------- 退出 ----------
// 默认只清本地（微软会话保留，下次可静默登录）
// opt.msLogout = true 时同时退出微软账号并跳 postLogoutRedirectUri
async function msLogout(redirectUri, opt) {
    var o = opt || {};
    var back = o.postLogoutRedirectUri || (location.origin + "/index.html");
    msClearLocal();
    if (!o.msLogout) { location.href = back; return; }
    try {
        var pca = await msInit(redirectUri || msDefaultRedirect());
        var accts = pca.getAllAccounts();
        await pca.logoutRedirect({ account: accts[0] || null, postLogoutRedirectUri: back });
        return;
    } catch (e) {}
    location.href = back;
}

// ---------- Graph API ----------
async function graphFetch(url, options) {
    var token = await msGetToken({ noRedirect: true });
    if (!token) throw new Error("未授权微软存储权限");
    var opt = options || {};
    opt.headers = Object.assign({}, opt.headers || {}, { Authorization: "Bearer " + token });
    var r = await fetch(url, opt);
    if (!r.ok) throw new Error("Graph " + r.status + " " + r.statusText);
    return r;
}

// 查询 OneDrive 配额
async function msGetDriveQuota() {
    var r = await graphFetch("https://graph.microsoft.com/v1.0/me/drive");
    var d = await r.json();
    var q = d.quota || {};
    return {
        total: q.total || 0,
        used: q.used || 0,
        remaining: q.remaining || 0
    };
}
