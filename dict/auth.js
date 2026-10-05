// ===== R6T5 Hub 统一登录模块 =====
// 登录跳转到 myacc.r6t5.dpdns.org，通过 app 参数召回
// 跨子域名共享会话（cookie 设在 .r6t5.dpdns.org）

const ACCOUNT_URL = "https://myacc.r6t5.dpdns.org";
const APP_ID = "wordgm";

const GH_USER_KEY = "wordGameGitHubUser";
const GH_TOKEN_KEY = "wordGameMSAToken";

// 从 cookie 读取跨域共享会话
function readHubCookie(name) {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
}

// 写入本地用户状态
function syncUserToLocal(user) {
    if (!user) {
        localStorage.removeItem(GH_USER_KEY);
        localStorage.removeItem(GH_TOKEN_KEY);
        return;
    }
    localStorage.setItem(GH_TOKEN_KEY, user.access_token || readHubCookie("rt_token") || "");
    localStorage.setItem(GH_USER_KEY, JSON.stringify({
        login: user.email || user.name || user.id,
        name: user.name || user.email || "用户",
        avatar_url: user.avatar_url || "",
        id: user.id,
        email: user.email || ""
    }));
}

// 从 cookie 恢复登录状态
function restoreFromCookies() {
    const userJson = readHubCookie("rt_user");
    const token = readHubCookie("rt_token");
    if (userJson && token) {
        try {
            syncUserToLocal({ ...JSON.parse(userJson), access_token: token });
            return true;
        } catch (e) {}
    }
    return false;
}

function isLoggedIn() {
    return !!localStorage.getItem(GH_USER_KEY) || !!readHubCookie("rt_token");
}

function getGitHubUser() {
    try {
        const local = JSON.parse(localStorage.getItem(GH_USER_KEY) || "null");
        if (local) return local;
    } catch (e) {}
    const cookieUser = readHubCookie("rt_user");
    if (cookieUser) {
        try { return JSON.parse(cookieUser); } catch (e) {}
    }
    return null;
}

// 登录：跳转到统一账号中心
function loginWithGitHub() {
    location.href = ACCOUNT_URL + "/?app=" + APP_ID;
}

// OAuth 也跳转到账号中心（在账号页选择 GitHub/Google）
function loginWithGoogle() {
    loginWithGitHub();
}

// 退出登录：清除本地状态并跳转账号中心退出
function logout() {
    localStorage.removeItem(GH_USER_KEY);
    localStorage.removeItem(GH_TOKEN_KEY);
    // 清除跨域 cookie（通过跳转账号中心清除）
    location.href = ACCOUNT_URL + "/?logout=1&app=" + APP_ID;
}

// 兼容旧接口
async function refreshAccessToken() { return false; }

// 初始化：先从 cookie 恢复，再处理 URL hash 回调
async function initAuth() {
    restoreFromCookies();
    // 如果 URL 带 hash（账号中心登录后跳回），Supabase 会自动处理
    const client = getSupabase();
    if (client) {
        const { data } = await client.auth.getSession();
        if (data && data.session) {
            syncUserToLocal({ ...data.session.user, access_token: data.session.access_token });
        }
        client.auth.onAuthStateChange((event, session) => {
            if (session && session.user) {
                syncUserToLocal({ ...session.user, access_token: session.access_token });
            }
        });
    }
}

// 保留 Supabase client（用于回调处理）
const SUPABASE_URL = "https://fckqmlwkujixwztzqqni.supabase.co";
const SUPABASE_KEY = "sb_publishable_x0i6QcZ6TEOAy40Ub8TAbQ_07YQnrAG";
let sb = null;
function getSupabase() {
    if (sb) return sb;
    if (!window.supabase || !window.supabase.createClient) return null;
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
    });
    return sb;
}

// 邮箱密码登录保留（用于兼容，实际不直接使用）
async function loginWithEmail(email, password) {
    const client = getSupabase();
    if (!client) throw new Error("Supabase 未加载");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

async function signUpWithEmail(email, password) {
    const client = getSupabase();
    if (!client) throw new Error("Supabase 未加载");
    const { data, error } = await client.auth.signUp({
        email, password,
        options: { emailRedirectTo: location.origin + "/login.html" }
    });
    if (error) throw error;
    return data;
}

async function loginWithMagicLink(email) {
    const client = getSupabase();
    if (!client) throw new Error("Supabase 未加载");
    const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + "/login.html" }
    });
    if (error) throw error;
}

async function handleAuthCallback() {
    const client = getSupabase();
    if (!client) return false;
    const { data, error } = await client.auth.getSession();
    if (error) return false;
    if (data && data.session) {
        syncUserToLocal({ ...data.session.user, access_token: data.session.access_token });
        return true;
    }
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (code) {
        const { data: exchData, error: exchErr } = await client.auth.exchangeCodeForSession(code);
        if (!exchErr && exchData && exchData.session) {
            syncUserToLocal({ ...exchData.session.user, access_token: exchData.session.access_token });
            return true;
        }
    }
    return false;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
} else {
    initAuth();
}
