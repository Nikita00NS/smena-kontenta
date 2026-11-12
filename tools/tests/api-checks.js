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
  r = await call("hiring-apply", { token: token2b, position: "Автор текстов", motivation: "Хочу писать про городские события и школьные новости." });
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

  /* ======================================================================
     24. ПЛАН 11.11.2026, ЭТАП 1: согласие на сервере, материалы привязаны
     к аккаунту, пресс-карта на сервере, открытие редакции — заявлением.
     ====================================================================== */
  async function editJson(file, fn) {
    let data = [];
    try { data = JSON.parse(await readText("/smena-data/" + file)); } catch (e) {}
    const next = fn(data) || data;
    await php.writeFile("/smena-data/" + file, JSON.stringify(next));
  }
  async function newUser(name, email, region) {
    const res = await call("reg", { name, email, pass: "parol1234", region: region || "moskva", role: "Автор текстов" });
    await verifyAll();
    return { token: res.token, id: res.user ? res.user.id : "", name, email };
  }
  async function setUser(id, patch) {
    await editJson("users.json", (users) => users.map((u) => (u.id === id ? Object.assign({}, u, patch) : u)));
  }
  const longBody = "Проверочный текст материала: абзац про школьную редакцию и её первый выпуск. ".repeat(6);
  function postPayload(token, title, extra) {
    return Object.assign({ token, title, excerpt: "Короткое описание материала для ленты и поиска.",
      body: longBody, topic: "Школа", format: "Статья", region: "moskva", authorKey: "browser-key-000001" }, extra || {});
  }
  /* директор принимает согласие человека — как в панели, под код из письма */
  async function giveConsent(user) {
    await call("consent-send", { token: user.token, pages: [realPng, realPng] });
    const q = await call("consent-queue", { token: token3 });
    const row = (q.consents || []).find((c) => c.userId === user.id);
    const confirm = await makeConfirm(token3);
    return call("consent-review", { token: token3, confirm, id: row ? row.id : "", decision: "approved" });
  }

  // 24.1 материал: только из аккаунта и только с согласием
  r = await call("submit", postPayload("", "Материал без входа в аккаунт"));
  check("24.1 без входа материал не принять", r.ok === false && r.code === 401, r);
  const authorA = await newUser("Анна Авторова", "author-a@example.ru", "moskva");
  r = await call("submit", postPayload(authorA.token, "Материал без согласия на обработку"));
  check("24.1 без согласия материал не принять", r.ok === false && r.code === 403 && r.needConsent === true, r);
  check("24.1 в отказе есть статус согласия", r.consent && r.consent.status === "none", r);
  r = await call("consent-status", { token: authorA.token });
  check("24.1 статус согласия: нет", r.ok === true && r.consent.status === "none" && r.granted === false && r.exempt === false, r);
  r = await call("consent-status", { token: token3 });
  check("24.1 директору согласие не требуется", r.ok === true && r.exempt === true && r.granted === true, r);

  // 24.2 согласие: закрытое хранение, очередь, решение
  r = await call("consent-send", { token: authorA.token, pages: [] });
  check("24.2 согласие без файла не принять", r.ok === false, r);
  r = await call("consent-send", { token: authorA.token, pages: [fakePng] });
  check("24.2 поддельный файл согласия отклонён", r.ok === false && r.code === 413, r);
  r = await call("consent-send", { token: authorA.token, pages: [realPng, realPng, realPng, realPng, realPng] });
  check("24.2 больше четырёх листов не принять", r.ok === false, r);
  r = await call("consent-send", { token: authorA.token, pages: [realPng, realPng] });
  check("24.2 согласие принято на проверку", r.ok === true && r.consent.status === "pending" && r.consent.pages === 2, r);
  check("24.2 в ответе нет адреса файла", r.ok === true && JSON.stringify(r).indexOf("pd_") === -1 && r.consent.scan === undefined, r);
  let closed = []; let open = [];
  try { closed = await php.readdir("/smena-data/consents"); } catch (e) {}
  try { open = await php.readdir("/smena-data/uploads"); } catch (e) {}
  check("24.2 сканы лежат в закрытой папке", closed.filter((f) => /^pd_/.test(f)).length === 2, closed);
  check("24.2 в папке публичных файлов сканов нет", open.filter((f) => /^pd_/.test(f)).length === 0, open);
  check("24.2 закрытая папка защищена от прямого доступа", closed.indexOf(".htaccess") !== -1, closed);
  r = await call("submit", postPayload(authorA.token, "Материал, пока согласие проверяется"));
  check("24.2 согласие на проверке — материал ещё не принять", r.ok === false && r.needConsent === true && r.consent.status === "pending", r);
  r = await call("consent-file", { token: authorA.token, page: 1 });
  check("24.2 свой скан человек видит", r.ok === true && /^data:image\/png;base64,/.test(r.data || "") && r.pages === 2, r);
  r = await call("consent-queue", { token: authorA.token });
  check("24.2 очередь согласий закрыта участнику", r.ok === false && r.code === 403, r);
  r = await call("consent-queue", { token: token3 });
  const consentA = (r.consents || []).find((c) => c.userId === authorA.id);
  check("24.2 директор видит согласие в очереди", r.ok === true && !!consentA && consentA.status === "pending" && r.counts.pending >= 1, r);
  r = await call("consent-file", { token: token4, id: consentA ? consentA.id : "", page: 1 });
  check("24.2 чужой скан постороннему не открыть", r.ok === false && r.code === 403, r);
  r = await call("consent-file", { token: token3, id: consentA ? consentA.id : "", page: 2 });
  check("24.2 проверяющий открывает скан", r.ok === true && /^data:image\/png/.test(r.data || ""), r);
  r = await call("admin-log", { token: token3 });
  check("24.2 просмотр скана записан в журнал", r.ok && r.entries.some((e) => e.action === "consent-file"), r.entries && r.entries.slice(0, 3));
  r = await call("consent-review", { token: token3, id: consentA.id, decision: "approved" });
  check("24.2 решение по согласию без кода не проходит", r.ok === false && r.code === 428, r);
  r = await call("consent-review", { token: token3, confirm: await makeConfirm(token3), id: consentA.id, decision: "rejected", note: "" });
  check("24.2 отказ без причины не принять", r.ok === false && r.code === 400, r);
  r = await call("consent-review", { token: token3, confirm: await makeConfirm(token3), id: consentA.id, decision: "approved" });
  check("24.2 согласие принято", r.ok === true && r.consent.status === "approved", r);
  r = await call("consent-review", { token: token3, confirm: await makeConfirm(token3), id: consentA.id, decision: "rejected", note: "повторное решение" });
  check("24.2 очередь не меняет уже принятое решение", r.ok === false && r.code === 409, r);
  r = await call("consent-send", { token: authorA.token, pages: [realPng] });
  check("24.2 принятое согласие повторно не загружается", r.ok === false && r.code === 409, r);
  r = await call("messages-mine", { token: authorA.token });
  check("24.2 человеку пришло уведомление о согласии", r.ok === true && r.messages.some((m) => /Согласие.*принято/.test(m.text)), r);

  // 24.3 материал привязан к аккаунту; публикация без проверки закрыта
  r = await call("submit", postPayload(authorA.token, "Первый материал Анны про школьную редакцию",
    { direct: true, authorName: "Чужое Имя" }));
  check("24.3 материал с согласием принят", r.ok === true && r.post.status === "pending", r);
  check("24.3 флажок direct без права не публикует", r.ok === true && r.direct === false, r);
  check("24.3 имя автора берётся из аккаунта, а не из формы", r.ok === true && r.post.authorName === "Анна Авторова", r.post);
  const postA1 = r.post ? r.post.id : "";
  const numberA1 = r.post ? r.post.number : 0;
  r = await call("state", {});
  check("24.3 неодобренного материала нет на сайте", r.ok === true && !r.posts.some((p) => p.id === postA1), r);
  r = await call("mine", { token: authorA.token });
  check("24.3 автор видит свой материал по аккаунту", r.ok === true && r.posts.length === 1 && r.posts[0].own === true, r);
  r = await call("mine", { authorKey: "browser-key-000001" });
  check("24.3 по одному ключу браузера материалы не отдаются", r.ok === false && r.code === 401, r);
  r = await call("queue", { token: token3 });
  const queued = (r.pending || []).find((p) => p.id === postA1);
  check("24.3 редакция видит материал и автора", !!queued && queued.authorId === authorA.id && queued.authorEmail === "author-a@example.ru", r);
  r = await call("review", { token: token3, confirm: await makeConfirm(token3), id: postA1, decision: "reject", note: "" });
  check("24.3 вернуть материал без замечания нельзя", r.ok === false && r.code === 400, r);
  r = await call("review", { token: token3, confirm: await makeConfirm(token3), id: postA1, decision: "reject", note: "Добавьте фото и проверьте имена." });
  check("24.3 материал возвращён на доработку", r.ok === true && r.post.status === "rejected", r);
  r = await call("review", { token: token3, confirm: await makeConfirm(token3), id: postA1, decision: "approve" });
  check("24.3 отклонённый материал повторным решением не опубликовать", r.ok === false && r.code === 409, r);
  r = await call("messages-mine", { token: authorA.token });
  check("24.3 автору пришло замечание", r.ok === true && r.messages.some((m) => /Добавьте фото/.test(m.text)), r);
  r = await call("submit", postPayload(token4, "Чужая правка материала Анны целиком", { replaceId: postA1 }));
  check("24.3 чужой материал не исправить", r.ok === false && (r.code === 403), r);
  r = await call("submit", postPayload(authorA.token, "Первый материал Анны, исправленная версия", { replaceId: postA1 }));
  check("24.3 исправленная версия встаёт на место прежней",
    r.ok === true && r.replaced === true && r.post.id === postA1 && r.post.number === numberA1 && r.post.revision === 2 && r.post.status === "pending", r);
  r = await call("review", { token: token3, confirm: await makeConfirm(token3), id: postA1, decision: "approve" });
  check("24.3 материал опубликован", r.ok === true && r.post.status === "published", r);
  r = await call("review", { token: token3, confirm: await makeConfirm(token3), id: postA1, decision: "reject", note: "передумали публиковать" });
  check("24.3 опубликованный материал решением из очереди не снять", r.ok === false && r.code === 409, r);
  r = await call("submit", postPayload(authorA.token, "Попытка заменить опубликованный материал", { replaceId: postA1 }));
  check("24.3 опубликованный материал заменой не переписать", r.ok === false && r.code === 409, r);
  r = await call("state", {});
  check("24.3 опубликованный материал виден на сайте", r.ok === true && r.posts.some((p) => p.id === postA1 && p.authorName === "Анна Авторова"), r);
  r = await call("points-history", { token: authorA.token });
  check("24.3 автору начислены баллы за публикацию", r.ok === true && (r.balance > 0 || (r.history || r.entries || []).length > 0), r);
  r = await call("submit", postPayload(token3, "Материал директора выходит без очереди", { direct: true }));
  check("24.3 с правом публикации материал выходит сразу", r.ok === true && r.direct === true && r.post.status === "published", r);

  /* материалы, отправленные до привязки: совпали ключ браузера и имя */
  await editJson("posts.json", (posts) => {
    posts.s_legacy1 = { id: "s_legacy1", authorKey: "legacy-key-aaaaaa", authorId: "", authorName: "Анна Авторова",
      authorRole: "", authorRegion: "", title: "Старый материал Анны без аккаунта", excerpt: "Описание старого материала.",
      body: longBody, topic: "", format: "Статья", region: "moskva", number: 900, status: "published",
      date: "2026-11-01T10:00:00+00:00", submittedAt: "2026-11-01T10:00:00+00:00", reviewNote: "" };
    posts.s_legacy2 = Object.assign({}, posts.s_legacy1, { id: "s_legacy2", authorName: "Другой Человек", number: 901 });
    return posts;
  });
  r = await call("mine", { token: authorA.token, authorKey: "legacy-key-aaaaaa" });
  check("24.3 старый материал привязывается к аккаунту по ключу и имени",
    r.ok === true && r.bound === true && r.posts.some((p) => p.id === "s_legacy1"), r);
  check("24.3 чужой материал с тем же ключом не привязывается", r.ok === true && !r.posts.some((p) => p.id === "s_legacy2"), r);

  // 24.4 пресс-карта: заявка, выдача, срок, проверка по номеру
  r = await call("card-request", { authorKey: "browser-key-000001", posts: [] });
  check("24.4 заявка на карту без аккаунта закрыта", r.ok === false && r.code === 410, r);
  r = await call("card-status", { token: authorA.token });
  check("24.4 кабинет знает, почему заявку подать нельзя",
    r.ok === true && r.canApply === false && r.published === 2 && r.minPosts === 5 && /5 опубликованных/.test(r.why), r);
  r = await call("card-apply", { token: authorA.token });
  check("24.4 меньше пяти материалов — заявка не принимается", r.ok === false && r.code === 409, r);
  await editJson("posts.json", (posts) => {
    for (let i = 1; i <= 3; i++) {
      posts["s_more" + i] = Object.assign({}, posts[postA1], { id: "s_more" + i, number: 910 + i, title: "Ещё один материал Анны № " + i });
    }
    return posts;
  });
  r = await call("card-status", { token: authorA.token });
  check("24.4 пять материалов — заявку подать можно", r.ok === true && r.canApply === true && r.published === 5 && r.consentOk === true, r);
  r = await call("card-apply", { token: token4 });
  check("24.4 без согласия заявка на карту не принимается", r.ok === false && r.code === 403 && r.needConsent === true, r);
  r = await call("card-apply", { token: authorA.token });
  check("24.4 заявка на карту принята", r.ok === true && r.request.state === "pending" && r.request.posts.length === 5, r);
  const cardA = r.request ? r.request.id : "";
  r = await call("card-apply", { token: authorA.token });
  check("24.4 вторая заявка не создаётся", r.ok === false && r.code === 409, r);
  r = await call("card-doc", { token: authorA.token, id: cardA });
  check("24.4 документа нет, пока карта не выдана", r.ok === false && r.code === 409, r);
  r = await call("card-queue", { token: authorA.token });
  check("24.4 очередь карт закрыта участнику", r.ok === false && r.code === 403, r);
  r = await call("card-queue", { token: token3 });
  const queuedCard = (r.requests || []).find((c) => c.id === cardA);
  check("24.4 редакция видит заявку с автором и согласием",
    !!queuedCard && queuedCard.state === "pending" && queuedCard.name === "Анна Авторова" && queuedCard.consent === "approved", r);
  r = await call("card-review", { token: token3, confirm: await makeConfirm(token3), id: cardA, decision: "reject", note: "" });
  check("24.4 отказ по карте без причины не принять", r.ok === false && r.code === 400, r);
  r = await call("card-review", { token: token3, confirm: await makeConfirm(token3), id: cardA, decision: "approve" });
  check("24.4 карта выдана с номером", r.ok === true && r.request.state === "issued" && /^СК-\d{4}-\d{4}$/.test(r.request.number), r);
  const numberA = r.request ? r.request.number : "";
  const yearMs = 365 * 86400 * 1000;
  check("24.4 карта действует год",
    r.ok === true && Math.abs(new Date(r.request.validUntil) - Date.now() - yearMs) < 3 * 86400 * 1000, r.request);
  r = await call("card-review", { token: token3, confirm: await makeConfirm(token3), id: cardA, decision: "approve" });
  check("24.4 решение по карте принимается один раз", r.ok === false && r.code === 409, r);
  r = await call("card-status", { token: authorA.token });
  check("24.4 кабинет видит ту же карту, что и редакция", r.ok === true && r.card && r.card.state === "issued" && r.card.number === numberA && r.canApply === false, r);
  r = await call("users", { token: token3 });
  const rowA = (r.users || []).find((u) => u.id === authorA.id);
  check("24.4 список участников показывает ту же карту и согласие",
    !!rowA && rowA.cardStatus === "issued" && rowA.cardNumber === numberA && rowA.consent === "approved", rowA);
  r = await call("card-verify", { number: numberA });
  check("24.4 проверка по номеру: карта действует", r.ok === true && r.found === true && r.valid === true && r.name === "Анна Авторова", r);
  r = await call("card-verify", { number: numberA.replace("СК", "ck").replace(/-/g, " ") });
  check("24.4 номер латиницей и с пробелами тоже находится", r.ok === true && r.found === true && r.number === numberA, r);
  r = await call("card-verify", { number: "СК-2026-9999" });
  check("24.4 несуществующий номер — карта не найдена", r.ok === true && r.found === false && r.name === undefined, r);
  r = await call("card-verify", { number: "что-то не то" });
  check("24.4 неверный вид номера отклоняется", r.ok === false && r.code === 400, r);
  r = await call("card-doc", { token: authorA.token, id: cardA });
  check("24.4 владелец открывает документ о карте",
    r.ok === true && r.card.number === numberA && r.holder.name === "Анна Авторова" && r.own === true && r.canPrint === true && !!r.issuedBy, r);
  r = await call("card-doc", { token: token4, id: cardA });
  check("24.4 чужой документ о карте не открыть", r.ok === false && r.code === 403, r);
  r = await call("card-suspend", { token: token3, id: cardA, note: "" });
  check("24.4 приостановка без причины не проходит", r.ok === false && r.code === 400, r);
  r = await call("card-suspend", { token: token3, id: cardA, note: "Проверяем жалобу на материал." });
  check("24.4 карта приостановлена", r.ok === true && r.card.state === "suspended", r);
  r = await call("card-verify", { number: numberA });
  check("24.4 приостановленная карта не действует", r.ok === true && r.valid === false && r.state === "suspended", r);
  r = await call("card-restore", { token: token3, id: cardA });
  check("24.4 карта возобновлена", r.ok === true && r.card.state === "issued", r);
  r = await call("card-extend", { token: token3, id: cardA });
  check("24.4 продление без кода не проходит", r.ok === false && r.code === 428, r);
  r = await call("card-extend", { token: token3, confirm: await makeConfirm(token3), id: cardA });
  check("24.4 карта продлена на год", r.ok === true && new Date(r.card.validUntil) - Date.now() > 1.9 * yearMs, r);
  await editJson("cards.json", (cards) => { cards[cardA].validUntil = "2025-01-01T00:00:00+00:00"; return cards; });
  r = await call("card-verify", { number: numberA });
  check("24.4 истёкшая карта не действует", r.ok === true && r.valid === false && r.state === "expired", r);
  r = await call("card-status", { token: authorA.token });
  check("24.4 по истёкшей карте можно подать на продление", r.ok === true && r.card.state === "expired" && r.canApply === true && r.renewal === true, r);
  r = await call("card-revoke", { token: token3, confirm: await makeConfirm(token3), id: cardA, note: "Нарушение правил редакции." });
  check("24.4 карта отозвана", r.ok === true && r.card.state === "revoked", r);
  r = await call("card-verify", { number: numberA });
  check("24.4 отозванная карта: недействительна, имя не показывается", r.ok === true && r.valid === false && r.state === "revoked" && r.name === "", r);
  r = await call("card-grant", { token: token3, id: token4 ? (await call("me", { token: token4 })).user.id : "" });
  check("24.4 без согласия карту по должности не выдать", r.ok === false && r.code === 409, r);
  const directorId = (await call("me", { token: token3 })).user.id;
  r = await call("card-grant", { token: token3, id: directorId });
  check("24.4 себе карту не выдать", r.ok === false && r.code === 403, r);
  r = await call("card-grant", { token: token3, id: authorA.id });
  check("24.4 карта по должности выдаётся с новым номером", r.ok === true && /^СК-\d{4}-\d{4}$/.test(r.number) && r.number !== numberA, r);

  // 24.5 открытие редакции: заявление вместо кнопки
  r = await call("editorial-create", { token: token4, region: "moskva", name: "Редакция без согласия", about: "Попытка открыть редакцию одной кнопкой." });
  check("24.5 без согласия заявление не начать", r.ok === false && r.code === 403 && r.needConsent === true, r);
  r = await call("editorial-create", { token: authorA.token, region: "moskva", name: "Школьный вестник", about: "Редакция школы № 5: новости, репортажи и подкаст." });
  check("24.5 прежняя кнопка «Создать редакцию» создаёт только черновик заявления",
    r.ok === true && r.pending === true && r.application.status === "draft" && r.editorial === undefined, r);
  r = await call("me", { token: authorA.token });
  check("24.5 роль при этом не меняется", r.ok === true && r.user.access === "Пользователь" && !r.user.editorialId, r.user);
  r = await call("editorial-list", {});
  check("24.5 редакция не появляется без решения директора", r.ok === true && r.editorials.length === 0, r);
  r = await call("editorial-open-save", { token: authorA.token, submit: true, form: { name: "Школьный вестник", region: "moskva" } });
  check("24.5 недозаполненную анкету отправить нельзя", r.ok === false && r.code === 400 && Array.isArray(r.problems) && r.problems.length > 3, r);
  const formOk = {
    name: "Школьный вестник", region: "moskva", city: "Москва", base: "school", baseName: "Школа № 5",
    about: "Редакция школы № 5: еженедельные новости, репортажи с событий, подкаст и фотолетопись.",
    headName: "Авторова Анна Сергеевна", headBirth: "2012-03-10", headPhone: "+7 900 000-00-00",
    team: [{ name: "Пётр Первый", role: "Фотограф", age: 15 }, { name: "Вера Вторая", role: "Корреспондент", age: 16 }],
    confirms: { truth: true, rules: true, consents: true, reports: true },
  };
  r = await call("editorial-open-save", { token: authorA.token, submit: true, form: Object.assign({}, formOk, { headBirth: "2015-01-01" }) });
  check("24.5 руководителю должно быть не меньше 14 лет", r.ok === false && r.problems.some((p) => /не младше 14/.test(p)), r);
  r = await call("editorial-open-save", { token: authorA.token, submit: true, form: formOk });
  check("24.5 руководителю до 18 лет нужен взрослый куратор", r.ok === false && r.problems.some((p) => /куратор/.test(p)), r);
  r = await call("editorial-open-save", { token: authorA.token, submit: true,
    form: Object.assign({}, formOk, { team: [formOk.team[0]], curator: { name: "Иванова Мария Петровна", role: "учитель", phone: "89001112233" } }) });
  check("24.5 в команде нужно двое кроме руководителя", r.ok === false && r.problems.some((p) => /не меньше 2/.test(p)), r);
  r = await call("editorial-open-mine", { token: authorA.token });
  check("24.5 набранное сохраняется черновиком", r.ok === true && r.application && r.application.status === "draft" && r.application.form.city === "Москва" && r.mailTo === "editorial@smenakontenta.ru", r);
  const formFull = Object.assign({}, formOk, { curator: { name: "Иванова Мария Петровна", role: "учитель литературы", phone: "89001112233" } });
  r = await call("editorial-open-save", { token: authorA.token, submit: true, form: formFull });
  check("24.5 заявление сформировано и ждёт подписи", r.ok === true && r.application.status === "awaiting" && /^ЗР-\d{4}-\d{4}$/.test(r.application.number), r);
  const openId = r.application ? r.application.id : "";
  r = await call("editorial-open-save", { token: authorA.token, form: formFull });
  check("24.5 отправленное заявление не редактируется", r.ok === false && r.code === 409, r);
  r = await call("editorial-open-get", { token: authorA.token, id: openId });
  check("24.5 заявитель открывает своё заявление", r.ok === true && r.own === true && r.application.form.headName === "Авторова Анна Сергеевна", r);
  r = await call("editorial-open-get", { token: token4, id: openId });
  check("24.5 чужое заявление не открыть", r.ok === false && r.code === 403, r);
  r = await call("editorial-open-queue", { token: authorA.token });
  check("24.5 очередь заявлений закрыта участнику", r.ok === false && r.code === 403, r);
  r = await call("editorial-open-queue", { token: token3 });
  check("24.5 директор видит заявление", r.ok === true && r.canDecide === true && r.applications.some((a) => a.id === openId && a.status === "awaiting"), r);
  r = await call("editorial-open-decide", { token: token3, confirm: await makeConfirm(token3), id: openId, decision: "approved" });
  check("24.5 решение до получения подписанного документа не принять", r.ok === false && r.code === 409, r);
  r = await call("editorial-open-return", { token: token3, id: openId, note: "" });
  check("24.5 вернуть на доработку без замечания нельзя", r.ok === false && r.code === 400, r);
  r = await call("editorial-open-received", { token: token3, id: openId });
  check("24.5 отмечено: подписанный документ получен", r.ok === true && r.application.status === "review", r);
  r = await call("editorial-open-decide", { token: token3, id: openId, decision: "approved" });
  check("24.5 решение директора без кода не проходит", r.ok === false && r.code === 428, r);
  r = await call("editorial-open-decide", { token: token3, confirm: await makeConfirm(token3), id: openId, decision: "rejected", note: "" });
  check("24.5 отказ без причины не принять", r.ok === false && r.code === 400, r);
  r = await call("editorial-open-decide", { token: token3, confirm: await makeConfirm(token3), id: openId, decision: "approved" });
  check("24.5 директор открыл редакцию", r.ok === true && r.application.status === "approved" && !!r.application.editorialId, r);
  const editorialX = r.application ? r.application.editorialId : "";
  r = await call("editorial-list", { region: "moskva" });
  check("24.5 редакция появилась в регионе", r.ok === true && r.editorials.some((e) => e.id === editorialX && e.name === "Школьный вестник"), r);
  r = await call("me", { token: authorA.token });
  check("24.5 заявитель стал руководителем редакции", r.ok === true && r.user.access === "Редакционный основатель" && r.user.editorialId === editorialX, r.user);
  r = await call("editorial-open-save", { token: authorA.token, form: formFull });
  check("24.5 вторую редакцию тот же руководитель не откроет", r.ok === false && r.code === 409, r);
  r = await call("messages-mine", { token: authorA.token });
  check("24.5 заявителю пришло решение", r.ok === true && r.messages.some((m) => /открыта решением директора/.test(m.text)), r);

  // 24.6 сессии и роли: закрытые дыры
  for (const bad of ["0", "1", "2", "abc", "true"]) {
    r = await call("me", { token: bad });
    if (r.ok !== false || r.code !== 401) { check("24.6 строка «" + bad + "» не работает как токен", false, r); }
  }
  r = await call("me", { token: "0" });
  check("24.6 короткие строки не работают как токен", r.ok === false && r.code === 401, r);
  let rawTokens = {};
  try { rawTokens = JSON.parse(await readText("/smena-data/tokens.json")); } catch (e) {}
  check("24.6 после удаления чужого аккаунта файл сессий цел",
    !Array.isArray(rawTokens) && Object.keys(rawTokens).length > 0 && Object.keys(rawTokens).every((k) => /^[a-f0-9]{48}$/.test(k)), Object.keys(rawTokens).slice(0, 3));
  r = await call("me", { token: token3 });
  check("24.6 остальные сессии после чужого удаления живы", r.ok === true, r);
  r = await call("boss-grant", { token: token3 });
  check("24.6 доступ без указанной почты не выдаётся", r.ok === false && r.code === 400, r);
  r = await call("user-access", { token: token3, id: directorId, access: "Сотрудник" });
  check("24.6 свою роль изменить нельзя", r.ok === false && r.code === 403, r);
  r = await call("person-status", { token: token3, userId: directorId, status: "suspended", reason: "проверка запрета" });
  check("24.6 себя приостановить нельзя", r.ok === false && r.code === 403, r);
  const chief = await newUser("Глеб Редактор", "chief@example.ru", "moskva");
  await setUser(chief.id, { access: "Главный редактор" });
  r = await call("user-update", { token: chief.token, id: chief.id, access: "Директор" });
  check("24.6 правкой профиля себе роль не выдать", r.ok === false && r.code === 403, r);
  r = await call("user-update", { token: chief.token, id: authorA.id, access: "Администрация" });
  check("24.6 правкой профиля чужую роль не поднять", r.ok === false && r.code === 403, r);
  r = await call("me", { token: chief.token });
  check("24.6 роль после попыток прежняя", r.ok === true && r.user.access === "Главный редактор", r.user);
  const adminB = await newUser("Борис Админов", "admin-b@example.ru", "moskva");
  await setUser(adminB.id, { access: "Администрация" });
  r = await call("grant-admin", { token: adminB.token, confirm: await makeConfirm(adminB.token), email: "chief@example.ru", access: "Директор" });
  check("24.6 администрация не назначает директора", r.ok === false && r.code === 403, r);
  r = await call("grant-admin", { token: adminB.token, confirm: await makeConfirm(adminB.token), email: "first@example.ru", access: "Сотрудник" });
  check("24.6 администрация не снимает директора (grant-admin)", r.ok === false && r.code === 403, r);
  r = await call("boss-grant", { token: adminB.token, email: "first@example.ru", access: "Сотрудник" });
  check("24.6 администрация не снимает директора (boss-grant)", r.ok === false && r.code === 403, r);
  r = await call("me", { token: token3 });
  check("24.6 директор остался директором", r.ok === true && r.user.access === "Директор", r.user);
  r = await call("user-access", { token: adminB.token, id: chief.id, access: "Редактор" });
  check("24.6 администрация меняет роль младшего", r.ok === true && r.access === "Редактор", r);
  await setUser(chief.id, { access: "Главный редактор" });
  r = await call("claim-director", { token: chief.token, confirm: await makeConfirm(chief.token), force: true });
  check("24.6 слово force не выдаёт роль директора", r.ok === false && r.code === 409, r);
  r = await call("whoami", {});
  check("24.6 постороннему не сообщается имя директора", r.ok === true && r.directorExists === true && r.directorName === "" && r.accounts === 0, r);
  r = await call("diag", { token: token3 });
  check("24.6 диагностика открыта директору по входу", r.ok === true && typeof r.accounts === "number", r);
  r = await call("diag", { token: chief.token });
  check("24.6 диагностика закрыта тем, у кого нет права", r.ok === false && r.code === 404, r);
  r = await call("selftest", { pass: "Redakcia-Smena-2026" });
  check("24.6 пароль из открытого репозитория ничего не открывает", r.ok === false && r.code === 404, r);

  /* ======================================================================
     25. ЗОНА ОТВЕТСТВЕННОСТИ: руководитель редакции видит и решает только
     по своим людям, региональный администратор — по своему региону.
     ====================================================================== */
  const memberM = await newUser("Миша Участников", "member-m@example.ru", "moskva");
  const outsiderO = await newUser("Оля Сторонняя", "outsider-o@example.ru", "tatarstan");
  r = await giveConsent(memberM);
  check("25.1 согласие участника принято", r.ok === true, r);
  await giveConsent(outsiderO);

  // 25.1 вступление в редакцию: заявка → решение руководителя
  r = await call("editorial-apply", { token: token4, editorialId: editorialX, birthDate: "01.02.2010", why: "Хочу писать репортажи о школьных событиях каждую неделю." });
  check("25.1 без согласия в редакцию не подать", r.ok === false && r.code === 403 && r.needConsent === true, r);
  r = await call("editorial-apply", { token: memberM.token, editorialId: editorialX, birthDate: "01.02.2010", why: "Хочу писать репортажи о школьных событиях каждую неделю." });
  check("25.1 заявка в редакцию подана", r.ok === true && r.application.status === "pending", r);
  const joinId = r.application ? r.application.id : "";
  await setUser(memberM.id, { access: "Редактор" });
  r = await call("editorial-review", { token: memberM.token, id: joinId, decision: "approved" });
  check("25.1 свою заявку в редакцию не одобрить", r.ok === false && r.code === 403, r);
  r = await call("editorial-review", { token: authorA.token, id: joinId, decision: "approved" });
  check("25.1 руководитель принял участника", r.ok === true, r);
  r = await call("me", { token: memberM.token });
  check("25.1 вступление в редакцию не снимает роль", r.ok === true && r.user.access === "Редактор" && r.user.editorialId === editorialX, r.user);
  await setUser(memberM.id, { access: "Пользователь" });
  r = await call("editorial-review", { token: authorA.token, id: joinId, decision: "rejected", note: "передумали" });
  check("25.1 решение по заявке в редакцию принимается один раз", r.ok === false && r.code === 409, r);

  // 25.2 очередь материалов по зоне
  r = await call("submit", postPayload(memberM.token, "Материал участника редакции про выпускной"));
  const postM = r.post ? r.post.id : "";
  r = await call("submit", postPayload(outsiderO.token, "Материал стороннего автора из Казани", { region: "tatarstan" }));
  const postO = r.post ? r.post.id : "";
  r = await call("submit", postPayload(authorA.token, "Материал самого руководителя редакции"));
  const postA2 = r.post ? r.post.id : "";
  r = await call("posts-queue", { token: authorA.token });
  const seen = (r.posts || []).map((p) => p.id);
  check("25.2 руководитель видит материалы своей редакции", r.ok === true && r.scoped === true && seen.indexOf(postM) !== -1 && seen.indexOf(postA2) !== -1, seen);
  check("25.2 чужих материалов в его очереди нет", r.ok === true && seen.indexOf(postO) === -1, seen);
  r = await call("posts-queue", { token: token3 });
  check("25.2 директор видит всю очередь", r.ok === true && r.scoped === false && r.posts.some((p) => p.id === postO) && r.posts.some((p) => p.id === postM), r);
  r = await call("review", { token: authorA.token, confirm: await makeConfirm(authorA.token), id: postO, decision: "approve" });
  check("25.2 чужой материал руководитель не решает", r.ok === false && r.code === 403, r);
  r = await call("review", { token: authorA.token, confirm: await makeConfirm(authorA.token), id: postA2, decision: "approve" });
  check("25.2 свой материал руководитель сам не публикует", r.ok === false && r.code === 403, r);
  r = await call("review", { token: authorA.token, confirm: await makeConfirm(authorA.token), id: postM, decision: "approve" });
  check("25.2 материал своего участника руководитель публикует", r.ok === true && r.post.status === "published", r);
  r = await call("submit", postPayload(authorA.token, "Руководитель редакции пробует выйти без очереди", { direct: true }));
  check("25.2 руководитель редакции без очереди не публикует", r.ok === true && r.direct === false && r.post.status === "pending", r);

  // 25.3 люди по зоне
  r = await call("users", { token: authorA.token });
  const ids = (r.users || []).map((u) => u.id);
  check("25.3 руководитель видит только людей своей редакции",
    r.ok === true && r.scoped === true && ids.indexOf(memberM.id) !== -1 && ids.indexOf(authorA.id) !== -1 && ids.indexOf(outsiderO.id) === -1 && ids.length === 2, ids);
  check("25.3 почту своих людей руководитель видит", r.ok === true && r.users.some((u) => u.id === memberM.id && u.email === "member-m@example.ru"), r.users);
  r = await call("user-card", { token: authorA.token, id: outsiderO.id });
  check("25.3 карточка чужого человека закрыта", r.ok === false && r.code === 403, r);
  r = await call("user-card", { token: authorA.token, id: memberM.id });
  check("25.3 карточка своего человека открыта", r.ok === true && r.canMessage === true && r.consent.status === "approved" && r.cardState === "none", r);
  check("25.3 заметки редакции руководителю не видны", r.ok === true && Array.isArray(r.notes) && r.notes.length === 0 && r.user.caps === undefined, r.notes);
  r = await call("user-message", { token: authorA.token, id: outsiderO.id, text: "Здравствуйте, напишите нам." });
  check("25.3 чужому человеку руководитель не пишет", r.ok === false && r.code === 403, r);
  r = await call("user-message", { token: authorA.token, id: memberM.id, text: "Сдайте, пожалуйста, текст до пятницы." });
  check("25.3 своему человеку руководитель пишет", r.ok === true, r);
  r = await call("support-queue", { token: authorA.token });
  check("25.3 обращения в поддержку руководителю редакции закрыты", r.ok === false && r.code === 403, r);
  r = await call("card-queue", { token: authorA.token });
  check("25.3 без права на карты очередь карт закрыта", r.ok === false && r.code === 403, r);
  r = await call("consent-queue", { token: authorA.token });
  check("25.3 согласия руководителю редакции закрыты", r.ok === false && r.code === 403, r);
  r = await call("editorial-queue", { token: authorA.token });
  check("25.3 общая очередь заявок в редакции — только центральной редакции", r.ok === false && r.code === 403, r);

  // 25.4 центральная роль без права на контакты видит почту скрытой
  const moder = await newUser("Зоя Модератор", "moder-z@example.ru", "moskva");
  await setUser(moder.id, { access: "Модератор" });
  r = await call("users", { token: moder.token });
  const rowO = (r.users || []).find((u) => u.id === outsiderO.id);
  check("25.4 модератор видит всех, но почта скрыта", r.ok === true && r.scoped === false && !!rowO && rowO.email === "o***@example.ru", rowO);
  r = await call("user-card", { token: moder.token, id: outsiderO.id });
  check("25.4 в карточке почта тоже скрыта", r.ok === true && r.user.email === "o***@example.ru" && r.contacts === false && r.canMessage === false, r.user);
  r = await call("consent-file", { token: moder.token, id: consentA.id, page: 1 });
  check("25.4 скан согласия модератору не открыть", r.ok === false && r.code === 403, r);
  r = await call("users", { token: token3 });
  check("25.4 директор видит почту полностью", r.ok === true && r.users.some((u) => u.email === "outsider-o@example.ru"), r);

  // 25.5 региональный администратор: карты только своего региона
  const regional = await newUser("Рената Региональная", "regional-r@example.ru", "tatarstan");
  await setUser(regional.id, { access: "Редакционный администратор региона" });
  r = await call("users", { token: regional.token });
  const regionIds = (r.users || []).map((u) => u.id);
  check("25.5 региональный администратор видит людей своего региона",
    r.ok === true && regionIds.indexOf(outsiderO.id) !== -1 && regionIds.indexOf(memberM.id) === -1, regionIds);
  r = await call("card-grant", { token: regional.token, id: memberM.id });
  check("25.5 карту человеку из другого региона он не выдаёт", r.ok === false && r.code === 403, r);
  r = await call("card-grant", { token: regional.token, id: outsiderO.id });
  check("25.5 карту человеку своего региона выдаёт", r.ok === true && /^СК-/.test(r.number), r);
  const numberO = r.number || "";
  r = await call("card-queue", { token: regional.token });
  check("25.5 в его списке карт только свой регион",
    r.ok === true && r.requests.length >= 1 && r.requests.every((c) => c.userId === outsiderO.id), r.requests && r.requests.map((c) => c.name));
  r = await call("posts-queue", { token: regional.token });
  check("25.5 материалы про свой регион он видит", r.ok === true && r.posts.some((p) => p.id === postO) && !r.posts.some((p) => p.id === postA2), r.posts && r.posts.map((p) => p.title));
  r = await call("card-revoke", { token: regional.token, confirm: await makeConfirm(regional.token), id: "x", note: "проверка права" });
  check("25.5 отзыв карты региональному администратору закрыт", r.ok === false && r.code === 403, r);

  // 25.6 сводка панели — по правам
  r = await call("staff-summary", { token: token4 });
  check("25.6 сводка закрыта обычному участнику", r.ok === false && r.code === 403, r);
  r = await call("staff-summary", { token: authorA.token });
  check("25.6 руководитель редакции: только свои разделы",
    r.ok === true && r.scoped === true && typeof r.summary.posts === "number" && r.summary.people === 2
    && r.summary.consents === undefined && r.summary.cards === undefined && r.summary.support === undefined
    && r.summary.editorialOpen === undefined && r.summary.site === undefined, r);
  check("25.6 счётчик материалов считает только свою редакцию", r.ok === true && r.summary.posts === 2, r.summary);
  r = await call("staff-summary", { token: token3 });
  check("25.6 директор: все разделы",
    r.ok === true && r.scoped === false && ["posts", "consents", "cards", "editorialOpen", "editorialApps", "support", "people", "site", "hiring", "recovery", "portfolio"]
      .every((k) => typeof r.summary[k] === "number"), r.summary);
  r = await call("staff-summary", { token: moder.token });
  check("25.6 модератор: материалы и поддержка, без согласий и карт",
    r.ok === true && typeof r.summary.posts === "number" && typeof r.summary.support === "number" && r.summary.consents === undefined && r.summary.cards === undefined, r.summary);

  // 25.7 лимит отправок — на аккаунт, а не на адрес
  let lastOk = true;
  for (let i = 0; i < 18; i++) {
    r = await call("submit", postPayload(outsiderO.token, "Серия материалов для проверки лимита № " + (i + 1)));
    if (!r.ok) { lastOk = false; break; }
  }
  check("25.7 двадцать отправок в час с аккаунта проходят", lastOk === true, r);
  r = await call("submit", postPayload(outsiderO.token, "Двадцать первый материал за час"));
  r = await call("submit", postPayload(outsiderO.token, "Двадцать второй материал за час"));
  check("25.7 сверх лимита — отказ", r.ok === false && r.code === 429, r);
  r = await call("submit", postPayload(memberM.token, "Материал другого автора с того же адреса"));
  check("25.7 другой автор с того же адреса не заперт", r.ok === true, r);

  // 25.8 удаление аккаунта стирает сканы и гасит карту
  let before = [];
  try { before = await php.readdir("/smena-data/consents"); } catch (e) {}
  r = await call("account-delete", { token: outsiderO.token, pass: "parol1234", confirm: "УДАЛИТЬ" });
  check("25.8 аккаунт удалён", r.ok === true, r);
  let after = [];
  try { after = await php.readdir("/smena-data/consents"); } catch (e) {}
  const mineBefore = before.filter((f) => f.indexOf(outsiderO.id) !== -1).length;
  const mineAfter = after.filter((f) => f.indexOf(outsiderO.id) !== -1).length;
  check("25.8 сканы согласия стёрты вместе с аккаунтом", mineBefore === 2 && mineAfter === 0, { mineBefore, mineAfter });
  r = await call("card-verify", { number: numberO });
  check("25.8 карта удалённого человека недействительна", r.ok === true && r.valid === false && r.name === "", r);
  r = await call("me", { token: token3 });
  check("25.8 сессия директора после чужого удаления жива", r.ok === true, r);
  r = await call("account-delete", { token: token3, pass: "parol4321", confirm: "УДАЛИТЬ" });
  check("25.8 единственный руководитель проекта не удаляется", r.ok === false && r.code === 409, r);

  // 25.9 диагностика: перебор пароля ограничен
  for (let i = 0; i < 10; i++) await call("diag", { pass: "wrong-pass-" + i });
  r = await call("diag", { pass: editorPass });
  check("25.9 после десяти неверных паролей диагностика закрыта и верным", r.ok === false && r.code === 404, r);
  r = await call("diag", { token: token3 });
  check("25.9 вход сотрудника с правом работает и при блокировке пароля", r.ok === true, r);

  /* ======================================================================
     26. РЕДАКЦИЯ ИЗНУТРИ: штат, выход, исключение; имя после согласия;
     преподаватель — роль сбоку от лестницы.
     ====================================================================== */
  const kirill = await newUser("Кирилл Корреспондент", "kirill-k@example.ru", "moskva");
  const lena = await newUser("Лена Литредактор", "lena-l@example.ru", "moskva");
  await giveConsent(kirill);
  await giveConsent(lena);
  async function joinEditorial(user) {
    const a = await call("editorial-apply", { token: user.token, editorialId: editorialX, birthDate: "03.04.2009", why: "Хочу работать в редакции и писать о школьных событиях каждую неделю." });
    return call("editorial-review", { token: authorA.token, id: a.application ? a.application.id : "", decision: "approved" });
  }
  r = await joinEditorial(kirill);
  check("26.1 второй участник принят в редакцию", r.ok === true, r);
  r = await joinEditorial(lena);
  check("26.1 третий участник принят в редакцию", r.ok === true, r);

  // 26.1 что видит о редакции руководитель и что — участник
  r = await call("editorial-mine", { token: authorA.token });
  const rosterHead = (r.roster || []).map((m) => m.id);
  check("26.1 руководитель видит штат своей редакции",
    r.ok === true && r.editorial && r.editorial.id === editorialX && r.member === null && rosterHead.indexOf(authorA.id) !== -1 && rosterHead.indexOf(kirill.id) !== -1 && rosterHead.indexOf(lena.id) !== -1, r.roster);
  check("26.1 в штате руководитель помечен и стоит первым", r.ok === true && r.roster[0].id === authorA.id && r.roster[0].head === true, r.roster && r.roster[0]);
  check("26.1 руководитель видит почту своих людей", r.ok === true && r.roster.some((m) => m.id === kirill.id && m.email === "kirill-k@example.ru"), r.roster);
  r = await call("editorial-mine", { token: kirill.token });
  check("26.1 участник видит свою редакцию", r.ok === true && r.editorial === null && r.member && r.member.id === editorialX && !!r.member.name, r);
  check("26.1 список людей редакции участнику не отдаётся", r.ok === true && Array.isArray(r.roster) && r.roster.length === 0, r.roster);
  check("26.1 входящие заявки участнику не показываются", r.ok === true && Array.isArray(r.incoming) && r.incoming.length === 0, r.incoming);
  check("26.1 в своей заявке стоит название редакции", r.ok === true && r.applications.some((a) => a.editorialId === editorialX && a.editorialName), r.applications);
  r = await call("editorial-mine", { token: token4 });
  check("26.1 человек вне редакций: ни редакции, ни штата", r.ok === true && r.member === null && r.editorial === null && r.roster.length === 0, r);

  // 26.2 выход из редакции
  r = await call("editorial-leave", { token: authorA.token });
  check("26.2 руководитель из своей редакции не выходит", r.ok === false && r.code === 409, r);
  r = await call("editorial-leave", { token: token4 });
  check("26.2 выйти можно только из редакции, где состоишь", r.ok === false && r.code === 409, r);
  await setUser(kirill.id, { access: "Редактор" });
  r = await call("posts-queue", { token: kirill.token });
  check("26.2 редактор редакции видит очередь своей редакции", r.ok === true && r.scoped === true, r);
  r = await call("editorial-leave", { token: kirill.token });
  check("26.2 участник вышел из редакции", r.ok === true && r.roleReset === true && r.roleWas === "Редактор", r);
  r = await call("me", { token: kirill.token });
  check("26.2 после выхода редакции нет, а роль в ней снята", r.ok === true && !r.user.editorialId && r.user.access === "Пользователь", r.user);
  r = await call("posts-queue", { token: kirill.token });
  check("26.2 очередь бывшей редакции закрыта", r.ok === false && r.code === 403, r);
  r = await call("editorial-mine", { token: kirill.token });
  check("26.2 в заявках стоит отметка «вышел»", r.ok === true && r.member === null && r.applications.some((a) => a.status === "left"), r.applications);
  r = await call("editorial-mine", { token: authorA.token });
  check("26.2 в штате его больше нет", r.ok === true && !r.roster.some((m) => m.id === kirill.id), r.roster);
  r = await call("messages-mine", { token: authorA.token });
  check("26.2 руководитель получил сообщение о выходе", r.ok === true && r.messages.some((m) => /Кирилл Корреспондент вышел из редакции/.test(m.text)), r.messages);
  r = await joinEditorial(kirill);
  check("26.2 после выхода можно вступить снова", r.ok === true, r);

  // 26.3 исключение из редакции
  r = await call("editorial-exclude", { token: kirill.token, userId: lena.id, note: "не сдаёт материалы" });
  check("26.3 участник участника не исключает", r.ok === false && r.code === 403, r);
  r = await call("editorial-exclude", { token: authorA.token, userId: lena.id, note: "нет" });
  check("26.3 без причины не исключить", r.ok === false && r.code === 400, r);
  r = await call("editorial-exclude", { token: authorA.token, userId: authorA.id, note: "проверка защиты" });
  check("26.3 себя не исключить", r.ok === false && r.code === 403, r);
  r = await call("editorial-exclude", { token: token3, userId: authorA.id, note: "проверка защиты" });
  check("26.3 руководителя редакции не исключить даже директору", r.ok === false && r.code === 403, r);
  r = await call("editorial-exclude", { token: authorA.token, userId: token4 ? "нет-такого" : "", note: "проверка защиты" });
  check("26.3 несуществующий человек — отказ", r.ok === false && r.code === 404, r);
  r = await call("editorial-exclude", { token: moder.token, userId: lena.id, note: "проверка права" });
  check("26.3 модератор из чужой редакции не исключает", r.ok === false && r.code === 403, r);
  r = await call("editorial-exclude", { token: authorA.token, userId: lena.id, note: "Три месяца не сдаёт материалы." });
  check("26.3 руководитель исключил участника", r.ok === true, r);
  r = await call("me", { token: lena.token });
  check("26.3 исключённый больше не в редакции", r.ok === true && !r.user.editorialId, r.user);
  r = await call("messages-mine", { token: lena.token });
  check("26.3 причина пришла человеку сообщением", r.ok === true && r.messages.some((m) => /Причина: Три месяца не сдаёт материалы\. Писать/.test(m.text)), r.messages);
  r = await call("editorial-mine", { token: lena.token });
  check("26.3 в заявках стоит отметка «исключён»", r.ok === true && r.applications.some((a) => a.status === "excluded"), r.applications);
  r = await call("editorial-exclude", { token: token3, userId: kirill.id, note: "Решение центральной редакции." });
  check("26.3 директор исключает участника любой редакции", r.ok === true, r);

  // 26.4 имя после принятого согласия закреплено
  r = await call("profile-save", { token: lena.token, name: "Елена Другая", role: "Фотограф", region: "moskva" });
  check("26.4 имя после принятого согласия не изменить", r.ok === false && r.code === 409, r);
  r = await call("profile-save", { token: lena.token, name: "Лена Литредактор", role: "Фотограф", region: "moskva" });
  check("26.4 остальные поля профиля сохраняются", r.ok === true && r.user.role === "Фотограф" && r.user.name === "Лена Литредактор", r);
  r = await call("profile-save", { token: token4, name: "Имя До Согласия", role: "Автор текстов", region: "moskva" });
  check("26.4 без принятого согласия имя меняется свободно", r.ok === true && r.user.name === "Имя До Согласия", r);

  // 26.4 (продолжение) удаление аккаунта снимает материалы с сайта и стирает имя
  r = await call("submit", postPayload(lena.token, "Материал автора, который потом удалит аккаунт"));
  const postL = r.post ? r.post.id : "";
  r = await call("review", { token: token3, confirm: await makeConfirm(token3), id: postL, decision: "approve" });
  check("26.4 материал опубликован до удаления аккаунта", r.ok === true && r.post.status === "published", r);
  r = await call("state", {});
  check("26.4 материал виден на сайте с именем автора", r.ok === true && r.posts.some((p) => p.id === postL && p.authorName === "Лена Литредактор"), r.posts && r.posts.length);
  r = await call("account-delete", { token: lena.token, pass: "parol1234", confirm: "УДАЛИТЬ" });
  check("26.4 автор удалил аккаунт", r.ok === true, r);
  r = await call("state", {});
  check("26.4 после удаления аккаунта материал снят с сайта", r.ok === true && !r.posts.some((p) => p.id === postL), r.posts && r.posts.map((p) => p.title));
  check("26.4 имени удалённого человека в ленте нет", r.ok === true && !r.posts.some((p) => p.authorName === "Лена Литредактор"), r.posts && r.posts.map((p) => p.authorName));
  r = await call("posts-queue", { token: token3 });
  check("26.4 в очереди редакции его материалов нет", r.ok === true && !r.posts.some((p) => p.id === postL || p.authorName === "Лена Литредактор"), r.posts && r.posts.map((p) => p.title));

  // 26.5 преподаватель: только школа
  const teacherT = await newUser("Тамара Преподаватель", "teacher-t@example.ru", "moskva");
  await setUser(teacherT.id, { access: "Преподаватель" });
  r = await call("whoami", { token: teacherT.token });
  const capsT = (r.user && r.user.caps) || [];
  check("26.5 у преподавателя только права школы",
    r.ok === true && capsT.indexOf("school.teach") !== -1 && capsT.indexOf("school.review") !== -1 && capsT.every((c) => c.indexOf("school.") === 0), capsT);
  r = await call("posts-queue", { token: teacherT.token });
  check("26.5 очередь материалов преподавателю закрыта", r.ok === false && r.code === 403, r);
  r = await call("users", { token: teacherT.token });
  check("26.5 список людей преподавателю закрыт", r.ok === false && r.code === 403, r);
  r = await call("support-queue", { token: teacherT.token });
  check("26.5 обращения в поддержку преподавателю закрыты", r.ok === false && r.code === 403, r);
  r = await call("consent-queue", { token: teacherT.token });
  check("26.5 согласия преподавателю закрыты", r.ok === false && r.code === 403, r);
  r = await call("staff-summary", { token: teacherT.token });
  check("26.5 панель преподавателю открыта, но без чужих разделов",
    r.ok === true && r.summary.posts === undefined && r.summary.people === undefined && r.summary.support === undefined && r.summary.consents === undefined, r);

  // 26.6 блок авторов на главной работает без расширения mbstring
  r = await call("top-authors", {});
  check("26.6 список авторов отдаётся", r.ok === true && Array.isArray(r.authors), r);
  check("26.6 у авторов есть инициалы", r.ok === true && r.authors.every((a) => typeof a.initials === "string" && a.initials.length >= 1), r.authors && r.authors.slice(0, 3));

  /* ======================================================================
     27. ОТЧЁТЫ РЕДАКЦИЙ: текст пишет руководитель, цифры считает сервер,
     принимает центральная редакция.
     ====================================================================== */
  const monthBack = (n) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
  const fullReport = { done: "Выпустили три материала, записали подкаст и провели планёрку с новыми авторами.",
    plans: "Серия интервью с учителями.", problems: "Нужен микрофон.", events: "" };

  r = await call("report-mine", { token: authorA.token });
  check("27.1 у новой редакции отчётных месяцев ещё нет",
    r.ok === true && r.editorial && r.editorial.id === editorialX && r.periods.length === 0 && r.current && typeof r.current.stats.members === "number", r);
  check("27.1 цифры текущего месяца считает сервер: материалы участников учтены",
    r.ok === true && r.current.stats.published >= 1 && r.current.stats.submitted >= 1 && r.current.stats.members >= 1, r.current && r.current.stats);
  r = await call("report-mine", { token: token4 });
  check("27.1 не руководителю отчёты не показываются", r.ok === true && r.editorial === null && r.periods.length === 0, r);
  r = await call("report-save", { token: token4, period: monthBack(1), form: fullReport, send: true });
  check("27.1 отчёт сдаёт только руководитель редакции", r.ok === false && r.code === 403, r);
  r = await call("report-save", { token: authorA.token, period: monthBack(1), form: fullReport, send: true });
  check("27.1 за месяц до открытия редакции отчёт не сдать", r.ok === false && r.code === 400, r);
  r = await call("report-mine", {});
  check("27.1 без входа отчёты закрыты", r.ok === false && r.code === 401, r);

  // редакция «открыта» два месяца назад: появились отчётные месяцы
  await editJson("editorials.json", (list) => list.map((e) => (e.id === editorialX ? Object.assign({}, e, { createdAt: monthBack(2) + "-03T10:00:00+00:00" }) : e)));
  r = await call("report-mine", { token: authorA.token });
  check("27.2 отчётные месяцы: с открытия редакции до прошлого месяца",
    r.ok === true && r.periods.length === 2 && r.periods[0].period === monthBack(1) && r.periods[1].period === monthBack(2) && r.periods.every((p) => p.status === "none"), r.periods);
  check("27.2 просроченный месяц помечен", r.ok === true && r.periods[1].overdue === true && /^\d{4}-\d{2}-05$/.test(r.periods[1].due), r.periods && r.periods[1]);
  r = await call("report-save", { token: authorA.token, period: monthBack(0), form: fullReport, send: true });
  check("27.2 за текущий месяц отчёт не сдать", r.ok === false && r.code === 400, r);
  r = await call("report-save", { token: authorA.token, period: "2026-13", form: fullReport, send: true });
  check("27.2 несуществующий месяц — отказ", r.ok === false && r.code === 400, r);
  r = await call("report-save", { token: authorA.token, period: monthBack(2), form: { done: "коротко" }, send: true });
  check("27.2 пустой отчёт не отправить", r.ok === false && r.code === 400, r);
  r = await call("report-save", { token: authorA.token, period: monthBack(2), form: { done: "коротко" }, send: false });
  check("27.2 черновик сохраняется", r.ok === true && r.report.status === "draft" && r.report.form.done === "коротко", r);
  r = await call("report-queue", { token: token3 });
  check("27.2 черновик центральной редакции не виден", r.ok === true && r.reports.length === 0, r.reports);
  check("27.2 редакция с просроченным отчётом — в списке несдавших",
    r.ok === true && r.missing.some((m) => m.editorialId === editorialX && m.period === monthBack(2) && m.status === "draft"), r.missing);

  // отправка и решение
  r = await call("report-save", { token: authorA.token, period: monthBack(2), form: fullReport, send: true });
  check("27.3 отчёт отправлен", r.ok === true && r.report.status === "sent" && r.report.late === true && r.report.sentBy === "Анна Авторова", r);
  check("27.3 цифры в отчёт подставил сервер",
    r.ok === true && r.report.stats && typeof r.report.stats.published === "number" && r.report.stats.members >= 1 && r.report.stats.period === monthBack(2), r.report && r.report.stats);
  const reportId = r.report ? r.report.id : "";
  r = await call("report-save", { token: authorA.token, period: monthBack(2), form: fullReport, send: true });
  check("27.3 отправленный отчёт не переписать", r.ok === false && r.code === 409, r);
  r = await call("report-queue", { token: authorA.token });
  check("27.3 очередь отчётов руководителю редакции закрыта", r.ok === false && r.code === 403, r);
  r = await call("report-queue", { token: moder.token });
  check("27.3 модератору отчёты закрыты", r.ok === false && r.code === 403, r);
  r = await call("staff-summary", { token: token3 });
  check("27.3 в сводке панели — один отчёт ждёт решения", r.ok === true && r.summary.reports === 1, r.summary);
  r = await call("report-queue", { token: token3 });
  check("27.3 отчёт в очереди с текстом и цифрами",
    r.ok === true && r.reports.length === 1 && r.reports[0].id === reportId && r.reports[0].form.done.indexOf("подкаст") !== -1 && !!r.reports[0].stats, r.reports);
  r = await call("report-review", { token: moder.token, id: reportId, decision: "accepted" });
  check("27.3 решение по отчёту — только центральной редакции", r.ok === false && r.code === 403, r);
  r = await call("report-review", { token: token3, id: reportId, decision: "returned", note: "" });
  check("27.3 вернуть без замечания нельзя", r.ok === false && r.code === 400, r);
  r = await call("report-review", { token: token3, id: reportId, decision: "returned", note: "Добавьте ссылки на вышедшие материалы." });
  check("27.3 отчёт возвращён на доработку", r.ok === true && r.report.status === "returned", r);
  r = await call("report-mine", { token: authorA.token });
  const back = (r.periods || []).find((p) => p.period === monthBack(2));
  check("27.3 руководитель видит замечание", !!back && back.status === "returned" && back.report.note === "Добавьте ссылки на вышедшие материалы." && back.overdue === true, back);
  r = await call("messages-mine", { token: authorA.token });
  check("27.3 замечание пришло сообщением", r.ok === true && r.messages.some((m) => /Отчёт редакции за .* возвращён на доработку/.test(m.text)), r.messages && r.messages.slice(0, 3));
  r = await call("report-save", { token: authorA.token, period: monthBack(2), form: Object.assign({}, fullReport, { events: "Ссылки: /article?id=1" }), send: true });
  check("27.3 исправленный отчёт отправлен заново", r.ok === true && r.report.status === "sent", r);
  r = await call("report-review", { token: token3, id: reportId, decision: "accepted", note: "" });
  check("27.3 отчёт принят", r.ok === true && r.report.status === "accepted" && r.report.decidedBy !== "", r);
  r = await call("report-review", { token: token3, id: reportId, decision: "returned", note: "ещё раз вернуть" });
  check("27.3 решение по отчёту принимается один раз", r.ok === false && r.code === 409, r);
  r = await call("report-save", { token: authorA.token, period: monthBack(2), form: fullReport, send: false });
  check("27.3 принятый отчёт не изменить", r.ok === false && r.code === 409, r);
  r = await call("report-queue", { token: token3 });
  check("27.3 принятый месяц ушёл из несдавших",
    r.ok === true && !r.missing.some((m) => m.period === monthBack(2)) && r.waiting === 0, r.missing);


  /* ======================================================================
     28. МЕДИАШКОЛА: курс → публикация → запись → уроки, тест, задание →
     проверка преподавателем → курс пройден.
     ====================================================================== */
  const lessonsDraft = [
    { title: "Что такое новость", body: "Новость отвечает на вопросы: кто, что, где, когда и почему. Начинаем с главного.", check: "none",
      video: "https://rutube.ru/video/0123456789abcdef0123456789abcdef/" },
    { title: "Проверь себя", body: "", check: "test", pass: 60, questions: [
      { q: "С чего начинается новость?", options: ["С главного", "С истории вопроса", "С цитаты"], answer: 0 },
      { q: "Сколько источников нужно спорному факту?", options: ["Один", "Не меньше двух"], answer: 1 },
      { q: "Можно ли менять цитату?", options: ["Да", "Нет"], answer: 1 },
    ] },
    { title: "Напиши новость", body: "Соберите факты о событии в вашей школе и напишите новость на 800 знаков.", check: "task",
      task: "Пришлите текст новости: заголовок, лид и три абзаца." },
  ];
  const courseDraft = { title: "Новость за один день", summary: "Короткий курс для начинающих авторов: как собрать и написать новость.", level: "Начальный", lessons: lessonsDraft };

  // 28.1 кто создаёт курсы
  r = await call("school-course-save", { token: token4, course: courseDraft });
  check("28.1 обычному участнику создание курсов закрыто", r.ok === false && r.code === 403, r);
  r = await call("school-course-save", { token: moder.token, course: courseDraft });
  check("28.1 модератору создание курсов закрыто", r.ok === false && r.code === 403, r);
  r = await call("school-course-save", { token: teacherT.token, course: { title: "Курс", summary: "мало", lessons: [{ title: "У", body: "", check: "none", video: "https://youtube.com/watch?v=1" }] } });
  check("28.1 неполный курс не сохраняется, причины перечислены",
    r.ok === false && r.code === 400 && Array.isArray(r.problems) && r.problems.length >= 4 && r.problems.some((p) => /VK Видео или Rutube/.test(p)), r);
  r = await call("school-course-save", { token: teacherT.token, course: courseDraft });
  check("28.1 преподаватель создал курс — черновик", r.ok === true && r.course.status === "draft" && r.course.teacherId === teacherT.id && r.course.lessons.length === 3, r);
  const courseId = r.course ? r.course.id : "";
  const lessonIds = r.course ? r.course.lessons.map((l) => l.id) : [];
  r = await call("school-catalog", {});
  check("28.1 черновика в каталоге нет", r.ok === true && !r.courses.some((c) => c.id === courseId) && r.why === "login", r);
  r = await call("school-course-status", { token: teacherT.token, id: courseId, status: "published" });
  check("28.1 преподаватель сам курс не публикует", r.ok === false && r.code === 403, r);
  const otherTeacher = await newUser("Олег Второй", "teacher-o@example.ru", "moskva");
  await setUser(otherTeacher.id, { access: "Преподаватель" });
  r = await call("school-course-save", { token: otherTeacher.token, course: Object.assign({ id: courseId }, courseDraft, { title: "Чужой курс переписан" }) });
  check("28.1 чужой курс преподаватель не правит", r.ok === false && r.code === 403, r);
  r = await call("school-course-get", { token: otherTeacher.token, id: courseId });
  check("28.1 чужой курс с ответами тестов преподавателю не открыть", r.ok === false && r.code === 403, r);
  r = await call("school-course-save", { token: teacherT.token, course: Object.assign({ id: courseId, ready: true }, courseDraft, { lessons: lessonsDraft.map((l, i) => Object.assign({ id: lessonIds[i] }, l)) }) });
  check("28.1 преподаватель отметил курс готовым, номера уроков сохранились",
    r.ok === true && r.course.ready === true && r.course.lessons.every((l, i) => l.id === lessonIds[i]), r);
  r = await call("staff-summary", { token: token3 });
  check("28.1 директор видит в сводке курс, ждущий публикации", r.ok === true && r.summary.school === 1, r.summary);
  r = await call("school-course-status", { token: token3, id: courseId, status: "published" });
  check("28.1 директор опубликовал курс", r.ok === true && r.course.status === "published", r);
  r = await call("school-catalog", {});
  check("28.1 курс в каталоге: уроки посчитаны, содержимого нет",
    r.ok === true && r.courses.some((c) => c.id === courseId && c.counts.lessons === 3 && c.counts.tests === 1 && c.counts.tasks === 1 && c.lessons === undefined), r.courses);

  // 28.2 запись: почта и согласие
  r = await call("school-enroll", { token: token4, id: courseId });
  check("28.2 без согласия на курс не записаться", r.ok === false && r.code === 403 && r.needConsent === true, r);
  r = await call("school-catalog", { token: token4 });
  check("28.2 каталог объясняет, чего не хватает", r.ok === true && r.canEnroll === false && r.why === "consent", r);
  r = await call("school-course", { token: token4, id: courseId });
  check("28.2 без записи видно только оглавление",
    r.ok === true && r.enrolled === false && r.lessons.length === 3 && r.lessons.every((l) => l.state === "locked" && l.body === undefined && l.questions === undefined), r.lessons);
  const studentS = await newUser("Соня Ученица", "student-s@example.ru", "moskva");
  await giveConsent(studentS);
  r = await call("school-enroll", { token: studentS.token, id: courseId });
  check("28.2 с согласием запись проходит", r.ok === true && r.progress.total === 3 && r.progress.done === 0, r);
  r = await call("school-enroll", { token: studentS.token, id: courseId });
  check("28.2 второй раз на тот же курс не записаться", r.ok === false && r.code === 409, r);
  r = await call("school-course", { token: studentS.token, id: courseId });
  check("28.2 первый урок открыт, остальные закрыты",
    r.ok === true && r.enrolled === true && r.lessons[0].state === "open" && r.lessons[0].body && r.lessons[1].state === "locked" && r.lessons[2].state === "locked", r.lessons && r.lessons.map((l) => l.state));
  check("28.2 в закрытом уроке нет ни текста, ни вопросов", r.ok === true && r.lessons[1].questions === undefined && r.lessons[2].task === undefined, r.lessons && r.lessons[1]);

  // 28.3 уроки по порядку, тест
  r = await call("school-test-send", { token: studentS.token, courseId, lessonId: lessonIds[1], answers: [0, 1, 1] });
  check("28.3 закрытый урок пройти нельзя", r.ok === false && r.code === 409, r);
  r = await call("school-lesson-done", { token: studentS.token, courseId, lessonId: lessonIds[1] });
  check("28.3 урок с тестом кнопкой «изучено» не закрыть", r.ok === false && r.code === 409, r);
  r = await call("school-lesson-done", { token: studentS.token, courseId, lessonId: lessonIds[0] });
  check("28.3 первый урок изучен", r.ok === true && r.state === "done" && r.progress.done === 1, r);
  r = await call("school-course", { token: studentS.token, id: courseId });
  check("28.3 открылся тест: вопросы есть, верных ответов нет",
    r.ok === true && r.lessons[1].state === "open" && r.lessons[1].questions.length === 3 && r.lessons[1].questions.every((q) => q.answer === undefined) && r.lessons[1].pass === 60, r.lessons && r.lessons[1]);
  r = await call("school-test-send", { token: studentS.token, courseId, lessonId: lessonIds[1], answers: [0, 1] });
  check("28.3 тест без ответа на все вопросы не принимается", r.ok === false && r.code === 400, r);
  r = await call("school-test-send", { token: studentS.token, courseId, lessonId: lessonIds[1], answers: [2, 0, 0] });
  check("28.3 тест не сдан: ноль верных", r.ok === true && r.passed === false && r.score === 0 && r.state === "failed" && r.marks.join() === "false,false,false", r);
  r = await call("school-course", { token: studentS.token, id: courseId });
  check("28.3 после несданного теста следующий урок закрыт", r.ok === true && r.lessons[1].state === "failed" && r.lessons[2].state === "locked" && r.lessons[1].test.attempts === 1, r.lessons && r.lessons.map((l) => l.state));
  r = await call("school-test-send", { token: studentS.token, courseId, lessonId: lessonIds[1], answers: [0, 1, 0] });
  check("28.3 тест сдан со второй попытки: два из трёх при пороге 60", r.ok === true && r.passed === true && r.score === 66 && r.state === "done" && r.right === 2, r);

  // 28.4 задание и проверка
  r = await call("school-task-send", { token: studentS.token, courseId, lessonId: lessonIds[2], text: "коротко" });
  check("28.4 слишком короткий ответ не принимается", r.ok === false && r.code === 400, r);
  r = await call("school-task-send", { token: studentS.token, courseId, lessonId: lessonIds[2], text: "В нашей школе открылась студия подкастов. Первый выпуск записали ученики девятого класса.", link: "javascript:alert(1)" });
  check("28.4 ссылка в ответе — только http(s)", r.ok === false && r.code === 400, r);
  r = await call("school-task-send", { token: studentS.token, courseId, lessonId: lessonIds[2], text: "В нашей школе открылась студия подкастов. Первый выпуск записали ученики девятого класса." });
  check("28.4 задание отправлено на проверку", r.ok === true && r.state === "sent" && r.progress.done === 2 && r.completed === false, r);
  r = await call("school-queue", { token: otherTeacher.token });
  check("28.4 чужому преподавателю работа не видна", r.ok === true && r.items.length === 0, r.items);
  r = await call("school-queue", { token: studentS.token });
  check("28.4 ученику очередь проверки закрыта", r.ok === false && r.code === 403, r);
  r = await call("school-queue", { token: teacherT.token });
  check("28.4 преподаватель курса видит работу", r.ok === true && r.items.length === 1 && r.items[0].userName === "Соня Ученица" && /студия подкастов/.test(r.items[0].text), r.items);
  const work = r.items && r.items[0] ? r.items[0] : {};
  r = await call("staff-summary", { token: teacherT.token });
  check("28.4 в сводке преподавателя — одна работа на проверке", r.ok === true && r.summary.school === 1, r.summary);
  r = await call("school-review", { token: otherTeacher.token, enrollId: work.enrollId, lessonId: work.lessonId, decision: "accepted" });
  check("28.4 чужой преподаватель работу не оценивает", r.ok === false && r.code === 403, r);
  r = await call("school-review", { token: teacherT.token, enrollId: work.enrollId, lessonId: work.lessonId, decision: "returned", note: "" });
  check("28.4 вернуть без замечания нельзя", r.ok === false && r.code === 400, r);
  r = await call("school-review", { token: teacherT.token, enrollId: work.enrollId, lessonId: work.lessonId, decision: "returned", note: "Добавьте, когда это произошло." });
  check("28.4 работа возвращена на доработку", r.ok === true && r.completed === false, r);
  r = await call("school-course", { token: studentS.token, id: courseId });
  check("28.4 ученик видит замечание преподавателя",
    r.ok === true && r.lessons[2].state === "returned" && r.lessons[2].review.note === "Добавьте, когда это произошло." && r.lessons[2].answer.text.indexOf("студия") !== -1, r.lessons && r.lessons[2]);
  r = await call("messages-mine", { token: studentS.token });
  check("28.4 замечание пришло сообщением", r.ok === true && r.messages.some((m) => /нужно доработать: Добавьте, когда это произошло/.test(m.text)), r.messages && r.messages.slice(0, 2));
  r = await call("school-task-send", { token: studentS.token, courseId, lessonId: lessonIds[2], text: "В понедельник в нашей школе открылась студия подкастов. Первый выпуск записали ученики девятого класса." });
  check("28.4 исправленная работа отправлена", r.ok === true && r.state === "sent", r);
  r = await call("school-review", { token: teacherT.token, enrollId: work.enrollId, lessonId: work.lessonId, decision: "accepted", note: "Хорошо!" });
  check("28.4 работа принята — курс пройден", r.ok === true && r.completed === true, r);
  r = await call("school-review", { token: teacherT.token, enrollId: work.enrollId, lessonId: work.lessonId, decision: "returned", note: "ещё раз" });
  check("28.4 решение по работе принимается один раз", r.ok === false && r.code === 409, r);
  r = await call("school-catalog", { token: studentS.token });
  const mineCourse = (r.courses || []).find((c) => c.id === courseId);
  check("28.4 в каталоге ученика курс отмечен пройденным", !!mineCourse && mineCourse.enrollStatus === "completed" && mineCourse.progress.percent === 100, mineCourse);
  r = await call("points-history", { token: studentS.token });
  const rules = (r.entries || []).map((h) => h.reason || "");
  check("28.4 начислены баллы за урок, тест, задание и курс",
    r.ok === true && ["school.lesson", "school.test", "school.homework", "school.course"].every((k) => rules.indexOf(k) !== -1), rules);
  r = await call("school-leave", { token: studentS.token, id: courseId });
  check("28.4 с пройденного курса не «уйти»: результат остаётся", r.ok === false && r.code === 409, r);

  // 28.5 ученики курса, снятие с публикации, удаление аккаунта
  r = await call("school-students", { token: teacherT.token, id: courseId });
  check("28.5 преподаватель видит учеников и прогресс", r.ok === true && r.students.length === 1 && r.students[0].status === "completed" && r.students[0].progress.done === 3, r);
  r = await call("school-students", { token: otherTeacher.token, id: courseId });
  check("28.5 чужих учеников преподаватель не видит", r.ok === false && r.code === 403, r);
  r = await call("school-admin", { token: teacherT.token });
  check("28.5 преподаватель видит только свои курсы", r.ok === true && r.courses.length === 1 && r.courses[0].students === 1 && r.canManage === false && r.teachers.length === 0, r);
  r = await call("school-admin", { token: token3 });
  check("28.5 директор видит все курсы и список преподавателей", r.ok === true && r.canManage === true && r.courses.length >= 1 && r.teachers.some((t) => t.id === teacherT.id), r);
  r = await call("school-course-status", { token: token3, id: courseId, status: "archived" });
  check("28.5 курс снят в архив", r.ok === true && r.course.status === "archived", r);
  r = await call("school-catalog", {});
  check("28.5 архивного курса в каталоге нет", r.ok === true && !r.courses.some((c) => c.id === courseId), r.courses);
  r = await call("school-catalog", { token: studentS.token });
  check("28.5 у того, кто учился, курс остаётся в списке", r.ok === true && r.courses.some((c) => c.id === courseId), r.courses);
  r = await call("account-delete", { token: studentS.token, pass: "parol1234", confirm: "УДАЛИТЬ" });
  check("28.5 ученик удалил аккаунт", r.ok === true, r);
  r = await call("school-students", { token: teacherT.token, id: courseId });
  check("28.5 записи и ответы удалённого ученика стёрты", r.ok === true && r.students.length === 0, r);

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
