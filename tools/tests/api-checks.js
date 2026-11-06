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
  for (const d of ["/site", "/site/api", "/smena-data"]) {
    try { await php.mkdir(d); } catch (e) {}
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
  await push(SRC + "/smtp.php", "/site/api/smtp.php");

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
  const token1 = r.token;

  r = await call("reg", { name: "Короткий", email: "weak@example.ru", pass: "parol12" });
  check("пароль короче 8 не принимается", r.ok === false, r);

  // 3. выдача директора только по паролю редакции
  r = await call("claim-director", { token: token1 });
  check("claim-director без пароля — отказ", r.ok === false && r.code === 403, r);
  r = await call("claim-director", { token: token1, password: editorPass });
  check("claim-director с паролем — директор", r.ok === true && r.user.access === "Директор", r);

  // 4. админские маршруты недоступны обычному пользователю
  r = await call("reg", { name: "Тест Второй", email: "second@example.ru", pass: "parol1234" });
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
  check("mail-setup без пароля закрыт", r.ok === false && r.code === 403, r);

  // 9. редакционные очереди по паролю
  r = await call("queue", { password: "Redakcia-Smena-2026" });
  check("старый пароль из репозитория не работает", r.ok === false && r.code === 403, r);
  r = await call("queue", { password: editorPass });
  check("очередь по новому паролю открыта", r.ok === true, r);

  // 10. восстановление: нет утечки имени по чужой почте
  r = await call("recovery-request", { email: "first@example.ru", note: "не помню пароль совсем" });
  check("заявка на восстановление принята", r.ok === true, r);
  check("в ответе нет имени", r.request && r.request.name === undefined, r.request);

  // 11. support и state
  r = await call("state", {});
  check("state отвечает", r.ok === true && Array.isArray(r.posts), r);
  r = await call("support-send", { name: "Гость", email: "guest@example.ru", message: "Здравствуйте, вопрос по проекту" });
  check("обращение принимается", r.ok === true, r);

  console.log("\n=== ИТОГ ===");
  let bad = 0;
  results.forEach((x) => {
    if (!x.ok) bad++;
    console.log((x.ok ? "  ok   " : "  FAIL ") + x.name + (x.ok ? "" : " → " + x.extra));
  });
  console.log(bad === 0 ? "\nвсе проверки пройдены" : "\nпровалено: " + bad);
  process.exit(bad === 0 ? 0 : 1);
 } catch (e) {
   console.log("СБОЙ ПРОГОНА:", e && (e.message || e.errno || e));
   process.exit(2);
 }
})();
