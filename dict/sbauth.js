// ===== Supabase 认证模块 =====
// 登录走 Supabase Auth；业务数据（积分/会员）仍存 Cloudflare D1，user_id 用邮箱。
// 兼容原 msauth.js 的函数名（msLogin/msGetUser/msLogout/msHandleRedirect/msTakeReturnTo），
// 各页面只需把 <script src="dict/msauth.js"> 换成 <script src="dict/sbauth.js">。

// ---------- 节点判断：country=cn 走中国大陆服务器，否则走国际/CF 节点 ----------
function _detectChinaNode() {
    // 1) URL 显式 ?country=cn 优先
    try {
        var p = new URLSearchParams(location.search || "");
        if (p.get("country") === "cn") {
            try { sessionStorage.setItem("wordGameCountry", "cn"); } catch (e) {}
            return true;
        }
        if (p.get("country") === "intl" || p.get("country") === "cf") {
            try { sessionStorage.removeItem("wordGameCountry"); } catch (e) {}
            return false;
        }
    } catch (e) {}
    // 2) 跳转/刷新后从 sessionStorage 恢复
    try {
        if (sessionStorage.getItem("wordGameCountry") === "cn") return true;
    } catch (e) {}
    // 3) 预留：未来若 cn 子域名直接落地，在此追加 hostname 判断
    // if (location.hostname.indexOf("cn.") === 0) return true;
    return false;
}

var IS_CN_NODE = _detectChinaNode();

// TODO(CN)：等后台拿到中国大陆区域的 Supabase project URL 和 anon key 后替换下面两个占位符
var CN_SB_URL  = "https://bxanbosouqnezggwdqhs.supabase.co";
var CN_SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4YW5ib3NvdXFuZXpnZ3dkcWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzNDg5NjAsImV4cCI6MjEwOTkyNDk2MH0.a29TONXcHs6lssvNw0KCAMVw6KkWsgysH5fiM3Pr0HM";
var CN_APP_ID  = "wordgm-md-beta";  // 中国大陆测试版应用

// 国际/CF 节点（默认）
var INTL_SB_URL  = "https://fckqmlwkujixwztzqqni.supabase.co";
var INTL_SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZja3FtbHdrdWppeHd6dHpxcW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMjkzODksImV4cCI6MjEwNTkwNTM4OX0.W6FHJ-CgNNuCO9xEcrNuLj2y6-1D6Gyy72D0oGmA7Xw";
var INTL_APP_ID  = "wordgm";

var SB_URL  = IS_CN_NODE ? CN_SB_URL : INTL_SB_URL;
var SB_ANON = IS_CN_NODE ? CN_SB_ANON : INTL_SB_ANON;
var SB_APP_ID = IS_CN_NODE ? CN_APP_ID : INTL_APP_ID;

var SB_USER_KEY = "wordGameGitHubUser";
var _sb = null;
var _sbPromise = null;

// ---------- 懒加载 Supabase JS ----------
function _injectSupabase() {
    if (_sbPromise) return _sbPromise;
    _sbPromise = new Promise(function (resolve, reject) {
        if (window.supabase && window.supabase.createClient) return resolve();
        var urls = [
            "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
            "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js"
        ];
        var i = 0;
        (function next() {
            if (i >= urls.length) return reject(new Error("Supabase 库加载失败，请检查网络"));
            var s = document.createElement("script");
            s.src = urls[i++];
            s.onload = function () {
                if (window.supabase && window.supabase.createClient) resolve();
                else next();
            };
            s.onerror = next;
            document.head.appendChild(s);
        })();
    });
    return _sbPromise;
}

// ---------- 初始化 client ----------
async function sbInit() {
    if (_sb) return _sb;
    await _injectSupabase();
    _sb = window.supabase.createClient(SB_URL, SB_ANON, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
        }
    });
    return _sb;
}

function _mapUser(sbUser) {
    if (!sbUser) return null;
    var email = sbUser.email || (sbUser.user_metadata && sbUser.user_metadata.email) || "";
    var name = (sbUser.user_metadata && (sbUser.user_metadata.name || sbUser.user_metadata.full_name)) || email;
    return {
        id: sbUser.id || email,
        name: name,
        email: email,
        login: email,
        avatar_url: (sbUser.user_metadata && sbUser.user_metadata.avatar_url) || ""
    };
}

function _saveAuth(u) {
    try { localStorage.setItem(SB_USER_KEY, JSON.stringify(u)); } catch (e) {}
    _writeHubCookie("ms_user", JSON.stringify(u), 7);
    _writeHubCookie("ms_user_node", IS_CN_NODE ? "cn" : "cf", 7);
    return u;
}

function _clearAuth() {
    try { localStorage.removeItem(SB_USER_KEY); } catch (e) {}
    _clearHubCookie("ms_user");
    _clearHubCookie("ms_user_node");
}

// 登录态缓存：checked=false 时 sbGetUser 走"乐观缓存"，checked=true 时以真实会话为准
var _sbState = { user: null, checked: false, ts: 0, checking: null };

function sbGetUser() {
    if (_sbState.checked) return _sbState.user;

    // 未校验时：跨站 cookie 是账号中心最新写入的，优先于本页旧 localStorage
    var cookieNode = _readHubCookie("ms_user_node");
    if (cookieNode && cookieNode !== (IS_CN_NODE ? "cn" : "cf")) return null; // 节点不符，不能当本人

    var c = _readHubCookie("ms_user");
    if (c) {
        try {
            var cu = JSON.parse(c);
            if (cu && (cu.id || cu.email)) return cu;
        } catch (e) {}
    }
    try {
        var u = JSON.parse(localStorage.getItem(SB_USER_KEY) || "null");
        if (u && (u.id || u.email)) return u;
    } catch (e) {}
    return null;
}

