// ===== 连连看预设表（设置页与游戏页共用）=====
// 两组预设互斥：选中任意一个即整体替换连连看的模式按钮。
//   A 组 = 难度预设（原有 4 个模式）
//   B 组 = 形式预设（新增 4 个玩法形式）
// 两侧都引本文件，避免预设清单在两处各写一份而走形。

var MATCH_PRESET_KEY = "wordGameMatchPreset";
var MATCH_PRESET_DEFAULT = "easy";

var MATCH_PRESETS = {
    A: [
        { id: "heaven", name: "☁️ 天堂模式", note: "顺序已排好",          cls: "heaven-btn",    locked: false },
        { id: "easy",   name: "🟢 简单模式", note: "顺序打乱，不限时",     cls: "simple-btn",    locked: false },
        { id: "race",   name: "🔴 困难模式", note: "总时限 = 词数 × 5 秒", cls: "challenge-btn", locked: true  },
        { id: "hell",   name: "💀 地狱模式", note: "卡片背面朝上，翻牌配对", cls: "hell-btn",      locked: true  }
    ],
    B: [
        { id: "f_heaven",    name: "☁️ 天堂模式", note: "顺序已排好",    cls: "heaven-btn",    locked: false },
        { id: "f_challenge", name: "❌ 挑战赛",   note: "5 点生命值",     cls: "challenge-btn", locked: false },
        { id: "f_timed",     name: "🕒 计时赛",   note: "每词 15 秒",     cls: "timed-btn",     locked: true  },
        { id: "f_combo",     name: "⏳ 综合赛",   note: "挑战赛 + 计时赛", cls: "combo-btn",     locked: true  }
    ]
};

var MATCH_GROUP_LABEL = { A: "A 预设 · 难度预设", B: "B 预设 · 形式预设", C: "C 预设 · 自定义预设" };
var MATCH_GROUP_IDS = ["A", "B", "C"];

// 每个模式的玩法参数（游戏侧按这些开关走）
var MATCH_MODE_CFG = {
    heaven:      { noShuffle: true },
    easy:        {},
    race:        { totalTimePerWord: 5 },     // 总时限 = 词数 × 5 秒
    hell:        { hell: true },
    f_heaven:    { noShuffle: true },
    f_challenge: { lives: 5 },                // 点错扣 1 点生命，扣完判负
    f_timed:     { perWordSec: 15, timeoutLose: true },       // 超时直接判负
    f_combo:     { lives: 5, perWordSec: 15, timeoutLoseLife: true }  // 超时扣命
};

function matchPresetList(group) {
    var g = group || matchPresetGroupOf(getMatchPreset());
    if (g === "C") return [customPresetAsMode()];
    return MATCH_PRESETS[g] || [];
}
function matchPresetAll() {
    return MATCH_PRESETS.A.concat(MATCH_PRESETS.B).concat([customPresetAsMode()]);
}
function matchPresetById(id) {
    if (id === CUSTOM_MODE_ID) return customPresetAsMode();
    return MATCH_PRESETS.A.concat(MATCH_PRESETS.B).filter(function (p) { return p.id === id; })[0] || null;
}
function matchPresetName(id) {
    var p = matchPresetById(id);
    return p ? p.name : (id || "未知模式");
}
// 组归属：custom = C 组（自定义预设），f_ 前缀 = B 组（形式预设），其余 = A 组（难度预设）
function matchPresetGroupOf(id) {
    if (id === CUSTOM_MODE_ID) return "C";
    return (typeof id === "string" && id.indexOf("f_") === 0) ? "B" : "A";
}
function modeConfig(id) {
    if (id === CUSTOM_MODE_ID) return customModeConfig();
    return MATCH_MODE_CFG[id] || {};
}
// 读取当前预设；存了非法值时回落到默认并存回
function getMatchPreset() {
    // 实验关掉之后不该还留着它的效果：一律回落到默认难度预设
    if (typeof labEnabled === "function" && !labEnabled("gameParams")) return MATCH_PRESET_DEFAULT;
    var raw = localStorage.getItem(MATCH_PRESET_KEY);
    if (raw && matchPresetById(raw)) return raw;
    if (raw) localStorage.setItem(MATCH_PRESET_KEY, MATCH_PRESET_DEFAULT);
    return MATCH_PRESET_DEFAULT;
}
function activePresetGroup() {
    return matchPresetGroupOf(getMatchPreset());
}
// 该模式在当前登录态下是否被锁（客人模式受限）
function isModeLocked(id) {
    var p = matchPresetById(id);
    if (!p || !p.locked) return false;
    return (typeof isGuest === "function") && isGuest();
}

// ======================================================================
// C 组：自定义预设
// 可调项覆盖连连看现有的全部玩法旋钮；每项都能选「不限」（开关关掉即不限制）。
// ======================================================================
var CUSTOM_MODE_ID = "custom";
var CUSTOM_PRESET_KEY = "wordGameCustomPreset";

// 数值范围（超出即夹到边界，避免手写代码把棋盘搞崩）
var CUSTOM_LIMITS = {
    totalSec:   { min: 1,  max: 60,  def: 5,   unit: "秒/词" },
    livesN:     { min: 1,  max: 20,  def: 5,   unit: "点" },
    perWordSec: { min: 3,  max: 120, def: 15,  unit: "秒" },
    iconLen: 4,
    nameLen: 12,
    descLen: 30
};

var CUSTOM_PRESET_DEFAULT = {
    icon: "🎯",
    name: "自定义玩法",
    desc: "自己调配的连连看玩法",
    shuffle: true,          // false = 英中同序不洗牌
    hell: false,            // true = 卡片背面朝上，翻牌配对
    totalLimit: false,      // true = 加总时限（词数 × totalSec）
    totalSec: 5,
    lives: false,           // true = 加生命值，点错扣 1 点
    livesN: 5,
    perWord: false,         // true = 加每词计时
    perWordSec: 15
};

