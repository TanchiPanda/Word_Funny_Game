// ===== 认证兼容层 =====
// 底层为微软原生 OAuth（dict/msauth.js），已移除 Supabase
// 对外保留原有函数名，避免各页面改动

const ACCOUNT_URL = "https://myacc.r6t5.dpdns.org";
const APP_ID = "wordgm";

// ---------- 登录状态 ----------
function isLoggedIn() {
    return !!msGetUser();
}

function getGitHubUser() {
    return msGetUser();
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

// ---------- 令牌 ----------
async function refreshAccessToken() {
    var t = await msGetToken({ force: true, noRedirect: true });
    return !!t;
}

// ---------- 初始化 ----------
// 普通页面只读本地/ cookie 状态，不加载 MSAL（按需在调用令牌时加载）
async function initAuth() {
    if (location.pathname.endsWith("/login.html")) return;
    // 若本地无用户但同域 cookie 有，则视为已登录（跨子域共享）
    return msGetUser();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
} else {
    initAuth();
}
