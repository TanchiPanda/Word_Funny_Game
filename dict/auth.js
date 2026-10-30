// ===== 认证兼容层 =====
// 底层为 Supabase Auth（dict/sbauth.js），已移除微软 OAuth 与 OneDrive
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
// 跳转到 login.html（再由它统一跳账号中心 myacc）
function loginWithGitHub(opts) {
    var opt = opts || {};
    var q = "?app=" + APP_ID;
    if (opt.returnTo) q += "&return=" + encodeURIComponent(opt.returnTo);
    location.href = location.origin + "/login.html" + q;
}

// 兼容旧名
function loginWithGoogle(opts) { loginWithGitHub(opts); }
function loginWithMicrosoft(opts) { loginWithGitHub(opts); }

// 直接发起登录（统一跳账号中心）
async function loginDirect() {
    await msLogin({ returnTo: location.href });
}

// ---------- 退出 ----------
async function logout() {
    msClearLocal();
    await msLogout(location.origin + "/index.html");
}

// ---------- 令牌（Supabase 会话自动刷新，无需手动）----------
async function refreshAccessToken() {
    return true;
}

// ---------- 初始化 ----------
async function initAuth() {
    if (location.pathname.endsWith("/login.html")) return;
    return msGetUser();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
} else {
    initAuth();
}