// 32 项字段白名单：代码编辑时用来发现拼错的字段名
var CUSTOM_FIELDS = {};
Object.keys(CUSTOM_PRESET_DEFAULT).forEach(function (k) { CUSTOM_FIELDS[k] = true; });

function _clampInt(v, lim, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return fallback;
    if (n < lim.min) return lim.min;
    if (n > lim.max) return lim.max;
    return n;
}
// 按码点截断：一个 emoji 算一个字符，不按 UTF-16 码元切
function _cpSlice(str, max) {
    var a = Array.from(str);
    return a.length > max ? a.slice(0, max).join("") : str;
}
function _cpLen(str) {
    return Array.from(str).length;
}
function _str(v, max, fallback) {
    if (typeof v !== "string") return fallback;
    var t = v.trim();
    if (!t) return fallback;
    return _cpSlice(t, max);
}

// 规范化：补默认值、夹范围、挑出问题（issues 数组会写明改了什么）
function normalizeCustomPreset(raw, issues) {
    var d = CUSTOM_PRESET_DEFAULT;
    var out = {};
    var src = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
    var push = function (m) { if (issues) issues.push(m); };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        push("不是有效的对象，已用默认值");
        src = {};
    }
    Object.keys(src).forEach(function (k) {
        if (!CUSTOM_FIELDS[k]) push("忽略未知字段 " + k);
    });

    out.icon = _str(src.icon, CUSTOM_LIMITS.iconLen, d.icon);
    out.name = _str(src.name, CUSTOM_LIMITS.nameLen, d.name);
    out.desc = _str(src.desc, CUSTOM_LIMITS.descLen, d.desc);
    if (typeof src.icon === "string" && _cpLen(src.icon.trim()) > CUSTOM_LIMITS.iconLen) push("图标超过 " + CUSTOM_LIMITS.iconLen + " 个字符，已截断");
    if (typeof src.name === "string" && _cpLen(src.name.trim()) > CUSTOM_LIMITS.nameLen) push("模式名称超过 " + CUSTOM_LIMITS.nameLen + " 字，已截断");
    if (typeof src.desc === "string" && _cpLen(src.desc.trim()) > CUSTOM_LIMITS.descLen) push("描述超过 " + CUSTOM_LIMITS.descLen + " 字，已截断");

    ["shuffle", "hell", "totalLimit", "lives", "perWord"].forEach(function (k) {
        out[k] = (k in src) ? !!src[k] : d[k];
    });
    out.totalSec = _clampInt(src.totalSec, CUSTOM_LIMITS.totalSec, d.totalSec);
    out.livesN = _clampInt(src.livesN, CUSTOM_LIMITS.livesN, d.livesN);
    out.perWordSec = _clampInt(src.perWordSec, CUSTOM_LIMITS.perWordSec, d.perWordSec);
    [["totalSec", "总时限"], ["livesN", "生命值"], ["perWordSec", "每词计时"]].forEach(function (kv) {
        if (key_in(src, kv[0])) {
            var lim = CUSTOM_LIMITS[kv[0]];
            var n = parseInt(src[kv[0]], 10);
            if (!isFinite(n)) push(kv[1] + "不是数字，已用默认 " + lim.def);
            else if (n < lim.min || n > lim.max) push(kv[1] + "超出 " + lim.min + "~" + lim.max + "，已夹到边界");
        }
    });
    return out;
}
function key_in(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function getCustomPreset() {
    var raw = localStorage.getItem(CUSTOM_PRESET_KEY);
    if (!raw) return normalizeCustomPreset(null);
    try {
        return normalizeCustomPreset(JSON.parse(raw));
    } catch (e) {
        return normalizeCustomPreset(null);
    }
}
function saveCustomPreset(obj) {
    var clean = normalizeCustomPreset(obj);
    localStorage.setItem(CUSTOM_PRESET_KEY, JSON.stringify(clean));
    return clean;
}
// C 组在 UI 里的样子（图标 / 名称 / 描述都由用户定义）
function customPresetAsMode() {
    var p = getCustomPreset();
    return {
        id: CUSTOM_MODE_ID,
        name: p.icon + " " + p.name,
        note: p.desc,
        cls: "custom-btn",
        locked: false,
        custom: true
    };
}
// 把自定义预设翻译成游戏侧认的玩法参数
function customModeConfig() {
    var p = getCustomPreset();
    var cfg = {};
    if (!p.shuffle) cfg.noShuffle = true;
    if (p.hell) cfg.hell = true;
    if (p.totalLimit) cfg.totalTimePerWord = p.totalSec;
    if (p.lives) cfg.lives = p.livesN;
    if (p.perWord) {
        cfg.perWordSec = p.perWordSec;
        // 有生命值时超时扣命；没生命值时超时直接判负（与挑战赛/计时赛一致）
        if (p.lives) cfg.timeoutLoseLife = true;
        else cfg.timeoutLose = true;
    }
    return cfg;
}
// 一句话摘要，设置页与游戏页都用它
function customPresetSummary(p) {
    p = p || getCustomPreset();
    var bits = [];
    bits.push(p.shuffle ? "洗牌" : "不洗牌");
    if (p.hell) bits.push("翻牌");
    bits.push(p.totalLimit ? ("总时限 " + p.totalSec + " 秒/词") : "总时限不限");
    bits.push(p.lives ? (p.livesN + " 点生命") : "生命不限");
    bits.push(p.perWord ? ("每词 " + p.perWordSec + " 秒") : "每词不限");
    return bits.join(" · ");
}
