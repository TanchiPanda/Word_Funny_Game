// ===== 实验室功能开关 =====
// 两类功能：
//   内测（Private）：默认关闭，需内部口令开启
//   公测（Public） ：默认开启，无需口令，所有人可用；用户可自行关掉
// 注意：纯前端校验，口令对会读 JS 的人不设防，不是安全机制

var LAB_PASSCODE = "EngHi";
var LAB_STORE_KEY = "wordGameLabFeatures";   // 内测：已开启的功能 id
var LAB_OFF_KEY = "wordGameLabOff";          // 公测：被用户手动关掉的功能 id

// 功能清单：id -> 展示名
var LAB_FEATURES = {
    downloadDict: "下载词典",
    multiLevel: "多选课时",
    gameParams: "连连看游戏参数"
};

// 公测功能：默认开启，无需口令
var LAB_PUBLIC_FEATURES = ["multiLevel"];

function labIsPublic(id) {
    return LAB_PUBLIC_FEATURES.indexOf(id) >= 0;
}

// ---------- 开关状态 ----------
function labList() {
    try {
        var a = JSON.parse(localStorage.getItem(LAB_STORE_KEY) || "[]");
        return Array.isArray(a) ? a : [];
    } catch (e) {
        return [];
    }
}

function labOffList() {
    try {
        var a = JSON.parse(localStorage.getItem(LAB_OFF_KEY) || "[]");
        return Array.isArray(a) ? a : [];
    } catch (e) {
        return [];
    }
}

function labEnabled(id) {
    if (labIsPublic(id)) return labOffList().indexOf(id) < 0;   // 公测：默认开
    return labList().indexOf(id) >= 0;                          // 内测：默认关
}

function labSetEnabled(id, on) {
    on = !!on;
    if (labIsPublic(id)) {
        var off = labOffList();
        var j = off.indexOf(id);
        if (on) { if (j >= 0) off.splice(j, 1); }
        else { if (j < 0) off.push(id); }
        localStorage.setItem(LAB_OFF_KEY, JSON.stringify(off));
    } else {
        var a = labList();
        var i = a.indexOf(id);
        if (on) { if (i < 0) a.push(id); }
        else { if (i >= 0) a.splice(i, 1); }
        localStorage.setItem(LAB_STORE_KEY, JSON.stringify(a));
    }
    labNotify();
    return on;
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
// 公测功能无需口令，直接返回当前状态
function labAskPass(id, label) {
    if (labIsPublic(id)) {
        labSetEnabled(id, true);
        return true;
    }
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
    if (e.key === LAB_STORE_KEY || e.key === LAB_OFF_KEY) labNotify();
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

