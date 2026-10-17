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

var MATCH_GROUP_LABEL = { A: "A 预设 · 难度预设", B: "B 预设 · 形式预设" };

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
    return MATCH_PRESETS[group || matchPresetGroupOf(getMatchPreset())] || [];
}
function matchPresetAll() {
    return MATCH_PRESETS.A.concat(MATCH_PRESETS.B);
}
function matchPresetById(id) {
    return matchPresetAll().filter(function (p) { return p.id === id; })[0] || null;
}
function matchPresetName(id) {
    var p = matchPresetById(id);
    return p ? p.name : (id || "未知模式");
}
// 组归属：f_ 前缀 = B 组（形式预设），其余 = A 组（难度预设）
function matchPresetGroupOf(id) {
    return (typeof id === "string" && id.indexOf("f_") === 0) ? "B" : "A";
}
function modeConfig(id) {
    return MATCH_MODE_CFG[id] || {};
}
// 读取当前预设；存了非法值时回落到默认并存回
function getMatchPreset() {
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
