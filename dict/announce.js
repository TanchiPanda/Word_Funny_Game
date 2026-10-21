// ===== 首页「服务变更公告」弹窗（每日最多 1 次）=====
// 引入方式：在 index.html 末尾 <script src="dict/sidebar.js?v=..."></script> 之后加
//           <script src="dict/announce.js?v=20261021"></script>
// 行为：
//   1. 每天首次进入首页时弹一次；点「我知道了」关闭并记录当日，当日不再弹；
//   2. 弹窗里有「查看详情」按钮，跳到飞书详细公告；
//   3. 暴露 window.showServiceChange() 供侧边栏等外部入口手动唤起。

(function () {
  try {
    var DOC_URL = "https://my.feishu.cn/docx/FCNqdudLioHO7SxganIc0Pbinxb";
    var STORE_KEY = "wordGameServiceChangeShownDate"; // 值：YYYY-MM-DD

    function today() {
      var d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function alreadyShownToday() {
      try { return localStorage.getItem(STORE_KEY) === today(); } catch (e) { return false; }
    }
    function markShownToday() {
      try { localStorage.setItem(STORE_KEY, today()); } catch (e) {}
    }

    // 注入样式
    var css = [
      ".sc-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:10000;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}",
      ".sc-overlay.show{display:flex}",
      ".sc-card{width:100%;max-width:440px;background:linear-gradient(160deg,#2a5a3e 0%,#1a3a2e 100%);border:1.5px solid rgba(255,215,0,0.5);border-radius:16px;padding:24px 22px;box-shadow:0 12px 40px rgba(0,0,0,0.5);color:#fff;box-sizing:border-box;animation:sc-in 0.25s ease}",
      "@keyframes sc-in{from{opacity:0;transform:translateY(12px) scale(0.97)}to{opacity:1;transform:none}}",
      ".sc-title{font-size:18px;font-weight:bold;color:#ffd700;margin-bottom:10px;display:flex;align-items:center;gap:8px}",
      ".sc-body{font-size:14px;line-height:1.7;color:#e8e6f5;margin-bottom:8px}",
      ".sc-body b{color:#fff}",
      ".sc-list{font-size:13px;line-height:1.8;color:#c9c6e0;margin:6px 0 14px 18px;padding:0}",
      ".sc-list li{margin-bottom:2px}",
      ".sc-tip{font-size:12px;color:#9a9ab8;margin-bottom:18px}",
      ".sc-actions{display:flex;gap:10px}",
      ".sc-btn{flex:1;height:42px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;transition:0.15s}",
      ".sc-btn:active{transform:scale(0.97)}",
      ".sc-primary{background:linear-gradient(90deg,#ffd700,#f0b429);color:#1a3a2e}",
      ".sc-ghost{background:rgba(255,255,255,0.08);color:#ffd700;border:1px solid rgba(255,215,0,0.4)}",
      "@media (max-width:480px){.sc-card{padding:20px 18px}.sc-title{font-size:16px}.sc-body{font-size:13px}}"
    ].join("");
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    // 结构
    var overlay = document.createElement("div");
    overlay.className = "sc-overlay";
    overlay.innerHTML =
      '<div class="sc-card" role="dialog" aria-modal="true" aria-label="服务变更公告">' +
      '  <div class="sc-title">⚠️ 服务变更公告</div>' +
      '  <div class="sc-body">为让<b>词书内容开放</b>、减少因数据更改产生的频繁提交，本站将在 <b>2026 年 12 月 – 2027 年 2 月</b> 期间，集中调整：</div>' +
      '  <ul class="sc-list">' +
      '    <li>游戏服务</li>' +
      '    <li>存储位置（旧地址长期保留）</li>' +
      '    <li>托管平台</li>' +
      '    <li>配色方案</li>' +
      '  </ul>' +
      '  <div class="sc-tip">你的学习记录与词书数据不受影响。Windows 客户端自动跟随，无需重装。</div>' +
      '  <div class="sc-actions">' +
      '    <button class="sc-btn sc-ghost" id="scDetail">查看详情</button>' +
      '    <button class="sc-btn sc-primary" id="scOk">我知道了</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlay);

    function show() { overlay.classList.add("show"); }
    function hide() { overlay.classList.remove("show"); markShownToday(); }

    overlay.addEventListener("click", function (e) { if (e.target === overlay) hide(); });
    overlay.querySelector("#scOk").onclick = hide;
    overlay.querySelector("#scDetail").onclick = function () { window.open(DOC_URL, "_blank", "noopener"); };

    // 外部手动唤起（不写记录）
    window.showServiceChange = function () { overlay.classList.add("show"); };

    // 每天首次进入首页时弹一次
    if (!alreadyShownToday()) {
      // 等页面基本渲染完再弹，避免和登录/其它弹窗叠加
      setTimeout(show, 800);
    }
  } catch (e) {
    if (window.console) console.warn("announce 组件异常：", e);
  }
})();
