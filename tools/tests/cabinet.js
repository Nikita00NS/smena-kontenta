/* Кабинет: разделы, фильтр материалов и место пресс-карты.
   Проверяем без сервера — важна разметка и переключение, а не данные.
   Запуск: node tools/tests/cabinet.js */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");

function inline(html) {
  return html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      const file = path.join(ROOT, src.split("?")[0]);
      return fs.existsSync(file) ? "<script>\n" + fs.readFileSync(file, "utf8") + "\n</script>" : "";
    });
}

let bad = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { bad++; console.log("  FAIL " + name + (extra === undefined ? "" : " → " + extra)); }
}

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e.detail || e.message || e);
    if (!/Not implemented/i.test(msg)) errors.push(msg);
  });
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));

  const dom = new JSDOM(inline(fs.readFileSync(path.join(ROOT, "profile/index.html"), "utf8")), {
    url: "https://smenakontenta.ru/profile/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("smena_lang", "ru"); /* проверки текста — на русском */
      w.fetch = () => Promise.reject(new Error("сети нет"));
      w.scrollTo = () => {};
      w.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
      w.localStorage.setItem("smena_token_v1", "probe-token");
      w.localStorage.setItem("smena_user_v1", JSON.stringify({
        id: "u_probe", name: "Проверка Кабинета", email: "probe@example.ru",
        region: "moskva", role: "Автор текстов", access: "Пользователь",
        createdAt: "2026-11-01T00:00:00Z",
      }));
      w.localStorage.setItem("smena_consent_v1", JSON.stringify({ status: "approved", kind: "processing" }));
      w.localStorage.setItem("smena_consent_distribution_v1", JSON.stringify({ status: "approved", kind: "distribution" }));
      w.localStorage.setItem("smena_content_v1", JSON.stringify({
        users: [], teams: [], session: null, settings: null,
        posts: [
          { id: "p1", authorId: "u_probe", title: "Двор", status: "published", format: "Репортаж", region: "moskva", date: "2026-11-05" },
          { id: "p2", authorId: "u_probe", title: "Черновик", status: "draft", format: "Заметка", region: "moskva", date: "2026-11-06" },
        ],
      }));
    },
  });

  await new Promise((r) => setTimeout(r, 1500));
  const doc = dom.window.document;
  const tabs = Array.from(doc.querySelectorAll("[data-cab-tab]"));
  const panels = Array.from(doc.querySelectorAll("[data-cab-panel]"));
  const ids = tabs.map((t) => t.getAttribute("data-cab-tab"));

  check("семь разделов кабинета", tabs.length === 7 && panels.length === 7, ids.join(","));
  check("порядок разделов", ids.join(",") === "overview,posts,card,progress,team,mail,settings", ids.join(","));
  check("виден ровно один раздел", panels.filter((p) => !p.hidden).length === 1);
  check("выбранный раздел помечен для скринридера",
    tabs.filter((t) => t.getAttribute("aria-selected") === "true").length === 1);

  const cardTab = doc.querySelector('[data-cab-tab="card"]');
  cardTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const cardPanel = doc.querySelector('[data-cab-panel="card"]');
  check("переход в раздел карты", !cardPanel.hidden && doc.querySelector('[data-cab-panel="overview"]').hidden);
  check("адрес хранит раздел", dom.window.location.hash === "#card", dom.window.location.hash);
  check("статус карты внутри раздела", !!cardPanel.querySelector("[data-profile-card]"));
  check("заявка на карту внутри раздела", !!cardPanel.querySelector("[data-card-app-host]"));
  check("заявка не в конце страницы", !doc.querySelector(".profile-settings [data-card-app]"));

  const settings = doc.querySelector('[data-cab-panel="settings"]');
  check("настройки и безопасность вместе",
    !!settings.querySelector("[data-profile-form]") && !!settings.querySelector("[data-twofa-card]") &&
    !!settings.querySelector("[data-danger-zone]") && !!settings.querySelector("[data-recovery-card]"));
  check("почта в своём разделе", !!doc.querySelector('[data-cab-panel="mail"] [data-inbox]'));
  check("редакция и задачи вместе",
    !!doc.querySelector('[data-cab-panel="team"] [data-my-editorial]') &&
    !!doc.querySelector('[data-cab-panel="team"] [data-tasks-cabinet]'));
  check("баллы и портфолио вместе",
    !!doc.querySelector('[data-cab-panel="progress"] [data-profile-points]') &&
    !!doc.querySelector('[data-cab-panel="progress"] [data-portfolio-form]'));

  /* следующий шаг и плитки */
  check("есть подсказка следующего шага", !!doc.querySelector(".next-step h2"));
  check("четыре плитки показателей", doc.querySelectorAll(".cab-kpi__item").length === 4);

  /* фильтр материалов */
  doc.querySelector('[data-cab-tab="posts"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const rows = Array.from(doc.querySelectorAll("[data-post-status]"));
  check("материалы размечены статусом", rows.length >= 2, rows.length);
  const draftFilter = doc.querySelector('[data-post-filter="draft"]');
  draftFilter.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const visible = rows.filter((r) => !r.hidden);
  check("фильтр по статусу работает", visible.length === 1 && visible[0].getAttribute("data-post-status") === "draft",
    visible.map((r) => r.getAttribute("data-post-status")).join(","));
  doc.querySelector('[data-post-filter=""]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  check("сброс фильтра возвращает все материалы", rows.filter((r) => !r.hidden).length === rows.length);

  dom.window.close();
  errors.slice(0, 5).forEach((e) => console.log("ОШИБКА", e.slice(0, 300)));
  if (errors.length || bad) {
    console.log("кабинет: проверка не пройдена");
    process.exit(1);
  }
  console.log("все проверки пройдены");
})();
