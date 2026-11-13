// ===== word-funny-game Worker 入口 =====
// 职责：/api/* 由本 Worker 处理；其余请求交给静态资源（env.ASSETS）
// 绑定：AI（Workers AI）；VISION_QUOTA（KV，可选，缺省时退化为内存计数）

// Worker 入口：识图接口 + 静态资源
// 路由：POST /api/vision
// 依赖绑定：AI（Workers AI）、VISION_QUOTA（KV，可选但强烈建议）
// 额度：每用户每天 40 页，每分钟 6 页

const SUPABASE_JWKS = [
  { url: "https://fckqmlwkujixwztzqqni.supabase.co/auth/v1/.well-known/jwks.json", iss: "https://fckqmlwkujixwztzqqni.supabase.co/auth/v1" },
  { url: "https://bxanbosouqnezggwdqhs.supabase.co/auth/v1/.well-known/jwks.json", iss: "https://bxanbosouqnezggwdqhs.supabase.co/auth/v1" },
];

const MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const DAILY_LIMIT = 40;   // 每人每天可识别页数（正常使用足够）
const MINUTE_LIMIT = 6;   // 每人每分钟最多请求数（防连点）

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function b64d(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// JWKS 缓存（每个实例 10 分钟）
let _jwksCache = null;
async function loadJwks() {
  const now = Date.now();
  if (_jwksCache && now - _jwksCache.t < 600000) return _jwksCache.keys;
  const keys = [];
  for (const src of SUPABASE_JWKS) {
    try {
      const r = await fetch(src.url);
      if (!r.ok) continue;
      const d = await r.json();
      (d.keys || []).forEach((k) => keys.push({ ...k, __iss: src.iss }));
    } catch (e) {}
  }
  _jwksCache = { keys, t: now };
  return keys;
}

async function verifyJwt(token) {
  if (!token) throw new Error("no token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(b64d(parts[0])));

  const keys = await loadJwks();
  let candidates = keys.filter((k) => k.kid === header.kid);
  if (!candidates.length) candidates = keys;

  for (const k of candidates) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk", { kty: k.kty, n: k.n, e: k.e, alg: k.alg || "RS256", kid: k.kid, ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
      );
      const data = new TextEncoder().encode(parts[0] + "." + parts[1]);
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, b64d(parts[2]), data);
      if (!ok) continue;
      const payload = JSON.parse(new TextDecoder().decode(b64d(parts[1])));
      if (payload.exp * 1000 < Date.now()) throw new Error("token expired");
      if (!payload.sub) throw new Error("missing sub");
      return payload;
    } catch (e) {
      if (String(e.message).includes("expired")) throw e;
      continue;
    }
  }
  throw new Error("invalid signature");
}

// 额度：KV 优先，无绑定时退化为进程内计数（不严格，仅兜底）
const _mem = new Map();
async function takeQuota(env, sub) {
  const day = new Date().toISOString().slice(0, 10);
  const dayKey = `v:${sub}:${day}`;
  const minKey = `m:${sub}:${Math.floor(Date.now() / 60000)}`;

  if (env && env.VISION_QUOTA && typeof env.VISION_QUOTA.get === "function") {
    const dayUsed = parseInt((await env.VISION_QUOTA.get(dayKey)) || "0", 10) || 0;
    const minUsed = parseInt((await env.VISION_QUOTA.get(minKey)) || "0", 10) || 0;
    if (dayUsed >= DAILY_LIMIT) return { ok: false, reason: "daily", used: dayUsed, limit: DAILY_LIMIT, mode: "kv" };
    if (minUsed >= MINUTE_LIMIT) return { ok: false, reason: "minute", used: minUsed, limit: MINUTE_LIMIT, mode: "kv" };
    await env.VISION_QUOTA.put(dayKey, String(dayUsed + 1), { expirationTtl: 172800 });
    await env.VISION_QUOTA.put(minKey, String(minUsed + 1), { expirationTtl: 120 });
    return { ok: true, used: dayUsed + 1, limit: DAILY_LIMIT, mode: "kv" };
  }

  const d = _mem.get(dayKey) || 0;
  const m = _mem.get(minKey) || 0;
  if (d >= DAILY_LIMIT) return { ok: false, reason: "daily", used: d, limit: DAILY_LIMIT, mode: "memory" };
  if (m >= MINUTE_LIMIT) return { ok: false, reason: "minute", used: m, limit: MINUTE_LIMIT, mode: "memory" };
  _mem.set(dayKey, d + 1);
  _mem.set(minKey, m + 1);
  return { ok: true, used: d + 1, limit: DAILY_LIMIT, mode: "memory" };
}

