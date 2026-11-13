/* Кабинет без сервера: проверяем, что оба документа для подписи на месте.

   Согласие на обработку данных и согласие на распространение — разные карточки,
   со своими файлами, состояниями и кнопками. Прогон ловит ошибки вёрстки строк,
   которые не видны в проверке синтаксиса.
   Запуск: node tools/tests/profile-consent.js */
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

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e.detail || e.message || e);
    if (!/Not implemented/i.test(msg)) errors.push(msg);
  });
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));

  const dom = new JSDOM(inline(fs.readFileSync(path.join(ROOT, "profile/index.html"), "utf8")), {
    url: "https://smenakontenta.ru/profile/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("smena_lang", "ru"); /* проверки текста — на русском */
      w.fetch = () => Promise.reject(new Error("сети нет"));
      w.scrollTo = () => {};
      w.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
      /* участник с принятым согласием на обработку и заявкой на распространение */
      w.localStorage.setItem("smena_token_v1", "probe-token");
      w.localStorage.setItem("smena_user_v1", JSON.stringify({
        id: "u_probe", name: "Проверка Кабинета", email: "probe@example.ru",
        region: "moskva", role: "Автор текстов", access: "Пользователь",
        createdAt: "2026-11-01T00:00:00Z",
      }));
      w.localStorage.setItem("smena_consent_v1", JSON.stringify({
        status: "approved", kind: "processing", decidedAt: "2026-11-02T00:00:00Z",
      }));
      w.localStorage.setItem("smena_consent_distribution_v1", JSON.stringify({
        status: "pending", kind: "distribution", purpose: "Конкурс «Мой город»",
        createdAt: "2026-11-10T00:00:00Z",
      }));
    },
  });

  await new Promise((r) => setTimeout(r, 1500));
  const doc = dom.window.document;
  const cards = Array.from(doc.querySelectorAll("[data-consent-card]"));
  const bad = [];

  if (cards.length !== 2) bad.push("карточек согласия " + cards.length + ", ожидалось 2");
  const expected = [
    { kind: "processing", title: /обработку персональных данных/, pdf: "soglasie-na-obrabotku-pd.pdf", state: "Проверено комиссией", upload: false },
    { kind: "distribution", title: /распространение персональных данных/, pdf: "soglasie-na-rasprostranenie-pd.pdf", state: "На проверке у комиссии", upload: true },
  ];
  expected.forEach((want, i) => {
    const card = cards[i];
    if (!card) return;
    if (card.getAttribute("data-consent-card") !== want.kind) bad.push("порядок карточек нарушен: " + want.kind);
    const h3 = card.querySelector("h3");
    if (!h3 || !want.title.test(h3.textContent)) bad.push("заголовок не тот: " + want.kind);
    const state = card.querySelector(".consent-card__state b");
    if (!state || state.textContent !== want.state) bad.push("состояние не то: " + want.kind);
    const link = card.querySelector(".consent-card__actions a");
    if (!link || link.getAttribute("href").indexOf(want.pdf) === -1) bad.push("ссылка на форму не та: " + want.kind);
    else if (!fs.existsSync(path.join(ROOT, link.getAttribute("href")))) bad.push("файла формы нет: " + want.pdf);
    const upload = card.querySelector("[data-consent-file]");
    if (!!upload !== want.upload) bad.push("кнопка загрузки не там: " + want.kind);
    if (upload && upload.getAttribute("data-consent-file") !== want.kind) bad.push("загрузка не привязана к документу: " + want.kind);
    const note = card.querySelector("[data-consent-note]");
    if (!note || note.getAttribute("data-consent-note") !== want.kind) bad.push("строка статуса не привязана к документу: " + want.kind);
  });

  const dist = cards[1];
  if (dist && !/Конкурс «Мой город»/.test(dist.textContent)) bad.push("в карточке распространения не видно название конкурса");
  if (dist && !dist.querySelector("[data-consent-purpose]")) bad.push("нет поля «для какого конкурса»");

  /* сервер недоступен — кабинет обязан сказать об этом, а не молчать */
  const note = doc.querySelector('[data-consent-note="processing"]');
  if (!note || !/Не удалось спросить сервер/.test(note.textContent)) bad.push("нет честного сообщения о недоступности сервера");

  /* соцсети в подвале — общий список из data.js */
  const social = Array.from(doc.querySelectorAll(".footer-social__link"));
  const wanted = ((dom.window.SC && dom.window.SC.brand && dom.window.SC.brand.social) || []).length;
  if (!wanted || social.length !== wanted) bad.push("соцсетей в подвале " + social.length + ", ожидалось " + wanted);

  dom.window.close();
  errors.slice(0, 5).forEach((e) => console.log("ОШИБКА", e.slice(0, 300)));
  bad.forEach((b) => console.log("FAIL", b));
  if (errors.length || bad.length) {
    console.log("кабинет: проверка не пройдена");
    process.exit(1);
  }
  console.log("ok   кабинет: два документа, свои формы и кнопки, название конкурса");
  console.log("ok   кабинет: честно сообщает, что сервер недоступен");
  console.log("ok   кабинет: соцсети в подвале —", social.length);
  console.log("все проверки пройдены");
})();
