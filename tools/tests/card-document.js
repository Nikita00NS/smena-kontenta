/* Кабинет: действующая пресс-карта даёт печать, PDF и показывает отправку.

   Подменяем только статус карты и ответ card-pdf; остальной сервер недоступен.
   Ловим ошибки вёрстки строк кабинета и проверяем, что кнопка PDF действительно
   запрашивает файл и запускает скачивание.
   Запуск: node tools/tests/card-document.js */
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
  id: "c_probe",
  userId: "u_probe",
  status: "issued",
  number: "СК-2026-0042",
  verifyCode: "ABCD2345",
  authorName: "Проверка Карты",
  authorRegion: "moskva",
  authorRole: "Автор текстов",
  issuedAt: "2026-11-01T00:00:00Z",
  validUntil: "2027-11-01T00:00:00Z",
  createdAt: "2026-10-20T00:00:00Z",
  decidedAt: "2026-11-01T00:00:00Z",
  dispatch: { tracking: "12345678901234", sentAt: "2026-11-02T00:00:00Z" },
  delivery: { method: "post" },
  posts: [],
  history: [],
};

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e.detail || e.message || e);
    if (!/Not implemented/i.test(msg)) errors.push(msg);
  });
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));

  let html = inline(fs.readFileSync(path.join(ROOT, "profile/index.html"), "utf8"));
  const override = `<script>
    Store.apiCardStatus = function () {
      return Promise.resolve({ ok: true, current: ${JSON.stringify(CARD)}, requests: [${JSON.stringify(CARD)}],
        minPosts: 5, published: 5, byRole: false, canApply: false });
    };
    Store.apiMyPosts = function () { return Promise.resolve([]); };
  </script>`;
  html = html.replace(/<script>\n\/\* =+\n   СМЕНА КОНТЕНТА — логика/, override + "\n<script>\n/* ============================================================================\n   СМЕНА КОНТЕНТА — логика");
  if (html.indexOf("Store.apiCardStatus = function") === -1) {
    /* запасной путь: вставляем перед последним большим скриптом (app.js) */
    const idx = html.lastIndexOf("<script>");
    html = html.slice(0, idx) + override + html.slice(idx);
  }

  const dom = new JSDOM(html, {
    url: "https://smenakontenta.ru/profile/",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.URL.createObjectURL = () => "blob:card-pdf";
      w.URL.revokeObjectURL = () => {};
      w.localStorage.setItem("smena_token_v1", "probe-token");
      w.localStorage.setItem("smena_user_v1", JSON.stringify({
        id: "u_probe", name: "Проверка Карты", email: "probe@example.ru",
        region: "moskva", role: "Автор текстов", access: "Пользователь",
      }));
      w.localStorage.setItem("smena_consent_v1", JSON.stringify({ status: "approved", kind: "processing" }));
      w.localStorage.setItem("smena_consent_distribution_v1", JSON.stringify({ status: "approved", kind: "distribution" }));
      w.document.addEventListener("click", (e) => {
        const a = e.target && e.target.closest ? e.target.closest("a[download]") : null;
        if (a) { w.__download = { href: a.href, filename: a.download }; e.preventDefault(); }
      }, true);
      w.fetch = (url, opts) => {
        let body = {};
        try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
        if (body.action === "card-pdf") {
          w.__pdfRequest = body;
          return Promise.resolve({ json: () => Promise.resolve({
            ok: true, mime: "application/pdf", filename: "press-karta-2026-0042.pdf",
            data: Buffer.from("%PDF-1.4 test").toString("base64"),
          }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, offline: true, error: "Нет связи с сервером." }) });
      };
    },
  });

  await new Promise((r) => setTimeout(r, 1600));
  const doc = dom.window.document;
  const box = doc.querySelector("[data-profile-card]");
  check(!errors.length, "кабинет с действующей картой открывается без ошибок", errors.slice(0, 3));
  check(!!box && /СК-2026-0042/.test(box.textContent), "номер действующей карты показан");
  const print = box && box.querySelector('a[href^="/verify#"]');
  check(!!print && /n=/.test(print.getAttribute("href")) && /c=ABCD2345/.test(print.getAttribute("href")),
    "ссылка печати ведёт на /verify с номером и кодом во фрагменте");
  check(!!print && print.getAttribute("href").indexOf("?") === -1, "код проверки не попадает в query URL");
  const pdfBtn = box && box.querySelector("[data-card-pdf]");
  check(!!pdfBtn && /Карта \(PDF\)/.test(pdfBtn.textContent), "кнопка скачивания PDF есть");
  check(!!box.querySelector("[data-card-act]"), "рядом кнопка акта выдачи");
  check(/Отправлена:/.test(box.textContent) && /12345678901234/.test(box.textContent),
    "дата отправки и трек-номер видны владельцу");
  if (pdfBtn) {
    pdfBtn.click();
    await new Promise((r) => setTimeout(r, 400));
    check(dom.window.__pdfRequest && dom.window.__pdfRequest.id === CARD.id, "кнопка запрашивает PDF своей карты");
    check(dom.window.__download && dom.window.__download.filename === "press-karta-2026-0042.pdf",
      "PDF скачивается с именем файла от сервера", dom.window.__download);
    const note = box.querySelector("[data-card-pdf-note]");
    check(note && /PDF сохранён/.test(note.textContent), "после скачивания кабинет сообщает об успехе");
  }
  dom.window.close();

  console.log("\n=== ИТОГ ===");
  console.log("проверок пройдено:", okCount);
  if (problems.length) { console.log("проблем:", problems.length); process.exit(1); }
  console.log("все проверки пройдены");
})();
