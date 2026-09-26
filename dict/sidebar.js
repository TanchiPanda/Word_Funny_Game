// ===== 全局侧边栏组件 =====
// 引入方式：在每个页面 </body> 前加 <script src="dict/sidebar.js?v=20260926"></script>
// 自动在所有页面注入侧边栏

(function () {
  const current = location.pathname.split("/").pop() || "index.html";
  const base = current === "index.html" ? "" : (location.pathname.includes("/dict/") ? "../" : "");

  const items = [
    { icon: "🏠", label: "首页", href: base + "index.html", match: ["index.html"] },
    { icon: "📚", label: "连连看", href: base + "match.html", match: ["match.html"] },
    { icon: "✏️", label: "单词拼写", href: base + "spell.html", match: ["spell.html"] },
    { icon: "📕", label: "词典学习", href: base + "study.html", match: ["study.html"] },
    { icon: "📖", label: "选课时", href: base + "dict/chooser.html", match: ["chooser.html", "editor.html"] },
    { icon: "⚙️", label: "设置", href: base + "settings.html", match: ["settings.html", "advanced-sync.html"] },
  ];

  const style = document.createElement("style");
  style.textContent = `
    .sb-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:none}
    .sb-overlay.show{display:block}
    .sb{position:fixed;top:0;left:0;width:240px;height:100vh;background:linear-gradient(180deg,#1a1a2e,#16213e);z-index:9999;transform:translateX(-100%);transition:transform 0.25s ease;display:flex;flex-direction:column;padding:16px 0;box-shadow:4px 0 20px rgba(0,0,0,0.3)}
    .sb.show{transform:translateX(0)}
    .sb-title{color:#ffd700;font-size:18px;font-weight:bold;text-align:center;padding:8px 0 16px;letter-spacing:2px}
    .sb-item{display:flex;align-items:center;gap:10px;padding:12px 20px;color:#ccc;text-decoration:none;font-size:15px;cursor:pointer;border-left:3px solid transparent;transition:0.15s}
    .sb-item:hover{background:rgba(255,255,255,0.06);color:#fff}
    .sb-item.active{background:rgba(255,215,0,0.1);color:#ffd700;border-left-color:#ffd700}
    .sb-divider{height:1px;background:rgba(255,255,255,0.1);margin:10px 16px}
    .sb-footer{margin-top:auto;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.1)}
    .sb-sync-row{display:flex;align-items:center;gap:8px;font-size:13px;color:#aaa;margin-bottom:8px;cursor:pointer}
    .sb-light{width:12px;height:12px;border-radius:50%;background:#666;flex-shrink:0;transition:0.2s}
    .sb-light.off{background:#666}
    .sb-light.error{background:#e74c3c;box-shadow:0 0 6px #e74c3c}
    .sb-light.syncing{background:#f39c12;box-shadow:0 0 6px #f39c12;animation:pulse 1s infinite}
    .sb-light.idle{background:#2ecc71;box-shadow:0 0 6px #2ecc71}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    .sb-sync-time{font-size:11px;color:#888;margin-left:20px}
    .sb-sound{display:flex;align-items:center;gap:8px;font-size:13px;color:#aaa;cursor:pointer;padding:4px 0}
    .sb-toggle{position:fixed;top:14px;left:14px;z-index:9997;width:40px;height:40px;border-radius:8px;background:rgba(44,27,84,0.9);border:1px solid rgba(255,215,0,0.4);color:#ffd700;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center}
    body{padding-left:0!important}
  `;
  document.head.appendChild(style);

  // 汉堡按钮
  const toggle = document.createElement("button");
  toggle.className = "sb-toggle";
  toggle.innerHTML = "☰";
  toggle.setAttribute("aria-label", "菜单");
  document.body.appendChild(toggle);

  // 遮罩
  const overlay = document.createElement("div");
  overlay.className = "sb-overlay";
  document.body.appendChild(overlay);

  // 侧边栏
  const sb = document.createElement("div");
  sb.className = "sb";
  sb.innerHTML = '<div class="sb-title">⚡ 单词闯关</div>' +
    items.map(it => {
      const active = it.match.includes(current) ? " active" : "";
      return `<a class="sb-item${active}" href="${it.href}"><span>${it.icon}</span><span>${it.label}</span></a>`;
    }).join("") +
    '<div class="sb-divider"></div>' +
    '<div class="sb-footer">' +
    '  <div class="sb-sync-row" id="sbSyncRow" title="点击进入高级同步设置">' +
    '    <div class="sb-light off" id="sbLight"></div>' +
    '    <span id="sbSyncText">同步未开启</span>' +
    '  </div>' +
    '  <div class="sb-sync-time" id="sbSyncTime">上次同步：-</div>' +
    '  <div class="sb-divider"></div>' +
    '  <div class="sb-sound" id="sbSound">' +
    '    <span id="sbSoundIcon">🔊</span><span id="sbSoundText">音效开</span>' +
    '  </div>' +
    '</div>';
  document.body.appendChild(sb);

  function open() { sb.classList.add("show"); overlay.classList.add("show"); }
  function close() { sb.classList.remove("show"); overlay.classList.remove("show"); }
  toggle.onclick = open;
  overlay.onclick = close;

  // 同步状态
  const advHref = base + "dict/advanced-sync.html";
  document.getElementById("sbSyncRow").onclick = () => location.href = advHref;

  function updateSync(state, err, lastOk) {
    const light = document.getElementById("sbLight");
    const text = document.getElementById("sbSyncText");
    const time = document.getElementById("sbSyncTime");
    light.className = "sb-light " + state;
    if (state === "off") { text.innerText = "同步未开启"; }
    else if (state === "syncing") { text.innerText = "正在同步…"; }
    else if (state === "error") { text.innerText = "同步错误"; }
    else if (state === "idle") { text.innerText = "已同步"; }
    time.innerText = "上次同步：" + (lastOk || "N/A");
  }

  // 音效
  const soundRow = document.getElementById("sbSound");
  function updateSound() {
    const on = localStorage.getItem("wordGameSoundEnabled") !== "0";
    document.getElementById("sbSoundIcon").innerText = on ? "🔊" : "🔇";
    document.getElementById("sbSoundText").innerText = on ? "音效开" : "音效关";
  }
  soundRow.onclick = () => {
    const cur = localStorage.getItem("wordGameSoundEnabled") !== "0";
    localStorage.setItem("wordGameSoundEnabled", cur ? "0" : "1");
    updateSound();
  };
  updateSound();

  // 绑定同步状态（如果 sync.js 已加载）
  if (typeof onSyncStateChange === "function") {
    onSyncStateChange(updateSync);
  } else {
    // 等 sync.js 加载
    const t = setInterval(() => {
      if (typeof onSyncStateChange === "function") {
        clearInterval(t);
        onSyncStateChange(updateSync);
      }
    }, 300);
  }
})();
