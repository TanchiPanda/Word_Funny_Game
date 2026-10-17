// ===== 实验功能版本登记表（手动维护，按功能分开）=====
// 每个实验功能各自维护一条版本线，互不相干。
// 版号 = 该功能最近一次改动所对应的 git 提交短 SHA。
//
// 维护流程：
//   1. 改了某个实验功能 → git commit → git push
//   2. git rev-parse --short HEAD  拿到这次提交的短 SHA
//   3. 到下面该功能的 versions 数组最前面插入一条记录
//   （数组第一项 = 该功能默认启用的版本）
//
// 字段说明：
//   version : 版号，git 提交短 SHA
//   channel : "Private" 内测 | "Public" 公测
//   date    : 登记日 YYYY-MM-DD，有效期从这天 00:00 起算
//   days    : 可选，覆盖默认有效期；0 = 永不过期
//   title   : 这一版改了什么
//   note    : 可选，补充说明
//   base    : 可选，该版本独立的部署地址；留空 = 只做登记

var VERSION_DEFAULT_DAYS = 90;
var FEATURE_VERSION_STORE_PREFIX = "wordGameFeatureVersion:";

var FEATURE_VERSIONS = {

    downloadDict: {
        name: "下载词典",
        versions: [
            { version: "d2e2842", channel: "Private", date: "2026-10-16",
              title: "首发：CSV + 默写版导出",
              note: "支持当前课时 / 整本词书两种导出范围" }
        ]
    },

    multiLevel: {
        name: "多选课时",
        versions: [
            { version: "ae18605", channel: "Public", date: "2026-10-16",
              title: "首发：选课时页多选课时",
              note: "可跨词书勾选；学习 / 配对 / 拼写 / 导出共用合并词表" }
        ]
    },

    gameParams: {
        name: "连连看游戏参数",
        versions: [
            { version: "2f7d628", channel: "Private", date: "2026-10-17",
              title: "自定义游戏参数（C 预设 · 自定义预设）",
              note: "图标/名称/描述与全部玩法参数可自定，图形编辑 + 代码编辑双模式；每项可关掉＝不限，越界自动夹取，脏数据回落默认" },
            { version: "edc07ca", channel: "Private", date: "2026-10-17",
              title: "接进实际玩法；两组改名 A 预设 / B 预设",
              note: "选中组整体替换选词页 4 个按钮；实装挑战赛 5 生命值、计时赛每词 15 秒、综合赛两者叠加，新增生命/倒计时 HUD" },
            { version: "f5c8784", channel: "Private", date: "2026-10-17",
              title: "首发：难度预设 + 形式预设两组互斥",
              note: "仅做设置与存储，玩法未实装" }
        ]
    }

};

// ---------- 有效期计算 ----------
var DAY_MS = 86400000;

// 到期时刻；days 为 0 时返回 null（永不过期）
function featVersionExpiry(v) {
    var days = (typeof v.days === "number") ? v.days : VERSION_DEFAULT_DAYS;
    if (!days) return null;
    var start = new Date(v.date + "T00:00:00");
    if (isNaN(start.getTime())) return null;   // 日期写错时不误杀
    return new Date(start.getTime() + days * DAY_MS);
}

// 剩余天数；永不过期返回 Infinity
function featVersionDaysLeft(v) {
    var exp = featVersionExpiry(v);
    if (!exp) return Infinity;
    return Math.ceil((exp.getTime() - Date.now()) / DAY_MS);
}

function featVersionValid(v) {
    return featVersionDaysLeft(v) > 0;
}

function featVersionExpiryText(v) {
    var exp = featVersionExpiry(v);
    if (!exp) return "永久有效";
    return exp.getFullYear() + "-" +
        String(exp.getMonth() + 1).padStart(2, "0") + "-" +
        String(exp.getDate()).padStart(2, "0") + " 到期";
}

// ---------- 查询 ----------
function featVersionList(id) {
    var f = FEATURE_VERSIONS[id];
    return (f && Array.isArray(f.versions)) ? f.versions : [];
}

function featVersionName(id) {
    var f = FEATURE_VERSIONS[id];
    return (f && f.name) ? f.name : id;
}

function featVersionFind(id, sha) {
    var list = featVersionList(id);
    for (var i = 0; i < list.length; i++) {
        if (list[i].version === sha) return list[i];
    }
    return null;
}

// 该功能最新登记的一版
function featVersionLatest(id) {
    return featVersionList(id)[0] || null;
}

function featVersionValidCount(id) {
    return featVersionList(id).filter(featVersionValid).length;
}

function versionChannelLabel(ch) {
    return ch === "Public" ? "公测" : "内测";
}
function versionChannelClass(ch) {
    return ch === "Public" ? "public" : "private";
}

// ---------- 当前启用的版本（按功能各存一份）----------
function featVersionStoreKey(id) {
    return FEATURE_VERSION_STORE_PREFIX + id;
}

// 记录失效（不在登记表里）时回落到该功能最新版
function featVersionGetActive(id) {
    var sha = "";
    try { sha = localStorage.getItem(featVersionStoreKey(id)) || ""; } catch (e) {}
    var v = sha ? featVersionFind(id, sha) : null;
    return v || featVersionLatest(id);
}

// 切换。只允许切到该功能登记表内、且仍在有效期内的版本
function featVersionSetActive(id, sha) {
    var v = featVersionFind(id, sha);
    if (!v) return { ok: false, reason: "该版号不在「" + featVersionName(id) + "」的登记表中" };
    if (!featVersionValid(v)) return { ok: false, reason: "该版本已超过有效期" };
    try { localStorage.setItem(featVersionStoreKey(id), sha); } catch (e) {
        return { ok: false, reason: "写入本地存储失败" };
    }
    // 登记了独立部署地址的版本，直接跳过去
    if (v.base) {
        location.href = v.base.replace(/\/?$/, "/");
        return { ok: true, redirect: true, version: v };
    }
    versionNotify(id);
    return { ok: true, version: v };
}

// ---------- 变更通知 ----------
var _verListeners = [];
function versionOnChange(fn) {
    if (typeof fn === "function") _verListeners.push(fn);
}
function versionNotify(id) {
    for (var i = 0; i < _verListeners.length; i++) {
        try { _verListeners[i](id); } catch (e) {}
    }
}
window.addEventListener("storage", function (e) {
    if (e.key && e.key.indexOf(FEATURE_VERSION_STORE_PREFIX) === 0) {
        versionNotify(e.key.slice(FEATURE_VERSION_STORE_PREFIX.length));
    }
});
window.addEventListener("pageshow", function () { versionNotify(); });
