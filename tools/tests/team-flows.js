/* Кабинет и админка: общие помощники больше не теряются между разделами.

   Проверяем три вещи, которые ломались при переносе блоков из админки в кабинет:
   1) карточка задачи в кабинете рисует приоритет (taskBadge живёт в общем scope);
   2) чат команды в админке рисует дату сообщения (fmtMailDate в общем scope);
   3) «Моя редакция» повторяет решение после кода из письма, без второго клика;
   4) вход при обрыве связи не подменяется локальной сессией, но старый локальный
      аккаунт по-прежнему переносится на сервер, когда сервер ответил.

   Запуск: node tools/tests/team-flows.js */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
let okCount = 0;
const problems = [];

function check(cond, label, extra) {
  if (cond) { okCount++; console.log("  ok  ", label); }
  else { problems.push(label); console.log("  FAIL", label, extra === undefined ? "" : extra); }
}

function inline(html) {
  return html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      const file = path.join(ROOT, src.split("?")[0]);
      return fs.existsSync(file) ? "<script>\n" + fs.readFileSync(file, "utf8") + "\n</script>" : "";
    });
}

function withOverride(html, code) {
  const tag = /<script src="\/assets\/js\/app\.js[^"]*"><\/script>/;
  if (!tag.test(html)) throw new Error("не найден тег app.js");
  return html.replace(tag, (m) => "<script>\n" + code + "\n</script>\n" + m);
}

function baseParse(w) {
  w.localStorage.setItem("smena_lang", "ru"); /* проверки текста — на русском */
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: false, offline: true, error: "Нет связи с сервером." }) });
}

function collectErrors() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e.detail || e.message || e);
    if (!/Not implemented/i.test(msg)) errors.push(msg);
  });
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));
  return { errors, vc };
}

const USER = {
  id: "u_probe", name: "Проверка Команды", email: "probe@example.ru",
  region: "moskva", role: "Автор текстов", access: "Пользователь",
  createdAt: "2026-11-01T00:00:00Z",
};

async function profileDom() {
  const { errors, vc } = collectErrors();
  const override = `
    localStorage.setItem("smena_token_v1", "probe-token");
    localStorage.setItem("smena_user_v1", ${JSON.stringify(JSON.stringify(USER))});
    localStorage.setItem("smena_consent_v1", JSON.stringify({ status: "approved", kind: "processing" }));
    localStorage.setItem("smena_consent_distribution_v1", JSON.stringify({ status: "approved", kind: "distribution" }));
    window.__reviewCalls = [];
    window.__codeSent = 0;
    var confirmed = false;
    var edState = {
      applications: [],
      editorial: { name: "Редакция Москвы", about: "Городские истории", members: 1, region: "moskva" },
      incoming: [{ id: "ed_1", name: "Автор Заявки", birthDate: "2000-01-01", email: "author@example.ru",
        why: "Хочу писать о городе", status: "pending", sitePosts: [], portfolio: [] }]
    };
    Store.siteStatus = function () { return Promise.resolve(null); };
    Store.apiCardStatus = function () { return Promise.resolve({ ok: true, current: null, requests: [], minPosts: 5, published: 0, byRole: false, canApply: false }); };
    Store.apiMyPosts = function () { return Promise.resolve([]); };
    Store.pointsHistory = function () { return Promise.resolve({ entries: [], balance: 0 }); };
    Store.pointsRules = function () { return Promise.resolve([]); };
    Store.messagesMine = function () { return Promise.resolve([]); };
    Store.hiringMine = function () { return Promise.resolve({ application: null, positions: ["Автор"], stages: {}, passPercent: 70, questionsCount: 10 }); };
    Store.tasksMine = function () {
      return Promise.resolve({ tasks: [{ id: "t_1", title: "Снять двор", status: "new", statusLabel: "Новая",
        priority: "urgent", priorityLabel: "Срочная", assignee: null, groupLabel: "Редакция", due: "", description: "", comments: [] }],
        statuses: { new: "Новая", done: "Готово" } });
    };
    Store.editorialMine = function () { return Promise.resolve(JSON.parse(JSON.stringify(edState))); };
    Store.editorialReview = function (id, decision, note) {
      window.__reviewCalls.push({ id: id, decision: decision, note: note, confirmed: confirmed });
      if (!confirmed) {
        var err = new Error("Нужен код из письма.");
        err.needConfirm = true;
        return Promise.reject(err);
      }
      edState.incoming[0].status = decision === "approved" ? "approved" : "rejected";
      return Promise.resolve(true);
    };
    Store.actionCode = function () { window.__codeSent++; return Promise.resolve({ email: "probe@example.ru" }); };
    Store.actionConfirm = function () { confirmed = true; return Promise.resolve(true); };
    Store.getConfirm = function () { return confirmed ? "test-confirm" : ""; };
    Store.hasConfirm = function () { return confirmed; };
    Store.clearConfirm = function () { confirmed = false; };
  `;
  const html = inline(withOverride(fs.readFileSync(path.join(ROOT, "profile/index.html"), "utf8"), override));
  const dom = new JSDOM(html, {
    url: "https://smenakontenta.ru/profile/", runScripts: "dangerously",
    pretendToBeVisual: true, virtualConsole: vc, beforeParse: baseParse,
  });
  await new Promise((r) => setTimeout(r, 1400));
  return { dom, errors };
}

