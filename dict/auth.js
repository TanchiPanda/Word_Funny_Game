// ===== 认证兼容层 =====
// 底层为 Supabase Auth（dict/sbauth.js）
// 对外保留原有函数名，避免各页面改动

const ACCOUNT_URL = "https://myacc.r6t5.dpdns.org";
const APP_ID = "wordgm";

// ---------- 登录状态 ----------
function _currentUser() {
    // 优先用 sbauth 的账号状态（会按真实 Supabase 会话校验）
    if (typeof sbGetUser === "function") {
        var u = sbGetUser();
        if (u) return u;
    }
    if (typeof msGetUser === "function") return msGetUser();
    return null;
}

function isLoggedIn() {
    return !!_currentUser();
}

function getGitHubUser() {
    return _currentUser();
}

// 兼容旧名
function getMsUser() { return msGetUser(); }

// ---------- 登录 ----------
// 跳转到 login.html（由它发起微软 OAuth）
function loginWithGitHub(opts) {
    var opt = opts || {};
    var q = "?app=" + APP_ID;
    if (opt.getToken) q += "&gettoken=true";
    if (opt.returnTo) q += "&return=" + encodeURIComponent(opt.returnTo);
    location.href = location.origin + "/login.html" + q;
}

// 兼容旧名
function loginWithGoogle(opts) { loginWithGitHub(opts); }
function loginWithMicrosoft(opts) { loginWithGitHub(opts); }

// 直接发起微软授权（不经过 login.html）
async function loginDirect() {
    await msLogin({ redirectUri: location.origin + "/login.html", returnTo: location.pathname });
}

// ---------- 退出 ----------
async function logout() {
    msClearLocal();
    await msLogout(location.origin + "/login.html");
}

// ---------- 令牌（Supabase 会话自动刷新，无需手动）----------
async function refreshAccessToken() {
    return true;
}

// ---------- 初始化 ----------
// 普通页面只读本地/ cookie 状态，不加载 MSAL（按需在调用令牌时加载）
async function initAuth() {
    if (location.pathname.endsWith("/login.html")) return;
    // 先按真实会话校验（而不是只读本地缓存），避免"显示已登录但会话已失效"
    if (typeof sbResolveAuth === "function") {
        try { return await sbResolveAuth(); } catch (e) {}
    }
    return _currentUser();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
} else {
    initAuth();
}
