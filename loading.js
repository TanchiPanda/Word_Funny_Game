/* R6T5 全局加载遮罩：注入"加载中…"文本，window.load 后给 html 加 .page-ready 隐藏 spinner */
(function () {
  function injectText() {
    if (document.querySelector('.app-loading-text')) return;
    var t = document.createElement('div');
    t.className = 'app-loading-text';
    t.textContent = '加载中…';
    (document.body || document.documentElement).appendChild(t);
  }
  function done() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.classList.add('page-ready');
      });
    });
    setTimeout(function () {
      document.documentElement.classList.add('page-ready');
    }, 4000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectText);
  } else {
    injectText();
  }
  window.addEventListener('load', done);
})();
