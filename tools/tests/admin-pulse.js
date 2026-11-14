/* Админка: «Пульт редакции», бейджи и боковая навигация.
   Запуск: node tools/tests/admin-pulse.js */
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

  const override = `
    localStorage.setItem("smena_token_v1", "probe-token");
    localStorage.setItem("smena_user_v1", ${JSON.stringify(JSON.stringify({
      id: "u_admin", name: "Проверка Пульта", email: "admin@example.ru",
      region: "moskva", role: "Директор", access: "Директор",
      createdAt: "2026-11-01T00:00:00Z",
    }))});
    Store.can = function () { return true; };
    Store.diag = function () {
      return Promise.resolve({
        ok: true, php: "8.2", posts: 42, editorials: 7, cards_pending: 3,
        support_open: 5, hiring_open: 2, school_open: 4, pending_email: 1, maintenance: false,
        data_writable: true, uploads_writable: true, mail_configured: true, rate_entries: 0,
      });
    };
    Store.usersList = function () { return Promise.resolve({ users: [{ access: "Директор" }, { access: "Пользователь" }], roles: [] }); };
    Store.apiPendingQueue = function () { return Promise.resolve([{ id: "p1" }, { id: "p2" }]); };
    Store.portfolioQueue = function () { return Promise.resolve({ ok: true, items: [{ status: "pending" }] }); };
    Store.consentQueue = function () { return Promise.resolve({ ok: true, consents: [{ status: "pending" }, { status: "approved" }] }); };
    Store.adminLog = function () {
      return Promise.resolve({ entries: [{ at: "2026-11-12T10:00:00Z", who: "Директор", action: "cards.issue", details: "СК-2026-001" }] });
    };
    Store.siteStatus = function () { return Promise.resolve(null); };
    Store.teamChatList = function () { return Promise.resolve({ ok: true, me: "Проверка Пульта", messages: [] }); };
    Store.tasksList = function () { return Promise.resolve({ tasks: [], statuses: {} }); };
    Store.supportQueue = function () { return Promise.resolve({ tickets: [] }); };
    Store.hiringList = function () { return Promise.resolve({ items: [] }); };
    Store.schoolList = function () { return Promise.resolve({ ok: true, applications: [], canDecide: true }); };
    Store.apiCardQueue = function () { return Promise.resolve([]); };
    Store.editorialList = function () { return Promise.resolve({ items: [] }); };
    Store.mailStatus = function () { return Promise.resolve({}); };
    Store.mailBoxes = function () { return Promise.resolve({ boxes: [] }); };
    Store.mailFolders = function () { return Promise.resolve({ folders: [] }); };
    Store.mailTemplates = function () { return Promise.resolve({ templates: [] }); };
    Store.mailLog = function () { return Promise.resolve({ entries: [] }); };
    Store.recoveryQueue = function () { return Promise.resolve({ items: [] }); };
    Store.authorsShow = function () { return Promise.resolve({}); };
  `;
  const html = inline(fs.readFileSync(path.join(ROOT, "admin/index.html"), "utf8"))
    .replace("</body>", "<script>" + override + "</script></body>");
  const dom = new JSDOM(html, {
    url: "https://smenakontenta.ru/admin/", runScripts: "dangerously",
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("smena_lang", "ru"); /* проверки текста — на русском */
      w.fetch = () => Promise.reject(new Error("сети нет"));
      w.scrollTo = () => {};
      w.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
    },
  });

  await new Promise((r) => setTimeout(r, 2000));
  const doc = dom.window.document;

  check("боковая навигация с иконками", !!doc.querySelector(".admin-layout .admin-tabs"));
  const tabs = Array.from(doc.querySelectorAll("[data-admin-tab]"));
  check("десять разделов", tabs.length === 10, tabs.length);
  check("у разделов есть иконки", tabs.every((t) => t.querySelector("svg")));
  check("у разделов есть бейджи", tabs.every((t) => t.querySelector("[data-admin-badge]")));

  const pulse = doc.querySelector("[data-admin-overview]");
  check("пульт редакции на месте", !!pulse && /Здравствуйте, Проверка Пульта/.test(pulse.textContent));
  check("семь плиток показателей", doc.querySelectorAll(".overview__tile").length === 7,
    doc.querySelectorAll(".overview__tile").length);
  const rows = Array.from(doc.querySelectorAll(".pulse-row"));
  check("очереди собраны в одном месте", rows.length >= 6, rows.length);
  check("очередь материалов показывает 2", rows.some((r) => /Материалы на проверке/.test(r.textContent) && /2/.test(r.querySelector(".pulse-row__count").textContent)));
  check("очередь согласий показывает 1", rows.some((r) => /Согласия на проверку/.test(r.textContent)));
  check("очередь школы показывает 4", rows.some((r) => /Заявки в медиашколу/.test(r.textContent) && /4/.test(r.querySelector(".pulse-row__count").textContent)));
  check("бейдж на «Медиашколе» равен 4",
    (doc.querySelector('[data-admin-badge="school"]') || {}).textContent === "4");
  check("бейдж на «Картах» равен 3",
    (doc.querySelector('[data-admin-badge="cards"]') || {}).textContent === "3",
    (doc.querySelector('[data-admin-badge="cards"]') || {}).textContent);
  check("бейдж на «Поддержке» равен 5",
    (doc.querySelector('[data-admin-badge="support"]') || {}).textContent === "5");
  check("последние действия из журнала", /cards.issue/.test((doc.querySelector("[data-pulse-audit]") || {}).textContent || ""));
  check("у журнала есть фильтры", doc.querySelectorAll("[data-audit-chip]").length === 6,
    doc.querySelectorAll("[data-audit-chip]").length);
  check("участников можно выгрузить в CSV", !!doc.querySelector("[data-panel=\"people\"] [data-people-csv]"));

  const cardsTab = doc.querySelector('[data-admin-tab="cards"]');
  cardsTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  check("переход по вкладке работает", !doc.querySelector('[data-panel="cards"]').hidden);
  check("выбор запоминается", dom.window.localStorage.getItem("smena_admin_tab") === "cards");

  /* Регротест «узкой колонки»: центрирующий отступ (100vw-1200px)/2 должен быть
     только на .admin-layout. Если он попадает и в .admin-panel — отступы
     складываются, контенту вкладок остаётся ~200px и текст режется посреди слова. */
  const css = fs.readFileSync(path.join(ROOT, "assets/css/site.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const panelRule = css.match(/\.admin-panel\s*\{[^}]*\}/);
  check("в .admin-panel нет второго центрирующего отступа 100vw",
    !!panelRule && panelRule[0].indexOf("100vw") === -1);

  dom.window.close();
  errors.slice(0, 5).forEach((e) => console.log("ОШИБКА", e.slice(0, 300)));
  if (errors.length || bad) {
    console.log("пульт: проверка не пройдена");
    process.exit(1);
  }
  console.log("все проверки пройдены");
})();
