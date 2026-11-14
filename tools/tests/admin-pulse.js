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
        school_subs_pending: 2,
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
    Store.schoolModules = function () { return Promise.resolve({ ok: true, modules: [] }); };
    Store.schoolQuizzes = function () { return Promise.resolve({ ok: true, quizzes: [] }); };
    Store.schoolQuizResults = function () { return Promise.resolve({ ok: true, results: [] }); };
    Store.schoolDiary = function () { return Promise.resolve({ ok: true, events: [] }); };
    Store.schoolCohortStudents = function () {
      return Promise.resolve({ ok: true, total: 2, students: [
        { userId: "u_s1", name: "Марина Съёмкина", email: "marina@example.ru", direction: "Фотография", accepted: 2, total: 2, points: 41 },
        { userId: "u_s2", name: "Пётр Пишет", email: "petr@example.ru", direction: "Интервью", accepted: 1, total: 2, points: 12 },
      ] });
    };
    Store.schoolInvite = function () { return Promise.resolve({ ok: true, sent: 0, skipped: 0 }); };
    Store.schoolSubQueue = function () { return Promise.resolve({ ok: true, subs: [] }); };
    Store.schoolAssignments = function () { return Promise.resolve({ ok: true, assignments: [] }); };
    Store.schoolCohorts = function () {
      return Promise.resolve({
        cohorts: [{ id: "sc_1", name: "Набор 001", open: false, createdAt: "2026-11-12T10:00:00Z", students: 3, assignments: 2, checked: 5 }],
        applications: [
          { id: "sa_1", name: "Юный автор", direction: "Тексты", status: "pending", motivation: "Пишу заметки про школу", createdAt: "2026-11-12T09:00:00Z" },
          { id: "sa_2", name: "Принятый", direction: "Видео", status: "accepted", createdAt: "2026-11-11T09:00:00Z" },
        ],
        directions: [],
      });
    };
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
  check("десять разделов (школа — платформа)", tabs.length === 10, tabs.length);
  check("у разделов есть иконки", tabs.every((t) => t.querySelector("svg")));
  check("у разделов есть бейджи", tabs.every((t) => t.querySelector("[data-admin-badge]")));

  const pulse = doc.querySelector("[data-admin-overview]");
  check("пульт редакции на месте", !!pulse && /Здравствуйте, Проверка Пульта/.test(pulse.textContent));
  check("восемь плиток показателей", doc.querySelectorAll(".overview__tile").length === 8,
    doc.querySelectorAll(".overview__tile").length);
  check("плитка «работ школы» показывает 2", /работ школы/.test(doc.querySelector("[data-admin-overview]").textContent) &&
    /на проверке/.test(doc.querySelector("[data-admin-overview]").textContent));
  const rows = Array.from(doc.querySelectorAll(".pulse-row"));
  check("очереди собраны в одном месте", rows.length >= 6, rows.length);
  check("очередь материалов показывает 2", rows.some((r) => /Материалы на проверке/.test(r.textContent) && /2/.test(r.querySelector(".pulse-row__count").textContent)));
  check("очередь согласий показывает 1", rows.some((r) => /Согласия на проверку/.test(r.textContent)));
  check("очередь школы показывает 4", rows.some((r) => /Заявки в медиашколу/.test(r.textContent) && /4/.test(r.querySelector(".pulse-row__count").textContent)));
  check("очередь работ школы показывает 2", rows.some((r) => /Работы медиашколы на проверке/.test(r.textContent) && /2/.test(r.querySelector(".pulse-row__count").textContent)));
  check("бейдж на «Медиашколе» равен 4",
    (doc.querySelector('[data-admin-badge="school"]') || {}).textContent === "4");
  check("вкладки «Карты» больше нет, карты внутри «Людей»",
    !doc.querySelector('[data-admin-tab="cards"]') &&
    !!doc.querySelector('[data-panel="people"] [data-card-queue], [data-panel="people"]'));
  check("бейдж на «Поддержке» равен 5",
    (doc.querySelector('[data-admin-badge="support"]') || {}).textContent === "5");
  check("последние действия из журнала", /cards.issue/.test((doc.querySelector("[data-pulse-audit]") || {}).textContent || ""));
  check("у журнала есть фильтры", doc.querySelectorAll("[data-audit-chip]").length === 6,
    doc.querySelectorAll("[data-audit-chip]").length);
  check("участников можно выгрузить в CSV", !!doc.querySelector("[data-panel=\"people\"] [data-people-csv]"));

  const teamTab = doc.querySelector('[data-admin-tab="team"]');
  check("вкладка «Сотрудники» на месте", !!teamTab);
  teamTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  check("переход во «Сотрудники» работает", !doc.querySelector('[data-panel="team"]').hidden);
  check("выбор запоминается", dom.window.localStorage.getItem("smena_admin_tab") === "team");
  check("приглашения сотрудников в разделе", !!doc.querySelector('[data-panel="team"] [data-invite-send]'));

  const mailTab = doc.querySelector('[data-admin-tab="mail"]');
  check("вкладка «Почта» отдельным разделом", !!mailTab);
  mailTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  check("переход в «Почту» работает", !doc.querySelector('[data-panel="mail"]').hidden);
  check("в «Почте» есть журнал отправок", !!doc.querySelector('[data-panel="mail"] [data-mail-log]'));

  const schoolTab = doc.querySelector('[data-admin-tab="school"]');
  check("вкладка «Медиашкола» на месте", !!schoolTab);
  schoolTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  check("переход в «Медиашколу» работает", !doc.querySelector('[data-panel="school"]').hidden);
  check("платформа: панель наборов на месте", !!doc.querySelector('[data-panel="school"] [data-sch-cohort-panel]'));
  check("платформа: зона заданий и работ", !!doc.querySelector('[data-panel="school"] [data-sch-zone]'));
  check("платформа: панель заявок на месте", !!doc.querySelector('[data-panel="school"] [data-sch-apps]'));
  check("набор 001 отрисован с закрытым приёмом",
    /Набор 001/.test(doc.querySelector('[data-panel="school"]').textContent) &&
    /приём закрыт/.test(doc.querySelector('[data-panel="school"]').textContent));
  check("принятую заявку можно зачислить", !!doc.querySelector('[data-panel="school"] [data-enroll]'));
  const panelText = doc.querySelector('[data-panel="school"]').textContent;
  check("ученики набора с прогрессом видны", /Ученики набора/.test(panelText) && /Марина Съёмкина/.test(panelText) &&
    /2\/2/.test(panelText) && /курс пройден/.test(panelText));
  check("кнопка выпуска у набравшего курс есть",
    !!doc.querySelector('[data-panel="school"] [data-sch-grad="u_s1"]'));
  check("кнопка приглашения на набор есть", !!doc.querySelector('[data-panel="school"] [data-sch-invite]'));

  /* Регротест «узкой колонки»: при box-sizing:border-box связка
     max-width + паддинг (100vw-1200)/2 схлопывает контентную область до
     2400-100vw (чем шире окно, тем уже колонка). Панель должна строиться
     на стандартном паттерне сайта var(--wrap)/var(--pad), как кабинет. */
  const css = fs.readFileSync(path.join(ROOT, "assets/css/site.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  check("в CSS нет схлопывающего паттерна (100vw - 1200px)", css.indexOf("100vw - 1200px") === -1);
  const layoutRule = css.match(/\.admin-layout\s*\{[^}]*\}/);
  check(".admin-layout построен на var(--wrap)/var(--pad)",
    !!layoutRule && layoutRule[0].indexOf("var(--wrap)") !== -1 && layoutRule[0].indexOf("var(--pad)") !== -1);
  check("у колонки контента панели есть нижний предел 360px",
    !!layoutRule && layoutRule[0].indexOf("minmax(360px, 1fr)") !== -1);
  const panelRule = css.match(/\.admin-panel\s*\{[^}]*\}/);
  check("в .admin-panel нет второго центрирующего отступа 100vw",
    !panelRule || panelRule[0].indexOf("100vw") === -1);

  dom.window.close();
  errors.slice(0, 5).forEach((e) => console.log("ОШИБКА", e.slice(0, 300)));
  if (errors.length || bad) {
    console.log("пульт: проверка не пройдена");
    process.exit(1);
  }
  console.log("все проверки пройдены");
})();
