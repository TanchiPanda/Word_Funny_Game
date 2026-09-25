// ===== GitHub OAuth 登录模块 =====
// 使用前请在 GitHub Settings > Developer settings > OAuth Apps 创建应用，
// 将下方 CLIENT_ID 替换为你的 OAuth App Client ID。
// 回调地址填: <你的站点地址>/oauth-callback.html
//
// 由于浏览器端无法安全保存 Client Secret，需要一个后端代理来用 code 换 token。
// 将 TOKEN_PROXY 设为你的代理地址（接受 POST {code}，返回 {token}）。
// 如果没有代理，可使用 Cloudflare Worker / Vercel Function 等免费方案。
// 若 TOKEN_PROXY 留空，则只支持授权跳转，无法完成登录。

const GITHUB_CLIENT_ID = "Ov23liYOUR_CLIENT_ID";
const GITHUB_TOKEN_PROXY = ""; // 例: "https://your-worker.workers.dev/auth"

const GH_USER_KEY = "wordGameGitHubUser";
const GH_TOKEN_KEY = "wordGameGitHubToken";

function getCallbackUrl() {
    // 自动拼接当前站点的 oauth-callback.html 地址
    const loc = window.location;
    const base = loc.origin + loc.pathname.replace(/[^/]*$/, "");
    return base + "oauth-callback.html";
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

function loginWithGitHub() {
    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: getCallbackUrl(),
        scope: "read:user",
        allow_signup: "true"
    });
    location.href = "https://github.com/login/oauth/authorize?" + params.toString();
}

function logout() {
    localStorage.removeItem(GH_USER_KEY);
    localStorage.removeItem(GH_TOKEN_KEY);
}

// 在 oauth-callback.html 中调用
async function handleOAuthCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const error = params.get("error");
    if (error) {
        return { ok: false, message: "GitHub 授权被拒绝: " + (params.get("error_description") || error) };
    }
    if (!code) {
        return { ok: false, message: "未收到授权码（code）" };
    }
    if (!GITHUB_TOKEN_PROXY) {
        return { ok: false, message: "未配置 TOKEN_PROXY，无法完成登录。请在 auth.js 中设置后端代理地址。" };
    }
    try {
        const resp = await fetch(GITHUB_TOKEN_PROXY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: code })
        });
        if (!resp.ok) throw new Error("代理返回 HTTP " + resp.status);
        const data = await resp.json();
        const token = data.token || data.access_token;
        if (!token) throw new Error("代理未返回 token");
        // 用 token 拉取用户信息
        const userResp = await fetch("https://api.github.com/user", {
            headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github.v3+json" }
        });
        if (!userResp.ok) throw new Error("获取用户信息失败 HTTP " + userResp.status);
        const user = await userResp.json();
        localStorage.setItem(GH_TOKEN_KEY, token);
        localStorage.setItem(GH_USER_KEY, JSON.stringify({
            login: user.login,
            name: user.name || user.login,
            avatar_url: user.avatar_url,
            id: user.id
        }));
        return { ok: true, user: { login: user.login, name: user.name || user.login } };
    } catch (e) {
        return { ok: false, message: "登录失败: " + e.message };
    }
}
