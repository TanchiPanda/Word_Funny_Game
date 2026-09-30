// ===== Supabase 登录模块（邮箱/魔法链接/GitHub/Google）=====
const SUPABASE_URL = "https://fckqmlwkujixwztzqqni.supabase.co";
const SUPABASE_KEY = "sb_publishable_x0i6QcZ6TEOAy40Ub8TAbQ_07YQnrAG";

const GH_USER_KEY = "wordGameGitHubUser";
const GH_TOKEN_KEY = "wordGameMSAToken";

let sb = null;
function getSupabase() {
    if (sb) return sb;
    if (!window.supabase || !window.supabase.createClient) return null;
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
    });
    return sb;
}

function isLoggedIn() {
    return !!localStorage.getItem(GH_USER_KEY);
}

function getGitHubUser() {
    try {
        return JSON.parse(localStorage.getItem(GH_USER_KEY) || "null");
    } catch (e) {
        return null;
    }
}

// 同步本地用户信息（Supabase onAuthStateChange 也会调用）
function syncUserToLocal(user) {
    if (!user) {
        localStorage.removeItem(GH_USER_KEY);
        localStorage.removeItem(GH_TOKEN_KEY);
        return;
    }
    const meta = user.user_metadata || {};
    localStorage.setItem(GH_TOKEN_KEY, user.access_token || "");
    localStorage.setItem(GH_USER_KEY, JSON.stringify({
        login: user.email || meta.user_name || meta.name || user.id,
        name: meta.name || meta.full_name || user.email || "用户",
        avatar_url: meta.avatar_url || "",
        id: user.id,
        email: user.email || ""
    }));
}

// 初始化：从 Supabase 恢复会话
async function initSupabaseAuth() {
    const client = getSupabase();
    if (!client) return;
    const { data } = await client.auth.getSession();
    if (data && data.session && data.session.user) {
        syncUserToLocal({ ...data.session.user, access_token: data.session.access_token });
    } else {
        localStorage.removeItem(GH_USER_KEY);
        localStorage.removeItem(GH_TOKEN_KEY);
    }
    client.auth.onAuthStateChange((event, session) => {
        if (session && session.user) {
            syncUserToLocal({ ...session.user, access_token: session.access_token });
        } else {
            localStorage.removeItem(GH_USER_KEY);
            localStorage.removeItem(GH_TOKEN_KEY);
        }
    });
}

// 邮箱密码登录
async function loginWithEmail(email, password) {
    const client = getSupabase();
    if (!client) throw new Error("Supabase 未加载");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

// 注册
async function signUpWithEmail(email, password) {
    const client = getSupabase();
    if (!client) throw new Error("Supabase 未加载");
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    return data;
}

// 魔法链接
async function loginWithMagicLink(email) {
    const client = getSupabase();
    if (!client) throw new Error("Supabase 未加载");
    const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + "/login.html" }
    });
    if (error) throw error;
}

// OAuth 登录（GitHub / Google）
function loginWithGitHub() {
    const client = getSupabase();
    if (!client) return;
    client.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: location.origin + "/login.html" }
    });
}
function loginWithGoogle() {
    const client = getSupabase();
    if (!client) return;
    client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin + "/login.html" }
    });
}

// 兼容旧接口名（设置页调用）
async function refreshAccessToken() {
    const client = getSupabase();
    if (!client) return false;
    const { data } = await client.auth.refreshSession();
    return !!(data && data.session);
}

function logout() {
    const client = getSupabase();
    if (client) client.auth.signOut();
    localStorage.removeItem(GH_USER_KEY);
    localStorage.removeItem(GH_TOKEN_KEY);
}

// 启动时自动初始化
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSupabaseAuth);
} else {
    initSupabaseAuth();
}
