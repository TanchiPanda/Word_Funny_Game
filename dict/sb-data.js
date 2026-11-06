// ===== Supabase 直连数据层（权威数据源在库里，localStorage 仅留本地 UI 偏好）=====
// 依赖 sbauth.js（提供全局 sbInit() 与已登录会话）。
// 词书/课时/词条走 RLS 直连；积分/签到/购买走 SECURITY DEFINER RPC，前端不改余额。
// 引入：<script src="dict/sb-data.js?v=20261031"></script>（在 sbauth.js 之后）

(function () {
  var _client = null;

  async function client() {
    if (_client) return _client;
    if (typeof sbInit !== "function") throw new Error("sbauth.js 未加载");
    _client = await sbInit();
    return _client;
  }

  // 未登录统一报错
  function needLogin() {
    var u = null;
    try { u = JSON.parse(localStorage.getItem("wordGameGitHubUser") || "null"); } catch (e) {}
    if (!u || !(u.id || u.email)) {
      var err = new Error("未登录");
      err.code = "NO_LOGIN";
      throw err;
    }
    return u;
  }

  // ---------- 词书：读取（组装成旧前端兼容结构） ----------
  // 返回 [{ id, name, data:[{ name, words:[{en,phonetic,pos,cn}] }] }]
  async function listBooks() {
    needLogin();
    var db = await client();
    var { data, error } = await db
      .from("books")
      .select("id, name, levels(id, name, words(en, phonetic, pos, cn))")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(function (b) {
      return {
        id: b.id,
        name: b.name,
        data: (b.levels || []).map(function (lv) {
          return {
            name: lv.name,
            words: (lv.words || []).map(function (w) {
              return { en: w.en, phonetic: w.phonetic || "", pos: w.pos || "", cn: w.cn || "" };
            })
          };
        })
      };
    });
  }

  // ---------- 词书：全量保存（编辑器用，整体替换某书的课时与词条） ----------
  // bookId 为 null 表示新建；levelsData = [{name, words:[{en,phonetic,pos,cn}]}]
  async function saveBookFull(bookId, name, levelsData) {
    needLogin();
    var db = await client();
    var bid = bookId;

    if (!bid) {
      var ins = await db.from("books").insert({ name: name }).select("id").single();
      if (ins.error) throw ins.error;
      bid = ins.data.id;
    } else {
      var up = await db.from("books").update({ name: name }).eq("id", bid);
      if (up.error) throw up.error;
    }

    // 全量覆盖：先删该书旧课时（级联删词条），再重写
    var del = await db.from("levels").delete().eq("book_id", bid);
    if (del.error) throw del.error;

    for (var i = 0; i < levelsData.length; i++) {
      var lv = levelsData[i] || {};
      var lIns = await db
        .from("levels")
        .insert({ book_id: bid, name: (lv.name || "LV1").trim() })
        .select("id")
        .single();
      if (lIns.error) throw lIns.error;
      var levelId = lIns.data.id;

      var rows = (lv.words || [])
        .filter(function (w) { return w && w.en && w.en.trim(); })
        .map(function (w) {
          return {
            level_id: levelId,
            en: w.en.trim(),
            phonetic: (w.phonetic || "").trim(),
            pos: (w.pos || "").trim(),
            cn: (w.cn || "").trim()
          };
        });
      if (rows.length) {
        var wIns = await db.from("words").insert(rows);
        if (wIns.error) throw wIns.error;
      }
    }
    return bid;
  }

  // ---------- 词书：删除 ----------
  async function deleteBook(bookId) {
    needLogin();
    var db = await client();
    var r = await db.from("books").delete().eq("id", bookId);
    if (r.error) throw r.error;
  }

  // ---------- 扩展收藏：按名找到/新建书与课时，英文小写去重后追加 ----------
  // 返回 { added, skipped }
  async function appendWords(bookName, levelName, words) {
    needLogin();
    var db = await client();

    var b = await db.from("books").select("id").eq("name", bookName).maybeSingle();
    var bookId;
    if (b.data) {
      bookId = b.data.id;
    } else {
      var bIns = await db.from("books").insert({ name: bookName }).select("id").single();
      if (bIns.error) throw bIns.error;
      bookId = bIns.data.id;
    }

    var l = await db
      .from("levels")
      .select("id")
      .eq("book_id", bookId)
      .eq("name", levelName)
      .maybeSingle();
    var levelId;
    if (l.data) {
      levelId = l.data.id;
    } else {
      var lIns = await db.from("levels").insert({ book_id: bookId, name: levelName }).select("id").single();
      if (lIns.error) throw lIns.error;
      levelId = lIns.data.id;
    }

    var exist = await db.from("words").select("en").eq("level_id", levelId);
    if (exist.error) throw exist.error;
    var have = new Set((exist.data || []).map(function (w) { return String(w.en).toLowerCase(); }));

    var rows = [];
    var added = 0, skipped = 0;
    (words || []).forEach(function (w) {
      if (!w || !w.en || !w.en.trim()) return;
      var en = w.en.trim();
      if (have.has(en.toLowerCase())) { skipped++; return; }
      have.add(en.toLowerCase());
      rows.push({
        level_id: levelId,
        en: en,
        phonetic: (w.phonetic || "").trim(),
        pos: (w.pos || "").trim(),
        cn: (w.cn || "").trim()
      });
      added++;
    });
    if (rows.length) {
      var wIns = await db.from("words").insert(rows);
      if (wIns.error) throw wIns.error;
    }
    return { added: added, skipped: skipped };
  }

  // ---------- 积分 / 会员 / 签到（RPC，服务端校验） ----------
  async function getProfile() {
    needLogin();
    var db = await client();
    var r = await db.rpc("get_my_profile");
    if (r.error) throw r.error;
    return r.data; // {credits, plan, plan_expires, checked_in_today}
  }

  async function checkin() {
    needLogin();
    var db = await client();
    var r = await db.rpc("do_checkin");
    if (r.error) throw r.error;
    return r.data; // {ok, reward} / {ok:false, error}
  }

  async function buyOne() {
    needLogin();
    var db = await client();
    var r = await db.rpc("buy_one");
    if (r.error) throw r.error;
    return r.data;
  }

  async function buyPro() {
    needLogin();
    var db = await client();
    var r = await db.rpc("buy_pro");
    if (r.error) throw r.error;
    return r.data;
  }

  window.SBData = {
    listBooks: listBooks,
    saveBookFull: saveBookFull,
    deleteBook: deleteBook,
    appendWords: appendWords,
    getProfile: getProfile,
    checkin: checkin,
    buyOne: buyOne,
    buyPro: buyPro
  };
})();
