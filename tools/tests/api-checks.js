/* Проверка прав и валидации API на настоящем PHP (php-wasm).

   Как запускать:
     npm i php-wasm            # один раз, из этой папки
     node api-checks.js        # из папки tools/tests

   Скрипт копирует api/ в виртуальную файловую систему PHP, подменяет
   php://input на body.json и respond() на запись в файл — так каждый запрос
   получает ответ детерминированно. Рабочие файлы сайта не меняются. */
/* Прогон api/index.php в php-wasm: проверяем права, роли и валидацию.
   Файлы копируются в виртуальную ФС, php://input подменён на body.json. */
const { PhpNode } = require("php-wasm/PhpNode");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "..", "api");
const WS = "/";

const php = new PhpNode();
php.refresh();
let OUT = "";
php.onoutput = (e) => { OUT += e && e.detail !== undefined ? String(e.detail) : String(e); };

async function readText(p) {
  const v = await php.readFile(p);
  return Buffer.isBuffer(v) ? v.toString("utf8") : Buffer.from(v).toString("utf8");
}

async function push(local, remote) {
  await php.writeFile(remote, fs.readFileSync(local));
}

/* Пропуск подтверждения: код приходит письмом, а в тестовой среде почты нет.
   Кладём готовый пропуск прямо в данные — сервер проверяет его так же, как
   выданный после кода. */
async function makeConfirm(token) {
  const me = await call("me", { token });
  const id = me && me.user ? me.user.id : "";
  const body = Buffer.from(JSON.stringify({
    "test-confirm": { user: id, exp: Math.floor(Date.now() / 1000) + 3600 },
  }));
  for (const dir of ["/smena-data", "/site/api/data"]) {
    try { await php.writeFile(dir + "/confirm-tokens.json", body); return "test-confirm"; } catch (e) {}
  }
  throw new Error("нет папки данных");
}

async function call(action, body) {
  body = body || {};
  try {
  await php.writeFile("/site/api/body.json", JSON.stringify(body));
  await php.writeFile(
    "/site/api/driver.php",
    `<?php
      $_SERVER['REMOTE_ADDR'] = '203.0.113.9';
      $_SERVER['HTTP_USER_AGENT'] = 'smena-test';
      $_GET['action'] = ${JSON.stringify(action)};
      require '/site/api/index.php';
    `
  );
  try { await php.unlink("/site/api/out.json"); } catch (e) {}
  try { php.refresh(); await php.run("<?php require '/site/api/driver.php';"); } catch (e) {}
  let raw = "";
  for (let i = 0; i < 40; i++) {
    try {
      const box = JSON.parse((await readText("/site/api/out.json")).trim());
      raw = box.__body;
      break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 25));
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { __raw: raw.slice(0, 600) };
  }
  } catch (err) {
    console.log("call failed:", action, err && (err.errno || err.message));
    return { ok: false, __error: String(err && (err.errno || err.message)) };
  }
}

async function readData(name) {
  try { return JSON.parse(await readText("/smena-data/" + name)); } catch (e) { return null; }
}
async function writeData(name, value) {
  await php.writeFile("/smena-data/" + name, JSON.stringify(value));
}

/* Медиа-маршруты не вызывают respond(): они отдают байлы и завершаются.
   Перехватываем вывод и код ответа через shutdown, чтобы проверить ACL. */
async function callMedia(action, id, cookie) {
  const driver = `<?php
    $_SERVER['REMOTE_ADDR'] = '203.0.113.9';
    $_SERVER['HTTP_USER_AGENT'] = 'smena-test';
    $_GET['action'] = ${JSON.stringify(action)};
    $_GET['id'] = ${JSON.stringify(id || "")};
    $_COOKIE['smena_docs'] = ${JSON.stringify(cookie || "")};
    require '/site/api/index.php';
  `;
  await php.writeFile("/site/api/driver-media.php", driver);
  try { await php.unlink("/site/api/media-out.json"); } catch (e) {}
  try { await php.unlink("/site/api/out.json"); } catch (e) {}
  try { php.refresh(); await php.run("<?php require '/site/api/driver-media.php';"); } catch (e) {}
  for (let i = 0; i < 40; i++) {
    try { return JSON.parse(await readText("/site/api/media-out.json")); } catch (e) {}
    try {
      const box = JSON.parse((await readText("/site/api/out.json")).trim());
      return { code: box.__code, headers: [], body: "" };
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 25));
  }
  return { code: 0, headers: [], body: "" };
}

function check(name, cond, extra) {
  console.log((cond ? "  ok   " : "  FAIL ") + name);
  let detail = "";
  if (!cond) {
    try { detail = JSON.stringify(extra === undefined ? null : extra).slice(0, 300); }
    catch (e) { detail = String(extra).slice(0, 300); }
  }
  results.push({ name, ok: !!cond, extra: detail });
}

const results = [];

