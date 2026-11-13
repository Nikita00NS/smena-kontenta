/* Правки раунда 2: гейт редактора, пресс-карта с данными и актом, чистка
   настроек, фильтр журнала и экспорт в панели.
   Запуск: node tools/tests/fixes.js */
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

function makeDom(page, override, seed) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e.detail || e.message || e);
    if (!/Not implemented/i.test(msg)) errors.push(msg);
  });
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));
  const html = inline(fs.readFileSync(path.join(ROOT, page), "utf8"))
    .replace("</body>", "<script>" + override + "</script></body>");
  const dom = new JSDOM(html, {
    url: "https://smenakontenta.ru" + page.replace("/index.html", "/"),
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("smena_lang", "ru"); /* проверки текста — на русском */
      w.URL.createObjectURL = () => "blob:mock";
      w.fetch = () => Promise.reject(new Error("сети нет"));
      w.scrollTo = () => {};
      w.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
      (seed || function () {})(w);
    },
  });
  return { dom, errors };
}

const ISSUED_CARD = {
  ok: true, published: 7, minPosts: 5, byRole: false,
  current: {
    id: "c1", status: "issued", number: "СК-2026-0042", verifyCode: "ABCDEFGH",
    authorName: "Проверка Карты", authorRegion: "moskva",
    issuedAt: "2026-11-10T12:00:00Z", validUntil: "2027-11-10T12:00:00Z",
    issuePlace: "Москва, лично",
  },
};

