/* Дымовой прогон страниц: собираем HTML со вставленными скриптами и гоняем
   в jsdom. Так видно ошибки, из-за которых страница остаётся пустой.
   Запуск: node tools/tests/pages-smoke.js */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
/* jsdom не умеет часть браузерных API (навигация, canvas, matchMedia).
   Такие сообщения — артефакт стенда, а не ошибка страницы: их отсекаем,
   иначе на «дым» уходят настоящие ошибки. */
const ARTIFACT = /Not implemented/i;
/* Страницы со своим каркасом: у них нет шапки и подвала сайта — это норма. */
const standalone = ["poisk/index.html"];

/* Все страницы сайта: папки с index.html в корне. Новая страница попадает
   в прогон сама — список руками не ведём. */
const SKIP_DIRS = ["api", "assets", "tools", "node_modules"];
const pages = ["index.html", "404.html"].concat(
  fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name[0] !== "." && SKIP_DIRS.indexOf(d.name) === -1)
    .map((d) => d.name + "/index.html")
    .filter((rel) => fs.existsSync(path.join(ROOT, rel)))
    .sort()
);

/* подключённые, но отсутствующие файлы: страница без скрипта «работает»
   в стенде и пустая на сайте — это ошибка, а не мелочь */
let missing = [];

function inline(html) {
  missing = [];
  html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
    const clean = href.split("?")[0];
    if (clean[0] === "/" && !fs.existsSync(path.join(ROOT, clean))) missing.push(clean);
    return m;
  });
  return html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      const clean = src.split("?")[0];
      const file = path.join(ROOT, clean);
      if (!fs.existsSync(file)) { missing.push(clean); return ""; }
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
    const html = inline(fs.readFileSync(file, "utf8"));
    missing.forEach((f) => errors.push("подключён файл, которого нет: " + f));
    const dom = new JSDOM(html, {
      url: "https://smenakontenta.ru/" + rel.replace(/\/?index\.html$/, "").replace(/\.html$/, ""),
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
  console.log(bad ? "страниц с ошибками: " + bad : "ошибок нет, страниц: " + pages.length);
  process.exit(bad ? 1 : 0);
})();
