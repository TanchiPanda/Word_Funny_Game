// ===== 微软身份平台登录模块（OAuth2 + PKCE，纯浏览器端，无需后端）=====
// 使用前请在 Azure Portal 注册应用：
//   1. 打开 https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
//   2. 「新建注册」→ 名称随意 → 支持账户类型选「任何组织目录和个人 Microsoft 账户」
//   3. 重定向 URI 选「单页应用(SPA)」，填: https://你的域名/oauth-callback.html
//   4. 复制「应用程序(客户端) ID」填到下面 MSA_CLIENT_ID

const MSA_CLIENT_ID = "037a7626-10a1-4dcf-a2c7-f5746fcba1df";
const MSA_AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
// 必须与 Azure 应用注册里「重定向 URI」完全一致（SPA 类型）
const MSA_REDIRECT_URI = "https://wordgm.r6t5.cloud-ip.cc/oauth-callback";

const GH_USER_KEY = "wordGameGitHubUser";   // 沿用旧 key 名，避免迁移丢失
const GH_TOKEN_KEY = "wordGameMSAToken";

function getCallbackUrl() {
    return MSA_REDIRECT_URI;
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

// ===== PKCE 工具 =====
function generateCodeVerifier() {
    const arr = new Uint8Array(64);
    crypto.getRandomValues(arr);
    return base64UrlEncode(arr);
}
async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64UrlEncode(new Uint8Array(digest));
}
function base64UrlEncode(bytes) {
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loginWithGitHub() {
    // 兼容旧函数名，实际走微软登录
    loginWithMSA();
}

async function loginWithMSA() {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    sessionStorage.setItem("wordGameCodeVerifier", verifier);
    const params = new URLSearchParams({
        client_id: MSA_CLIENT_ID,
        response_type: "code",
        redirect_uri: getCallbackUrl(),
        response_mode: "query",
        scope: "openid profile email User.Read Files.ReadWrite",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "wordgame",
        prompt: "select_account"
    });
    location.href = MSA_AUTHORITY + "/authorize?" + params.toString();
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
    const errorDesc = params.get("error_description");
    if (error) {
        return { ok: false, message: "登录被取消或失败: " + (errorDesc ? decodeURIComponent(errorDesc).replace(/\+/g, " ") : error) };
    }
    if (!code) {
        return { ok: false, message: "未收到授权码（code）" };
    }
    const verifier = sessionStorage.getItem("wordGameCodeVerifier");
    if (!verifier) {
        return { ok: false, message: "缺少 PKCE verifier，请重新登录" };
    }
    sessionStorage.removeItem("wordGameCodeVerifier");
    try {
        const body = new URLSearchParams({
            client_id: MSA_CLIENT_ID,
            scope: "openid profile email User.Read Files.ReadWrite",
            code: code,
            redirect_uri: getCallbackUrl(),
            code_verifier: verifier,
            grant_type: "authorization_code"
        });
        const resp = await fetch(MSA_AUTHORITY + "/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString()
        });
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.error_description ? decodeURIComponent(errData.error_description).replace(/\+/g, " ") : ("HTTP " + resp.status));
        }
        const tokenData = await resp.json();
        const accessToken = tokenData.access_token;
        // 调 Microsoft Graph 获取用户信息
        const userResp = await fetch("https://graph.microsoft.com/v1.0/me", {
            headers: { "Authorization": "Bearer " + accessToken }
        });
        if (!userResp.ok) throw new Error("获取用户信息失败 HTTP " + userResp.status);
        const user = await userResp.json();
        localStorage.setItem(GH_TOKEN_KEY, accessToken);
        localStorage.setItem(GH_USER_KEY, JSON.stringify({
            login: user.userPrincipalName || user.mail || user.id,
            name: user.displayName || user.userPrincipalName || "用户",
            avatar_url: "",
            id: user.id
        }));
        return { ok: true, user: { login: user.displayName || user.userPrincipalName, name: user.displayName } };
    } catch (e) {
        return { ok: false, message: "登录失败: " + e.message };
    }
}