(async () => {
  /* 1. Редактор закрыт без согласий */
  {
    const { dom } = makeDom("/write/index.html", `
      window.__consentsAsked = 0;
      Store.refreshConsent = function () {
        window.__consentsAsked++;
        return Promise.resolve(null);
      };
      Store.consent = function (kind) {
        return { status: kind === "distribution" ? "approved" : "none" };
      };
    `, (w) => {
      w.localStorage.setItem("smena_token_v1", "fix-token");
      w.localStorage.setItem("smena_user_v1", JSON.stringify({
        id: "u_fix", name: "Проверка Правок", email: "fix@example.ru", createdAt: "2026-11-01T00:00:00Z",
      }));
    });
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    check("без согласий редактор не открывается", !doc.querySelector("[data-write-form]"));
    check("вместо редактора — понятный гейт", !!doc.querySelector(".write-gate"));
    check("гейт ведёт в кабинет за документами",
      !!doc.querySelector('.write-gate a[href="/profile"]'));
    check("статус согласий запрашивался", dom.window.__consentsAsked >= 1);
    dom.window.close();
  }

  /* 2. С двумя согласиями редактор открывается */
  {
    const { dom } = makeDom("/write/index.html", `
      Store.consent = function (kind) {
        return { status: "approved", kind: kind || "processing" };
      };
      Store.refreshConsent = function () { return Promise.resolve(null); };
    `, (w) => {
      w.localStorage.setItem("smena_token_v1", "fix-token");
      w.localStorage.setItem("smena_user_v1", JSON.stringify({
        id: "u_fix", name: "Проверка Правок", email: "fix@example.ru", createdAt: "2026-11-01T00:00:00Z",
      }));
    });
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    check("с двумя согласиями редактор открывается", !!doc.querySelector("[data-write-form]"));
    check("гейт не показывается", !doc.querySelector(".write-gate"));
    dom.window.close();
  }

  /* 3. Пресс-карта: данные, уточнения, акт выдачи */
  {
    let actAsked = 0;
    const { dom } = makeDom("/profile/index.html", `
      Store.apiCardStatus = function () { return Promise.resolve(${JSON.stringify(ISSUED_CARD)}); };
      Store.cardPdf = function () { return Promise.resolve({ blob: new Blob(), filename: "karta.pdf" }); };
      window.__actAsked = 0;
      Store.cardActPdf = function () {
        window.__actAsked++;
        return Promise.resolve({ blob: new Blob(), filename: "akt.pdf" });
      };
      Store.consent = function () { return { status: "approved" }; };
    `, (w) => {
      w.localStorage.setItem("smena_token_v1", "fix-token");
      w.localStorage.setItem("smena_user_v1", JSON.stringify({
        id: "u_fix", name: "Проверка Карты", email: "fix@example.ru", region: "moskva",
        role: "Автор текстов", createdAt: "2026-11-01T00:00:00Z",
      }));
      w.localStorage.setItem("smena_consent_v1", JSON.stringify({ status: "approved", kind: "processing" }));
      w.localStorage.setItem("smena_consent_distribution_v1", JSON.stringify({ status: "approved", kind: "distribution" }));
    });
    await new Promise((r) => setTimeout(r, 2000));
    const doc = dom.window.document;
    const cardPanel = doc.querySelector('[data-cab-panel="card"]');
    check("данные карты одним списком", !!cardPanel.querySelector(".pcard-data"));
    const data = cardPanel.querySelector(".pcard-data");
    check("в данных есть номер карты", /СК-2026-0042/.test(data.textContent));
    check("в данных есть срок действия", /2027/.test(data.textContent));
    check("в данных есть способ получения", /лично/i.test(data.textContent));
    check("блок «что можно уточнить» на месте", !!cardPanel.querySelector(".pcard-faq details"));
    check("уточнение про проверку карты", /\/verify/.test(cardPanel.querySelector(".pcard-faq").textContent));
    const actBtn = cardPanel.querySelector("[data-card-act]");
    check("кнопка «Акт выдачи (PDF)» у выданной карты", !!actBtn);
    if (actBtn) actBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    check("акт запрашивается у сервера", dom.window.__actAsked === 1, dom.window.__actAsked);
    check("в описании акта названы оба основателя",
      /Сирика Н\. С\./.test(cardPanel.textContent) && /Ильина Б\. П\./.test(cardPanel.textContent));
    dom.window.close();
  }

  /* 4. Настройки: без лишнего, в одном стиле */
  {
    const { dom } = makeDom("/profile/index.html", `
      Store.apiCardStatus = function () { return Promise.resolve({ ok: true, published: 0, minPosts: 5, current: null }); };
      Store.consent = function () { return { status: "none" }; };
    `, (w) => {
      w.localStorage.setItem("smena_token_v1", "fix-token");
      w.localStorage.setItem("smena_user_v1", JSON.stringify({
        id: "u_fix", name: "Проверка Правок", email: "fix@example.ru", region: "moskva",
        role: "Автор текстов", createdAt: "2026-11-01T00:00:00Z",
      }));
    });
    await new Promise((r) => setTimeout(r, 2000));
    const doc = dom.window.document;
    const settings = doc.querySelector('[data-cab-panel="settings"]');
    check("роль показана, но не редактируется",
      !!settings.querySelector('input[disabled]') && !settings.querySelector('select[name="role"]'));
    check("акцентный цвет не дублируется в настройках",
      !settings.querySelector('[data-swatch]') && !/Акцентный цвет/.test(settings.textContent));
    check("служебная заметка о хранилище убрана", !settings.querySelector(".storage-note"));
    check("2FA и коды спрятаны в сворачиваемый блок", !!settings.querySelector(".cab-extra [data-twofa-card]"));
    check("у смены пароля заголовок, а не двойная подпись поля",
      !!settings.querySelector(".cab-sub") && settings.querySelectorAll('label[for="p-old"]').length === 1);
    check("«Как это работает» больше не дублирует обзор",
      !doc.querySelector('[data-cab-panel="overview"] .panel h3') ||
      !/Как это работает/.test(doc.querySelector('[data-cab-panel="overview"]').textContent));
    dom.window.close();
  }

  /* 5. Админка: фильтр журнала и экспорт людей */
  {
    const { dom } = makeDom("/admin/index.html", `
      localStorage.setItem("smena_token_v1", "fix-token");
      localStorage.setItem("smena_user_v1", ${JSON.stringify(JSON.stringify({
        id: "u_admin", name: "Проверка Панели", email: "admin@example.ru",
        region: "moskva", role: "Директор", access: "Директор",
        createdAt: "2026-11-01T00:00:00Z",
      }))});
      Store.can = function () { return true; };
      Store.diag = function () {
        return Promise.resolve({ ok: true, php: "8.2", posts: 42, editorials: 7, cards_pending: 0,
          support_open: 0, hiring_open: 0, school_open: 1, pending_email: 0, maintenance: false,
          data_writable: true, uploads_writable: true, mail_configured: true, rate_entries: 0 });
      };
      Store.usersList = function () { return Promise.resolve({ users: [
        { name: "Один Автор", email: "one@example.ru", access: "Пользователь", role: "Автор", region: "moskva", createdAt: "2026-11-01" },
        { name: "Два Автор", email: "two@example.ru", access: "Сотрудник", role: "Фотограф", region: "kzn", createdAt: "2026-11-02" },
      ], roles: [] }); };
      Store.apiPendingQueue = function () { return Promise.resolve([]); };
      Store.portfolioQueue = function () { return Promise.resolve({ ok: true, items: [] }); };
      Store.consentQueue = function () { return Promise.resolve({ ok: true, consents: [] }); };
      Store.adminLog = function () { return Promise.resolve({ entries: [
        { at: "2026-11-12T10:00:00Z", who: "Директор", action: "cards.issue", details: "СК-2026-0042" },
        { at: "2026-11-12T10:05:00Z", who: "Директор", action: "post.approve", details: "Двор" },
        { at: "2026-11-12T10:06:00Z", who: "Директор", action: "consent.approve", details: "обработка" },
        { at: "2026-11-12T10:07:00Z", who: "Директор", action: "school.accept", details: "fix@example.ru" },
      ] }); };
      Store.siteStatus = function () { return Promise.resolve(null); };
      Store.teamChatList = function () { return Promise.resolve({ ok: true, me: "Проверка Панели", messages: [] }); };
      Store.tasksList = function () { return Promise.resolve({ tasks: [], statuses: {} }); };
      Store.supportQueue = function () { return Promise.resolve({ tickets: [] }); };
      Store.hiringList = function () { return Promise.resolve({ ok: true, applications: [], canDecide: true }); };
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
    `);
    await new Promise((r) => setTimeout(r, 2500));
    const doc = dom.window.document;
    const audit = doc.querySelector("[data-pulse-audit]");
    check("фильтры журнала на пульте", !!audit && audit.querySelectorAll("[data-audit-chip]").length === 6,
      audit && audit.querySelectorAll("[data-audit-chip]").length);
    const cardsChip = audit.querySelector('[data-audit-chip="cards"]');
    cardsChip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const rowsText = audit.querySelector(".pulse-audit__row")
      ? audit.textContent : "";
    check("фильтр «Карты» оставляет только карты",
      /cards\.issue/.test(audit.textContent) && !/consent\.approve/.test(audit.textContent),
      audit.textContent.slice(0, 120));
    const peoplePanel = doc.querySelector('[data-panel="people"]');
    check("кнопка экспорта участников в CSV", !!peoplePanel.querySelector("[data-people-csv]"));
    dom.window.close();
  }

  /* 6. Страница медиашколы /school: статус, заявка, задания */
  {
    const { dom } = makeDom("/school/index.html", `
      Store.schoolMine = function () { return Promise.resolve({ ok: true, application: null }); };
      Store.consent = function () { return { status: "approved" }; };
    `, (w) => {
      w.localStorage.setItem("smena_token_v1", "fix-token");
      w.localStorage.setItem("smena_user_v1", JSON.stringify({
        id: "u_fix", name: "Ученик Школы", email: "school@example.ru", region: "moskva",
        createdAt: "2026-11-01T00:00:00Z",
      }));
      w.localStorage.setItem("smena_consent_v1", JSON.stringify({ status: "approved", kind: "processing" }));
      w.localStorage.setItem("smena_consent_distribution_v1", JSON.stringify({ status: "approved", kind: "distribution" }));
      w.__lastApply = null;
      w.fetch = (url, opts) => {
        let b = {};
        try { b = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
        let data = { ok: false };
        if (b.action === "school-mine") data = { ok: true, application: null };
        if (b.action === "school-apply") { w.__lastApply = JSON.parse(JSON.stringify(b)); data = { ok: true }; }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
      };
    });
    await new Promise((r) => setTimeout(r, 2000));
    const doc = dom.window.document;
    check("у страницы школы есть статус-блок", !!doc.querySelector("[data-school-status] .pcard-steps"));
    check("форма заявки на странице школы", !!doc.querySelector('[data-school-apply] [data-school-form]'));
    check("направления — чипами, не селектом",
      doc.querySelectorAll(".school-dir-chips label").length === 6);
    const chip = doc.querySelector(".school-dir-chips label:nth-child(2) input");
    chip.checked = true;
    chip.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    check("чип подсвечивается при выборе", chip.closest("label").classList.contains("is-on"));
    const mot = doc.querySelector("#sh-mot");
    mot.value = "Пишу про школьный театр, готова показывать материалы и учиться каждые выходные.";
    doc.querySelector('[data-school-apply] form[data-school-form]')
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
    check("заявка уходит на сервер с выбранным направлением",
      dom.window.__lastApply && dom.window.__lastApply.direction === "Интервью",
      JSON.stringify(dom.window.__lastApply));
    check("дорожная карта из пяти шагов", doc.querySelectorAll(".school-road li").length === 5);
    check("первые задания по направлениям раскрыты", doc.querySelectorAll(".school-tasks details").length === 6);
    dom.window.close();
  }

  if (bad) {
    console.log("правки: проверка не пройдена");
    process.exit(1);
  }
  console.log("все проверки пройдены");
})();
