// ===== 主题应用（原 D1 同步模块精简版）=====
// 旧的 localStorage → D1 KV 进度同步已随迁移到 Supabase 废弃；
// 本文件只保留：按服务端 plan 校正主题，主题偏好本身仍存 localStorage（纯本地 UI 偏好）。
// 引入方式：在每个页面 </body> 前加 <script src="dict/d1-sync.js?v=20261031"></script>

(function () {
  function applyTheme(plan) {
    document.body.classList.remove("theme-one", "theme-pro");
    var saved = localStorage.getItem("wordGameTheme") || "default";
    // 权限检查：免费 default，one 解锁 one，pro 解锁 pro
    var allowed = ["default"];
    if (plan === "one" || plan === "pro") allowed.push("one");
    if (plan === "pro") allowed.push("pro");
    // 没拉到 plan 时，先按已保存的主题应用（避免闪烁）
    if (plan && !allowed.includes(saved)) saved = "default";

    var old = document.getElementById("theme-css");
    if (old) old.remove();
    if (saved === "one") {
      document.body.classList.add("theme-one");
      var c1 = document.createElement("style");
      c1.id = "theme-css";
      c1.textContent = 'body { background: linear-gradient(135deg, #2a1f0a, #3d2e0f) !important; } .sb { background: linear-gradient(180deg, #3d2e0f, #4a3a15) !important; }';
      document.head.appendChild(c1);
    } else if (saved === "pro") {
      document.body.classList.add("theme-pro");
      var c2 = document.createElement("style");
      c2.id = "theme-css";
      c2.textContent = 'body { background: linear-gradient(135deg, #1a0a2a, #2a0a1a, #0a1a2a, #0a2a1a) !important; background-size: 400% 400% !important; animation: rainbow 15s ease infinite !important; } @keyframes rainbow { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} } .sb { background: linear-gradient(180deg, #2a0a4a, #4a0a2a) !important; }';
      document.head.appendChild(c2);
    }
  }

  // 启动时立即应用已保存的主题（避免延迟闪烁）
  applyTheme(null);

  // 登录后用服务端 plan 校正主题（plan 由 Supabase RPC 提供，不信前端）
  var user = null;
  try { user = JSON.parse(localStorage.getItem("wordGameGitHubUser") || "null"); } catch (e) {}
  if (user && typeof SBData !== "undefined" && SBData.getProfile) {
    SBData.getProfile()
      .then(function (d) { if (d && d.plan) applyTheme(d.plan); })
      .catch(function () {});
  }

  window.d1ApplyTheme = function () { applyTheme(window.USER_PLAN); };
  // 旧钩子保留为空实现，避免页面调用报错（KV/ready 概念已废弃）
  window.d1MarkReady = function () { return Promise.resolve(); };
  window.d1IsReady = function () { return true; };
  window.d1Forced = function () { return true; };
})();
