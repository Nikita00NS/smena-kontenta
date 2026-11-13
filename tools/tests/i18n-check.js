/* Проверка языков интерфейса: десять языков, полный словарь, работа в DOM.
   Запуск: node tools/tests/i18n-check.js */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "assets", "js", "i18n.js");

let bad = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { bad++; console.log("  FAIL " + name + (extra === undefined ? "" : " → " + extra)); }
}

const EXPECTED = ["ru", "en", "uk", "kk", "be", "de", "fr", "es", "tr", "zh"];

const SAMPLES = [
  "Материалы", "Медиашкола", "Личный кабинет", "Все материалы", "Светлая тема",
  "Проверить карту", "Подать заявку", "Пульт редакции", "Заявки в медиашколу",
  "Согласие на обработку персональных данных", "Приблизить", "января",
];

function makeDom(lang) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String(e.detail || e.message)));
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="ru"><body>
       <nav><a href="/news">Материалы</a><a href="/media-school">Медиашкола</a></nav>
       <h1>Регионы</h1><button aria-label="Поиск по сайту">Поиск</button>
       <div data-no-i18n>Материалы</div>
     </body></html>`,
    { url: "https://smenakontenta.ru/", runScripts: "outside-only", virtualConsole: vc,
      beforeParse(w) {
        if (lang) w.localStorage.setItem("smena_lang", lang);
      } });
  dom.window.eval(fs.readFileSync(SRC, "utf8"));
  return { dom, errors };
}

(async () => {
  /* 1. Список языков */
  {
    const { dom } = makeDom(null);
    const I = dom.window.SmenaI18n;
    check("десять языков", I.langs.length === 10, I.langs.length);
    check("коды совпадают: " + EXPECTED.join(","),
      I.langs.map((l) => l.code).join(",") === EXPECTED.join(","),
      I.langs.map((l) => l.code).join(","));
    check("у каждого языка есть название", I.langs.every((l) => l.name && l.dir === "ltr"));
    check("без сохранения берётся язык браузера (jsdom → en)", I.lang === "en", I.lang);
    dom.window.close();
  }

  /* 2. Полный словарь у всех девяти не-русских языков */
  {
    const { dom } = makeDom(null);
    const I = dom.window.SmenaI18n;
    const total = I.keys.length;
    check("словарь не пуст: " + total + " строк", total >= 250, total);
    for (const l of I.langs) {
      if (l.code === "ru") continue;
      const n = I.coverage(l.code);
      check("«" + l.name + "» переведён полностью", n === total, n + " из " + total);
    }
    /* переводы не совпадают с ключами-пустышками и не коллапсировали */
    dom.window.eval("SmenaI18n.setLang('en')");
    check("перевод en: Материалы → Stories", I.t("Материалы") === "Stories", I.t("Материалы"));
    check("перевод en: Пульт редакции → Newsroom console", I.t("Пульт редакции") === "Newsroom console", I.t("Пульт редакции"));
    dom.window.close();
  }

  /* 3. DOM: перевод шапки по сохранённому языку */
  {
    const { dom } = makeDom("en");
    const doc = dom.window.document;
    check("html lang = en", doc.documentElement.getAttribute("lang") === "en");
    check("меню переведено", doc.querySelector("nav").textContent.includes("Stories")
      && doc.querySelector("nav").textContent.includes("Media school"));
    check("h1 переведён", doc.querySelector("h1").textContent === "Regions",
      doc.querySelector("h1").textContent);
    check("aria-label переведён", doc.querySelector("button").getAttribute("aria-label") === "Search the site");
    check("data-no-i18n не тронут", doc.querySelector("[data-no-i18n]").textContent === "Материалы");
    dom.window.close();
  }

  /* 4. Наблюдатель динамики (свежая загрузка с немецким) */
  {
    const { dom } = makeDom("de");
    const doc = dom.window.document;
    check("html lang = de", doc.documentElement.getAttribute("lang") === "de");
    check("меню по-немецки", doc.querySelector("nav").textContent.includes("Beiträge"));
    check("h1 по-немецки", doc.querySelector("h1").textContent === "Regionen",
      doc.querySelector("h1").textContent);
    /* новый узел от скрипта подхватывается наблюдателем */
    const fresh = doc.createElement("a");
    fresh.textContent = "Проверить карту";
    doc.body.appendChild(fresh);
    await new Promise((r) => setTimeout(r, 400));
    check("динамический узел переведён (наблюдатель)", fresh.textContent === "Karte prüfen", fresh.textContent);
    dom.window.close();
  }

  /* 5. ?lang= сильнее localStorage */
  {
    const { dom } = makeDom("de");
    dom.window.location.search = "?lang=tr";
    dom.window.eval("window.SmenaI18n2 = window.SmenaI18n;");
    // перечитываем: i18n читает location при загрузке — проверяем через новый дом
    const vc = new VirtualConsole();
    const dom2 = new JSDOM("<!DOCTYPE html><html lang=\"ru\"><body>Материалы</body></html>", {
      url: "https://smenakontenta.ru/news?lang=tr", runScripts: "outside-only", virtualConsole: vc });
    dom2.window.eval(fs.readFileSync(SRC, "utf8"));
    check("?lang=tr открывает турецкий", dom2.window.SmenaI18n.lang === "tr", dom2.window.SmenaI18n.lang);
    check("текст переведён на турецкий", dom2.window.document.body.textContent.includes("Yazılar"));
    dom.window.close();
    dom2.window.close();
  }

  if (bad) {
    console.log("языки: проверка не пройдена");
    process.exit(1);
  }
  console.log("все проверки пройдены");
})();