async function adminDom() {
  const { errors, vc } = collectErrors();
  const admin = Object.assign({}, USER, { access: "Директор" });
  const override = `
    localStorage.setItem("smena_token_v1", "probe-token");
    localStorage.setItem("smena_user_v1", ${JSON.stringify(JSON.stringify(admin))});
    window.__chatSends = 0;
    window.__chatLoads = 0;
    window.__chatText = "";
    Store.can = function (user, cap) { return cap === "manage" || cap === "people.view" || cap === "people.edit"; };
    Store.siteStatus = function () { return Promise.resolve(null); };
    Store.usersList = function () { return Promise.resolve({ users: [], roles: [] }); };
    Store.tasksList = function () { return Promise.resolve({ tasks: [], statuses: { new: "Новая", done: "Готово" } }); };
    Store.teamChatList = function () {
      window.__chatLoads++;
      return Promise.resolve({ ok: true, me: "Проверка Команды", messages: [
        { from: "Коллега", role: "Редактор", text: "Привет, команда", createdAt: "2026-11-12T10:00:00Z" }
      ] });
    };
    Store.teamChatSend = function (text) {
      window.__chatSends++;
      window.__chatText = text;
      return Promise.resolve({ id: "tc_1", from: "Проверка Команды", text: text, createdAt: "2026-11-12T10:01:00Z" });
    };
  `;
  const html = inline(withOverride(fs.readFileSync(path.join(ROOT, "admin/index.html"), "utf8"), override));
  const dom = new JSDOM(html, {
    url: "https://smenakontenta.ru/admin/", runScripts: "dangerously",
    pretendToBeVisual: true, virtualConsole: vc, beforeParse: baseParse,
  });
  await new Promise((r) => setTimeout(r, 1400));
  return { dom, errors };
}

