/* Проверка словаря интерфейса: все языки на месте, ни одного пустого значения,
   направления письма верные, у каждой строки есть перевод во всех слоях.
   Запуск: node tools/tests/i18n-check.js */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const src = fs.readFileSync(path.join(ROOT, "assets/js/i18n.js"), "utf8");

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? "  ok   " : "  FAIL ") + name + (cond || extra === undefined ? "" : " → " + String(extra).slice(0, 200)));
}

function arrayOf(name) {
  const start = src.indexOf("var " + name + " = [");
  if (start === -1) return [];
  const block = src.slice(start, src.indexOf("];", start));
  return [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

function objectOf(name, arity) {
  const start = src.indexOf("var " + name + " = {");
  if (start === -1) return {};
  const block = src.slice(start, src.indexOf("\n  };", start));
  const out = {};
  for (const row of block.matchAll(/^\s{4}([a-z]{2}): \[(.*?)\],$/gm)) {
    out[row[1]] = [...row[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  }
  return out;
}

// языки: [код, название, направление, 24 перевода]
const localesBlock = src.slice(src.indexOf("var LOCALES = ["), src.indexOf("\n  ];", src.indexOf("var LOCALES = [")));
const locales = [...localesBlock.matchAll(/^ {4}\["([a-z]{2})", "([^"]+)", "(ltr|rtl)"/gm)].map((m) => ({
  code: m[1], name: m[2], dir: m[3],
}));

const KEYS = arrayOf("KEYS");
const EXTRA_KEYS = arrayOf("EXTRA_KEYS");
const EXTRA2_KEYS = arrayOf("EXTRA2_KEYS");
const EXTRA = objectOf("EXTRA");
const EXTRA2 = objectOf("EXTRA2");

check("языков в списке не меньше 50", locales.length >= 50, locales.length);
check("в базовом слое 24 подписи", KEYS.length === 24, KEYS.length);
check("во втором слое есть меню и цвета", EXTRA_KEYS.length >= 18, EXTRA_KEYS.length);
check("в третьем слое есть кнопки знакомства", EXTRA2_KEYS.length >= 10, EXTRA2_KEYS.length);

const codes = locales.map((l) => l.code);
const uniq = new Set(codes);
check("коды языков не повторяются", uniq.size === codes.length, codes.length - uniq.size);

// RTL: арабский, иврит, фарси, урду
const rtl = locales.filter((l) => l.dir === "rtl").map((l) => l.code).sort();
check("направление rtl у ar, he, fa, ur",
  ["ar", "fa", "he", "ur"].every((c) => rtl.includes(c)) && rtl.length === 4, rtl.join(","));

// у каждого языка, кроме русского, все значения на месте
const badExtra = [];
const badExtra2 = [];
const badBase = [];
for (const l of locales) {
  if (l.code === "ru") continue;
  const e = EXTRA[l.code] || [];
  const e2 = EXTRA2[l.code] || [];
  if (e.length !== EXTRA_KEYS.length || e.some((v) => !v)) badExtra.push(l.code);
  if (e2.length !== EXTRA2_KEYS.length || e2.some((v) => !v)) badExtra2.push(l.code);
  const row = localesBlock.match(new RegExp('\\["' + l.code + '", "[^"]+", "(?:ltr|rtl)", \\[([\\s\\S]*?)\\]\\]'));
  const values = row ? [...row[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : [];
  if (values.length !== KEYS.length || values.some((v) => !v)) badBase.push(l.code);
}
check("второй слой заполнен на всех языках", badExtra.length === 0, badExtra.join(","));
check("третий слой заполнен на всех языках", badExtra2.length === 0, badExtra2.join(","));
check("базовый слой заполнен на всех языках", badBase.length === 0, badBase.join(","));

// переводы не должны остаться русскими
const cyrillic = /[А-Яа-яЁё]/;
const stillRussian = [];
for (const l of locales) {
  if (["ru", "uk", "kk", "ky", "tg", "mk", "bg", "sr", "mn", "be"].includes(l.code)) continue;
  const all = (EXTRA[l.code] || []).concat(EXTRA2[l.code] || []);
  if (all.some((v) => cyrillic.test(v))) stillRussian.push(l.code);
}
check("в нерусских языках нет русских подписей", stillRussian.length === 0, stillRussian.join(","));

const bad = results.filter((r) => !r.ok);
console.log(bad.length ? "провалено: " + bad.length : "все проверки пройдены");
process.exit(bad.length ? 1 : 0);
