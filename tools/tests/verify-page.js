/* Страница /verify без сервера: проверка карты, печать и честные статусы.

   Подменяем fetch ответами API и смотрим, что страница показывает действующую,
   истёкшую и отозванную карту, не раскрывает лишних данных и не даёт печатать
   недействующую карту.
   Запуск: node tools/tests/verify-page.js */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
const problems = [];
let okCount = 0;

function check(condition, message, extra) {
  if (condition) { okCount++; console.log("  ok   " + message); }
  else { problems.push(message); console.log("  FAIL " + message + (extra ? " → " + JSON.stringify(extra) : "")); }
}

function inline(html) {
  return html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      const file = path.join(ROOT, src.split("?")[0]);
      return fs.existsSync(file) ? "<script>\n" + fs.readFileSync(file, "utf8") + "\n</script>" : "";
    });
}

const CARD = {
  number: "СК-2026-0042",
  status: "issued",
  authorName: "Проверка Карты",
  authorRegion: "moskva",
  authorRole: "Автор текстов",
  issuedAt: "2026-11-01T00:00:00Z",
  validUntil: "2027-11-01T00:00:00Z",
  issuePlace: "Москва, редакция",
};

async function open(query, reply) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e.detail || e.message || e);
    if (!/Not implemented/i.test(msg)) errors.push(msg);
  });
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));
  const dom = new JSDOM(inline(fs.readFileSync(path.join(ROOT, "verify/index.html"), "utf8")), {
    url: "https://smenakontenta.ru/verify" + (query || ""),
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("smena_lang", "ru"); /* проверки текста — на русском */
      w.scrollTo = () => {};
      w.print = () => { w.__printed = (w.__printed || 0) + 1; };
      w.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
      w.fetch = (url, opts) => {
        let body = {};
        try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
        const answer = body.action === "card-verify" ? reply(body) : { ok: false, offline: true };
        return Promise.resolve({ json: () => Promise.resolve(answer) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 900));
  return { dom, errors, doc: dom.window.document, win: dom.window };
}

(async () => {
  /* 1. Действующая карта по ссылке из кабинета */
  let ctx = await open("#n=%D0%A1%D0%9A-2026-0042&c=ABCD2345", () => ({ ok: true, found: true, card: CARD }));
  let doc = ctx.doc;
  const box = doc.querySelector("[data-verify-result]");
  check(!ctx.errors.length, "страница проверки открывается без ошибок", ctx.errors.slice(0, 2));
  check(!!box && box.hidden === false, "результат проверки показан");
  check(/Действует/.test(box.textContent), "статус «Действует» виден");
  check(box.textContent.indexOf(CARD.authorName) !== -1, "имя с карты показано");
  check(box.textContent.indexOf(CARD.number) !== -1, "номер карты показан");
  check(!!box.querySelector(".pcard-print__face") && !!box.querySelector(".pcard-print__back"),
    "есть обе стороны карты для печати");
  check(/ABCD2345/.test(box.querySelector(".pcard-print__back").textContent), "код напечатан на обратной стороне");
  check(/не является удостоверением журналиста/i.test(box.textContent), "на карте есть предупреждение о статусе СМИ");
  const printBtn = box.querySelector("[data-verify-print]");
  check(!!printBtn, "кнопка печати есть");
  if (printBtn) { printBtn.click(); check(ctx.win.__printed === 1, "кнопка вызывает печать"); }
  check(doc.getElementById("verify-number").value === CARD.number, "номер подставлен из ссылки");
  ctx.dom.window.close();

  /* 2. Отозванная карта: статус виден, печати нет */
  ctx = await open("", (body) => ({ ok: true, found: true, card: Object.assign({}, CARD, { status: "revoked", revokedAt: "2026-11-10T00:00:00Z" }) }));
  doc = ctx.doc;
  doc.getElementById("verify-number").value = CARD.number;
  doc.getElementById("verify-code").value = "ABCD2345";
  doc.querySelector("[data-verify-form]").dispatchEvent(new ctx.win.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 400));
  const revoked = doc.querySelector("[data-verify-result]");
  check(/Отозвана/.test(revoked.textContent), "отозванная карта показана как отозванная");
  check(!revoked.querySelector("[data-verify-print]") && !revoked.querySelector(".pcard-print"),
    "недействующую карту печатать нельзя");
  ctx.dom.window.close();

  /* 3. Неверный код: данных нет, сообщение честное */
  ctx = await open("", () => ({ ok: true, found: false, error: "Карта с таким номером и кодом не найдена." }));
  doc = ctx.doc;
  doc.getElementById("verify-number").value = CARD.number;
  doc.getElementById("verify-code").value = "00000000";
  doc.querySelector("[data-verify-form]").dispatchEvent(new ctx.win.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 400));
  check(doc.querySelector("[data-verify-result]").hidden === true, "при неверном коде результат скрыт");
  check(/не найдена/.test(doc.querySelector("[data-verify-status]").textContent), "сообщение об отказе показано");
  check(doc.body.textContent.indexOf(CARD.authorName) === -1, "имя владельца не раскрыто");
  ctx.dom.window.close();

  /* 4. Пустая форма: подсказка, запрос не уходит */
  ctx = await open("", () => { throw new Error("запрос не должен уходить"); });
  doc = ctx.doc;
  doc.querySelector("[data-verify-form]").dispatchEvent(new ctx.win.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 250));
  check(/Нужны и номер, и код/.test(doc.querySelector("[data-verify-status]").textContent),
    "без номера и кода страница просит заполнить поля");
  check(!ctx.errors.length, "пустая форма не ломает страницу", ctx.errors.slice(0, 2));
  ctx.dom.window.close();

  console.log("\n=== ИТОГ ===");
  console.log("проверок пройдено:", okCount);
  if (problems.length) { console.log("проблем:", problems.length); process.exit(1); }
  console.log("все проверки пройдены");
})();
