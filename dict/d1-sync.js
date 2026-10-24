// ===== Cloudflare D1 云存储同步 =====
// 引入方式：在每个页面 </body> 前加 <script src="dict/d1-sync.js?v=20261024"></script>
// 行为：
//   1. 未登录：不同步
//   2. 已登录但未点"我已准备好"：本地存储为主，D1 不写
//   3. 已点"我已准备好"：每个 localStorage 变化自动同步到 D1（按 key 逐个写）
//   4. 已强制 D1（评估期已提前结束）

(function () {
  var API = "https://api.r6t5.dpdns.org/api";
  var FORCE_DATE = "2026-10-24"; // 评估期已提前结束，直接强制 D1
  // 不同步的 key（登录状态、token、密钥）
  var SKIP_KEYS = [
    "wordGameGitHubUser", "wordGameMSAToken", "wordGameMSAExpires",
    "msReturnTo", "wordGameB2AppKey", "wordGameB2KeyId",
    "wordGameServiceChangeShownDate"
  ];

  function getUser() {
    try { return JSON.parse(localStorage.getItem("wordGameGitHubUser") || "null"); } catch (e) { return null; }
  }
  function userEmail(u) { return (u && (u.email || u.login || u.id)) || ""; }

  // 根据用户计划切换主题（全局所有页面）
  function applyTheme(plan) {
    document.body.classList.remove("theme-one", "theme-pro");
    var saved = localStorage.getItem("wordGameTheme") || "default";
    // 权限：Free 只能默认，One 可以金色，Pro 可以彩虹
    var allowed = ["default"];
    if (plan === "one" || plan === "pro") allowed.push("one");
    if (plan === "pro") allowed.push("pro");
    if (!allowed.includes(saved)) saved = "default";

    var css = document.getElementById("theme-css");
    if (css) css.remove();
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

  // 拉取用户计划并应用主题
  var user2 = getUser();
  if (user2) {
    fetch(API.replace("/kv", "") + "/user?user_id=" + encodeURIComponent(userEmail(user2)))
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.plan) applyTheme(d.plan); })
      .catch(function () {});
  }
  function isForced() {
    var d = new Date();
    var today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return today >= FORCE_DATE;
  }

  var user = getUser();
  if (!user) return;
  var uid = userEmail(user);

  // 检查用户是否已准备好
  var ready = false;
  fetch(API + "/ready?user_id=" + encodeURIComponent(uid))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      ready = !!(d && d.ready);
      if (ready || isForced()) syncAll();
    })
    .catch(function () {});

  // 写单个 key 到 D1
  function writeKey(key, value) {
    if (!ready && !isForced()) return;
    if (SKIP_KEYS.indexOf(key) !== -1) return;
    fetch(API + "/kv?user_id=" + encodeURIComponent(uid), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key, value: value })
    }).catch(function () {});
  }

  // 首次加载：从 D1 拉取所有 key，和本地对比（D1 优先如果是 forced）
  function syncAll() {
    // 简单策略：遍历本地所有 key，逐个写 D1
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (SKIP_KEYS.indexOf(k) !== -1) continue;
      writeKey(k, localStorage.getItem(k));
    }
  }

  // 监听 localStorage 变化（跨标签页）
  window.addEventListener("storage", function (e) {
    if (e.key) writeKey(e.key, e.newValue);
  });

  // 暴露给页面：用户点"我已准备好"
  window.d1MarkReady = function () {
    return fetch(API + "/ready?user_id=" + encodeURIComponent(uid), { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function () { ready = true; syncAll(); });
  };
  window.d1IsReady = function () { return ready || isForced(); };
  window.d1Forced = isForced;
})();
