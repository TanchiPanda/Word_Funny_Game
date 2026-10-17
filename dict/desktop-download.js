// ===== 站点共用：「下载桌面端」入口 + 设置齿轮 =====
// 引入方式：在每个页面 </body> 前加 <script src="dict/desktop-download.js?v=20261017b"></script>
//          （dict/ 目录下的页面用 <script src="desktop-download.js?v=20261017b"></script>）
//
// 行为说明：
//   1. 页面若已有设置齿轮（.settings-toggle 或 .float-toggle.settings），按钮紧挨着它放；
//   2. 页面没有齿轮时，组件自动在右下角补一个设置齿轮（指向 settings.html）；
//   3. 设备识别为 Windows → 显示微软四色方块图标；
//      不是 Windows → 显示感叹号警告图标并置灰，但仍可点击下载（下载的是 Windows 版）；
//   4. 窄屏（<=480px）只显示图标，隐藏「下载桌面端」文字；
//   5. 整个组件包在 try/catch 里，出问题也不会影响页面其它功能。

(function () {
  try {
    var DOWNLOAD_URL = "https://mirror.r6t5.dpdns.org/software-download/word-funny-game/v1/Word_Funny_Game_1.0.0_x64-setup.exe";
    var base = location.pathname.indexOf("/dict/") !== -1 ? "../" : "";

    var GEAR_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

    // 微软四色方块
    var MS_ICON = '<svg viewBox="0 0 23 23" aria-hidden="true"><rect width="10" height="10" x="0" y="0" fill="#f25022"></rect><rect width="10" height="10" x="13" y="0" fill="#7fba00"></rect><rect width="10" height="10" x="0" y="13" fill="#00a4ef"></rect><rect width="10" height="10" x="13" y="13" fill="#ffb900"></rect></svg>';

    // 感叹号警告（非 Windows）
    var WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

    function isWindows() {
      try {
        var d = navigator.userAgentData;
        if (d && d.platform) return /windows/i.test(d.platform);
      } catch (e) {}
      if (navigator.platform && /win/i.test(navigator.platform)) return true;
      return /windows/i.test(navigator.userAgent || "");
    }
    var onWindows = isWindows();

    // ---- 样式（全部 dd- 前缀，不和页面已有样式冲突）----
    var style = document.createElement("style");
    style.textContent = [
      ".dd-gear{position:fixed;bottom:14px;right:14px;z-index:999;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:1.5px solid rgba(255,215,0,0.5);background:rgba(44,27,84,0.88);color:#ffd700;cursor:pointer;backdrop-filter:blur(8px);transition:0.2s}",
      ".dd-gear:active{transform:scale(0.92) rotate(30deg)}",
      ".dd-download{position:fixed;z-index:999;display:inline-flex;align-items:center;gap:6px;height:44px;padding:0 14px;border-radius:999px;border:1.5px solid rgba(255,215,0,0.5);background:rgba(44,27,84,0.88);color:#ffd700;text-decoration:none;font-size:13px;font-weight:500;cursor:pointer;backdrop-filter:blur(8px);transition:0.2s;white-space:nowrap;box-sizing:border-box}",
      ".dd-download:hover{background:rgba(60,38,110,0.95);border-color:rgba(255,215,0,0.85)}",
      ".dd-download:active{transform:scale(0.96)}",
      ".dd-download.dd-other{border-color:rgba(255,255,255,0.18);color:#9a9ab8}",
      ".dd-download.dd-other .dd-ico{filter:grayscale(1);opacity:0.55}",
      ".dd-ico{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex-shrink:0}",
      ".dd-ico svg{width:18px;height:18px;display:block}",
      "@media (max-width:480px){.dd-download .dd-txt{display:none}.dd-download{padding:0;width:44px;justify-content:center}}"
    ].join("");
    document.head.appendChild(style);

    // ---- 找现成的设置齿轮；找不到就补一个右下角齿轮 ----
    var gear = null;
    var found = document.querySelectorAll(".settings-toggle, .float-toggle.settings");
    for (var i = 0; i < found.length; i++) {
      var rect = found[i].getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) { gear = found[i]; break; }
    }
    if (!gear) {
      gear = document.createElement("button");
      gear.className = "dd-gear";
      gear.type = "button";
      gear.title = "设置";
      gear.setAttribute("aria-label", "设置");
      gear.innerHTML = GEAR_SVG;
      gear.onclick = function () { location.href = base + "settings.html"; };
      document.body.appendChild(gear);
    }

    // ---- 下载按钮 ----
    var btn = document.createElement("a");
    btn.className = "dd-download" + (onWindows ? "" : " dd-other");
    btn.href = DOWNLOAD_URL;
    btn.title = onWindows ? "下载 Windows 桌面端" : "当前系统不是 Windows，仍可下载 Windows 版安装包";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("data-dd-os", onWindows ? "windows" : "other");
    btn.innerHTML = '<span class="dd-ico">' + (onWindows ? MS_ICON : WARN_ICON) + '</span><span class="dd-txt">下载桌面端</span>';
    document.body.appendChild(btn);

    // ---- 定位：默认贴在齿轮左侧并垂直居中；左侧放不下就放上方/下方 ----
    var GAP = 8;
    function place() {
      if (!gear || !document.body.contains(gear)) return;
      var g = gear.getBoundingClientRect();
      var bw = btn.offsetWidth || 44;
      var bh = btn.offsetHeight || 44;
      btn.style.top = "";
      btn.style.bottom = "";
      if (g.left - GAP - bw >= 8) {
        btn.style.right = (window.innerWidth - g.left + GAP) + "px";
        btn.style.top = (g.top + g.height / 2 - bh / 2) + "px";
      } else {
        btn.style.right = (window.innerWidth - g.right) + "px";
        var upTop = g.top - GAP - bh;
        btn.style.top = (upTop >= 8 ? upTop : g.bottom + GAP) + "px";
      }
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("orientationchange", place);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(place).catch(function () {});
    }
  } catch (e) {
    if (window.console) console.warn("desktop-download 组件异常：", e);
  }
})();
