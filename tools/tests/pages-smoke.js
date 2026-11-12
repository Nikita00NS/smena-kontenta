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

const pages = ["index.html", "profile/index.html", "admin/index.html", "join/index.html", "news/index.html", "poisk/index.html", "docs/index.html", "media-school/index.html", "about/index.html", "partners/index.html", "founders/index.html", "verify/index.html"];

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

    /* Рабочая почта проекта: общая — в подвале, поддержка — на /support. */
    if (!own) {
      const footerMail = doc.querySelector('.site-footer a[href="mailto:info@smenakontenta.ru"]');
      if (!footerMail) { bad++; console.log("ОШИБКИ почта", rel, "| в подвале нет info@smenakontenta.ru"); }
      if (rel === "support/index.html" && !doc.querySelector('a[href="mailto:support@smenakontenta.ru"]')) {
        bad++; console.log("ОШИБКИ почта", rel, "| нет адреса поддержки");
      }
      if (rel === "partners/index.html") {
        const mails = Array.from(doc.querySelectorAll("[data-brand-email]"));
        if (!mails.length || mails.some((a) => a.getAttribute("href") !== "mailto:info@smenakontenta.ru")) {
          bad++; console.log("ОШИБКИ почта", rel, "| data-brand-email не ведёт на info@");
        }
      }
    }

    /* Соцсети в подвале: список один на сайт (SC.brand.social), ссылки должны
       совпадать с ним, открываться в новой вкладке и вести на существующий логотип. */
    if (!own) {
      const expected = (dom.window.SC && dom.window.SC.brand && dom.window.SC.brand.social) || [];
      const links = Array.from(doc.querySelectorAll(".footer-social__link"));
      const trouble = [];
      if (!expected.length) trouble.push("в data.js пустой brand.social");
      if (links.length !== expected.length) trouble.push("ссылок " + links.length + ", ожидалось " + expected.length);
      expected.forEach((item, i) => {
        const a2 = links[i];
        if (!a2) return;
        if (a2.getAttribute("href") !== item.url) trouble.push("адрес не совпадает: " + item.title);
        if (a2.getAttribute("target") !== "_blank" || !/noopener/.test(a2.getAttribute("rel") || "")) {
          trouble.push("нет target/rel: " + item.title);
        }
        if ((a2.textContent || "").trim() !== item.title) trouble.push("подпись не совпадает: " + item.title);
        if (item.icon) {
          const img = a2.querySelector("img");
          if (!img || img.getAttribute("src") !== item.icon) trouble.push("нет логотипа: " + item.title);
          else if (!fs.existsSync(path.join(ROOT, item.icon))) trouble.push("файла логотипа нет: " + item.icon);
        }
      });
      if (trouble.length) { bad++; console.log("ОШИБКИ соцсети", rel, "|", trouble.join("; ")); }
      else console.log("  ok   соцсети в подвале:", expected.map((x) => x.title).join(", "));
    }

    /* У страницы поиска свой подвал, но список соцсетей тот же самый. */
    if (rel === "poisk/index.html") {
      const expected = (dom.window.SC && dom.window.SC.brand && dom.window.SC.brand.social) || [];
      const links = Array.from(doc.querySelectorAll(".ps-foot__links a"));
      const hrefs = links.map((a2) => a2.getAttribute("href"));
      const wanted = expected.map((x) => x.url);
      const same = hrefs.length === wanted.length && wanted.every((u, i) => u === hrefs[i]);
      const icons = links.every((a2) => {
        const img = a2.querySelector("img");
        return img && fs.existsSync(path.join(ROOT, img.getAttribute("src")));
      });
      if (!same || !icons) { bad++; console.log("ОШИБКИ соцсети poisk |", hrefs.join(", ")); }
      else console.log("  ok   соцсети в подвале поиска:", links.length, "ссылки из brand.social");
    }

    /* Разметка организации на главной: sameAs берёт только наши площадки. */
    if (rel === "index.html") {
      const ld = doc.querySelector('script[type="application/ld+json"]');
      const known = ((dom.window.SC && dom.window.SC.brand && dom.window.SC.brand.social) || []).map((x) => x.url);
      let same = [];
      try { same = JSON.parse(ld.textContent).sameAs || []; } catch (e) { same = []; }
      const unknown = same.filter((u) => known.indexOf(u) === -1);
      if (!same.length || unknown.length) { bad++; console.log("ОШИБКИ sameAs |", unknown.join(", ") || "пусто"); }
      else console.log("  ok   sameAs на главной:", same.length, "площадки, все из brand.social");
    }

    dom.window.close();
  }
  console.log(bad ? "страниц с ошибками: " + bad : "ошибок нет");
  if (bad) process.exitCode = 1;
})();