async function personDom() {
  const { errors, vc } = collectErrors();
  const admin = Object.assign({}, USER, { access: "Директор" });
  const override = `
    localStorage.setItem("smena_token_v1", "probe-token");
    localStorage.setItem("smena_user_v1", ${JSON.stringify(JSON.stringify(admin))});
    window.__calls = {};
    window.__notes = [{ by: "Редактор", text: "позвонить о карте", createdAt: "2026-11-11T10:00:00Z" }];
    URL.createObjectURL = function () { return "blob:probe"; };
    URL.revokeObjectURL = function () {};
    window.prompt = function () { return "За серию фотографий двора на Лесной: пять кадров, подпись и история героя."; };
    window.confirm = function () { return true; };
    Store.can = function (user, cap) {
      return cap === "manage" || cap === "people.view" || cap === "people.edit" ||
        cap === "people.note" || cap === "people.block" || cap === "cards.view" || cap === "cards.issue" ||
        cap === "mail.use" || cap === "mail.manage";
    };
    Store.siteStatus = function () { return Promise.resolve(null); };
    Store.mailBoxes = function () {
      return Promise.resolve({ ok: true, mailboxes: [{ key: "editorial", label: "Редакция", address: "support@smenakontenta.ru", ready: true }] });
    };
    Store.mailFolders = function () { return Promise.resolve({ ok: true, folders: ["INBOX", "Sent", "Drafts", "Trash"] }); };
    Store.mailList = function () { return Promise.resolve({ ok: true, letters: [] }); };
    Store.mailTemplates = function () {
      return Promise.resolve({ ok: true, canManage: true, templates: [
        { key: "school_new", name: "Заявка в школу", subject: "Заявка принята", title: "Мы получили заявку", body: "Привет, {{name}}!" }] });
    };
    Store.mailTemplatePreview = function (key) {
      window.__calls.tplPreview = key;
      return Promise.resolve({ ok: true, subject: "Заявка принята", text: "Привет, Юлия! Мы получили вашу заявку." });
    };
    Store.mailLog = function () {
      return Promise.resolve({ ok: true, entries: [
        { at: "2026-11-12T10:00:00Z", box: "editorial", to: "julia@example.ru", subject: "Заявка принята", ok: true }] });
    };
    Store.usersList = function () {
      return Promise.resolve({ users: [{ id: "u_p", name: "Юлия Автор", email: "julia@example.ru", access: "Автор", region: "moskva", createdAt: "2026-11-01T00:00:00Z" }],
        roles: ["Пользователь", "Автор", "Редактор", "Директор"] });
    };
    Store.userCard = function (id) {
      window.__calls.card = id;
      return Promise.resolve({
        ok: true,
        user: { id: id, name: "Юлия Автор", email: "julia@example.ru", access: "Автор", region: "moskva",
          createdAt: "2026-11-01T00:00:00Z", emailVerified: true, status: "active" },
        cards: [], editorialsFounded: [], editorialApps: [], consents: [], portfolio: [], recovery: [],
        posts: [{ title: "Двор на Лесной", status: "published" }],
        messages: [], notes: window.__notes,
        timeline: [{ at: "2026-11-10T10:00:00Z", label: "Карта", title: "СК-2026-001" }],
        points: 12, published: 1, cardNumberNext: "СК-2026-012",
      });
    };
    Store.personCertPdf = function (userId) {
      window.__calls.cert = userId;
      return Promise.resolve({ blob: new Blob(["pdf"], { type: "application/pdf" }), filename: "spravka-ot-2026-11-12.pdf", mime: "application/pdf" });
    };
    Store.personThanksPdf = function (userId, text) {
      window.__calls.thanks = { userId: userId, text: text };
      return Promise.resolve({ blob: new Blob(["pdf"], { type: "application/pdf" }), filename: "blagodarnost.pdf", mime: "application/pdf" });
    };
    Store.personNote = function (userId, text) {
      window.__calls.note = { userId: userId, text: text };
      window.__notes.push({ by: "Проверка Команды", text: text, createdAt: "2026-11-12T10:00:00Z" });
      return Promise.resolve({ ok: true });
    };
    Store.personStatus = function (userId, status, reason) {
      window.__calls.status = { userId: userId, status: status, reason: reason };
      return Promise.resolve({ ok: true });
    };
    Store.pointsAdd = function () { return Promise.resolve({ ok: true }); };
  `;
  const html = inline(withOverride(fs.readFileSync(path.join(ROOT, "admin/index.html"), "utf8"), override));
  const dom = new JSDOM(html, {
    url: "https://smenakontenta.ru/admin/", runScripts: "dangerously",
    pretendToBeVisual: true, virtualConsole: vc, beforeParse: baseParse,
  });
  await new Promise((r) => setTimeout(r, 1400));
  return { dom, errors };
}

async function storeDom() {
  const { errors, vc } = collectErrors();
  const src = fs.readFileSync(path.join(ROOT, "assets/js/store.js"), "utf8");
  const dom = new JSDOM("<!doctype html><body><script>\n" + src + "\n</script></body>", {
    url: "https://smenakontenta.ru/", runScripts: "dangerously", virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: false, offline: true, error: "Нет связи с сервером." }) });
    },
  });
  await new Promise((r) => setTimeout(r, 200));
  return { dom, errors };
}

