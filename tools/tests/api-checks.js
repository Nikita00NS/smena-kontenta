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

const SRC = "/home/user/smena-kontenta/api";
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

function check(name, cond, extra) {
  console.log((cond ? "  ok   " : "  FAIL ") + name);
  results.push({ name, ok: !!cond, extra: cond ? "" : JSON.stringify(extra).slice(0, 300) });
}

const results = [];

(async () => {
 try {
  for (const d of ["/site", "/site/api", "/site/api/lib", "/smena-data"]) {
    try { await php.mkdir(d); } catch (e) {}
  }
  /* копируем ВСЕ библиотеки: index.php подключает их все, и забытый файл
     даёт пустой ответ вместо ошибки (fatal error в wasm не печатается) */
  for (const lib of fs.readdirSync(SRC + "/lib")) {
    if (!lib.endsWith(".php")) continue;
    await push(SRC + "/lib/" + lib, "/site/api/lib/" + lib);
  }
  const srcIndex = fs.readFileSync(SRC + "/index.php", "utf8")
    .replace("$raw = file_get_contents('php://input');",
      "$raw = file_exists(__DIR__ . '/body.json') ? (string) file_get_contents(__DIR__ . '/body.json') : '';")
    .replace(`function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}`, `function respond($data, $code = 200) {
    http_response_code($code);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    file_put_contents(__DIR__ . '/out.json', json_encode(array('__code' => $code, '__body' => $json)));
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
    !fs.readFileSync("/home/user/smena-kontenta/api/index.php", "utf8").includes("password_hash(DEFAULT_EDITOR_PASSWORD"));

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
