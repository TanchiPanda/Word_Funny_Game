// ===== Supabase 认证模块 =====
// 登录走 Supabase Auth；业务数据（积分/会员）仍存 Cloudflare D1，user_id 用邮箱。
// 兼容原 msauth.js 的函数名（msLogin/msGetUser/msLogout/msHandleRedirect/msTakeReturnTo），
// 各页面只需把 <script src="dict/msauth.js"> 换成 <script src="dict/sbauth.js">。

var SB_URL = "https://fckqmlwkujixwztzqqni.supabase.co";
var SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZja3FtbHdrdWppeHd6dHpxcW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMjkzODksImV4cCI6MjEwNTkwNTM4OX0.W6FHJ-CgNNuCO9xEcrNuLj2y6-1D6Gyy72D0oGmA7Xw";

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

// ---------- 用户对象映射 ----------
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

// ---------- 读取本地用户 ----------
function sbGetUser() {
    try {
        var u = JSON.parse(localStorage.getItem(SB_USER_KEY) || "null");
        if (u && (u.id || u.email)) return u;
    } catch (e) {}
    var c = _readHubCookie("ms_user");
    if (c) { try { return JSON.parse(c); } catch (e) {} }
    return null;
}

// 异步：从 Supabase 拿最新会话并写入本地
async function sbRefreshUser() {
    var client = await sbInit();
    var { data } = await client.auth.getSession();
    if (data && data.session && data.session.user) {
        return _saveAuth(_mapUser(data.session.user));
    }
    return null;
}

// ---------- 跨子域 cookie（与原 msauth 保持一致，钱包站可读）----------
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

// ---------- 登录跳转（统一跳到账号中心 myacc）----------
function msLogin(options) {
    var opt = options || {};
    var returnTo = opt.returnTo || location.href;
    var url = "https://myacc.r6t5.dpdns.org/?app=wordgm&return=" + encodeURIComponent(returnTo);
    location.href = url;
}

// ---------- 读取并清除返回页 ----------
function msTakeReturnTo(def) {
    try {
        var v = localStorage.getItem("msReturnTo");
        localStorage.removeItem("msReturnTo");
        if (v) return v;
    } catch (e) {}
    return def || "index.html";
}

// ---------- 处理回调 ----------
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

// ---------- 退出 ----------
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

// ---------- 向后兼容别名 ----------
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
