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
