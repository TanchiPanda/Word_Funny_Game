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



// ===== TanchiNotes「AI 帮写」接口（跨域给 tcnotes 调用）=====
// 路由：POST /api/notes-ai   GET /api/notes-ai/quota
const NOTES_MODEL = "@cf/zai-org/glm-4.7-flash";
const NOTES_FALLBACK = "@cf/qwen/qwen3-30b-a3b-fp8";
const NOTES_DAILY = 60;
const NOTES_MINUTE = 8;
const _notesMem = new Map();

async function notesQuota(env, id, consume) {
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const dayKey = "ai:v:" + id + ":" + day;
  const minKey = "ai:m:" + id + ":" + Math.floor(Date.now() / 60000);
  const kv = env && env.VISION_QUOTA && typeof env.VISION_QUOTA.get === "function" ? env.VISION_QUOTA : null;

  const dUsed = kv ? parseInt((await kv.get(dayKey)) || "0", 10) : (_notesMem.get(dayKey) || 0);
  const mUsed = kv ? parseInt((await kv.get(minKey)) || "0", 10) : (_notesMem.get(minKey) || 0);

  if (consume) {
    if (dUsed >= NOTES_DAILY) return { ok: false, reason: "daily", used: dUsed, limit: NOTES_DAILY, mode: kv ? "kv" : "memory" };
    if (mUsed >= NOTES_MINUTE) return { ok: false, reason: "minute", used: mUsed, limit: NOTES_MINUTE, mode: kv ? "kv" : "memory" };
    if (kv) {
      await Promise.all([
        kv.put(dayKey, String(dUsed + 1), { expirationTtl: 172800 }),
        kv.put(minKey, String(mUsed + 1), { expirationTtl: 120 }),
      ]);
    } else {
      _notesMem.set(dayKey, dUsed + 1);
      _notesMem.set(minKey, mUsed + 1);
    }
    return { ok: true, used: dUsed + 1, limit: NOTES_DAILY, mode: kv ? "kv" : "memory" };
  }
  return { used: dUsed, limit: NOTES_DAILY, mode: kv ? "kv" : "memory" };
}

const NOTES_SYSTEM =
  "你是「贪吃笔记」里的中文写作助手。用户的笔记使用 Markdown 语法。回答简洁、直接，不要客套话，除 Markdown 外不要使用 HTML。";

const NOTES_STYLES = {
  polish: "润色：保持原意与信息量，让表达更通顺自然，修正语病与标点。",
  concise: "精简：压缩到原长度 50%~70%，只保留关键信息。",
  expand: "扩写：补充细节与过渡，长度约为原来 1.5 倍，不要编造事实。",
  formal: "正式化：改成书面、正式的表达。",
  casual: "口语化：改成自然口语，保留专业术语。",
};

function buildNotesMessages(body) {
  const sel = String(body.selection || "").slice(0, 6000);
  const note = String(body.note || "").slice(0, 8000);
  const q = String(body.question || "").slice(0, 1000);
  const action = String(body.action || "ask");

  const refNote = note && note !== sel
    ? "参考上下文（整篇笔记，不要复述、不要输出）：\n<<<\n" + note + "\n>>>\n\n"
    : "";

  let userContent;
  if (action === "ask") {
    userContent =
      (sel ? "选中的片段：\n<<<\n" + sel + "\n>>>\n\n" : "") +
      (note && note !== sel ? "整篇笔记：\n<<<\n" + note + "\n>>>\n\n" : "") +
      "问题：" + (q || "这段内容是什么意思？") +
      "\n\n要求：直接回答，不要复述笔记原文，不要输出 <<< >>> 标记。";
  } else if (action === "rewrite") {
    if (!sel) return null;
    userContent =
      refNote +
      "任务：" + (NOTES_STYLES[body.style] || NOTES_STYLES.polish) + "\n" +
      "只改写下面这一段的文字：\n<<<\n" + sel + "\n>>>\n" +
      "要求：直接输出改写后的文字本身；不要解释、不要加引号、不要写“改写如下”；不要输出 <<< >>> 标记；保留原有的 Markdown 结构。";
  } else if (action === "summary") {
    userContent =
      refNote +
      (sel
        ? "把下面这段总结成 3~6 条要点，每条一句话：\n<<<\n" + sel + "\n>>>"
        : "把上面的整篇笔记总结成 3~8 条要点，每条一句话。") +
      "\n要求：只输出 Markdown 列表，不要开头结尾的说明。";
  } else if (action === "translate") {
    const target = body.target === "en" ? "英文" : "中文";
    userContent =
      refNote +
      "把下面这段翻译成" + target + "：\n<<<\n" + (sel || note) + "\n>>>\n" +
      "要求：只输出译文，保留 Markdown 格式，不要输出 <<< >>> 标记。";
  } else {
    userContent = refNote + "请就这段笔记给出有用的补充或建议。";
  }

  return [
    { role: "system", content: NOTES_SYSTEM },
    { role: "user", content: userContent },
  ];
}

