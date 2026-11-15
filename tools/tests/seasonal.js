/* Проверка сезонного оформления: даты праздников, календарные темы,
   снегопад, доступность, скрытие оформления и отдельная страница поиска. */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "assets/js/seasonal.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/site.css"), "utf8");
let bad = 0;

function check(name, condition, extra) {
  if (condition) console.log("  ok   " + name);
  else {
    bad++;
    console.log("  FAIL " + name + (extra === undefined ? "" : " → " + extra));
  }
}

function makeDom(options) {
  options = options || {};
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(String(e.detail || e.message || e)));
  vc.on("error", (...args) => errors.push("console.error: " + args.map(String).join(" ")));
  const search = !!options.search;
  const html = `<!doctype html><html lang="${options.lang || "ru"}"><head></head><body>
    ${search ? '<nav class="ps-hud"></nav><main class="ps-view"></main>' : '<div data-header></div><main></main>'}
  </body></html>`;
  const dom = new JSDOM(html, {
    url: "https://smenakontenta.ru/" + (search ? "poisk" : "news"),
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = (query) => ({
        matches: !!options.reducedMotion && query.indexOf("prefers-reduced-motion") !== -1,
        media: query,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
    },
  });
  if (options.hidden) dom.window.localStorage.setItem("smena_seasonal_hidden_v1", options.hidden);
  dom.window.eval(SOURCE);
  return { dom, errors };
}

function localDate(window, year, month, day) {
  return new window.Date(year, month - 1, day, 12, 0, 0);
}

