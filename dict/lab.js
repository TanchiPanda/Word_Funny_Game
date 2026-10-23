// ===== 实验室功能开关 =====
// 规则（2026-10-17 起）：
//   1. 所有实验功能一律公开，不再分内测/公测；
//   2. 一律默认关闭，要用自己开；
//   3. 首次开启需要先读《实验室公约》（整个实验室只拦一次，确认过就不再拦）；
//   4. 稳定发行的功能列在「以前实验过」里，常驻开启、不可关闭。
// 注意：纯前端校验，不是安全机制，只是让使用者知道这些功能是试验性的。

var LAB_CONVENTION = {
    title: "实验室公约",
    url: "https://my.feishu.cn/docx/SVaEdzWktovxSsxFdGXcFLrmnrf"
};

var LAB_STORE_KEY = "wordGameLabFeatures";   // 已开启的功能 id
var LAB_AGREE_KEY = "wordGameLabAgreed";     // 公约确认记录

// 实验功能清单：id -> 展示名
var LAB_FEATURES = {
    downloadDict: "下载词典",
    multiLevel: "多选课时",
    gameParams: "连连看游戏参数"
};

// 稳定发行：已经跑完实验期，常驻开启、不可关闭，收在「以前实验过」栏目里
var LAB_GRADUATED = {
    multiLevel: {
        since: "2026-10-17",
        note: "在选课时页可同时勾选多个课时（再点一次取消），学习、配对、拼写都用合并后的词表。"
    }
};

