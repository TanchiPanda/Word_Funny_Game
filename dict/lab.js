// ===== 实验室功能开关（内部实验）=====
// 用于把试验性功能藏在口令后面，仅区分"内部测试"，不是安全机制
// （纯前端校验，口令对会读 JS 的人不设防）

var LAB_PASSCODE = "EngHi";
var LAB_STORE_KEY = "wordGameLabFeatures";

// 功能清单：id -> 展示名
var LAB_FEATURES = {
    downloadDict: "下载词典"
};

// ---------- 开关状态 ----------
function labList() {
    try {
        var a = JSON.parse(localStorage.getItem(LAB_STORE_KEY) || "[]");
        return Array.isArray(a) ? a : [];
    } catch (e) {
        return [];
    }
}

function labEnabled(id) {
    return labList().indexOf(id) >= 0;
}

function labSetEnabled(id, on) {
    var a = labList();
    var i = a.indexOf(id);
    if (on) {
        if (i < 0) a.push(id);
    } else {
        if (i >= 0) a.splice(i, 1);
    }
    localStorage.setItem(LAB_STORE_KEY, JSON.stringify(a));
    labNotify();
    return !!on;
}

// 再次调用即关闭
function labToggle(id) {
    return labSetEnabled(id, !labEnabled(id));
}

// ---------- 口令 ----------
function labVerify(input) {
    return input === LAB_PASSCODE; // 区分大小写
}

// 弹窗询问口令；通过则开启该功能并返回 true
function labAskPass(id, label) {
    var name = label || LAB_FEATURES[id] || "该功能";
    var v = window.prompt("「" + name + "」为内部实验功能\n请输入内部测试口令：", "");
    if (v === null) return false;
    if (!labVerify(v)) {
        window.alert("口令不正确");
        return false;
    }
    labSetEnabled(id, true);
    return true;
}

// ---------- 变更通知（跨标签页 / 返回页面时刷新）----------
var _labListeners = [];
function labOnChange(fn) {
    if (typeof fn === "function") _labListeners.push(fn);
}
function labNotify() {
    for (var i = 0; i < _labListeners.length; i++) {
        try { _labListeners[i](); } catch (e) {}
    }
}
window.addEventListener("storage", function (e) {
    if (e.key === LAB_STORE_KEY) labNotify();
});
// 从 bfcache 返回或切回标签页时同步一次
window.addEventListener("pageshow", function () { labNotify(); });
document.addEventListener("visibilitychange", function () {
    if (!document.hidden) labNotify();
});

// ---------- 路由守卫 ----------
// 未开启该实验功能时，强制弹回来源页（无来源则回指定兜底页）
function labGuard(id, fallback, label) {
    if (labEnabled(id)) return true;
    var back = fallback || "index.html";
    try {
        if (document.referrer) {
            var u = new URL(document.referrer);
            if (u.origin === location.origin) back = u.pathname + u.search + u.hash;
        }
    } catch (e) {}
    alert("「" + (label || LAB_FEATURES[id] || "该功能") + "」为内部实验功能，尚未开启。");
    location.replace(back); // replace：不在历史里留下这一页
    return false;
}