(async () => {
  const base = makeDom();
  const seasonal = base.dom.window.SmenaSeasonal;
  check("модуль экспортирует детектор дат", !!seasonal && typeof seasonal.detect === "function");
  const expectedSeasons = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
  const actualSeasons = [];
  for (let month = 1; month <= 12; month++) {
    actualSeasons.push(seasonal.detect(localDate(base.dom.window, 2026, month, 15)).season);
  }
  check("все 12 месяцев получают сезонную тему", actualSeasons.join(",") === expectedSeasons.join(","), actualSeasons.join(","));

  const holidayCases = [
    [2026, 12, 20, "new-year"], [2027, 1, 8, "new-year"],
    [2026, 2, 23, "defender-day"], [2026, 3, 8, "women-day"],
    [2026, 4, 12, "cosmonautics-day"], [2026, 5, 1, "spring-labour-day"],
    [2026, 5, 9, "victory-day"], [2026, 6, 12, "russia-day"],
    [2026, 9, 1, "knowledge-day"], [2026, 11, 4, "unity-day"],
    [2026, 12, 12, "constitution-day"],
  ];
  holidayCases.forEach(([year, month, day, expected]) => {
    const found = seasonal.detect(localDate(base.dom.window, year, month, day)).holiday;
    check("праздник определяется: " + expected, found === expected, found);
  });
  check("новогоднее окно начинается 20 декабря", seasonal.detect(localDate(base.dom.window, 2026, 12, 19)).holiday === "");
  check("новогоднее окно заканчивается 8 января", seasonal.detect(localDate(base.dom.window, 2027, 1, 9)).holiday === "");
  check("4 ноября распознаётся как День народного единства",
    seasonal.detect(localDate(base.dom.window, 2026, 11, 4)).holiday === "unity-day");
  check("3 ноября остаётся обычным осенним днём",
    seasonal.detect(localDate(base.dom.window, 2026, 11, 3)).holiday === "");
  base.dom.window.close();

  {
    const { dom, errors } = makeDom();
    const state = dom.window.SmenaSeasonal.init(localDate(dom.window, 2026, 11, 12));
    const doc = dom.window.document;
    const layer = doc.querySelector(".site-seasonal-leaves");
    check("осенью показывается отдельная оранжевая листва", state.season === "autumn"
      && !!layer && doc.querySelectorAll(".site-seasonal-leaves__leaf").length === 14);
    check("осенняя плашка получает листовой знак",
      !!doc.querySelector(".site-seasonal__mark") && /🍂/.test(doc.querySelector(".site-seasonal__mark").textContent));
    check("листья — декоративный слой с SVG и без перехвата кликов",
      !!layer && layer.getAttribute("aria-hidden") === "true"
      && layer.querySelectorAll("svg path").length === 28
      && /pointer-events:\s*none/.test(CSS));
    const dismiss = doc.querySelector(".site-seasonal__dismiss");
    dismiss.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    check("закрытие осенней темы убирает листву", !doc.querySelector(".site-seasonal-leaves")
      && !doc.querySelector(".site-seasonal"));
    check("нет ошибок в осеннем рантайме", errors.length === 0, errors.join(" | "));
    dom.window.close();
  }

  {
    const { dom, errors } = makeDom();
    const state = dom.window.SmenaSeasonal.init(localDate(dom.window, 2026, 12, 24));
    const doc = dom.window.document;
    const banner = doc.querySelector(".site-seasonal");
    check("в декабре назначается новогодняя тема", state.holiday === "new-year"
      && doc.documentElement.getAttribute("data-seasonal-holiday") === "new-year");
    check("праздничная плашка вставляется под шапкой",
      !!banner && doc.querySelector("[data-header]").nextElementSibling === banner);
    check("новогодний текст показан по-русски", !!banner && /Новогоднее настроение/.test(banner.textContent));
    check("для Нового года создаются 16 декоративных снежинок",
      doc.querySelectorAll(".site-seasonal-snow__flake").length === 16);
    check("слой снега не перехватывает действия мыши",
      /\.site-seasonal-snow\s*\{[^}]*pointer-events:\s*none/s.test(CSS));
    const dismiss = doc.querySelector(".site-seasonal__dismiss");
    check("кнопка скрытия доступна с клавиатуры и подписана", !!dismiss
      && dismiss.tagName === "BUTTON" && !!dismiss.getAttribute("aria-label"));
    dismiss.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    check("закрытие скрывает плашку и снег", !doc.querySelector(".site-seasonal")
      && !doc.querySelector(".site-seasonal-snow"));
    check("закрытие сохраняется на новогодний период",
      dom.window.localStorage.getItem("smena_seasonal_hidden_v1") === "new-year-2026");
    check("после закрытия сезонные атрибуты удаляются",
      !doc.documentElement.hasAttribute("data-seasonal-month"));
    check("нет ошибок в браузерном рантайме", errors.length === 0, errors.join(" | "));
    dom.window.close();
  }

  {
    const { dom } = makeDom({ hidden: "new-year-2026" });
    dom.window.SmenaSeasonal.init(localDate(dom.window, 2027, 1, 8));
    check("скрытая тема остаётся скрытой после перезагрузки в январе",
      !dom.window.document.querySelector(".site-seasonal")
      && !dom.window.document.documentElement.hasAttribute("data-seasonal-month"));
    dom.window.SmenaSeasonal.init(localDate(dom.window, 2027, 1, 9));
    check("после новогоднего периода снова показывается сезонная плашка",
      !!dom.window.document.querySelector(".site-seasonal")
      && dom.window.document.documentElement.getAttribute("data-seasonal-month") === "1");
    dom.window.close();
  }

  {
    const { dom } = makeDom({ reducedMotion: true });
    dom.window.SmenaSeasonal.init(localDate(dom.window, 2026, 12, 24));
    check("при reduced motion плашка остаётся доступной",
      !!dom.window.document.querySelector(".site-seasonal"));
    check("при reduced motion анимированный снег не создаётся",
      !dom.window.document.querySelector(".site-seasonal-snow"));
    dom.window.SmenaSeasonal.init(localDate(dom.window, 2026, 11, 12));
    check("при reduced motion осенняя листва не создаётся",
      !!dom.window.document.querySelector(".site-seasonal")
      && !dom.window.document.querySelector(".site-seasonal-leaves"));
    dom.window.close();
  }

  {
    const { dom } = makeDom({ lang: "en" });
    dom.window.SmenaSeasonal.init(localDate(dom.window, 2026, 11, 4));
    const banner = dom.window.document.querySelector(".site-seasonal");
    check("праздничный текст учитывает выбранный язык",
      !!banner && /National Unity Day/.test(banner.textContent));
    dom.window.close();
  }

  {
    const { dom } = makeDom({ search: true });
    dom.window.SmenaSeasonal.init(localDate(dom.window, 2026, 11, 4));
    const hud = dom.window.document.querySelector(".ps-hud");
    check("отдельная страница поиска тоже получает сезонную плашку",
      !!hud && hud.nextElementSibling.classList.contains("site-seasonal--search"));
    dom.window.close();
  }

  if (bad) {
    console.log("seasonal: проверка не пройдена — " + bad + " ошибок");
    process.exitCode = 1;
  } else {
    console.log("seasonal: все проверки пройдены");
  }
})();
