/* Проверка интерфейса на настоящем сервере проекта.

   Страницы открываются в jsdom, запросы идут в api/index.php (php-wasm), данные —
   демонстрационные (tools/preview/site.js). Проверяется связка целиком:
   нажали кнопку → ушёл запрос → сервер решил → экран изменился.

   Запуск:  NODE_PATH=/tmp/sk-tests/node_modules node tools/tests/ui-checks.js
   Быстрее при повторных запусках: UI_SEED_CACHE=/tmp/ui-seed.json …

   Чего стенд не видит: вёрстку, цвета и печать — это смотрится глазами
   в просмотре (node tools/preview/server.js). */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const kit = require("./ui-kit.js");

const ROOT = kit.ROOT;
const { check, finish } = kit.makeChecks();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");

/* ---------------------------------------------------------------- без сервера */
function staticChecks() {
  console.log("\n— Код: страницы, функции и запросы согласованы");
  const jsDir = path.join(ROOT, "assets", "js");
  const files = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"));

  /* 1. всё, что страницы зовут у Store, в Store есть */
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://smenakontenta.ru/", runScripts: "outside-only" });
  dom.window.eval(read("assets/js/data.js"));
  dom.window.eval(read("assets/js/store.js"));
  const have = new Set(Object.keys(dom.window.Store));
  const missing = [];
  for (const f of files.filter((f) => f !== "store.js")) {
    const src = read("assets/js/" + f);
    const re = /\bStore\.([A-Za-z_]\w*)/g;
    let m;
    while ((m = re.exec(src))) if (!have.has(m[1])) missing.push(f + ": Store." + m[1]);
  }
  check("все функции Store, которые зовут страницы, существуют", missing.length === 0, [...new Set(missing)]);
  check("в Store нет пустых экспортов", [...have].every((k) => dom.window.Store[k] !== undefined), [...have].filter((k) => dom.window.Store[k] === undefined));

  /* 2. каждое действие, которое клиент просит у сервера, сервер умеет */
  const php = fs.readdirSync(path.join(ROOT, "api", "lib")).map((f) => read("api/lib/" + f)).join("\n") + read("api/index.php");
  const known = new Set();
  php.replace(/\$act [!=]== '([a-z0-9_-]+)'/g, (m, a) => { known.add(a); return m; });
  php.replace(/\$handled = array\(([^;]+?)\);/g, (m, list) => { list.replace(/'([a-z0-9_-]+)'/g, (x, a) => { known.add(a); return x; }); return m; });
  php.replace(/in_array\(\$act, array\(([^)]+)\)/g, (m, list) => { list.replace(/'([a-z0-9_-]+)'/g, (x, a) => { known.add(a); return x; }); return m; });
  const asked = new Set();
  for (const f of files) {
    const src = read("assets/js/" + f);
    src.replace(/\b(?:api|withToken|callStaff|call|act|load|raw)\(\s*(?:Store,\s*|sec,\s*|queue,\s*|ui\.Store,\s*)?"([a-z][a-z0-9-]+)"/g, (m, a) => { asked.add(a); return m; });
  }
  const unknown = [...asked].filter((a) => !known.has(a));
  check("клиент не просит у сервера действий, которых нет", unknown.length === 0 && asked.size > 80, { unknown, asked: asked.size });

  /* 3. документы: что в списке — то и лежит, и наоборот */
  const docs = dom.window.SC.docs || [];
  const onDisk = fs.readdirSync(path.join(ROOT, "assets", "docs")).filter((f) => f.endsWith(".pdf")).sort();
  const listed = docs.map((d) => path.basename(d.file)).sort();
  check("список документов совпадает с файлами в assets/docs", JSON.stringify(onDisk) === JSON.stringify(listed), { onDisk, listed });
  check("бланка пресс-карты больше нет", !onDisk.includes("blank-press-karty.pdf") && !/blank-press-karty/.test(files.map((f) => read("assets/js/" + f)).join("")), onDisk);
  check("у каждого документа есть название, описание и число страниц", docs.length >= 8 && docs.every((d) => d.title && d.desc && d.pages > 0), docs.length);

  /* 4. данные проекта на сайте — из project.json, без ИНН */
  const project = JSON.parse(read("tools/docs/project.json"));
  const site = dom.window.SC.project || {};
  check("оператор и директор на сайте — те же, что в project.json",
    site.operator && site.operator.name === project.operator.name && site.director.name === project.director.name && site.mail.personalData === project.mail.personalData, site.operator);
  check("ИНН на сайт не попадает", !/\b\d{12}\b/.test(JSON.stringify(site)) && !/inn/i.test(Object.keys(site.operator || {}).join()), Object.keys(site.operator || {}));

  /* 5. страницы подключают существующие файлы и одну версию сборки */
  const pages = ["index.html", "404.html"].concat(fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, "index.html"))).map((d) => d.name + "/index.html"));
  const badLinks = [];
  const versions = new Set();
  for (const rel of pages) {
    read(rel).replace(/(?:src|href)="(\/assets\/(?:js|css)\/[^"?]+)(?:\?v=([^"]+))?"/g, (m, file, v) => {
      if (!fs.existsSync(path.join(ROOT, file))) badLinks.push(rel + " → " + file);
      if (v) versions.add(v);
      return m;
    });
  }
  check("страницы подключают только существующие файлы", badLinks.length === 0, badLinks);
  check("версия сборки одна на всех страницах и совпадает с SC.build", versions.size === 1 && versions.has(dom.window.SC.build), { versions: [...versions], build: dom.window.SC.build });
  const rules = read(".htaccess");
  const noRule = pages.filter((p) => p.includes("/")).map((p) => p.split("/")[0]).filter((dir) => !new RegExp("RewriteRule \\^" + dir + "/\\?\\$").test(rules));
  check("у каждой страницы есть короткий адрес в .htaccess", noRule.length === 0, noRule);
  dom.window.close();
}