(async () => {
 try {
  for (const d of ["/site", "/site/api", "/site/api/lib", "/site/api/lib/fonts", "/site/assets", "/site/assets/js", "/smena-data"]) {
    try { await php.mkdir(d); } catch (e) {}
  }
  /* копируем ВСЕ библиотеки: index.php подключает их все, и забытый файл
     даёт пустой ответ вместо ошибки (fatal error в wasm не печатается) */
  for (const lib of fs.readdirSync(SRC + "/lib")) {
    if (!lib.endsWith(".php")) continue;
    let libSrc = fs.readFileSync(SRC + "/lib/" + lib, "utf8");
    if (lib === "private-media.php") {
      libSrc = libSrc.replace(/readfile\(\$path\);/g,
        "file_put_contents('/site/api/media-out.json', json_encode(array('code' => (http_response_code() ?: 200), 'headers' => headers_list(), 'body' => base64_encode(file_get_contents($path)))));");
    }
    await php.writeFile("/site/api/lib/" + lib, libSrc);
  }
  /* Шрифты и метрики для PDF карты, а также карта регионов для названия региона. */
  for (const font of fs.readdirSync(SRC + "/lib/fonts")) {
    await php.writeFile("/site/api/lib/fonts/" + font, fs.readFileSync(SRC + "/lib/fonts/" + font));
  }
  await php.writeFile("/site/assets/js/map-data.js", fs.readFileSync(SRC + "/../assets/js/map-data.js"));
  const srcIndex = fs.readFileSync(SRC + "/index.php", "utf8")
    .replace("$raw = file_get_contents('php://input');",
      "$raw = file_exists(__DIR__ . '/body.json') ? (string) file_get_contents(__DIR__ . '/body.json') : '';")
    .replace(/readfile\(\$path\);/g,
      "file_put_contents(__DIR__ . '/media-out.json', json_encode(array('code' => (http_response_code() ?: 200), 'headers' => headers_list(), 'body' => base64_encode(file_get_contents($path)))));")
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

  /* Почта в тестах не ходит наружу: подменяем отправку заглушкой и говорим
     API, что SMTP настроен, — иначе регистрация закрыта (это и есть требование
     «без письма аккаунт не создаётся»). Проверяется именно логика, не сеть. */
  const srcSmtp = fs.readFileSync(SRC + "/smtp.php", "utf8")
    .replace("function mail_send($to, $subject, $text, $html = '', $kind = '') {",
      "function mail_send($to, $subject, $text, $html = '', $kind = '') { return true;");
  await php.writeFile("/site/api/smtp.php", srcSmtp);
  await php.writeFile("/smena-data/mail.json", JSON.stringify({
    host: "smtp.example.ru", port: 465, secure: "ssl", user: "u@smenakontenta.ru",
    pass: "x", from: "kod@smenakontenta.ru", fromName: "Смена контента", notify: "",
  }));

  /* Подтверждение почты: в тесте код не прочитать (в базе только хэш),
     поэтому сразу отмечаем адрес подтверждённым, как это сделал бы человек,
     введя код из письма. Проверка «без подтверждения нельзя» — отдельно ниже. */
  async function verifyAll() {
    let users = [];
    try { users = JSON.parse(await readText("/smena-data/users.json")); } catch (e) { return; }
    for (const u of users) { u.emailVerified = true; if (u.status === "pending_email") u.status = "active"; }
    await php.writeFile("/smena-data/users.json", JSON.stringify(users));
  }

  /* Только фикстура для старых сценариев: новые проверки ниже проходят
     весь путь consent-send → consent-review через маршруты API. */
  async function approveConsent(token) {
    const me = await call("me", { token });
    if (!me.user) throw new Error("Нет аккаунта для фикстуры согласия");
    let rows = [];
    try { rows = JSON.parse(await readText("/smena-data/consents.json")); } catch (e) {}
    rows = rows.filter((c) => c.userId !== me.user.id);
    for (const kind of ["processing", "distribution"]) {
      rows.push({ id: "consent_fixture_" + kind + "_" + me.user.id, userId: me.user.id, kind,
        status: "approved", name: me.user.name, email: me.user.email, scan: "",
        createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(), history: [] });
    }
    await php.writeFile("/smena-data/consents.json", JSON.stringify(rows));
  }

  // 1. диагностика закрыта
  let r = await call("diag", {});
  check("diag без пароля закрыт", r.ok === false && r.code === 404, r);
  r = await call("selftest", {});
  check("selftest без пароля закрыт", r.ok === false && r.code === 404, r); console.log("   selftest ->", JSON.stringify(r).slice(0,200));
  r = await call("selftest_full", {});
  check("selftest_full без пароля закрыт", r.ok === false, r); console.log("   full ->", JSON.stringify(r).slice(0,200));

  // пароль редакции создаётся сам — читаем из bootstrap-файла
  for (const d of ["/smena-data", "/site/api/data"]) {
    try { console.log("   files in", d, (await php.readdir(d)).join(",")); } catch (e) { console.log("   no dir", d, e.errno); }
  }
  let boot = ""; for (const f of ["/smena-data/BOOTSTRAP-PAROL.txt", "/site/api/data/BOOTSTRAP-PAROL.txt"]) { try { boot = await readText(f); break; } catch (e) {} }
  const m = boot.match(/\n\n(red-[0-9a-f]+)\n\n/);
  const editorPass = m ? m[1] : "";
  check("пароль редакции сгенерирован (не из кода)", editorPass.length > 10, boot.slice(0, 120));
  check("в коде нет стандартного пароля",
    !fs.readFileSync(path.join(SRC, "index.php"), "utf8").includes("password_hash(DEFAULT_EDITOR_PASSWORD"));

  r = await call("diag", { pass: editorPass });
  check("diag с паролем открыт", r.ok === true, r);
  check("diag сообщает про стандартный пароль", r.editor_default_password === false, r);

  // 2. регистрация: первый не становится директором
  r = await call("reg", { name: "Тест Первый", email: "first@example.ru", pass: "parol1234", region: "moskva", role: "Автор текстов" });
  check("регистрация прошла", r.ok === true, r); console.log("   reg ->", JSON.stringify(r).slice(0,300));
  check("первый аккаунт — Пользователь", r.user && r.user.access === "Пользователь", r.user);
  check("после регистрации аккаунт ждёт подтверждения почты", r.user && r.user.emailVerified === false, r.user);
  const token1 = r.token;

  /* регистрация без подтверждённой почты: действия закрыты */
  r = await call("submit", { token: token1, title: "Без подтверждения почты",
    excerpt: "Проверяем, что без подтверждения адреса материал не уходит в редакцию.",
    body: "Длинный текст материала для проверки запрета. ".repeat(8),
    authorName: "Тест Первый", authorKey: "test-author-key-1" });
  check("без подтверждения почты материал не отправить", r.ok === false && r.code === 403, r);
  await verifyAll();
  await approveConsent(token1);

  r = await call("reg", { name: "Короткий", email: "weak@example.ru", pass: "parol12" });
  check("пароль короче 8 не принимается", r.ok === false, r);

  // 3. выдача директора только по паролю редакции
  r = await call("claim-director", { token: token1 });
  check("claim-director без подтверждения — отказ", r.ok === false && r.code === 428 && r.needConfirm === true, r);
  const confirm1 = await makeConfirm(token1);
  r = await call("claim-director", { token: token1, confirm: confirm1 });
  check("claim-director после кода — директор", r.ok === true && r.user.access === "Директор", r);

  // 4. админские маршруты недоступны обычному пользователю
  r = await call("reg", { name: "Тест Второй", email: "second@example.ru", pass: "parol1234" });
  await verifyAll();
  const token2 = r.token;
  await approveConsent(token2);
  check("второй аккаунт — Пользователь", r.user && r.user.access === "Пользователь", r.user);
  r = await call("users", { token: token2 });
  check("список участников закрыт", r.ok === false && r.code === 403, r);
  r = await call("admin-log", { token: token2 });
  check("журнал закрыт для пользователя", r.ok === false && r.code === 403, r);
  r = await call("admin-log", { token: token1 });
  check("журнал открыт директору", r.ok === true && Array.isArray(r.entries), r);
  check("в журнале есть выдача директора",
    r.ok && r.entries.some((e) => e.action === "claim-director"), r.entries);

  // 5. подмена роли запросом из браузера не работает без директора
  r = await call("user-update", { token: token2, id: r.users ? "" : "", access: "Директор" });
  check("user-update закрыт", r.ok === false, r);

  // 6. сессии: смена пароля закрывает остальные
  r = await call("login", { email: "first@example.ru", pass: "parol1234" });
  const token3 = r.token;
  r = await call("change-password", { token: token3, old: "parol1234", new: "parol4321" });
  check("пароль изменён", r.ok === true, r);
  r = await call("me", { token: token1 });
  check("старая сессия закрыта", r.ok === false && r.code === 401, r);
  r = await call("me", { token: token3 });
  check("текущая сессия жива", r.ok === true, r);

  // 7. загрузка файлов: подпись проверяется
  const fakePng = "data:image/png;base64," + Buffer.from("<html>не картинка</html>").toString("base64");
  r = await call("media-upload", { token: token3, data: fakePng });
  check("поддельная картинка отклонена", r.ok === false, r);
  const realPng = "data:image/png;base64," + Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0,0,0,0]).toString("base64");
  r = await call("media-upload", { token: token3, data: realPng });
  check("настоящая картинка принята", r.ok === true && /action=media/.test(r.url || ""), r);

  // 8. почтовые настройки без пароля
  r = await call("mail-setup", { host: "evil.example", user: "a", pass_smtp: "b", from: "a@b.ru" });
  check("mail-setup без подтверждения закрыт", r.ok === false && (r.code === 401 || r.code === 428), r);

  // 9. редакционные очереди: только по коду из письма
  r = await call("queue", { password: "Redakcia-Smena-2026" });
  check("пароль редакции больше не открывает очередь", r.ok === false && r.code === 401, r);
  const confirm3 = await makeConfirm(token3);
  r = await call("queue", { token: token3, confirm: confirm3 });
  check("очередь открыта по подтверждению", r.ok === true, r);
  r = await call("queue", { token: token3 });
  check("очередь материалов видна без кода", r.ok === true, r);
  r = await call("review", { token: token3, id: "p_none", decision: "approve" });
  check("решение по материалу без кода не проходит", r.ok === false && r.code === 428, r);
  r = await call("card-queue", { token: token3 });
  check("заявки на карту видны без кода", r.ok === true, r);
  r = await call("card-review", { token: token3, id: "c_none", decision: "approve" });
  check("решение по карте без кода не проходит", r.ok === false && r.code === 428, r);

  // 9в. блок «Кто делает материалы» на главной
  r = await call("top-authors", {});
  check("список авторов на главной открыт всем", r.ok === true && Array.isArray(r.authors), r);
  r = await call("authors-show-save", { token: token2, mode: "points", limit: 5 });
  check("настройку авторов меняет только редакция", r.ok === false && r.code === 403, r);
  r = await call("authors-show-save", { token: token3, mode: "manual", ids: [] });
  check("пустой ручной список не сохраняется", r.ok === false, r);
  r = await call("authors-show-save", { token: token3, mode: "points", limit: 5 });
  check("редакция сохраняет настройку авторов", r.ok === true && r.limit === 5, r);

  // 9б. карта по должности: сотруднику не нужно пять опубликованных материалов
  r = await call("card-apply", { token: token3, delivery: "personal",
    fullName: "Никита Сирик", phone: "9000000000", agree: true });
  check("сотрудник подаёт заявку на карту без материалов", r.ok === true, r);
  check("заявка помечена «по должности»", r.ok && r.request && r.request.byRole === true, r.request);

  // 10. восстановление: нет утечки имени по чужой почте
  r = await call("recovery-request", { email: "first@example.ru", note: "не помню пароль совсем" });
  check("заявка на восстановление принята", r.ok === true, r);
  check("в ответе нет имени", r.request && r.request.name === undefined, r.request);

  // 11. баллы: журнал, права, баланс
  r = await call("points-rules", {});
  check("правила баллов читаются", r.ok === true && Array.isArray(r.rules.rules) && r.rules.rules.length > 5, r);
  r = await call("points-add", { token: token2, userId: "u_x", delta: 100 });
  check("пользователь не начисляет баллы", r.ok === false && r.code === 403, r);
  r = await call("points-add", { token: token3, userId: "u_x", delta: 100 });
  check("директор не может начислить неизвестному", r.ok === false && r.code === 404, r);

  r = await call("users", { token: token3 });
  const second = r.users.find((u) => u.email === "second@example.ru");
  check("список участников отдаёт баллы и активность",
    !!(second && typeof second.points === "number" && second.cardStatus === "none"), second);

  r = await call("points-add", { token: token3, userId: second.id, delta: 25, reason: "manual", note: "Помощь с редакцией" });
  check("начисление прошло", r.ok === true && r.balance === 25, r);
  r = await call("points-add", { token: token3, userId: second.id, delta: -5, reason: "manual" });
  check("списание без основания отклонено", r.ok === false, r);
  r = await call("points-add", { token: token3, userId: second.id, delta: -5, reason: "manual", note: "Ошибочное начисление" });
  check("списание с основанием прошло", r.ok === true && r.balance === 20, r);
  r = await call("points-add", { token: token3, userId: second.id, delta: 900 });
  check("слишком большая операция отклонена", r.ok === false, r);

  r = await call("points-history", { token: token2 });
  check("своя история баллов доступна", r.ok === true && r.balance === 20 && r.entries.length === 2, r);
  r = await call("points-leaderboard", {});
  check("рейтинг считает баллы",
    r.ok === true && r.leaders.length === 1 && r.leaders[0].points === 20 && r.leaders[0].email === undefined, r);

  // 12. заметки и приостановка аккаунта
  r = await call("person-note", { token: token2, userId: second.id, text: "заметка от себя" });
  check("пользователь не пишет заметки", r.ok === false && r.code === 403, r);
  r = await call("person-note", { token: token3, userId: second.id, text: "Просили помочь с вёрсткой" });
  check("директор пишет внутреннюю заметку", r.ok === true, r);
  r = await call("person-status", { token: token3, userId: second.id, status: "suspended" });
  check("приостановка требует причины", r.ok === false, r);
  r = await call("person-status", { token: token3, userId: second.id, status: "suspended", reason: "Спам в обращениях" });
  check("приостановка прошла", r.ok === true, r);
  r = await call("me", { token: token2 });
  check("приостановленный не проходит по токену", r.ok === false && (r.code === 401 || r.code === 403), r);
  r = await call("login", { email: "second@example.ru", pass: "parol1234" });
  check("приостановленный не входит", r.ok === false, r);
  r = await call("person-status", { token: token3, userId: second.id, status: "active", reason: "Разобрались" });
  check("восстановление прошло", r.ok === true, r);
  r = await call("login", { email: "second@example.ru", pass: "parol1234" });
  const token2b = r.token;
  check("после восстановления вход вернулся", r.ok === true && !!token2b, r);

  // 13. карточка участника: вкладки и хронология
  r = await call("user-card", { token: token3, id: second.id });
  check("карточка отдаёт баллы и хронологию",
    r.ok === true && r.points === 20 && Array.isArray(r.timeline) && r.timeline.length > 0, r && r.ok);
  check("в карточке есть заметки редакции", r.ok === true && r.notes.length === 1, r && r.notes);
  r = await call("user-card", { token: token2b, id: second.id });
  check("карточка закрыта обычному участнику", r.ok === false && r.code === 403, r);

  // 14. резервные копии
  r = await call("backup-now", { token: token2b });
  check("копии делает только редакция", r.ok === false && r.code === 403, r);
  r = await call("backup-now", { token: token3 });
  check("копия создаётся", r.ok === true && r.result.ok === true && r.copies.length >= 1, r);
  const backupDir = "/smena-data/backup/" + r.result.date;
  let backed = [];
  try { backed = await php.readdir(backupDir); } catch (e) {}
  check("в копии лежат данные аккаунтов", backed.indexOf("users.json") !== -1, backed);

  // 15. запрет на повышение выше себя
  r = await call("user-access", { token: token3, id: "u_missing", access: "Директор" });
  check("несуществующий участник не найден", r.ok === false && r.code === 404, r);

  // 16. support и state
  r = await call("state", {});
  check("state отвечает", r.ok === true && Array.isArray(r.posts), r);
  r = await call("support-send", { name: "Гость", email: "guest@example.ru", message: "Здравствуйте, вопрос по проекту" });
  check("обращение принимается", r.ok === true, r);

  // 17. ПОЧТА: ящики, доступ, шаблоны (без реальной сети — SMTP заглушён)
  r = await call("mailboxes", {});
  check("ящики без входа закрыты", r.ok === false && r.code === 401, r);
  r = await call("mailboxes", { token: token2b });
  check("ящики закрыты обычному участнику", r.ok === false && r.code === 403, r);
  r = await call("mailboxes", { token: token3 });
  check("администрация видит четыре ящика", r.ok === true && r.mailboxes.length === 4, r);
  check("адреса ящиков — на домене проекта",
    r.ok === true && r.mailboxes.every((b) => /@smenakontenta\.ru$/.test(b.address)), r.mailboxes);
  check("пароли ящиков не отдаются в браузер",
    r.ok === true && r.mailboxes.every((b) => b.pass === undefined && typeof b.hasPass === "boolean"), r.mailboxes);
  r = await call("mailboxes-save", { token: token3, box: { key: "nope", pass: "x" } });
  check("неизвестный ящик не сохраняется", r.ok === false && r.code === 404, r);
  r = await call("mail-list", { token: token3, key: "editorial" });
  check("неподключённый ящик не читается", r.ok === false && r.code === 409, r);
  r = await call("mail-send", { token: token3, key: "editorial", to: "a@example.ru", subject: "Т", text: "Текст" });
  check("письмо без подтверждения не уходит", r.ok === false && r.code === 428, r);
  r = await call("mail-send", { token: token3, key: "editorial", to: "a@example.ru", subject: "Т", text: "Текст", confirm: true });
  check("письмо из ненастроенного ящика не уходит", r.ok === false && r.code === 409, r);
  r = await call("mail-templates", { token: token3 });
  check("шаблоны писем доступны редакции", r.ok === true && r.templates.length >= 13, r && r.templates && r.templates.length);
  r = await call("mail-template-preview", { token: token3, key: "confirm_code" });
  check("предпросмотр шаблона собирает письмо", r.ok === true && /482913/.test(r.html) && /smenakontenta/.test(r.html), r);
  r = await call("mail-template-save", { token: token2b, key: "welcome", subject: "Взлом" });
  check("шаблоны меняет только администрация", r.ok === false && r.code === 403, r);
  r = await call("mail-log", { token: token2b });
  check("журнал писем закрыт участнику", r.ok === false && r.code === 403, r);
  r = await call("mail-log", { token: token3 });
  check("журнал писем ведётся", r.ok === true && Array.isArray(r.entries), r && r.entries && r.entries.length);

  // 18. ПРИЁМ В КОМАНДУ: заявка, тест, чек-лист, согласование
  r = await call("hiring-apply", { token: token2b, position: "Автор текстов", motivation: "Хочу писать про городские события." });
  check("заявка в команду подаётся", r.ok === true && r.application.stage === "test", r);
  r = await call("hiring-apply", { token: token2b, position: "Автор текстов", motivation: "Хочу писать про городские события." });
  check("вторая заявка не создаётся", r.ok === false && r.code === 409, r);
  r = await call("hiring-test", { token: token2b });
  check("тест выдаёт вопросы без ответов",
    r.ok === true && r.questions.length >= 8 && r.questions.every((q) => q.right === undefined), r);
  const wrongAnswers = {};
  r.questions.forEach((q) => { wrongAnswers[q.id] = q.options.length - 1; });
  r = await call("hiring-test-submit", { token: token2b, answers: wrongAnswers });
  check("проваленный тест не пускает дальше", r.ok === true && r.passed === false && r.stage === "test", r);
  const goodAnswers = {};
  r = await call("hiring-test", { token: token2b });
  r.questions.forEach((q) => { goodAnswers[q.id] = 0; });
  r = await call("hiring-test-submit", { token: token2b, answers: goodAnswers });
  check("сданный тест переводит на чек-лист", r.ok === true && r.passed === true && r.stage === "checklist", r);

  r = await call("hiring-list", { token: token2b });
  check("заявки видит только редакция", r.ok === false && r.code === 403, r);
  r = await call("hiring-list", { token: token3 });
  const myApp = r.ok ? r.applications.find((a) => a.userId === second.id) : null;
  check("редакция видит заявку", !!myApp, r);
  r = await call("hiring-decide", { token: token3, id: myApp.id, decision: "approve" });
  check("принять без чек-листа нельзя", r.ok === false && r.code === 409 && /чек-лист/i.test(r.error), r);

  const items = myApp.checklist.map((c) => c.key);
  for (const key of items) {
    await call("hiring-checklist", { token: token3, id: myApp.id, key, ok: true });
  }
  r = await call("hiring-decide", { token: token3, id: myApp.id, decision: "approve" });
  check("после чек-листа приём проходит", r.ok === true && r.application.stage === "approved", r);
  r = await call("user-card", { token: token3, id: second.id });
  check("принятый стал сотрудником", r.ok === true && r.user && r.user.access === "Сотрудник", r && r.user);

  r = await call("hiring-decide", { token: token3, id: myApp.id, decision: "reject", note: "" });
  check("отказ без причины не принимается", r.ok === false, r);

  r = await call("admin-log", { token: token3 });
  check("в журнале есть приём в команду",
    r.ok === true && r.entries.some((e) => /приём в команду/.test(e.action || "")), r && r.entries && r.entries[0]);

  // 19. ЗАДАЧИ: сотрудник видит свои, ставит только руководство
  r = await call("tasks-mine", { token: token2b });
  check("свои задачи открываются", r.ok === true && Array.isArray(r.tasks) && r.tasks.length === 0, r);
  r = await call("tasks-create", { token: token2b, title: "Сделать подборку", assignee: second.id });
  check("поставить задачу может только руководство", r.ok === false && r.code === 403, r);
  r = await call("tasks-create", { token: token3, title: "Подготовить подборку про театры", assignee: second.id, due: "2026-12-01", priority: "high" });
  check("руководство ставит задачу человеку", r.ok === true && r.task.status === "new", r);
  const taskId = r.ok ? r.task.id : "";
  r = await call("tasks-create", { token: token3, title: "Коротко" });
  check("задача без названия не создаётся", r.ok === false, r);
  r = await call("tasks-mine", { token: token2b });
  check("исполнитель видит свою задачу", r.ok === true && r.tasks.length === 1 && r.tasks[0].id === taskId, r);
  r = await call("tasks-update", { token: token2b, id: taskId, status: "in_work" });
  check("исполнитель меняет статус", r.ok === true && r.task.status === "in_work", r);
  r = await call("tasks-comment", { token: token2b, id: taskId, text: "Взял в работу, сроки понятны" });
  check("комментарий к задаче сохраняется", r.ok === true && r.task.comments.length === 1, r);
  r = await call("tasks-update", { token: token2b, id: taskId, title: "Переименовать" });
  check("исполнитель не переименовывает задачу", r.ok === true && r.task.title !== "Переименовать", r);
  r = await call("tasks-list", { token: token3 });
  check("редакция видит все задачи", r.ok === true && r.tasks.some((t) => t.id === taskId), r);

  // 21. ИИ-ПОМОЩНИК и ЯЩИКИ
  r = await call("ai-status", { token: token2b });
  check("помощник закрыт обычному участнику", r.ok === false && r.code === 403, r);
  r = await call("ai-status", { token: token3 });
  check("помощник отдаёт задания и состояние", r.ok === true && r.ai.hasKey === false && r.tasks.improve, r);
  r = await call("ai-save", { token: token2b, provider: "gemini" });
  check("ключ помощника меняет только администрация", r.ok === false && r.code === 403, r);
  r = await call("ai-save", { token: token3, provider: "gemini", key: "test-key-not-real" });
  check("ключ помощника сохраняется", r.ok === true && r.ai.hasKey === true, r);
  r = await call("ai-assist", { token: token3, task: "improve", text: "текст письма" });
  check("без настоящего ключа помощник честно падает",
    r.ok === false && (r.code === 502 || r.code === 409), r);

  r = await call("mailboxes-smtp-test", { token: token2b, key: "editorial" });
  check("проверка отправки закрыта участнику", r.ok === false && r.code === 403, r);
  r = await call("mailboxes-smtp-test", { token: token3, key: "editorial" });
  check("без пароля ящика отправку не проверить", r.ok === false && r.code === 409, r);

  // 22. ВЫДАЧА АДМИНКИ БЕЗ ПАРОЛЯ РЕДАКЦИИ
  r = await call("boss-grant", { token: token2b, email: "boss@example.ru" });
  check("участник не выдаёт доступ", r.ok === false && r.code === 403, r);
  r = await call("boss-grant", { token: token3, email: "boss@example.ru", access: "Главный администратор" });
  check("директор выдаёт доступ по почте", r.ok === true && r.access === "Главный администратор", r);
  check("для нового человека аккаунт создаётся", r.ok === true && r.created === true, r);

  // 23. ВХОД ПО КОДУ (вместо пароля редакции)
  r = await call("reg", { name: "Двухфакторный Тест", email: "twofa@example.ru", pass: "parol1234" });
  await verifyAll();
  const token4 = r.token;
  r = await call("twofa-enable", { token: token4, pass: "parol1234" });
  check("вход по коду включается паролем", r.ok === true && r.twofa === true, r);
  r = await call("login", { email: "twofa@example.ru", pass: "parol1234" });
  check("вход просит код из письма", r.ok === true && r.needCode === true, r);
  r = await call("login-2fa", { email: "twofa@example.ru", code: "000000" });
  check("неверный код не пускает", r.ok === false && r.code === 403, r);
  r = await call("twofa-disable", { token: token4, pass: "parol1234" });
  check("вход по коду выключается паролем", r.ok === true && r.twofa === false, r);
  r = await call("login", { email: "twofa@example.ru", pass: "parol1234" });
  check("после выключения вход обычный", r.ok === true && !!r.token, r);

  // 20. УДАЛЕНИЕ АККАУНТА из кабинета
  r = await call("account-delete", { token: token2b, pass: "неверный", confirm: "УДАЛИТЬ" });
  check("удаление без пароля не проходит", r.ok === false && r.code === 403, r);
  r = await call("account-delete", { token: token2b, pass: "parol1234", confirm: "нет" });
  check("удаление без слова-подтверждения не проходит", r.ok === false && r.code === 400, r);
  r = await call("account-delete", { token: token2b, pass: "parol1234", confirm: "УДАЛИТЬ" });
  check("аккаунт удаляется по паролю и слову", r.ok === true && r.deleted === true, r);
  r = await call("login", { email: "second@example.ru", pass: "parol1234" });
  check("после удаления войти нельзя", r.ok === false, r);
  r = await call("me", { token: token2b });
  check("после удаления токен не работает", r.ok === false && (r.code === 401 || r.code === 403), r);
  let rawUsers = [];
  try { rawUsers = JSON.parse(await readText("/smena-data/users.json")); } catch (e) {}
  const ghost = rawUsers.find((u) => u.id === second.id);
  check("в системе осталась обезличенная запись",
    !!ghost && ghost.email === "" && /Удал/.test(ghost.name) && ghost.status === "deleted", ghost);


  // 24. ЭТАП 1: согласие, личные документы, идемпотентность, роли, журнал, копии
  const crypto = require("node:crypto");
  const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
  const confirmD = await makeConfirm(token3);
  const directorMe = await call("me", { token: token3 });
  const directorId = directorMe.user.id;

  r = await call("reg", { name: "Этап Автор", email: "stage-author@example.ru", pass: "parol1234", region: "moskva" });
  check("этап 1: автор зарегистрирован", r.ok === true, r);
  const tokenA = r.token;
  await verifyAll();
  const meA = await call("me", { token: tokenA });
  const authorId = meA.user.id;

  const article = {
    token: tokenA, requestId: "stage1-submit-0001", authorKey: "stage-author-key",
    title: "Проверка надёжной отправки материала",
    excerpt: "Описание достаточно длинное для проверки серверной валидации.",
    body: "Текст материала для проверки идемпотентности. ".repeat(12),
    topic: "Проверка", format: "Статья", region: "moskva",
  };
  r = await call("submit", Object.assign({}, article, { token: "" }));
  check("этап 1: отправка без входа закрыта", r.ok === false && r.code === 401, r);
  r = await call("submit", article);
  check("этап 1: без согласия материал не отправляется", r.ok === false && r.code === 403 && r.needConsent === true, r);
  r = await call("media-upload", { token: tokenA, data: realPng });
  check("этап 1: без согласия файл не загружается", r.ok === false && r.needConsent === true, r);
  r = await call("card-apply", { token: tokenA, delivery: "personal", fullName: "Этап Автор", phone: "9000000000", agree: true });
  check("этап 1: без согласия заявка на карту закрыта", r.ok === false && r.needConsent === true, r);
  r = await call("portfolio-send", { token: tokenA, title: "Работа без согласия", about: "Описание работы достаточно длинное для проверки.", files: [realPng] });
  check("этап 1: без согласия портфолио закрыто", r.ok === false && r.needConsent === true, r);
  r = await call("hiring-apply", { token: tokenA, position: "Автор текстов", motivation: "Хочу писать про городские события." });
  check("этап 1: без согласия приём в команду закрыт", r.ok === false && r.needConsent === true, r);

  r = await call("consent-send", { token: tokenA, scan: fakePng });
  check("этап 1: поддельный скан согласия отклонён", r.ok === false, r);
  r = await call("consent-send", { token: tokenA, scan: realPng });
  check("этап 1: скан согласия принят и закрыт ссылкой", r.ok === true && /action=private-media/.test(r.consent.scan), r);
  const consentId = r.ok ? r.consent.id : "";
  r = await call("consent-status", { token: tokenA });
  check("этап 1: владелец видит свой скан", r.ok === true && !!r.consent.scan, r);
  r = await call("user-card", { token: token3, id: authorId });
  check("этап 1: ответственная редакция видит скан в карточке", r.ok === true && r.consents.length === 1 && !!r.consents[0].scan, r);
  r = await call("consent-queue", { token: token4 });
  check("этап 1: очередь согласий закрыта постороннему", r.ok === false && r.code === 403, r);
  r = await call("consent-queue", { token: token3 });
  check("этап 1: очередь согласий открыта ответственной роли", r.ok === true && r.consents.some((c) => c.id === consentId && !!c.scan), r);
  r = await call("consent-review", { token: token3, id: consentId, decision: "approved" });
  check("этап 1: решение по согласию требует код", r.ok === false && r.code === 428, r);
  r = await call("consent-review", { token: token3, confirm: confirmD, id: consentId, decision: "approved" });
  check("этап 1: согласие принято по коду", r.ok === true, r);
  r = await call("consent-review", { token: token3, confirm: confirmD, id: consentId, decision: "approved" });
  check("этап 1: повторное решение по согласию идемпотентно", r.ok === true && r.replayed === true, r);

  /* Второй документ: имя автора и его работа видны всем на сайте, поэтому
     нужно и согласие на распространение. Прогоняем его через те же маршруты. */
  r = await call("submit", Object.assign({}, article, { requestId: "stage1-submit-spread", title: "Проверка второго согласия" }));
  check("этап 3: без согласия на распространение материал не публикуется",
    r.ok === false && r.code === 403 && r.needConsent === true && r.consentKind === "distribution", r);
  r = await call("consent-send", { token: tokenA, scan: realPng, kind: "distribution" });
  const spreadId = r.ok && r.consent ? r.consent.id : "";
  check("этап 3: второй документ загружен отдельной заявкой",
    r.ok === true && r.consent.kind === "distribution" && spreadId !== consentId, r);
  r = await call("consent-review", { token: token3, confirm: confirmD, id: spreadId, decision: "approved" });
  check("этап 3: второй документ принят редакцией", r.ok === true, r);

  // ACL личного документа: сессия владельца и постороннего
  const privateId = (r0) => { const m = String(r0 || "").match(/[?&]id=([a-f0-9]{40})/); return m ? m[1] : ""; };
  const consentNow = await call("consent-status", { token: tokenA });
  const docId = privateId(consentNow.consent.scan);
  const rawA = "a".repeat(64), rawB = "b".repeat(64);
  await writeData("media-sessions.json", {
    [sha256(rawA)]: { userId: authorId, tokenHash: sha256(tokenA), exp: Math.floor(Date.now() / 1000) + 3600 },
    [sha256(rawB)]: { userId: (await call("me", { token: token4 })).user.id, tokenHash: sha256(token4), exp: Math.floor(Date.now() / 1000) + 3600 },
  });
  let media = await callMedia("private-media", docId, "");
  check("этап 1: личный документ без cookie закрыт", media.code === 401, media);
  media = await callMedia("private-media", docId, rawB);
  check("этап 1: чужой личный документ запрещён", media.code === 403, media);
  media = await callMedia("private-media", docId, rawA);
  check("этап 1: владелец открывает свой документ", media.code === 200 && media.body.length > 0, media);
  check("этап 1: личный документ отдаётся без публичного кэша",
    media.headers.some((h) => /cache-control:\s*private,\s*no-store/i.test(h)), media.headers);

  // Перенос старого pd_ файла: ссылка переписана, публичный маршрут закрыт
  const pngBytes = Buffer.from(realPng.split(",")[1], "base64");
  await php.writeFile("/smena-data/uploads/pd_stage1.png", pngBytes);
  let consents = await readData("consents.json");
  consents = consents.map((c) => c.userId === authorId ? Object.assign({}, c, { scan: "/api/index.php?action=media&id=pd_stage1.png" }) : c);
  await writeData("consents.json", consents);
  try { await php.unlink("/smena-data/private-media-migrated-v1.json"); } catch (e) {}
  r = await call("consent-status", { token: tokenA });
  check("этап 1: старая ссылка перенесена в закрытое хранилище", r.ok === true && /action=private-media/.test(r.consent.scan), r);
  media = await callMedia("media", "pd_stage1.png", "");
  check("этап 1: старый публичный адрес личного файла закрыт", media.code === 401, media);
  media = await callMedia("media", "pd_stage1.png", rawA);
  check("этап 1: старый адрес доступен владельцу через проверку", media.code === 200, media);
  const privateIndex = await readData("private-media.json");
  check("этап 1: перенос не создаёт дубль при повторе",
    Object.values(privateIndex).filter((x) => x.legacyName === "pd_stage1.png").length === 1, privateIndex);

  // Идемпотентность отправки и проверки
  r = await call("submit", article);
  check("этап 1: материал отправлен в очередь", r.ok === true && r.direct === false && r.post.status === "pending", r);
  const postId = r.ok ? r.post.id : "";
  r = await call("submit", article);
  check("этап 1: повтор той же отправки не создаёт дубль", r.ok === true && r.replayed === true && r.post.id === postId, r);
  r = await call("submit", Object.assign({}, article, { body: article.body + " Другой текст." }));
  check("этап 1: тот же ключ с другим текстом отклонён", r.ok === false && r.code === 409, r);
  r = await call("submit", Object.assign({}, article, { requestId: "stage1-submit-0002" }));
  check("этап 1: новый ключ создаёт новый материал", r.ok === true && r.post.id !== postId, r);
  const postId2 = r.ok ? r.post.id : "";
  r = await call("review", { token: token3, confirm: confirmD, id: postId, decision: "approve" });
  check("этап 1: материал опубликован решением редакции", r.ok === true && r.post.status === "published", r);
  r = await call("points-history", { token: tokenA });
  const balanceAfterPost = r.ok ? r.balance : -1;
  check("этап 1: за публикацию начислены баллы по правилу", r.ok === true && r.balance === 10, r);
  r = await call("review", { token: token3, confirm: confirmD, id: postId, decision: "approve" });
  check("этап 1: повторное одобрение идемпотентно", r.ok === true && r.replayed === true, r);
  r = await call("points-history", { token: tokenA });
  check("этап 1: повторное одобрение не удваивает баллы", r.ok === true && r.balance === balanceAfterPost, r);
  r = await call("review", { token: token3, confirm: confirmD, id: postId2, decision: "reject", note: "Нужны правки" });
  check("этап 1: отказ сохраняется", r.ok === true && r.post.status === "rejected", r);

  // Портфолио: решение и баллы пишутся один раз
  r = await call("portfolio-send", { token: tokenA, title: "Работа для проверки этапа", about: "Описание работы достаточно длинное для проверки сервера.", files: [realPng] });
  check("этап 1: портфолио отправлено", r.ok === true, r);
  const pfId = r.ok ? r.item.id : "";
  r = await call("portfolio-queue", { token: token3 });
  check("этап 1: очередь портфолио показывает вложения ответственной роли",
    r.ok === true && r.items.some((x) => x.id === pfId && x.files.length > 0), r);
  r = await call("portfolio-decide", { token: token3, confirm: confirmD, id: pfId, decision: "approved", points: 7 });
  check("этап 1: портфолио принято с баллами", r.ok === true && r.points === 7, r);
  r = await call("portfolio-decide", { token: token3, confirm: confirmD, id: pfId, decision: "approved", points: 7 });
  check("этап 1: повторное решение по портфолио идемпотентно", r.ok === true && r.replayed === true, r);
  r = await call("points-history", { token: tokenA });
  check("этап 1: баллы портфолио в журнале один раз",
    r.ok === true && r.balance === balanceAfterPost + 7 && r.entries.filter((e) => e.ref === "portfolio:" + pfId).length === 1, r);

  // Карта по должности: согласие, решение, баллы, повтор
  r = await call("user-access", { token: token3, id: authorId, access: "Сотрудник" });
  check("этап 1: роль сотрудника выдана", r.ok === true, r);
  r = await call("card-apply", { token: tokenA, delivery: "personal", fullName: "Этап Автор", phone: "9000000000", agree: true });
  check("этап 1: сотрудник подаёт заявку на карту", r.ok === true && r.request.byRole === true, r);
  const cardId = r.ok ? r.request.id : "";
  r = await call("card-review", { token: token3, confirm: confirmD, id: cardId, decision: "approve", place: "Москва" });
  check("этап 1: карта выдана решением редакции", r.ok === true && r.request.status === "issued", r);
  r = await call("card-review", { token: token3, confirm: confirmD, id: cardId, decision: "approve", place: "Москва" });
  check("этап 1: повторная выдача карты идемпотентна", r.ok === true && r.replayed === true, r);
  r = await call("points-history", { token: tokenA });
  check("этап 1: баллы за карту начислены один раз",
    r.ok === true && r.entries.filter((e) => e.ref === "card:" + cardId).length === 1, r);

  // Роли: подтверждение почты нельзя подделать, последнего директора не снять
  r = await call("reg", { name: "Неподтверждённый", email: "stage-unverified@example.ru", pass: "parol1234" });
  const tokenC = r.token;
  const meC = await call("me", { token: tokenC });
  const unverifiedId = meC.user.id;
  let usersRaw = await readData("users.json");
  usersRaw = usersRaw.map((u) => u.id === unverifiedId ? Object.assign({}, u, { emailVerified: false, status: "pending_email" }) : u);
  await writeData("users.json", usersRaw);
  r = await call("user-update", { token: token3, id: unverifiedId, emailVerified: true, name: "Неподтверждённый" });
  check("этап 1: профиль не может включить подтверждение почты", r.ok === true && r.user.emailVerified === false, r);
  r = await call("grant-admin", { token: token3, confirm: confirmD, email: "stage-unverified@example.ru", access: "Администратор" });
  check("этап 1: роль не выдаётся неподтверждённому аккаунту", r.ok === false && r.code === 403, r);
  r = await call("user-access", { token: token3, id: directorId, access: "Администрация" });
  check("этап 1: последнего директора нельзя понизить", r.ok === false && r.code === 409, r);
  r = await call("person-status", { token: token3, userId: directorId, status: "suspended", reason: "Проверка защиты" });
  check("этап 1: последнего директора нельзя приостановить", r.ok === false && r.code === 409, r);

  r = await call("reg", { name: "Технический Админ", email: "stage-tech@example.ru", pass: "parol1234" });
  const tokenT = r.token;
  await verifyAll();
  const meT = await call("me", { token: tokenT });
  r = await call("user-access", { token: token3, id: meT.user.id, access: "Технический администратор" });
  check("этап 1: техническая роль выдана", r.ok === true, r);
  r = await call("users", { token: tokenT });
  check("этап 1: технический администратор видит участников", r.ok === true, r);
  r = await call("user-access", { token: tokenT, id: authorId, access: "Сотрудник" });
  check("этап 1: технический администратор не меняет роли", r.ok === false && r.code === 403, r);
  r = await call("consent-queue", { token: tokenT });
  check("этап 1: технический администратор не видит личные согласия", r.ok === false && r.code === 403, r);
  r = await call("mailboxes", { token: tokenT });
  check("этап 1: технический администратор управляет почтой", r.ok === true, r);

  // Журнал баллов не обрезается: старые записи и баланс не теряются
  let points = await readData("points.json") || [];
  const archive = [];
  for (let i = 0; i < 20001; i++) archive.push({ id: "pt_archive_" + i, userId: "u_archive_stage1", delta: 1, reason: "manual", note: "", by: "test", ref: "", at: "2026-01-01T00:00:00+00:00", balanceAfter: i + 1 });
  await writeData("points.json", points.concat(archive));
  r = await call("points-add", { token: token3, userId: authorId, delta: 1, reason: "manual", note: "Проверка сохранения журнала" });
  check("этап 1: новая операция записана", r.ok === true, r);
  points = await readData("points.json");
  check("этап 1: журнал больше 20000 записей не обрезается",
    points.filter((x) => x.userId === "u_archive_stage1").length === 20001, points.length);

  // Резервная копия проверяется и включает личные документы
  r = await call("backup-now", { token: token3 });
  check("этап 1: копия создана и проверена", r.ok === true && r.result.ok === true && r.result.verified === true, r);
  const backupDate = r.ok ? r.result.date : "";
  const manifest = await readData("backup/" + backupDate + "/manifest.json");
  check("этап 1: манифест копии содержит контрольные суммы",
    !!manifest && !!manifest.files && Object.keys(manifest.files).length > 0, manifest);
  check("этап 1: личные документы входят в копию",
    !!manifest && Object.keys(manifest.files).some((n) => n.indexOf("private/") === 0), manifest && Object.keys(manifest.files));
  r = await call("backups", { token: token3 });
  check("этап 1: список копий показывает проверенную копию",
    r.ok === true && r.copies.some((c) => c.date === backupDate && c.verified === true), r);

  // Атомарная запись: после операций не остаётся временных файлов
  r = await call("points-add", { token: token3, userId: authorId, delta: 1, reason: "manual", note: "Проверка атомарной записи" });
  check("этап 1: операция после большой истории записана", r.ok === true, r);
  let rootFiles = [];
  try { rootFiles = await php.readdir("/smena-data"); } catch (e) {}
  check("этап 1: временные файлы записи не остаются в хранилище",
    rootFiles.every((n) => !/\.tmp$/.test(n)), rootFiles);

  // ============================================================ ЭТАП 2
  // Кабинет и админка: единый серверный статус карты, жизненный цикл,
  // рабочие очереди и удаление своих материалов.

  r = await call("card-status", { authorKey: "stage-author-key" });
  check("этап 2: статус карты требует вход, а не локальный ключ", r.ok === false && r.code === 401, r);
  r = await call("card-status", { token: tokenA });
  check("этап 2: кабинет получает серверный статус и срок карты",
    r.ok === true && r.current && r.current.status === "issued" && !!r.current.validUntil && r.canApply === false, r);
  const issuedCardId = r.ok && r.current ? r.current.id : cardId;

  // Срок истёк — статус выводится сервером, новая заявка снова возможна
  let cardsRaw = await readData("cards.json");
  cardsRaw[issuedCardId].validUntil = "2020-01-01T00:00:00+00:00";
  await writeData("cards.json", cardsRaw);
  r = await call("card-status", { token: tokenA });
  check("этап 2: истёкший срок даёт статус expired", r.ok === true && r.current.status === "expired" && r.canApply === true, r);
  r = await call("users", { token: token3 });
  const authorRow2 = r.ok ? r.users.find((u) => u.id === authorId) : null;
  check("этап 2: список участников видит истёкшую карту", !!authorRow2 && authorRow2.cardStatus === "expired", authorRow2);

  r = await call("card-extend", { token: tokenA, id: issuedCardId, months: 6 });
  check("этап 2: продление закрыто автору", r.ok === false && r.code === 403, r);
  r = await call("card-extend", { token: token3, id: issuedCardId, months: 6 });
  check("этап 2: продление требует подтверждение", r.ok === false && r.code === 428, r);
  r = await call("card-extend", { token: token3, confirm: confirmD, id: issuedCardId, months: 0 });
  check("этап 2: неверный срок продления отклонён", r.ok === false, r);
  r = await call("card-extend", { token: token3, confirm: confirmD, id: issuedCardId, months: 6, note: "Продление редакцией" });
  check("этап 2: продление возвращает карту в действие", r.ok === true && r.request.status === "issued" && Date.parse(r.request.validUntil) > Date.now(), r);
  const extendedUntil = r.ok ? r.request.validUntil : "";
  r = await call("card-extend", { token: token3, confirm: confirmD, id: issuedCardId, months: 6, note: "Продление редакцией" });
  check("этап 2: повторное продление не ломает статус", r.ok === true && r.request.status === "issued", r);

  r = await call("card-revoke", { token: token3, confirm: confirmD, id: issuedCardId, note: "" });
  check("этап 2: отзыв без основания отклонён", r.ok === false, r);
  r = await call("card-revoke", { token: token3, id: issuedCardId, note: "Нарушение правил проекта" });
  check("этап 2: отзыв требует подтверждение", r.ok === false && r.code === 428, r);
  r = await call("card-revoke", { token: token3, confirm: confirmD, id: issuedCardId, note: "Нарушение правил проекта" });
  check("этап 2: отзыв сохраняет основание и историю", r.ok === true && r.request.status === "revoked" && r.request.history.some((h) => h.decision === "revoked"), r);
  r = await call("card-revoke", { token: token3, confirm: confirmD, id: issuedCardId, note: "Нарушение правил проекта" });
  check("этап 2: повторный отзыв идемпотентен", r.ok === true && r.replayed === true, r);
  r = await call("card-extend", { token: token3, confirm: confirmD, id: issuedCardId, months: 6 });
  check("этап 2: отозванную карту нельзя продлить", r.ok === false && r.code === 409, r);
  r = await call("card-status", { token: tokenA });
  check("этап 2: после отзыва можно подать новую заявку", r.ok === true && r.current.status === "revoked" && r.canApply === true, r);

  // Ручная выдача: номер, срок, запрет дубля
  r = await call("card-grant", { token: token3, confirm: confirmD, id: authorId });
  check("этап 2: ручная выдача создаёт карту со сроком", r.ok === true && r.request && r.request.status === "issued" && !!r.request.validUntil, r);
  const grantedId = r.ok && r.request ? r.request.id : "";
  r = await call("card-grant", { token: token3, confirm: confirmD, id: authorId });
  check("этап 2: вторая действующая карта не выдаётся", r.ok === false && r.code === 409, r);
  r = await call("card-apply", { token: tokenA, delivery: "personal", fullName: "Этап Автор", phone: "9000000000", agree: true });
  check("этап 2: заявка при действующей карте закрыта", r.ok === false && r.code === 409, r);

  // Материалы: возврат с замечанием, удаление своего черновика/очереди
  r = await call("submit", Object.assign({}, article, { token: tokenA, requestId: "stage2-submit-0001", title: "Материал для возврата etapa 2" }));
  check("этап 2: материал отправлен в очередь", r.ok === true && r.post.status === "pending", r);
  const reviewId = r.ok ? r.post.id : "";
  r = await call("review", { token: token3, confirm: confirmD, id: reviewId, decision: "reject", note: "" });
  check("этап 2: возврат без замечания отклонён", r.ok === false, r);
  r = await call("review", { token: token3, confirm: confirmD, id: reviewId, decision: "reject", note: "Добавьте источник фотографии" });
  check("этап 2: возврат сохраняет замечание", r.ok === true && r.post.status === "rejected" && r.post.reviewNote.length > 5, r);
  r = await call("post-delete", { token: tokenC, id: reviewId });
  check("этап 2: чужой материал удалить нельзя", r.ok === false && (r.code === 403 || r.code === 401), r);
  r = await call("post-delete", { token: tokenA, id: reviewId });
  check("этап 2: автор удаляет свой материал с сервера", r.ok === true, r);
  r = await call("post-delete", { token: tokenA, id: postId });
  check("этап 2: опубликованный материал автор сам не снимает", r.ok === false && r.code === 409, r);

  // Очереди админки уважают полномочия
  r = await call("card-queue", { token: tokenT });
  check("этап 2: технический администратор не видит очередь карт", r.ok === false && r.code === 403, r);
  r = await call("card-queue", { token: token3 });
  check("этап 2: очередь карт отдаёт публичные поля и срок", r.ok === true && r.requests.every((c) => c.authorKey === undefined && c.validUntil !== undefined), r);
  r = await call("points-history", { token: tokenA });
  check("этап 2: журнал баллов доступен владельцу", r.ok === true && typeof r.balance === "number" && Array.isArray(r.entries), r);
  r = await call("editorial-mine", { token: tokenA });
  check("этап 2: кабинет получает членство в редакции с сервера", r.ok === true && "membership" in r, r);

  // ============================================================ ЭТАП 3
  // Два отдельных документа: обработка данных — условие работы на сайте,
  // распространение данных — только для конкурсов в открытых площадках.

  r = await call("consent-status", { token: tokenA });
  check("этап 3: кабинет получает оба статуса сразу",
    r.ok === true && r.consent && r.consent.kind === "processing" &&
    r.distribution && r.distribution.kind === "distribution", r);

  r = await call("consent-send", { token: tokenA, scan: realPng, kind: "distribution", purpose: "Конкурс «Мой город»" });
  check("этап 3: согласие на распространение — отдельная запись",
    r.ok === true && r.consent.kind === "distribution" && r.consent.status === "pending" &&
    r.consent.purpose === "Конкурс «Мой город»", r);
  const distId = r.ok && r.consent ? r.consent.id : "";
  check("этап 3: повторная загрузка не создаёт второй записи того же вида", distId === spreadId, { distId, spreadId });

  r = await call("consent-status", { token: tokenA });
  check("этап 3: обработка осталась принятой, распространение на проверке",
    r.ok === true && r.consent.status === "approved" && r.distribution.status === "pending", r);

  r = await call("consent-send", { token: tokenA, scan: realPng, kind: "distribution", purpose: "Конкурс «Мой двор»" });
  check("этап 3: повторная загрузка заменяет свой документ",
    r.ok === true && r.consent.id === distId && r.consent.purpose === "Конкурс «Мой двор»", r);

  r = await call("consent-queue", { token: token3, confirm: confirmD, kind: "distribution" });
  check("этап 3: очередь фильтруется по виду документа",
    r.ok === true && r.consents.length > 0 && r.consents.every((c) => c.kind === "distribution"), r);
  r = await call("consent-queue", { token: token3, confirm: confirmD, kind: "processing" });
  check("этап 3: в очереди обработки нет документов о распространении",
    r.ok === true && r.consents.length > 0 && r.consents.every((c) => c.kind === "processing"), r);

  r = await call("consent-review", { token: token3, confirm: confirmD, id: distId, decision: "rejected", note: "" });
  check("этап 3: отказ по распространению требует основания", r.ok === false, r);
  r = await call("consent-review", { token: token3, confirm: confirmD, id: distId, decision: "approved" });
  check("этап 3: распространение одобряется отдельно", r.ok === true, r);
  r = await call("consent-status", { token: tokenA });
  check("этап 3: оба документа приняты независимо",
    r.ok === true && r.consent.status === "approved" && r.distribution.status === "approved", r);

  // Новый участник: одно согласие на распространение работу на сайте не открывает
  r = await call("reg", { name: "Только Конкурсы", email: "contest-only@example.ru", pass: "parol1234", region: "moskva", role: "Автор текстов" });
  const tokenK = r.token;
  await verifyAll();
  r = await call("consent-send", { token: tokenK, scan: realPng, kind: "distribution", purpose: "Конкурс" });
  const contestConsentId = r.ok && r.consent ? r.consent.id : "";
  r = await call("consent-review", { token: token3, confirm: confirmD, id: contestConsentId, decision: "approved" });
  check("этап 3: документ участника конкурса принят", r.ok === true, r);
  r = await call("submit", Object.assign({}, article, { token: tokenK, requestId: "stage3-submit-0001", title: "Материал участника конкурса" }));
  check("этап 3: распространение не заменяет согласие на обработку",
    r.ok === false && r.code === 403 && r.needConsent === true && r.consentKind === "processing", r);

  const meK = await call("me", { token: tokenK });
  const contestUserId = meK.ok && meK.user ? meK.user.id : "";
  r = await call("consent-decide", { token: token3, confirm: confirmD, userId: contestUserId, decision: "rejected", note: "", kind: "distribution" });
  check("этап 3: решение из карточки участника требует основания", r.ok === false, r);
  r = await call("consent-decide", { token: token3, confirm: confirmD, userId: contestUserId, decision: "rejected", note: "Не видно подписи на второй странице", kind: "distribution" });
  check("этап 3: решение из карточки сохраняется", r.ok === true, r);
  r = await call("consent-status", { token: tokenK });
  check("этап 3: решение по распространению не трогает обработку",
    r.ok === true && r.distribution.status === "rejected" && r.consent.status === "none", r);

  r = await call("reg", { name: "Без Второго", email: "no-spread@example.ru", pass: "parol1234", region: "moskva", role: "Автор текстов" });
  const tokenP = r.token;
  await verifyAll();
  r = await call("consent-send", { token: tokenP, scan: realPng });
  const onlyProcessingId = r.ok && r.consent ? r.consent.id : "";
  await call("consent-review", { token: token3, confirm: confirmD, id: onlyProcessingId, decision: "approved" });
  r = await call("submit", Object.assign({}, article, { token: tokenP, requestId: "stage3-submit-0002", title: "Материал без второго согласия" }));
  check("этап 3: одного согласия на обработку для публикации мало",
    r.ok === false && r.code === 403 && r.consentKind === "distribution", r);

  // ============================================================ ЭТАП 4
  // Пресс-карта как документ: код проверки, печать, отметка об отправке.

  r = await call("card-verify", {});
  check("этап 4: проверка без номера и кода не отвечает данными", r.ok === false, r);
  r = await call("card-status", { token: tokenA });
  const printed = r.ok && r.current ? r.current : null;
  check("этап 4: владелец получает код проверки своей карты",
    !!printed && printed.status === "issued" && /^[A-Z2-9]{8}$/.test(printed.verifyCode || ""), printed);
  const cardNumber = printed ? printed.number : "";
  const cardCode = printed ? printed.verifyCode : "";

  const rateBefore = (await readData("rate.json").catch(() => ({}))) || {};
  r = await call("card-verify", { number: cardNumber });
  check("этап 4: одного номера для проверки мало", r.ok === false, r);
  r = await call("card-verify", { number: cardNumber, code: "ZZZZZZZZ" });
  check("этап 4: неверный код не раскрывает данные", r.ok === true && r.found === false && !r.card, r);
  r = await call("card-verify", { number: cardNumber.toLowerCase(), code: cardCode.toLowerCase() });
  check("этап 4: проверка не зависит от регистра и пробелов", r.ok === true && r.found === true, r);
  const seen = r.ok && r.card ? r.card : {};
  check("этап 4: проверка показывает статус, имя и срок",
    seen.status === "issued" && !!seen.authorName && !!seen.validUntil, seen);
  check("этап 4: проверка не раскрывает лишнего",
    seen.email === undefined && seen.userId === undefined && seen.delivery === undefined &&
    seen.history === undefined && seen.verifyCode === undefined && seen.authorEmail === undefined, Object.keys(seen));
  const verifyRate = await readData("rate-verify.json").catch(() => null);
  const rateAfter = (await readData("rate.json").catch(() => ({}))) || {};
  check("этап 4: у проверки свой счётчик попыток", !!verifyRate && JSON.stringify(rateBefore) === JSON.stringify(rateAfter),
    { verifyRate: !!verifyRate });

  r = await call("card-pdf", {});
  check("этап 4: PDF карты требует входа", r.ok === false && r.code === 401, r);
  r = await call("card-pdf", { token: tokenP, id: printed ? printed.id : "" });
  check("этап 4: чужую карту нельзя скачать без прав редакции", r.ok === false && r.code === 403, r);
  r = await call("card-pdf", { token: tokenA, id: printed ? printed.id : "" });
  const pdfBytes = r.ok && r.data ? Buffer.from(r.data, "base64") : Buffer.alloc(0);
  check("этап 4: владелец скачивает действующую карту в PDF",
    r.ok === true && r.mime === "application/pdf" && /\.pdf$/.test(r.filename || "") &&
    pdfBytes.slice(0, 5).toString("ascii") === "%PDF-" && pdfBytes.length > 10000,
    { ok: r.ok, filename: r.filename, size: pdfBytes.length });
  r = await call("card-pdf", { token: token3, id: printed ? printed.id : "" });
  check("этап 4: ответственная редакция тоже может скачать PDF", r.ok === true && !!r.data, r.ok ? undefined : r);

  /* Лимит проверки отдельный и действительно останавливает перебор. */
  const verifyIp = "203.0.113.9";
  const nowSec = Math.floor(Date.now() / 1000);
  await writeData("rate-verify.json", { [verifyIp]: Array.from({ length: 60 }, () => nowSec) });
  r = await call("card-verify", { number: cardNumber, code: cardCode });
  check("этап 4: после 60 проверок в час включается лимит", r.ok === false && r.code === 429, r);
  await writeData("rate-verify.json", {});

  r = await call("card-dispatch", { token: tokenA, id: printed ? printed.id : "", tracking: "12345678901234" });
  check("этап 4: отметку об отправке ставит только редакция", r.ok === false && (r.code === 403 || r.code === 401), r);
  r = await call("card-dispatch", { token: token3, id: printed ? printed.id : "", tracking: "12345678901234" });
  check("этап 4: редакция отмечает отправку с трек-номером",
    r.ok === true && r.request.dispatch && r.request.dispatch.tracking === "12345678901234", r);
  r = await call("card-status", { token: tokenA });
  check("этап 4: трек-номер виден владельцу в кабинете",
    r.ok === true && r.current.dispatch && r.current.dispatch.tracking === "12345678901234", r);
  const firstSentAt = r.ok && r.current.dispatch ? r.current.dispatch.sentAt : "";
  r = await call("card-dispatch", { token: token3, id: printed ? printed.id : "", tracking: "99887766554433" });
  check("этап 4: исправление трек-номера не меняет дату первой отправки",
    r.ok === true && r.request.dispatch.tracking === "99887766554433" && r.request.dispatch.sentAt === firstSentAt, r);

  r = await call("card-revoke", { token: token3, confirm: confirmD, id: printed ? printed.id : "", note: "Проверка отзыва карты" });
  check("этап 4: карта отозвана для проверки статуса", r.ok === true, r);
  r = await call("card-verify", { number: cardNumber, code: cardCode });
  check("этап 4: проверка сразу показывает отзыв", r.ok === true && r.found === true && r.card.status === "revoked", r);
  r = await call("card-dispatch", { token: token3, id: printed ? printed.id : "", tracking: "1" });
  check("этап 4: отозванную карту нельзя отметить отправленной", r.ok === false && r.code === 409, r);
  r = await call("card-pdf", { token: tokenA, id: printed ? printed.id : "" });
  check("этап 4: отозванную карту нельзя скачать как действующую", r.ok === false && r.code === 409, r);

  console.log("\n=== ИТОГ ===");
  let bad = 0;
  results.forEach((x) => {
    if (!x.ok) bad++;
    console.log((x.ok ? "  ok   " : "  FAIL ") + x.name + (x.ok ? "" : " → " + String(x.extra || "")));
  });
  console.log(bad === 0 ? "\nвсе проверки пройдены" : "\nпровалено: " + bad);
  process.exit(bad === 0 ? 0 : 1);
 } catch (e) {
   console.log("СБОЙ ПРОГОНА:", e && (e.message || e.errno || e));
   process.exit(2);
 }
})();