(async () => {
  /* --- кабинет: задача и подтверждение решения редакции --- */
  const p = await profileDom();
  const doc = p.dom.window.document;
  check(!p.errors.length, "кабинет открывается без ошибок скрипта", p.errors.slice(0, 3));
  const tasks = doc.querySelector("[data-tasks-cabinet]");
  check(!!tasks && /Снять двор/.test(tasks.textContent) && /Срочная/.test(tasks.textContent),
    "карточка задачи в кабинете показывает приоритет (taskBadge доступен)");

  const ed = doc.querySelector("[data-my-editorial]");
  const accept = ed && ed.querySelector("[data-ed-ok]");
  check(!!accept, "в «Моей редакции» есть кнопка «Принять»");
  if (accept) {
    accept.click();
    await new Promise((r) => setTimeout(r, 120));
    const slot = ed.querySelector("[data-ed-confirm]");
    check(!!slot && !!slot.querySelector("[data-confirm-row]") && slot.style.display !== "none",
      "после ответа «нужен код» строка подтверждения показана на месте");
    check(p.dom.window.__reviewCalls.length === 1 && p.dom.window.__reviewCalls[0].id === "ed_1",
      "первое решение ушло на сервер один раз");
    const send = slot && slot.querySelector("[data-confirm-send]");
    if (send) {
      send.click();
      await new Promise((r) => setTimeout(r, 80));
      check(p.dom.window.__codeSent === 1, "кнопка запрашивает код на почту");
      const input = slot.querySelector("[data-confirm-code]");
      const go = slot.querySelector("[data-confirm-go]");
      if (input) input.value = "123456";
      if (go) go.click();
      await new Promise((r) => setTimeout(r, 160));
      check(p.dom.window.__reviewCalls.length === 2 && p.dom.window.__reviewCalls[1].confirmed === true,
        "после подтверждения решение повторилось само, без второго клика");
      const freshSlot = doc.querySelector("[data-ed-confirm]");
      check(!freshSlot || freshSlot.style.display === "none" || !freshSlot.querySelector("[data-confirm-row]"),
        "строка подтверждения убрана после успеха");
      check(/приняли/.test(doc.querySelector("[data-my-editorial]").textContent),
        "список обновился: заявка принята");
    }
  }
  p.dom.window.close();

  /* --- админка: чат команды --- */
  const a = await adminDom();
  const adoc = a.dom.window.document;
  check(!a.errors.length, "админка открывается без ошибок скрипта", a.errors.slice(0, 3));
  const chat = adoc.querySelector("[data-team-chat]");
  check(!!chat && /Привет, команда/.test(chat.textContent), "чат команды загрузил сообщение");
  const time = chat && chat.querySelector(".chat__msg time");
  check(!!time && /\d/.test(time.textContent), "дата сообщения отрисована (fmtMailDate доступен)", time && time.textContent);
  const field = chat && chat.querySelector("[data-chat-text]");
  const form = chat && chat.querySelector("[data-chat-form]");
  if (field && form) {
    field.value = "Ответ команды";
    form.dispatchEvent(new a.dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 160));
    check(a.dom.window.__chatSends === 1 && a.dom.window.__chatText === "Ответ команды",
      "сообщение отправлено через Store.teamChatSend");
    check(field.value === "" && a.dom.window.__chatLoads >= 2, "после отправки поле очищено и лента перечитана");
  }
  a.dom.window.close();

  /* --- страница участника: открывается как ЛК, документы, заметки, статус --- */
  const pn = await personDom();
  const pdoc = pn.dom.window.document;
  const pw = pn.dom.window;
  check(!pn.errors.length, "админка (страница участника) без ошибок скрипта", pn.errors.slice(0, 3));
  const openBtn = pdoc.querySelector('[data-panel="people"] [data-open="u_p"]');
  check(!!openBtn, "участник в списке")
  openBtn.dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const card = pdoc.querySelector('[data-panel="people"] .pcard');
  check(!!card && /Юлия Автор/.test(card.textContent), "карточка открылась отдельной страницей")
  check(!!card.querySelector("[data-person-cert]") && !!card.querySelector("[data-person-thanks]"), "секция «Документы из сайта» на месте")
  card.querySelector("[data-person-cert]").dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  check(pw.__calls.cert === "u_p", "справка собрана по этому участнику", pw.__calls)
  check(/PDF готов/.test(card.querySelector("[data-person-doc-note]").textContent), "файл скачан с примечанием")
  card.querySelector("[data-person-thanks]").dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  check(pw.__calls.thanks && pw.__calls.thanks.userId === "u_p" && /двора на Лесной/.test(pw.__calls.thanks.text || ""),
    "благодарность ушла с текстом от окна", pw.__calls.thanks)
  const pnote = card.querySelector("[data-pnote-text]");
  pnote.value = "созвон в четверг, подтвердить адрес доставки карты";
  card.querySelector("[data-pnote-add]").dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  check(pw.__calls.note && /созвон в четверг/.test(pw.__calls.note.text || ""), "заметка команды сохранена", pw.__calls.note)
  const card2 = pdoc.querySelector('[data-panel="people"] .pcard');
  console.log("DBG", JSON.stringify(pw.__notes)); console.log("DBG2", (card2 && card2.textContent || "").replace(/\s+/g, " ").slice(0, 500)); check(!!card2 && /созвон в четверг/.test(card2.textContent), "заметка видна в карточке после перерисовки");
  const statusInput = card2.querySelector("[data-person-block-reason]");
  statusInput.value = "нарушение правил публикации";
  card2.querySelector("[data-person-block]").dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  check(pw.__calls.status && pw.__calls.status.status === "suspended" &&
    /нарушение правил/.test(pw.__calls.status.reason || ""), "приостановка ушла с причиной", pw.__calls.status)
  /* --- почта: папки, журнал отправок, шаблон в письме --- */
  const mailTabBtn = pdoc.querySelector('[data-admin-tab="mail"]');
  check(!!mailTabBtn, "вкладка «Почта» у директора есть");
  mailTabBtn.dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const mailPanel = pdoc.querySelector('[data-panel="mail"]');
  check(!!mailPanel && !!mailPanel.querySelector("[data-mailboxes]"), "клиент почты открылся с ящиками");
  check(/Редакция/.test(mailPanel.querySelector("[data-mailboxes]").textContent) &&
    /Входящие/.test(mailPanel.querySelector("[data-mail-folders]").textContent),
    "папки Входящие/Отправленные/Черновики видны");
  mailPanel.querySelector("[data-mail-write]").dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const tplSel = pdoc.querySelector("[data-compose-tpl]");
  check(!!tplSel && tplSel.options.length >= 2, "в письме выпадает список шаблонов");
  tplSel.value = "school_new";
  tplSel.dispatchEvent(new pw.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const subjEl = pdoc.querySelector("[data-c-subject]");
  const textEl = pdoc.querySelector("[data-c-text]");
  check(/Заявка принята/.test(subjEl.value || "") && /Привет/.test(textEl.value || "") &&
    /шаблон/.test(textEl.value || ""), "шаблон подставил тему и текст");
  mailPanel.querySelector("[data-mail-log]").dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  check(/Журнал отправок/.test(pdoc.querySelector('[data-panel="mail"] [data-mail-read]').textContent) &&
    /julia@example.ru/.test(pdoc.querySelector('[data-panel="mail"] [data-mail-read]').textContent),
    "журнал отправок показывает письмо участнику");
  pn.dom.window.close();

  /* --- вход: обрыв связи не создаёт локальную сессию; миграция жива --- */
  const s = await storeDom();
  const w = s.dom.window;
  const reg = w.Store.register({ name: "Старый Автор", email: "old@example.ru", pass: "password123", region: "moskva" });
  check(reg && reg.ok, "старый локальный аккаунт создан для проверки переноса");
  w.Store.logout();
  check(!w.Store.currentUser(), "после выхода локальной сессии нет");
  const offline = await w.Store.signIn("old@example.ru", "password123");
  check(offline && offline.ok === false && offline.offline === true && !w.Store.currentUser(),
    "при обрыве связи вход не подменяется локальным аккаунтом");
  w.fetch = (url, opts) => {
    let body = {};
    try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
    if (body.action === "login") {
      return Promise.resolve({ json: () => Promise.resolve({ ok: false, code: 401, error: "Неверная почта или пароль" }) });
    }
    if (body.action === "reg") {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, token: "t_new",
        user: { id: "u_new", name: "Старый Автор", email: "old@example.ru", access: "Пользователь" } }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: false, offline: true }) });
  };
  const migrated = await w.Store.signIn("old@example.ru", "password123");
  check(migrated && migrated.ok === true && w.Store.currentUser() && w.Store.currentUser().id === "u_new",
    "когда сервер ответил, старый локальный аккаунт перенесён и вход серверный");
  check(!s.errors.length, "store.js без ошибок скрипта", s.errors.slice(0, 3));
  s.dom.window.close();

  console.log("\n=== ИТОГ ===");
  console.log("проверок пройдено:", okCount);
  if (problems.length) { console.log("проблем:", problems.length); process.exit(1); }
  console.log("все проверки пройдены");
})();