/* ------------------------------------------------------------------ с сервером */
async function main() {
  staticChecks();

  const t0 = Date.now();
  const { site, seed, cached } = await kit.demoSite();
  console.log("\nсервер с демо-данными готов за " + Math.round((Date.now() - t0) / 1000) + " с" + (cached ? " (снимок)" : ""));
  const tk = seed.tokens;
  const noErrors = (p, name) => check(name + ": без ошибок в браузере", p.errors.length === 0, p.errors.slice(0, 3));
  const goTab = async (p, name) => { p.click(p.$('a[href="#' + name + '"]')); await p.settle(); };

  /* ---------------------------------------------------- 1. новичок и согласие */
  console.log("\n— Новичок: без согласия закрыто, загрузка согласия, проверка редакцией");
  let p = await kit.openPage(site, "profile", { token: tk.newbie });
  await p.settle();
  noErrors(p, "кабинет новичка");
  check("в обзоре следующий шаг — согласие", /соглас/i.test(p.text(p.$(".cab-next"))), p.text(p.$(".cab-next")));
  check("вкладок восемь", p.$$(".cab-tab").length === 8, p.$$(".cab-tab").map((a) => p.text(a)));
  check("«команды в браузере» в кабинете нет", !/браузер|localStorage|ключ автора/i.test(p.text(p.main())), "");
  await goTab(p, "docs");
  check("во вкладке «Документы» два бланка и форма загрузки",
    p.$$('.cab-steps a[href$=".pdf"]').length === 2 && !!p.$("[data-consent-form]"), p.text(p.$(".cab-steps")));
  check("оператор назван по имени", p.text(p.main()).includes("Ильин Борис Павлович"), "");
  p.attach(p.$("[data-consent-files]"), [{ name: "soglasie.pdf", type: "application/pdf", data: PDF }, { name: "rasprostranenie.pdf", type: "application/pdf", data: PDF }]);
  p.$("[data-consent-form]").dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  await p.wait("согласие ушло на сервер", () => p.last("consent-send"));
  await p.settle();
  check("согласие отправлено: два листа, статус «на проверке»",
    p.last("consent-send").ok && p.last("consent-send").body.pages.length === 2 && /на проверке|проверяется/i.test(p.text(p.$(".cab-status"))), p.text(p.$(".cab-status")));
  p.close();

  p = await kit.openPage(site, "write", { token: tk.newbie });
  await p.settle();
  check("редактор материала закрыт, пока согласие не принято", !!p.$(".gate--page") && !p.$("[data-write-form] textarea"), p.text(p.main()).slice(0, 200));
  p.close();

  p = await kit.openPage(site, "region", { token: tk.newbie, search: "?r=respublika-tatarstan" });
  await p.settle();
  p.click(p.$("[data-editorial-join]"));
  check("в редакцию без согласия не подать: подсказка со ссылкой на документы",
    !!p.$('[data-editorial-gate] a[href="/profile#docs"]') && p.$("[data-editorial-apply]").classList.contains("is-hidden"), p.text(p.$("[data-editorial-gate]")));
  check("формы «создать редакцию» на странице региона нет", !p.$("[data-editorial-create]") && !!p.$('a[href="/profile#editorial"]'), "");
  p.close();

  /* директор принимает согласие в панели */
  p = await kit.openPage(site, "admin", { token: tk.director, confirm: await site.confirmFor(tk.director), hash: "#consents" });
  await p.settle();
  noErrors(p, "панель директора, согласия");
  const rowNewbie = p.$$("[data-consent]").find((el) => /Нина Новичкова/.test(p.text(el)));
  check("согласие новичка в очереди директора, листов два", !!rowNewbie && p.$$("[data-page]", rowNewbie).length === 2, p.$$("[data-consent]").map((el) => p.text(el).slice(0, 40)));
  p.click(p.$("[data-page]", rowNewbie));
  await p.wait("скан открыт", () => p.last("consent-file"));
  await p.settle();
  check("скан открывается из закрытой папки", p.last("consent-file").ok && p.opened.length === 1 && /^blob:/.test(p.opened[0]), p.opened);
  p.click(p.$('[data-decide="approved"]', rowNewbie));
  await p.wait("решение ушло", () => p.last("consent-review"));
  await p.settle();
  check("согласие принято из панели", p.last("consent-review").ok === true, p.last("consent-review"));
  p.close();

  p = await kit.openPage(site, "write", { token: tk.newbie });
  await p.settle();
  check("после принятия согласия редактор открыт", !p.$(".gate--page") && !!p.$("textarea"), p.text(p.main()).slice(0, 200));
  noErrors(p, "редактор материала");
  p.close();

  /* ------------------------------------------------------ 2. права по ролям */
  console.log("\n— Панель: каждому — свои разделы");
  const tabsOf = async (who) => {
    const page = await kit.openPage(site, "admin", { token: tk[who] });
    await page.settle();
    const tabs = page.$$("[data-adm-tab]").map((a) => a.getAttribute("data-adm-tab"));
    const errors = page.errors.slice();
    const gate = !!page.$("[data-gate-list]") && /Панель открыта сотрудникам/.test(page.text(page.main()));
    page.close();
    return { tabs, errors, gate };
  };
  let t = await tabsOf("director");
  check("директор видит все разделы панели",
    ["overview", "queue", "consents", "cards", "editorials", "school", "people", "support", "site", "server"].every((k) => t.tabs.includes(k)) && !t.errors.length, t);
  t = await tabsOf("teacher");
  check("преподаватель видит только обзор и медиашколу", t.tabs.join() === "overview,school" && !t.errors.length, t);
  t = await tabsOf("head");
  check("руководитель редакции: материалы и люди, без согласий, карт и сервера",
    t.tabs.includes("queue") && t.tabs.includes("people") && !t.tabs.includes("consents") && !t.tabs.includes("cards") && !t.tabs.includes("server") && !t.tabs.includes("site"), t);
  t = await tabsOf("author");
  check("автору панель закрыта", t.tabs.length === 0 && t.gate, t);

  p = await kit.openPage(site, "", { token: tk.author });
  await p.settle();
  check("в подвале у автора нет ссылки на панель", !p.$('.site-footer a[href="/admin"]') && !!p.$('.site-footer a[href="/verify"]'), "");
  p.close();
  p = await kit.openPage(site, "", { token: tk.editor });
  await p.settle();
  check("в подвале у сотрудника ссылка на панель есть", !!p.$('.site-footer a[href="/admin"]'), "");
  p.close();

  /* --------------------------------------------------------- 3. пресс-карта */
  console.log("\n— Пресс-карта: заявка, документ, проверка по номеру");
  p = await kit.openPage(site, "profile", { token: tk.author, hash: "#card" });
  await p.settle();
  noErrors(p, "кабинет автора, пресс-карта");
  check("у автора заявка на карту на рассмотрении, кнопки печати нет", /рассмотрени|на проверке/i.test(p.text(p.main())) && !/распечатать карту|бланк/i.test(p.text(p.main())), p.text(p.main()).slice(0, 300));
  p.close();

  p = await kit.openPage(site, "profile", { token: tk.head, hash: "#card" });
  await p.settle();
  check("у руководителя карта с номером и ссылкой на документ", p.text(p.main()).includes(seed.cardNumber) && !!p.$('a[href^="/card-doc"]') && !!p.$('a[href^="/verify"]'), "");
  p.close();

  p = await kit.openPage(site, "card-doc", { token: tk.head });
  await p.settle();
  noErrors(p, "документ о карте");
  const sheet = p.text(p.$("[data-doc-sheet]"));
  check("документ «О присвоении пресс-карты»: номер, владелец, срок, обе подписи",
    sheet.includes(seed.cardNumber) && sheet.includes("Глеб Руководин") && sheet.includes("Н. С. Сирик") && sheet.includes("Б. П. Ильин") && /Действует до/.test(sheet), sheet.slice(0, 300));
  p.click(p.$("[data-doc-print]"));
  check("кнопка печати вызывает печать браузера", p.printed === 1, p.printed);
  p.close();

  p = await kit.openPage(site, "card-doc", { token: tk.newbie, search: "?id=" + encodeURIComponent(seed.cardId) });
  await p.settle();
  check("чужой документ о карте не открывается", !p.$("[data-doc-sheet]") && /недоступен|не найден|видит/i.test(p.text(p.main())), p.text(p.main()));
  p.close();

  p = await kit.openPage(site, "verify", { search: "?n=" + encodeURIComponent(seed.cardNumber) });
  await p.settle();
  noErrors(p, "проверка карты");
  check("проверка по номеру: карта действует, имя показано", !!p.$(".verify-card.is-good") && p.text(p.$(".verify-card")).includes("Глеб Руководин"), p.text(p.$(".verify-card")));
  p.type(p.$("#verify-number"), "СК-2026-9999");
  p.$("[data-verify-form]").dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  await p.settle();
  check("несуществующий номер: «карта не найдена»", !!p.$(".verify-card.is-bad") && /не найдена/i.test(p.text(p.$(".verify-card"))), p.text(p.$("[data-verify-result]")));
  p.close();

  /* ------------------------------------------------- 4. редакция и отчёты */
  console.log("\n— Редакция: штат, заявление, отчёт руководителя и решение редакции");
  p = await kit.openPage(site, "profile", { token: tk.head, hash: "#editorial" });
  await p.settle();
  noErrors(p, "кабинет руководителя, редакция");
  check("руководитель видит штат и отчёты", p.$$("[data-member]").length === 2 && p.$$("[data-period]").length === 3, p.text(p.main()).slice(0, 200));
  const lateRow = p.$$("[data-period]").find((el) => el.classList.contains("rep-item--late"));
  check("несданный месяц помечен как просроченный", !!lateRow && /не сдан/.test(p.text(lateRow)), lateRow ? p.text(lateRow) : "");
  p.click(p.$("[data-rep-open]", lateRow));
  let repForm = p.$("[data-rep-form]");
  check("форма отчёта: четыре поля и цифры сервера", !!repForm && p.$$("textarea", repForm).length === 4 && !!p.$(".rep-stats"), "");
  p.type(p.$('[name="done"]', repForm), "коротко");
  repForm.dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  check("короткий отчёт не уходит на сервер", !p.last("report-save") && /30 символов/.test(p.text(p.$("[data-rep-note]"))), p.text(p.$("[data-rep-note]")));
  p.type(p.$('[name="done"]', repForm), "Выпустили два материала о жизни лицея и записали выпуск подкаста с учителем истории.");
  p.type(p.$('[name="plans"]', repForm), "Фоторепортаж с олимпиады.");
  repForm.dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  await p.wait("отчёт ушёл", () => p.last("report-save"));
  await p.settle();
  check("отчёт отправлен и стал «на проверке»", p.last("report-save").ok && p.last("report-save").body.send === true && !p.$(".rep-item--late"), p.last("report-save"));
  p.close();

  p = await kit.openPage(site, "admin", { token: tk.editor, hash: "#editorials" });
  await p.settle();
  noErrors(p, "панель главного редактора, редакции");
  const waiting = p.$$("[data-report]").filter((el) => !!p.$("[data-decide]", el));
  check("у главного редактора два отчёта на проверке, несдавших нет", waiting.length === 2 && !/Не сдали отчёт/.test(p.text(p.main())), waiting.length);
  p.click(p.$('[data-decide="returned"]', waiting[0]));
  check("вернуть отчёт без замечания нельзя", !p.last("report-review"), "");
  p.type(p.$("[data-note]", waiting[0]), "Добавьте ссылки на вышедшие материалы.");
  p.click(p.$('[data-decide="returned"]', waiting[0]));
  await p.wait("решение по отчёту", () => p.last("report-review"));
  await p.settle();
  check("отчёт возвращён с замечанием", p.last("report-review").ok && p.last("report-review").body.decision === "returned", p.last("report-review"));
  p.close();

  p = await kit.openPage(site, "editorial-doc", { token: tk.director, search: "?id=" + encodeURIComponent(seed.openWaiting) });
  await p.settle();
  noErrors(p, "заявление на открытие редакции");
  const app = p.text(p.$("[data-doc-sheet]"));
  check("заявление: адресат — директор, оператор назван, есть куратор и подписи",
    app.includes("Сирику Никите Сергеевичу") && app.includes("Ильин Борис Павлович") && app.includes("Куратор редакции") && /ЗР-\d{4}-\d{4}/.test(app), app.slice(0, 300));
  p.close();

  /* ------------------------------------------------------- 5. медиашкола */
  console.log("\n— Медиашкола: каталог, урок, тест, проверка задания, новый курс");
  p = await kit.openPage(site, "media-school", {});
  await p.settle();
  noErrors(p, "страница медиашколы");
  check("каталог без входа: курс виден, запись — после входа", p.$$(".sch-card").length === 1 && /Войдите/.test(p.text(p.$(".sch-card"))), p.text(p.$("[data-school-catalog]")).slice(0, 200));
  p.close();

  p = await kit.openPage(site, "media-school", { token: tk.member });
  await p.settle();
  p.click(p.$("[data-enroll]"));
  await p.wait("запись на курс", () => p.last("school-enroll"));
  check("участник с согласием записался на курс", p.last("school-enroll").ok === true, p.last("school-enroll"));
  p.close();

  p = await kit.openPage(site, "media-school", { token: tk.member, search: "?course=" + encodeURIComponent(seed.courseId) });
  await p.settle();
  noErrors(p, "страница курса");
  check("курс открыт: четыре урока, первый доступен, остальные закрыты",
    p.$$(".sch-nav__item").length === 4 && p.$$(".sch-nav__item.is-locked").length === 3 && !!p.$("[data-lesson-done]") && !!p.$(".sch-video iframe"), p.$$(".sch-nav__item").map((a) => a.className));
  check("видео встроено плеером Rutube", /^https:\/\/rutube\.ru\/play\/embed\//.test(p.$(".sch-video iframe").getAttribute("src")), p.$(".sch-video iframe").getAttribute("src"));
  p.click(p.$("[data-lesson-done]"));
  await p.wait("урок отмечен", () => p.last("school-lesson-done"));
  await p.settle();
  check("после первого урока открылся тест", !!p.$("[data-test-form]") && p.$$(".sch-q").length === 3, p.text(p.$(".sch-lesson")).slice(0, 200));
  let testForm = p.$("[data-test-form]");
  testForm.dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  check("тест без ответов не отправляется", !p.last("school-test-send") && /все вопросы/.test(p.text(p.$("[data-test-note]"))), p.text(p.$("[data-test-note]")));
  [2, 0, 0].forEach((v, i) => { p.$('input[name="q' + i + '"][value="' + v + '"]', testForm).checked = true; });
  testForm.dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  await p.wait("тест проверен", () => p.last("school-test-send"));
  await p.settle();
  check("неверные ответы: тест не сдан, вопросы помечены", /не сдан/i.test(p.text(p.$(".sch-task"))) && p.$$(".sch-q.is-wrong").length === 3, p.text(p.$(".sch-task")).slice(0, 200));
  testForm = p.$("[data-test-form]");
  [0, 1, 1].forEach((v, i) => { p.$('input[name="q' + i + '"][value="' + v + '"]', testForm).checked = true; });
  testForm.dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  await p.wait("вторая попытка", () => p.calls.filter((c) => c.action === "school-test-send").length === 2);
  await p.settle();
  check("верные ответы: тест сдан, прогресс вырос", p.last("school-test-send").json.passed === true && /50%/.test(p.text(p.$(".sch-top__progress"))), p.text(p.$(".sch-top__progress")));
  p.close();

  p = await kit.openPage(site, "admin", { token: tk.teacher, hash: "#school" });
  await p.settle();
  noErrors(p, "панель преподавателя, медиашкола");
  const work = p.$("[data-work]");
  check("преподаватель видит работу ученика", !!work && /Анна Авторова/.test(p.text(work)), work ? p.text(work).slice(0, 120) : "");
  p.type(p.$("[data-note]", work), "Хорошая новость, принимаю.");
  p.click(p.$('[data-decide="accepted"]', work));
  await p.wait("работа оценена", () => p.last("school-review"));
  await p.settle();
  check("работа принята", p.last("school-review").ok === true && !p.$("[data-work]"), p.last("school-review"));
  check("преподаватель не публикует курс сам: кнопки нет", !p.$('[data-status="published"]'), "");

  p.click(p.$("[data-new]"));
  const editor = p.$("[data-editor]");
  check("редактор курса открылся с одним уроком", !!editor && p.$$("[data-les]", editor).length === 1, "");
  editor.dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  await p.wait("пустой курс отклонён", () => p.last("school-course-save"));
  await p.settle();
  check("пустой курс не сохраняется: причины показаны списком", p.last("school-course-save").ok === false && p.$$("[data-problems] li").length >= 3, p.text(p.$("[data-problems]")));
  p.type(p.$("#sch-title", editor), "Фоторепортаж с телефона");
  p.type(p.$("#sch-summary", editor), "Как снять серию кадров о событии и собрать из них историю.");
  let les = p.$("[data-les]", editor);
  p.type(p.$('[data-f="title"]', les), "Пять кадров истории");
  p.type(p.$('[data-f="body"]', les), "Общий план, средний, крупный, деталь и финальный кадр — этого хватит для репортажа.");
  p.type(p.$('[data-f="check"]', les), "test");
  les = p.$("[data-les]", editor);
  p.type(p.$("[data-q-text]", les), "Сколько кадров в базовой серии?");
  p.type(p.$("[data-q-options]", les), "Три\n*Пять\nДесять");
  editor.dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  await p.wait("курс сохранён", () => p.calls.filter((c) => c.action === "school-course-save").length === 2);
  await p.settle();
  const saved = p.last("school-course-save");
  check("курс с тестом сохранён: верный ответ взят по звёздочке",
    saved.ok === true && saved.json.course.status === "draft" && saved.json.course.lessons[0].questions[0].answer === 1 && saved.json.course.lessons[0].questions[0].options.length === 3, saved.json);
  check("новый курс появился в списке черновиком", p.$$("[data-course]").some((el) => /Фоторепортаж с телефона/.test(p.text(el)) && /черновик/.test(p.text(el))), p.$$("[data-course]").map((el) => p.text(el).slice(0, 50)));
  p.close();

  p = await kit.openPage(site, "profile", { token: tk.author, hash: "#school" });
  await p.settle();
  noErrors(p, "кабинет автора, медиашкола");
  check("в кабинете автора — курс с прогрессом", p.$$(".sch-card").length >= 1 && /Пройдено 3 из 4/.test(p.text(p.main())), p.text(p.main()).slice(-300));
  await goTab(p, "messages");
  check("решение преподавателя пришло в сообщения", /Задание «Напишите свою новость».*принято/.test(p.text(p.main())), p.text(p.main()).slice(0, 400));
  p.close();

  process.exit(finish() === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log("СБОЙ ПРОГОНА:", e && (e.stack || e.message || e));
  process.exit(2);
});