// 消费 URL 里带回的会话（账号中心 return 时是 #access_token，PKCE 时是 ?code=）
async function _consumeUrlSession(client) {
    try {
        var hash = location.hash || "";
        if (hash.indexOf("access_token=") >= 0) {
            var hp = new URLSearchParams(hash.replace(/^#/, ""));
            var at = hp.get("access_token");
            var rt = hp.get("refresh_token");
            if (at && rt) {
                await client.auth.setSession({ access_token: at, refresh_token: rt });
                try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
            }
            return;
        }
        var qs = new URLSearchParams(location.search || "");
        var code = qs.get("code");
        if (code && typeof client.auth.exchangeCodeForSession === "function") {
            await client.auth.exchangeCodeForSession(code);
            try {
                qs.delete("code");
                history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs.toString() : ""));
            } catch (e) {}
        }
    } catch (e) {}
}

// 真正的登录态解析：以 Supabase 会话为唯一标准，并回写/清理本地缓存
async function sbResolveAuth(force) {
    if (_sbState.checking) return _sbState.checking;
    if (!force && _sbState.checked && Date.now() - _sbState.ts < 30000) return _sbState.user;

    _sbState.checking = (async function () {
        var user = null;
        try {
            var client = await sbInit();
            await _consumeUrlSession(client);

            var { data } = await client.auth.getSession();
            var session = data && data.session;

            // 会话过期时尝试刷新一次
            if (!session) {
                try {
                    var r = await client.auth.refreshSession();
                    if (r && r.data && r.data.session) session = r.data.session;
                } catch (e) {}
            }

            if (session && session.user) user = _saveAuth(_mapUser(session.user));
            else _clearAuth();
        } catch (e) {
            // 网络/库加载失败：不清缓存，避免误判成"未登录"
            user = sbGetUser();
        }

        _sbState.user = user;
        _sbState.checked = true;
        _sbState.ts = Date.now();
        _sbState.checking = null;
        try {
            document.dispatchEvent(new CustomEvent("sb:auth", { detail: { user: user } }));
        } catch (e) {}
        return user;
    })();

    return _sbState.checking;
}

async function sbRefreshUser() {
    return await sbResolveAuth(true);
}

// 订阅登录态变化（页面可用它刷新 UI）
function sbOnAuth(cb) {
    if (typeof cb !== "function") return;
    document.addEventListener("sb:auth", function (e) { cb(e.detail && e.detail.user); });
    cb(sbGetUser());
}

// 取当前 access_token（供服务端接口调用）
async function sbGetAccessToken() {
    try {
        var client = await sbInit();
        var { data } = await client.auth.getSession();
        if (data && data.session && data.session.access_token) return data.session.access_token;
        var r = await client.auth.refreshSession();
        if (r && r.data && r.data.session) return r.data.session.access_token;
    } catch (e) {}
    return null;
}

// 启动时自动校验一次；从账号中心切回来（focus/可见性变化）时重新校验
(function () {
    function boot() { sbResolveAuth().catch(function () {}); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else setTimeout(boot, 0);

    function recheck() {
        if (document.hidden) return;
        if (Date.now() - _sbState.ts < 10000) return;
        sbResolveAuth(true).catch(function () {});
    }
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
})();

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

function msLogin(options) {
    var opt = options || {};
    var returnTo = opt.returnTo || location.href;
    // 跳 myacc 时显式带上当前节点标记，防止 myacc 误判
    var wantCountry = IS_CN_NODE ? "cn" : "cf";
    try {
        var u = new URL(returnTo);
        u.searchParams.set("country", wantCountry);
        returnTo = u.toString();
    } catch (e) {}
    var url = "https://myacc.r6t5.dpdns.org/?app=" + SB_APP_ID + "&country=" + wantCountry + "&return=" + encodeURIComponent(returnTo);
    location.href = url;
}

function msTakeReturnTo(def) {
    try {
        var v = localStorage.getItem("msReturnTo");
        localStorage.removeItem("msReturnTo");
        if (v) return v;
    } catch (e) {}
    return def || "index.html";
}

async function msHandleRedirect(redirectUri) {
    // 统一交给 sbResolveAuth：自动消费 #access_token / ?code= 并校验会话
    return await sbResolveAuth(true);
}

async function msLogout(redirectUri, opt) {
    var back = (opt && opt.postLogoutRedirectUri) || (location.origin + "/index.html");
    try {
        var client = await sbInit();
        await client.auth.signOut();
    } catch (e) {}
    _clearAuth();
    _sbState.user = null;
    _sbState.checked = true;
    _sbState.ts = Date.now();
    location.href = back;
}

var msGetUser = sbGetUser;
function msClearLocal() {
    _clearAuth();
    _sbState.user = null;
    _sbState.checked = true;
    _sbState.ts = Date.now();
}
async function msGetToken() { return null; }
function msPeekToken() { return null; }
function msHasToken() { return false; }
async function graphFetch() { throw new Error("OneDrive 同步已停用"); }
async function msGetDriveQuota() { return { total: 0, used: 0, remaining: 0 }; }
