// ===== 版本登记表（手动维护）=====
// 版号 = git 提交短 SHA。每次 commit + push 后，把新 SHA 加到数组最前面。
//
// 维护流程：
//   1. 改完代码 → git commit → git push
//   2. git rev-parse --short HEAD  拿到这次提交的短 SHA
//   3. 把该 SHA 作为一条新记录插入 VERSION_REGISTRY 最前面
//   4. 再提交一次（这一步只是登记版号，不必单独登记）
//   数组第一项 = 当前默认启用的版本。
//
// 字段说明：
//   version : 版号，git 提交短 SHA
//   channel : "Private" 内测 | "Public" 公测
//   date    : 登记日 YYYY-MM-DD，有效期从这天 00:00 起算
//   days    : 可选，覆盖默认有效期；0 = 永不过期
//   title   : 这一版的主要改动
//   note    : 可选，补充说明
//   base    : 可选，该版本实际部署地址；留空 = 只做登记（不加载另一份构建）

var VERSION_DEFAULT_DAYS = 90;               // 每个测试版默认有效期
var VERSION_STORE_KEY = "wordGameActiveVersion";

var VERSION_REGISTRY = [
    { version: "71163de", channel: "Private", date: "2026-10-16",
      title: "版本登记与切换",
      note: "Private/Public 双渠道，每版 90 天有效期" },

    { version: "d2e2842", channel: "Private", date: "2026-10-16",
      title: "实验室「下载词典」",
      note: "内部实验口令；词书导出 CSV / 默写版" },

    { version: "5815040", channel: "Private", date: "2026-10-16",
      title: "实验室骨架",
      note: "空实验室页 + 模块注册机制" },

    { version: "996d75a", channel: "Private", date: "2026-10-16",
      title: "微软原生 OAuth",
      note: "移除 Supabase，改用 MSAL；云同步切到 Cloudflare R2" },

    { version: "75cb9a9", channel: "Private", date: "2026-10-05",
      title: "登录后跳首页" },

    { version: "07c6fea", channel: "Private", date: "2026-10-05",
      title: "域名迁移",
      note: "迁到 r6t5.dpdns.org，删除 CNAME" },

    { version: "b249624", channel: "Private", date: "2026-10-01",
      title: "切换 Cloudflare R2",
      note: "放弃 Backblaze B2" }
];

// ---------- 有效期 ----------
var DAY_MS = 86400000;

// 到期时刻；days 为 0 时返回 null（永不过期）
function versionExpiry(v) {
    var days = (typeof v.days === "number") ? v.days : VERSION_DEFAULT_DAYS;
    if (!days) return null;
    var start = new Date(v.date + "T00:00:00");
    if (isNaN(start.getTime())) return null;   // 日期写错时不误杀
    return new Date(start.getTime() + days * DAY_MS);
}

// 剩余天数；永不过期返回 Infinity
function versionDaysLeft(v) {
    var exp = versionExpiry(v);
    if (!exp) return Infinity;
    return Math.ceil((exp.getTime() - Date.now()) / DAY_MS);
}

function versionValid(v) {
    return versionDaysLeft(v) > 0;
}

function versionExpiryText(v) {
    var exp = versionExpiry(v);
    if (!exp) return "永久有效";
    return exp.getFullYear() + "-" +
        String(exp.getMonth() + 1).padStart(2, "0") + "-" +
        String(exp.getDate()).padStart(2, "0") + " 到期";
}

// ---------- 查询 ----------
function versionFind(sha) {
    for (var i = 0; i < VERSION_REGISTRY.length; i++) {
        if (VERSION_REGISTRY[i].version === sha) return VERSION_REGISTRY[i];
    }
    return null;
}

// 最新登记的一版（数组第一项）
function versionLatest() {
    return VERSION_REGISTRY[0] || null;
}

function versionValidCount() {
    return VERSION_REGISTRY.filter(versionValid).length;
}

// 渠道展示名
function versionChannelLabel(ch) {
    return ch === "Public" ? "公测" : "内测";
}
function versionChannelClass(ch) {
    return ch === "Public" ? "public" : "private";
}

// ---------- 当前启用的版本 ----------
// 存的是版号；记录失效（不在登记表里）时回落到最新版
function versionGetActive() {
    var sha = "";
    try { sha = localStorage.getItem(VERSION_STORE_KEY) || ""; } catch (e) {}
    var v = sha ? versionFind(sha) : null;
    return v || versionLatest();
}

// 切换。只允许切到登记表内、且仍在有效期内的版本
function versionSetActive(sha) {
    var v = versionFind(sha);
    if (!v) return { ok: false, reason: "该版号不在登记表中" };
    if (!versionValid(v)) return { ok: false, reason: "该版本已超过有效期" };
    try { localStorage.setItem(VERSION_STORE_KEY, sha); } catch (e) {
        return { ok: false, reason: "写入本地存储失败" };
    }
    // 登记了部署地址的版本，直接跳过去
    if (v.base) {
        location.href = v.base.replace(/\/?$/, "/");
        return { ok: true, redirect: true, version: v };
    }
    versionNotify();
    return { ok: true, version: v };
}

// ---------- 变更通知 ----------
var _verListeners = [];
function versionOnChange(fn) {
    if (typeof fn === "function") _verListeners.push(fn);
}
function versionNotify() {
    for (var i = 0; i < _verListeners.length; i++) {
        try { _verListeners[i](); } catch (e) {}
    }
}
window.addEventListener("storage", function (e) {
    if (e.key === VERSION_STORE_KEY) versionNotify();
});
window.addEventListener("pageshow", function () { versionNotify(); });
