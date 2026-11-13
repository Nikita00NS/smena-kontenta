/* Медиашкола: форма на странице, статус в кабинете.
   Запуск: node tools/tests/school.js */
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

function makeDom(page, override) {
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
      w.fetch = () => Promise.reject(new Error("сети нет"));
      w.scrollTo = () => {};
      w.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
    },
  });
  return { dom, errors };
}

const BASE = `
  localStorage.removeItem("smena_token_v1");
  localStorage.removeItem("smena_user_v1");
  var applied = null;
  var schApp = null;
  Store.schoolMine = function () { return Promise.resolve({ ok: true, application: schApp, directions: [] }); };
  Store.schoolApply = function (p) {
    applied = p;
    schApp = { id: "sc_1", status: "pending", direction: p.direction, motivation: p.motivation, createdAt: "2026-11-13T00:00:00Z" };
    return Promise.resolve({ ok: true, application: schApp });
  };
`;

(async () => {
  /* 1. Гость: приглашение зарегистрироваться */
  {
    const { dom } = makeDom("/media-school/index.html", BASE);
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    const host = doc.querySelector("[data-school-host]");
    check("на странице медиашколы есть блок заявки", !!host);
    check("гостю предлагают создать аккаунт",
      !!host && /Создать аккаунт/.test(host.textContent), host && host.textContent.slice(0, 120));
    dom.window.close();
  }

  /* 2. Автор без заявки: форма, направление из списка, отправка */
  {
    const { dom } = makeDom("/media-school/index.html", BASE + `
      localStorage.setItem("smena_token_v1", "school-token");
      localStorage.setItem("smena_user_v1", JSON.stringify({ id: "u_sch", name: "Школа Тест", email: "sch@example.ru", createdAt: "2026-11-01T00:00:00Z" }));
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    const w = dom.window;
    const form = doc.querySelector("[data-school-form]");
    check("вошедшему показывают форму заявки", !!form);
    const dir = form && form.querySelector('select[name="direction"]');
    check("шесть направлений из программы",
      !!dir && dir.options.length === 6, dir && dir.options.length);
    check("в списке есть «Проверка информации»",
      !!dir && Array.from(dir.options).some((o) => o.textContent === "Проверка информации"));
    dir.value = "Интервью";
    form.querySelector('textarea[name="motivation"]').value = "Делаю разговоры с героями района: записала уже три интервью на телефон.";
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    check("заявка ушла с выбранным направлением",
      w.applied && w.applied.direction === "Интервью", w.applied);
    check("после отправки виден статус «на рассмотрении»",
      /Заявка на рассмотрении/.test((doc.querySelector("[data-school-host]") || {}).textContent || ""));
    dom.window.close();
  }

  /* 3. Принятый: зелёная плашка и следующий шаг */
  {
    const { dom } = makeDom("/media-school/index.html", BASE + `
      localStorage.setItem("smena_token_v1", "school-token");
      localStorage.setItem("smena_user_v1", JSON.stringify({ id: "u_sch", name: "Школа Тест", email: "sch@example.ru", createdAt: "2026-11-01T00:00:00Z" }));
      schApp = { id: "sc_1", status: "accepted", direction: "Фотография", createdAt: "2026-11-10T00:00:00Z" };
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const doc = dom.window.document;
    const state = doc.querySelector("[data-school-state]");
    check("принятому показывают зелёную плашку",
      !!state && state.classList.contains("fill-note--ok"), state && state.className);
    check("следующий шаг — первое задание", /Написать материал/.test(state.textContent));
    dom.window.close();
  }

  /* 4. Кабинет: блок медиашколы в обзоре */
  {
    const { dom } = makeDom("/profile/index.html", BASE + `
      localStorage.setItem("smena_token_v1", "school-token");
      localStorage.setItem("smena_user_v1", JSON.stringify({ id: "u_sch", name: "Школа Тест", email: "sch@example.ru", role: "Автор", createdAt: "2026-11-01T00:00:00Z" }));
      schApp = { id: "sc_1", status: "pending", direction: "Видео и монтаж", createdAt: "2026-11-11T00:00:00Z" };
    `);
    await new Promise((r) => setTimeout(r, 2000));
    const doc = dom.window.document;
    const overview = doc.querySelector('[data-cab-panel="overview"]');
    check("в кабинете есть блок медиашколы", !!overview && !!overview.querySelector("[data-school-host]"));
    check("в кабинете виден статус заявки",
      !!overview && /Заявка на рассмотрении/.test(overview.textContent) && /Видео и монтаж/.test(overview.textContent));
    dom.window.close();
  }

  if (bad) {
    console.log("медиашкола: проверка не пройдена");
    process.exit(1);
  }
  console.log("все проверки пройдены");
})();
