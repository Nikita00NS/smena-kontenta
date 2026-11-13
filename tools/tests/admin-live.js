/* Живая симуляция админки: настоящий PHP (php-wasm) + настоящие скрипты
   страницы в jsdom под аккаунтом директора. Показывает ровно то, что видит
   человек: какие разделы отрисовались, какие ошибки упали.
   Запуск: node tools/tests/admin-live.js */
const { PhpNode } = require("php-wasm/PhpNode");
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "..", "api");
const ROOT = path.resolve(__dirname, "..", "..");
let bad = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { bad++; console.log("  FAIL " + name + (extra === undefined ? "" : " → " + JSON.stringify(extra).slice(0, 300))); }
}

(async () => {
  const php = new PhpNode();
  php.refresh();
  let OUT = "";
  php.onoutput = (e) => { OUT += e && e.detail !== undefined ? String(e.detail) : String(e); };

  async function readText(p) {
    const v = await php.readFile(p);
    return Buffer.isBuffer(v) ? v.toString("utf8") : Buffer.from(v).toString("utf8");
  }
  for (const d of ["/site", "/site/api", "/site/api/lib", "/site/api/lib/fonts", "/site/assets", "/site/assets/js", "/smena-data"]) {
    try { await php.mkdir(d); } catch (e) {}
  }
  for (const lib of fs.readdirSync(SRC + "/lib")) {
    if (!lib.endsWith(".php")) continue;
    await php.writeFile("/site/api/lib/" + lib, fs.readFileSync(SRC + "/lib/" + lib));
  }
  for (const font of fs.readdirSync(SRC + "/lib/fonts")) {
    await php.writeFile("/site/api/lib/fonts/" + font, fs.readFileSync(SRC + "/lib/fonts/" + font));
  }
  await php.writeFile("/site/assets/js/map-data.js", fs.readFileSync(SRC + "/../assets/js/map-data.js"));
  const srcIndex = fs.readFileSync(SRC + "/index.php", "utf8")
    .replace("$raw = file_get_contents('php://input');",
      "$raw = file_exists(__DIR__ . '/body.json') ? (string) file_get_contents(__DIR__ . '/body.json') : '';")
    .replace(/readfile\(\$path\);/g, "/* media off in this sim */")
    .replace(`function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    data_unlock();
    exit;
}`, `function respond($data, $code = 200) {
    http_response_code($code);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    file_put_contents(__DIR__ . '/out.json', json_encode(array('__code' => $code, '__body' => $json)));
    data_unlock();
    exit;
}`);
  await php.writeFile("/site/api/index.php", srcIndex);
  const srcSmtp = fs.readFileSync(SRC + "/smtp.php", "utf8")
    .replace("function mail_send($to, $subject, $text, $html = '', $kind = '') {",
      "function mail_send($to, $subject, $text, $html = '', $kind = '') { return true;");
  await php.writeFile("/site/api/smtp.php", srcSmtp);
  await php.writeFile("/smena-data/mail.json", JSON.stringify({
    host: "smtp.example.ru", port: 465, secure: "ssl", user: "u@smenakontenta.ru",
    pass: "x", from: "kod@smenakontenta.ru", fromName: "Смена контента", notify: "",
  }));

  process.on("unhandledRejection", (e) => console.log("   unhandled:", String(e && e.message || e).slice(0, 160)));

  async function call(action, body) {
    body = body || {};
    try {
    await php.writeFile("/site/api/body.json", JSON.stringify(body));
    await php.writeFile("/site/api/driver.php",
      `<?php
      $_SERVER['REMOTE_ADDR'] = '203.0.113.9';
      $_SERVER['HTTP_USER_AGENT'] = 'smena-test';
      $_GET['action'] = ${JSON.stringify(action)};
      require '/site/api/index.php';
    `);
    try { await php.unlink("/site/api/out.json"); } catch (e) {}
    try { php.refresh(); await php.run("<?php require '/site/api/driver.php';"); }
    catch (e) { console.log("   run error:", String(e && e.message || e).slice(0, 200)); }
    for (let i = 0; i < 40; i++) {
      try {
        const box = JSON.parse((await readText("/site/api/out.json")).trim());
        return JSON.parse(box.__body);
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 25));
    }
    if (OUT.trim()) console.log("   php out:", OUT.slice(0, 400));
    OUT = "";
    return { ok: false, error: "сервер не ответил" };
    } catch (e) {
      return { ok: false, error: "call упал: " + String(e && e.message || e).slice(0, 120) };
    }
  }

  /* все запросы браузера — через одну очередь, как по сети по очереди */
  let chain = Promise.resolve();
  function callQ(action, body) {
    const p = chain.then(() => call(action, body));
    chain = p.catch(() => {});
    return p;
  }

  async function verifyAll() {
    let users = [];
    try { users = JSON.parse(await readText("/smena-data/users.json")); } catch (e) { return; }
    for (const u of users) { u.emailVerified = true; if (u.status === "pending_email") u.status = "active"; }
    await php.writeFile("/smena-data/users.json", JSON.stringify(users));
  }
  async function makeConfirm(token) {
    const me = await call("me", { token });
    const body = Buffer.from(JSON.stringify({
      "test-confirm": { user: me.user.id, exp: Math.floor(Date.now() / 1000) + 3600 },
    }));
    for (const dir of ["/smena-data", "/site/api/data"]) {
      try { await php.writeFile(dir + "/confirm-tokens.json", body); return "test-confirm"; } catch (e) {}
    }
    throw new Error("нет папки данных");
  }

  /* директор: регистрация → подтверждение → claim-director */
  let r = await call("reg", { name: "Директор Симуляции", email: "director@example.ru", pass: "parol1234", region: "moskva", role: "Директор" });
  check("директор зарегистрирован", r.ok === true, r);
  const token = r.token;
  await verifyAll();
  const confirm = await makeConfirm(token);
  r = await call("claim-director", { token, confirm });
  check("права директора выданы", r.ok === true && r.user.access === "Директор", r);
  const meR = await call("me", { token });
  const meUser = meR.user;

  /* чуть данных, чтобы панель не была пустой: согласие и пост на проверке */
  let users = JSON.parse(await readText("/smena-data/users.json"));
  users[0].role = "Директор";
  await php.writeFile("/smena-data/users.json", JSON.stringify(users));
  let consents = [];
  try { consents = JSON.parse(await readText("/smena-data/consents.json")); } catch (e) {}
  consents.push({ id: "consent_sim_1", userId: meUser.id, kind: "processing", status: "pending",
    name: meUser.name, email: meUser.email, scan: "", createdAt: new Date().toISOString(), history: [] });
  await php.writeFile("/smena-data/consents.json", JSON.stringify(consents));

  /* страница админки: настоящие скрипты, сеть — через php-wasm */
  function inline(html) {
    return html
      .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
      .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
        const file = path.join(ROOT, src.split("?")[0]);
        return fs.existsSync(file) ? "<script>\n" + fs.readFileSync(file, "utf8") + "\n</script>" : "";
      });
  }
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e.detail || e.message || e);
    if (!/Not implemented/i.test(msg)) errors.push(msg);
  });
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));
  const dom = new JSDOM(inline(fs.readFileSync(path.join(ROOT, "admin/index.html"), "utf8")), {
    url: "https://smenakontenta.ru/admin/",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("smena_lang", "ru");
      w.localStorage.setItem("smena_token_v1", token);
      w.localStorage.setItem("smena_user_v1", JSON.stringify(meUser));
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      w.URL.createObjectURL = () => "blob:mock";
      w.fetch = (url, opts) => {
        let body = {};
        try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
        return callQ(String(body.action || ""), body).then((data) => ({
          ok: true, status: 200, json: () => Promise.resolve(data),
        }), (err) => ({
          ok: false, status: 0, json: () => Promise.resolve({ ok: false, offline: true,
            error: "симуляция: " + String(err && (err.message || err.errno) || err) }),
        }));
      };
    },
  });

  await new Promise((res) => setTimeout(res, 12000));
  const doc = dom.window.document;
  const text = doc.body.textContent;

  check("нет ошибок скриптов", errors.length === 0, errors.slice(0, 3));
  check("экран «нужны права» НЕ показан", !doc.querySelector("[data-gate-list]"), "найден гейт");
  check("панель отрисована", !!doc.querySelector(".admin-layout"));
  const tabs = Array.from(doc.querySelectorAll("[data-admin-tab], .admin-tabs__btn"));
  check("разделов не меньше восьми", tabs.length >= 8, tabs.map((t) => t.textContent.trim()).join(","));
  check("раздел «Медиашкола» есть", tabs.some((t) => /Медиашкола/.test(t.textContent)));
  const peopleList = doc.querySelector('[data-panel="people"] [data-people-list]');
  check("список людей заполнен", !!peopleList && peopleList.children.length >= 1, peopleList && peopleList.children.length);
  const overview = doc.querySelector('[data-panel="overview"]');
  const tiles = overview ? overview.querySelectorAll("[data-overview-cards] > *") : [];
  check("пульт с плитками", tiles.length >= 4, tiles.length);
  check("очереди решений на пульте", !!overview && /Требуют решения/.test(overview.textContent));
  check("журнал действий отрисован", !!overview && !!overview.querySelector("[data-pulse-audit] .pulse-audit__row, [data-pulse-audit] .form__note"));
  check("изоляция сбоев: ни один раздел не показал ошибку", !doc.querySelector(".admin-broken"));
  check("очередь согласий видна (заявка ждёт)", !!doc.querySelector('[data-panel="people"]') && /Сирик|соглас/.test(doc.querySelector('[data-panel="people"]').textContent));
  const schoolPanel = doc.querySelector('[data-panel="school"]');
  check("раздел медиашколы отрисован", !!schoolPanel && schoolPanel.textContent.length > 100, schoolPanel && schoolPanel.textContent.slice(0, 100));
  check("на телефоне табы со скроллом (css)", (await Promise.resolve(fs.readFileSync(path.join(ROOT, "assets/css/site.css"), "utf8"))).includes("admin-tabs::-webkit-scrollbar"));

  dom.window.close();
  if (bad) {
    console.log("admin-live: проверка не пройдена");
    process.exit(1);
  }
  console.log("admin-live: всё отрисовалось");
})();
