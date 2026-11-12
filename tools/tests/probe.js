/* Быстрый просмотр страницы на настоящем сервере проекта (php-wasm) с
   демо-данными: что нарисовалось, какие запросы ушли, были ли ошибки.

   node tools/tests/probe.js <страница> <аккаунт|-> [#вкладка|-] [?запрос]

   страница — папка (profile, admin, verify…) или home;
   аккаунт  — director, admin, editor, teacher, head, member, author, waiting, newbie;
   в запросе {cardNumber}, {cardId}, {openDone}, {openWaiting}, {editorialId}
   заменяются значениями из демо-данных.
   Переменные: SHOW=сколько символов текста показать, HTML=сколько символов разметки,
   UI_SEED_CACHE=файл со снимком демо-данных (ускоряет повторные запуски). */
const kit = require("./ui-kit.js");

(async () => {
  const [rel, who, hash, searchRaw] = process.argv.slice(2);
  if (!rel) { console.log("node tools/tests/probe.js <страница> <аккаунт|-> [#вкладка|-] [?запрос]"); process.exit(1); }
  const t0 = Date.now();
  const { site, seed, cached } = await kit.demoSite();
  console.log("сервер готов за", Date.now() - t0, "мс; снимок из кэша:", cached);
  const search = String(searchRaw || "").replace(/\{(\w+)\}/g, (m, k) => encodeURIComponent(seed[k] || ""));
  const p = await kit.openPage(site, rel === "home" ? "" : rel, {
    token: who && who !== "-" ? seed.tokens[who] : "",
    hash: hash && hash !== "-" ? hash : "",
    search,
  });
  await p.settle(25000);
  console.log("ошибки:", p.errors.length);
  p.errors.slice(0, 6).forEach((e) => console.log("   ", e.slice(0, 600)));
  console.log("запросы:", p.calls.map((c) => c.action + (c.ok ? "" : "!" + c.status + "(" + c.error.slice(0, 50) + ")")).join(" "));
  const main = p.main();
  console.log("main:", main.innerHTML.length, "симв.");
  console.log(p.text(main).slice(0, Number(process.env.SHOW || 1800)));
  if (process.env.HTML) console.log(main.innerHTML.slice(0, Number(process.env.HTML)));
  p.close();
  process.exit(0);
})().catch((e) => { console.log("СБОЙ:", e.stack || e); process.exit(2); });