function labIsGraduated(id) {
    return Object.prototype.hasOwnProperty.call(LAB_GRADUATED, id);
}
function labGraduatedIds() {
    return Object.keys(LAB_GRADUATED);
}
// 仍在实验期、带开关的功能
function labActiveIds() {
    return Object.keys(LAB_FEATURES).filter(function (id) { return !labIsGraduated(id); });
}
function labName(id) {
    return LAB_FEATURES[id] || id;
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
function labWriteList(a) {
    localStorage.setItem(LAB_STORE_KEY, JSON.stringify(a));
    labNotify();
}

function labEnabled(id) {
    if (labIsGraduated(id)) return true;      // 稳定发行：常驻开启
    return labList().indexOf(id) >= 0;        // 实验期：默认关，开了才开
}

function labSetEnabled(id, on) {
    if (labIsGraduated(id)) return true;      // 稳定发行不接受改动
    var a = labList();
    var i = a.indexOf(id);
    if (on) { if (i < 0) a.push(id); }
    else { if (i >= 0) a.splice(i, 1); }
    labWriteList(a);
    return labEnabled(id);
}

// 再次调用即关闭（稳定发行无效）
function labToggle(id) {
    return labSetEnabled(id, !labEnabled(id));
}

// ---------- 《实验室公约》确认 ----------
function labAgreed() {
    try {
        var o = JSON.parse(localStorage.getItem(LAB_AGREE_KEY) || "null");
        return !!(o && o.doc === LAB_CONVENTION.url);
    } catch (e) {
        return false;
    }
}
function labSetAgreed() {
    localStorage.setItem(LAB_AGREE_KEY, JSON.stringify({
        doc: LAB_CONVENTION.url, t: Date.now()
    }));
    labNotify();
}
// 忘掉确认：下次开启功能时会重新要求读公约
function labForgetAgreed() {
    localStorage.removeItem(LAB_AGREE_KEY);
    labNotify();
}

// 开启一个功能。没确认过公约就先弹公约，确认后再开。
// onDone(ok)：真正开起来了才回调 true
function labEnable(id, onDone) {
    if (labIsGraduated(id) || labEnabled(id)) {
        if (onDone) onDone(true);
        return true;
    }
    if (labAgreed()) {
        labSetEnabled(id, true);
        if (onDone) onDone(true);
        return true;
    }
    labShowConvention(id, function (ok) {
        if (ok) labSetEnabled(id, true);
        if (onDone) onDone(ok);
    });
    return false;
}

// ---------- 公约弹窗（自带样式，任何页面都能用）----------
var _labCvBound = false;
function labShowConvention(id, cb) {
    var old = document.getElementById("labCvMask");
    if (old) old.parentNode.removeChild(old);

    var opened = false;
    var agreed = false;
    var name = labName(id);

    var mask = document.createElement("div");
    mask.id = "labCvMask";
    mask.className = "labcv-mask";
    mask.innerHTML =
        '<div class="labcv-box" role="dialog" aria-modal="true">' +
        '  <div class="labcv-title"><img class="inline-icon" src="../site-icon/book-open.svg" alt="" /> 开启前请先阅读《实验室公约》</div>' +
        '  <div class="labcv-text">「' + name + '」属于实验室的试验性功能，可能随时改动、失效或移除。' +
        '    继续前请先读一遍公约。</div>' +
        '  <button class="labcv-open" type="button" id="labCvOpen">打开《实验室公约》 ↗</button>' +
        '  <label class="labcv-check">' +
        '    <input type="checkbox" id="labCvAgree">' +
        '    <span>我已阅读并同意《实验室公约》</span>' +
        '  </label>' +
        '  <div class="labcv-tip" id="labCvTip">请先打开公约，再勾选同意</div>' +
        '  <div class="labcv-btns">' +
        '    <button class="labcv-btn" type="button" id="labCvCancel">取消</button>' +
        '    <button class="labcv-btn primary" type="button" id="labCvOk" disabled>确认开启</button>' +
        '  </div>' +
        '</div>';

    if (!_labCvBound) {
        var st = document.createElement("style");
        st.textContent =
            ".labcv-mask{position:fixed;inset:0;z-index:99999;background:rgba(8,4,24,.78);" +
            "display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;}" +
            ".labcv-box{width:100%;max-width:380px;box-sizing:border-box;padding:20px;border-radius:16px;" +
            "background:linear-gradient(135deg,#244a36,#2d6a4a);border:1.5px solid rgba(255,215,0,.35);" +
            "box-shadow:0 18px 50px rgba(0,0,0,.55);font-family:inherit;}" +
            ".labcv-title{font-size:16px;font-weight:bold;color:#ffd700;margin-bottom:12px;line-height:1.5;}" +
            ".labcv-text{font-size:13px;color:#c8e0d0;line-height:1.75;margin-bottom:14px;}" +
            ".labcv-open{display:block;width:100%;padding:11px;border-radius:10px;cursor:pointer;" +
            "border:1.5px solid rgba(78,205,196,.5);background:rgba(78,205,196,.12);color:#4ecdc4;" +
            "font-size:14px;font-weight:bold;}" +
            ".labcv-open.done{border-color:rgba(78,205,196,.25);color:#7fbfb8;background:rgba(78,205,196,.05);}" +
            ".labcv-check{display:flex;align-items:flex-start;gap:9px;margin:16px 0 0;cursor:pointer;" +
            "font-size:13px;color:#e8f5ec;line-height:1.6;}" +
            ".labcv-check input{width:18px;height:18px;margin:1px 0 0;flex:none;accent-color:#4ecdc4;cursor:pointer;}" +
            ".labcv-tip{font-size:12px;color:#ffb84d;line-height:1.6;margin-top:8px;min-height:19px;}" +
            ".labcv-btns{display:flex;gap:10px;margin-top:16px;}" +
            ".labcv-btn{flex:1;padding:11px;border-radius:10px;cursor:pointer;font-size:14px;" +
            "border:1.5px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#c8e0d0;}" +
            ".labcv-btn.primary{border:none;background:linear-gradient(135deg,#ffd700,#ff9500);" +
            "color:#2a1a00;font-weight:bold;}" +
            ".labcv-btn.primary:disabled{opacity:.4;cursor:not-allowed;filter:grayscale(.5);}";
        document.head.appendChild(st);
        _labCvBound = true;
    }
    document.body.appendChild(mask);

    var okBtn = mask.querySelector("#labCvOk");
    var tip = mask.querySelector("#labCvTip");
    var check = mask.querySelector("#labCvAgree");

    function refresh() {
        okBtn.disabled = !(opened && agreed);
        tip.innerText = !opened ? "请先打开公约，再勾选同意"
                                : (!agreed ? "请勾选「我已阅读并同意」" : "");
    }
    function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }

    mask.querySelector("#labCvOpen").onclick = function () {
        opened = true;
        this.className = "labcv-open done";
        this.innerText = "已打开《实验室公约》（可再点一次重看）";
        try { window.open(LAB_CONVENTION.url, "_blank", "noopener"); } catch (e) {}
        refresh();
    };
    check.onchange = function () { agreed = this.checked; refresh(); };
    mask.querySelector("#labCvCancel").onclick = function () {
        close();
        if (cb) cb(false);
    };
    okBtn.onclick = function () {
        if (!opened || !agreed) return;
        labSetAgreed();
        close();
        if (cb) cb(true);
    };
    refresh();
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
    if (e.key === LAB_STORE_KEY || e.key === LAB_AGREE_KEY) labNotify();
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
    alert("「" + (label || labName(id)) + "」是实验室功能，还没开启。\n请先到「🧪 实验室」里开启。");
    location.replace(back); // replace：不在历史里留下这一页
    return false;
}
