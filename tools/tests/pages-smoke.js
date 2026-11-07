/* Дымовой прогон страниц: собираем HTML со вставленными скриптами и гоняем
   в jsdom. Так видно ошибки, из-за которых страница остаётся пустой.
   Запуск: node tools/tests/pages-smoke.js */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = "/home/user/smena-kontenta";
/* jsdom не умеет часть браузерных API (навигация, canvas, matchMedia).
   Такие сообщения — артефакт стенда, а не ошибка страницы: их отсекаем,
   иначе на «дым» уходят настоящие ошибки. */
const ARTIFACT = /Not implemented/i;
/* Страницы со своим каркасом: у них нет шапки и подвала сайта — это норма. */
const standalone = ["poisk/index.html"];

const pages = ["index.html", "profile/index.html", "admin/index.html", "join/index.html", "news/index.html", "poisk/index.html", "docs/index.html", "media-school/index.html", "about/index.html", "partners/index.html", "founders/index.html"];

function inline(html) {
  return html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      const clean = src.split("?")[0];
      const file = path.join(ROOT, clean);
      if (!fs.existsSync(file)) return "";
      return "<script>\n" + fs.readFileSync(file, "utf8") + "\n</script>";
    });
}

(async () => {
  let bad = 0;
  for (const rel of pages) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) { console.log("НЕТ ФАЙЛА", rel); continue; }
    const errors = [];
    const vc = new VirtualConsole();
    const push = (msg) => { if (!ARTIFACT.test(msg)) errors.push(msg); };
    vc.on("jsdomError", (e) => push("jsdomError: " + (e.detail || e.message || e)));
    vc.on("error", (...a) => push("console.error: " + a.map(String).join(" ")));
    const dom = new JSDOM(inline(fs.readFileSync(file, "utf8")), {
      url: "https://smenakontenta.ru/" + rel.replace(/index\.html$/, ""),
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(window) {
        window.fetch = () => Promise.reject(new Error("сети нет"));
        window.scrollTo = () => {};
        window.matchMedia = () => ({
          matches: false, addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {},
        });
      },
    });
    await new Promise((r) => setTimeout(r, 1200));
    const doc = dom.window.document;
    const main = doc.getElementById("main") || doc.body;
    const status = errors.length ? "ОШИБКИ" : "ok";
    if (errors.length) bad++;
    const own = standalone.indexOf(rel) !== -1;
    console.log(status, rel, "| шапка:", own ? "свой каркас" : !!doc.querySelector(".site-header"),
      "| подвал:", own ? "свой подвал" : !!doc.querySelector(".site-footer"),
      "| main:", main.innerHTML.length);
    errors.slice(0, 4).forEach((e) => console.log("    ", String(e).slice(0, 400)));
    dom.window.close();
  }
  console.log(bad ? "страниц с ошибками: " + bad : "ошибок нет");
})();