async function getQuotaInfo(env, sub) {
  const day = new Date().toISOString().slice(0, 10);
  const dayKey = `v:${sub}:${day}`;
  let used = 0;
  try {
    if (env && env.VISION_QUOTA && typeof env.VISION_QUOTA.get === "function") {
      used = parseInt((await env.VISION_QUOTA.get(dayKey)) || "0", 10) || 0;
    } else {
      used = _mem.get(dayKey) || 0;
    }
  } catch (e) {}
  return { used, limit: DAILY_LIMIT, remain: Math.max(0, DAILY_LIMIT - used) };
}

const PROMPT = [
  "Extract every English vocabulary entry visible in this word-list image.",
  "Return ONLY compact JSON, no explanation, no markdown fence:",
  '{"words":[{"en":"","phonetic":"","pos":"","cn":""}]}',
  "Rules: en = English word or phrase exactly as printed; phonetic = IPA without slashes (empty if absent);",
  "pos = part of speech abbreviation like n./v./adj. (empty if absent); cn = Chinese meaning (empty if absent).",
  "Keep original order, skip headers and page numbers. If nothing found, return {\"words\":[]}.",
].join(" ");

function extractWords(answer) {
  if (!answer) return [];
  let text = String(answer).trim();
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const obj = JSON.parse(text);
    const arr = Array.isArray(obj) ? obj : obj.words || [];
    return arr
      .map((w) => ({
        en: String(w.en || w.word || "").trim(),
        phonetic: String(w.phonetic || w.ipa || "").replace(/^\/|\/$/g, "").trim(),
        pos: String(w.pos || w.part || "").trim(),
        cn: String(w.cn || w.meaning || w.zh || "").trim(),
      }))
      .filter((w) => w.en);
  } catch (e) {
    return [];
  }
}

async function handleVision(body, request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");

  let payload;
  try {
    payload = await verifyJwt(token);
  } catch (e) {
    return json({ ok: false, error: "未登录或登录已过期，请重新登录后再试" }, 401);
  }
  const sub = payload.sub;

  if (!env || !env.AI || typeof env.AI.run !== "function") {
    return json({ ok: false, error: "服务端未配置 AI 绑定，请联系管理员" }, 503);
  }

  const image = body && body.image;
  if (!image || typeof image !== "string" || !/^data:image\//.test(image)) {
    return json({ ok: false, error: "请上传图片" }, 400);
  }
  // 单图上限约 4MB（base64 后约 5.5MB）
  if (image.length > 5_600_000) {
    return json({ ok: false, error: "图片太大，请压缩后再试" }, 413);
  }

  if (body.quotaOnly) {
    return json({ ok: true, quota: await getQuotaInfo(env, sub) });
  }

  const quota = await takeQuota(env, sub);
  if (!quota.ok) {
    const msg =
      quota.reason === "daily"
        ? `今天识图次数已用完（${quota.limit} 页/天），明天再来，或手动录入单词`
        : `操作太快了，请等一分钟再试（每分钟 ${quota.limit} 次）`;
    return json({ ok: false, error: msg, quota: await getQuotaInfo(env, sub) }, 429);
  }

  try {
    const r = await env.AI.run(MODEL, {
      task: "query",
      image,
      question: PROMPT,
      reasoning: false,
      temperature: 0.1,
      max_tokens: 4096,
    });
    const answer = (r && (r.answer || r.response || r.result)) || "";
    const words = extractWords(answer);
    return json({
      ok: true,
      words,
      raw: words.length ? undefined : String(answer).slice(0, 800),
      quota: { used: quota.used, limit: quota.limit, remain: Math.max(0, quota.limit - quota.used), mode: quota.mode },
    });
  } catch (e) {
    return json({ ok: false, error: "识别失败：" + (e && e.message ? e.message : "未知错误") }, 502);
  }
}


// ---------- 路由 ----------
async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (path === "/api/vision" || path === "/api/quota") {
    if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405);

    const bodyText = await request.text();
    let body = {};
    try { body = JSON.parse(bodyText || "{}"); } catch (e) {
      return json({ ok: false, error: "请求格式错误" }, 400);
    }

    // 额度查询（不消耗额度）
    if (path === "/api/quota" || body.quotaOnly) {
      const auth = request.headers.get("Authorization") || "";
      let payload;
      try {
        payload = await verifyJwt(auth.replace(/^Bearer\s+/i, ""));
      } catch (e) {
        return json({ ok: false, error: "未登录或登录已过期，请重新登录后再试" }, 401);
      }
      return json({ ok: true, quota: await getQuotaInfo(env, payload.sub) });
    }

    return await handleVision(body, request, env);
  }

  return json({ ok: false, error: "Not Found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // 其余交给静态资源
    const res = await env.ASSETS.fetch(request);

    // 给 HTML 注入全局加载样式（原 middleware 逻辑，之前从未生效）
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      try {
        return new HTMLRewriter()
          .on("head", { element(el) { el.append('<link rel="stylesheet" href="/loading.css">', { html: true }); } })
          .on("body", { element(el) { el.append('<script src="/loading.js"></script>', { html: true }); } })
          .transform(res);
      } catch (e) {}
    }
    return res;
  },
};