async function handleNotesAi(request, env) {
  const url = new URL(request.url);
  const auth = request.headers.get("Authorization") || "";
  let sub = null;
  if (auth) {
    try { sub = (await verifyJwt(auth.replace(/^Bearer\s+/i, ""))).sub; } catch (e) { sub = null; }
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const id = sub ? "u:" + sub : "ip:" + ip;

  if (url.pathname === "/api/notes-ai/quota") {
    return json({ ok: true, signedIn: !!sub, ...(await notesQuota(env, id, false)) });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405);

  let body = {};
  try { body = JSON.parse((await request.text()) || "{}"); } catch (e) {
    return json({ ok: false, error: "请求格式错误" }, 400);
  }

  const quota = await notesQuota(env, id, true);
  if (!quota.ok) {
    return json({
      ok: false,
      error: quota.reason === "daily" ? "daily_limit" : "rate_limited",
      message: quota.reason === "daily"
        ? "今天的 AI 额度用完了（" + quota.limit + " 次/天），明天再来"
        : "操作太快了，休息几秒再试",
      used: quota.used, limit: quota.limit, mode: quota.mode,
    }, 429);
  }

  const messages = buildNotesMessages(body);
  if (!messages) {
    return json({ ok: false, error: "no_selection", message: "请先在正文里选中要改写的文字" }, 400);
  }

  const models = [env.NOTES_MODEL || NOTES_MODEL, NOTES_FALLBACK];

  // 流式：边生成边返回，避免十几秒干等
  const wantStream = absBody.stream === true || url.searchParams.get("stream") === "1";
  if (wantStream) {
    for (const m of models) {
      try {
        const out = await env.AI.run(m, { messages, max_tokens: 1024, temperature: 0.4, stream: true });
        if (!out || !out.getReader) continue;
        return new Response(out, {
          headers: {
            ...CORS,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-AI-Model": m,
            "X-AI-Used": String(quota.used),
            "X-AI-Limit": String(quota.limit),
            "Access-Control-Expose-Headers": "X-AI-Model, X-AI-Used, X-AI-Limit",
          },
        });
      } catch (e) {}
    }
  }

  for (const m of models) {
    try {
      const out = await env.AI.run(m, { messages, max_tokens: 1024, temperature: 0.4 });
      const text = (out && (out.response || out.text)) ||
        (out && out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content) || "";
      if (String(text).trim()) {
        return json({
          ok: true, signedIn: !!sub, text: String(text).trim(), model: m,
          used: quota.used, limit: quota.limit, left: Math.max(0, quota.limit - quota.used), mode: quota.mode,
        });
      }
    } catch (e) {}
  }
  return json({ ok: false, error: "model_error", message: "模型这次没返回结果，稍后重试" }, 502);
}

// ---------- 路由 ----------
async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 健康检查：用于确认绑定是否生效（不返回任何密钥）
  if (path === "/api/health") {
    return json({
      ok: true,
      ai: !!(env && env.AI && typeof env.AI.run === "function"),
      kv: !!(env && env.VISION_QUOTA && typeof env.VISION_QUOTA.get === "function"),
      model: MODEL,
      notesModel: NOTES_MODEL,
      notesDaily: NOTES_DAILY,
    });
  }

  if (path === "/api/notes-ai" || path === "/api/notes-ai/quota") {
    return await handleNotesAi(request, env);
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
