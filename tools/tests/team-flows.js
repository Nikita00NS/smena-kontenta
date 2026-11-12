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
