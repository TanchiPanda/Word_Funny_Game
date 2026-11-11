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

var CN_SB_URL  = "https://bxanbosouqnezggwdqhs.supabase.co";
var CN_SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4YW5ib3NvdXFuZXpnZ3dkcWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzNDg5NjAsImV4cCI6MjEwOTkyNDk2MH0.a29TONXcHs6lssvNw0KCAMVw6KkWsgysH5fiM3Pr0HM";
var CN_APP_ID  = "wordgm-md-beta";

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
    return u;
}

function sbGetUser() {
    try {
        var u = JSON.parse(localStorage.getItem(SB_USER_KEY) || "null");
        if (u && (u.id || u.email)) return u;
    } catch (e) {}
    var c = _readHubCookie("ms_user");
    if (c) { try { return JSON.parse(c); } catch (e) {} }
    return null;
}

async function sbRefreshUser() {
    var client = await sbInit();
    var { data } = await client.auth.getSession();
    if (data && data.session && data.session.user) {
        return _saveAuth(_mapUser(data.session.user));
    }
    return null;
}

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
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*))"));
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
    var client = await sbInit();
    var params = new URLSearchParams(location.search);
    if (params.get("code") || location.hash.indexOf("access_token") >= 0) {
        var { data, error } = await client.auth.getSessionFromUrl({ storeSession: true });
        if (!error && data && data.session) {
            return _saveAuth(_mapUser(data.session.user));
        }
    }
    var u = await sbRefreshUser();
    return u;
}

async function msLogout(redirectUri, opt) {
    var back = (opt && opt.postLogoutRedirectUri) || (location.origin + "/index.html");
    try {
        var client = await sbInit();
        await client.auth.signOut();
    } catch (e) {}
    try { localStorage.removeItem(SB_USER_KEY); } catch (e) {}
    _clearHubCookie("ms_user");
    location.href = back;
}

var msGetUser = sbGetUser;
function msClearLocal() {
    try { localStorage.removeItem(SB_USER_KEY); } catch (e) {}
    _clearHubCookie("ms_user");
}
async function msGetToken() { return null; }
function msPeekToken() { return null; }
function msHasToken() { return false; }
async function graphFetch() { throw new Error("OneDrive 同步已停用"); }
async function msGetDriveQuota() { return { total: 0, used: 0, remaining: 0 }; }
