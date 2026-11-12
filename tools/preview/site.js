/* Настоящий сервер проекта без хостинга: api/index.php исполняется в php-wasm.

   Зачем: посмотреть сайт с работающим входом, очередями и панелью, не трогая
   живой сервер, и прогонять интерфейс в тестах на тех же данных.

   Используют:
     tools/preview/server.js   — сайт в браузере (node tools/preview/server.js)
     tools/tests/ui-checks.js  — кабинет и панель в jsdom

   Рабочие файлы сайта не меняются: код копируется в виртуальную файловую
   систему, данные живут в памяти. Письма никуда не уходят — складываются
   в «исходящие», откуда их показывает сервер просмотра. */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function loadPhp() {
  const tries = [
    "php-wasm/PhpNode",
    path.join(ROOT, "tools", "tests", "node_modules", "php-wasm", "PhpNode"),
    "/tmp/sk-tests/node_modules/php-wasm/PhpNode",
  ];
  for (const id of tries) {
    try { return require(id).PhpNode; } catch (e) { /* следующий вариант */ }
  }
  throw new Error(
    "Не найден пакет php-wasm. Поставьте зависимости тестов:\n" +
    "  mkdir -p /tmp/sk-tests && cp tools/tests/package*.json /tmp/sk-tests/ && (cd /tmp/sk-tests && npm ci)\n" +
    "  export NODE_PATH=/tmp/sk-tests/node_modules");
}

/* Три точечные подмены, без которых PHP в wasm не заработает как сервер:
   тело запроса читается из файла, ответ пишется в файл, письма не уходят. */
function swap(source, from, to, what) {
  if (source.indexOf(from) === -1) {
    throw new Error("Стенд не смог подменить «" + what + "»: строка в коде изменилась.");
  }
  return source.replace(from, to);
}

async function createSite(opts) {
  opts = opts || {};
  const PhpNode = loadPhp();
  const php = new PhpNode();
  php.refresh();

  const DATA = "/smena-data";
  const text = async (p) => {
    const v = await php.readFile(p);
    return Buffer.isBuffer(v) ? v.toString("utf8") : Buffer.from(v).toString("utf8");
  };
  const bytes = async (p) => {
    const v = await php.readFile(p);
    return Buffer.isBuffer(v) ? v : Buffer.from(v);
  };

  async function loadCode() {
    for (const d of ["/site", "/site/api", "/site/api/lib", DATA]) {
      try { await php.mkdir(d); } catch (e) { /* уже есть */ }
    }
    const api = path.join(ROOT, "api");
    for (const lib of fs.readdirSync(path.join(api, "lib"))) {
      if (lib.endsWith(".php")) await php.writeFile("/site/api/lib/" + lib, fs.readFileSync(path.join(api, "lib", lib)));
    }
    let index = fs.readFileSync(path.join(api, "index.php"), "utf8");
    index = swap(index, "$raw = file_get_contents('php://input');",
      "$raw = file_exists(__DIR__ . '/body.json') ? (string) file_get_contents(__DIR__ . '/body.json') : '';", "чтение запроса");
    index = swap(index, `function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}`, `function respond($data, $code = 200) {
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    file_put_contents(__DIR__ . '/out.json', json_encode(array('__code' => $code, '__body' => $json)));
    exit;
}`, "ответ сервера");
    await php.writeFile("/site/api/index.php", index);

    let smtp = fs.readFileSync(path.join(api, "smtp.php"), "utf8");
    smtp = swap(smtp, "function mail_send($to, $subject, $text, $html = '', $kind = '') {",
      `function mail_send($to, $subject, $text, $html = '', $kind = '') {
    @file_put_contents('/site/outbox.jsonl', json_encode(array('at' => date('c'), 'to' => $to,
        'subject' => $subject, 'text' => $text, 'kind' => $kind), JSON_UNESCAPED_UNICODE) . "\\n", FILE_APPEND);
    return true;`, "отправка писем");
    await php.writeFile("/site/api/smtp.php", smtp);
  }

  await loadCode();
  /* почта «настроена»: без этого регистрация закрыта (и это правильно) */
  await php.writeFile(DATA + "/mail.json", JSON.stringify({
    host: "smtp.example.ru", port: 465, secure: "ssl", user: "noreply@smenakontenta.ru",
    pass: "x", from: "noreply@smenakontenta.ru", fromName: "Смена контента", notify: "",
  }));

  /* запросы идут строго по одному: у php-wasm один интерпретатор */
  let chain = Promise.resolve();
  function inLine(job) {
    const run = chain.then(job, job);
    chain = run.then(() => {}, () => {});
    return run;
  }

  async function runOnce(action, body, meta) {
    meta = meta || {};
    const query = Object.assign({}, meta.query || {}, { action });
    await php.writeFile("/site/api/body.json", JSON.stringify(body || {}));
    await php.writeFile("/site/api/driver.php", `<?php
      $_SERVER['REMOTE_ADDR'] = ${JSON.stringify(meta.ip || "203.0.113.9")};
      $_SERVER['HTTP_USER_AGENT'] = ${JSON.stringify(meta.ua || "smena-preview")};
      foreach (json_decode(${JSON.stringify(JSON.stringify(query))}, true) as $k => $v) { $_GET[$k] = (string) $v; }
      /* ошибка PHP не должна выглядеть как «сервер молчит»: пишем её в ответ */
      try {
          require '/site/api/index.php';
      } catch (\\Throwable $e) {
          $text = 'Ошибка PHP: ' . $e->getMessage() . ' (' . basename((string) $e->getFile()) . ':' . $e->getLine() . ')';
          file_put_contents('/site/api/out.json', json_encode(array('__code' => 500,
              '__body' => json_encode(array('ok' => false, 'error' => $text, 'code' => 500, 'phpError' => true), JSON_UNESCAPED_UNICODE))));
      }
    `);
    try { await php.unlink("/site/api/out.json"); } catch (e) { /* не было */ }
    try { php.refresh(); await php.run("<?php require '/site/api/driver.php';"); } catch (e) { /* exit внутри PHP */ }
    for (let i = 0; i < 60; i++) {
      try {
        const box = JSON.parse((await text("/site/api/out.json")).trim());
        let json = null;
        try { json = JSON.parse(box.__body); } catch (e) { json = null; }
        return { status: box.__code || 200, json: json, raw: box.__body };
      } catch (e) { /* ответ ещё не записан */ }
      await new Promise((r) => setTimeout(r, 20));
    }
    return { status: 500, json: { ok: false, error: "Сервер не ответил (ошибка PHP).", code: 500 }, raw: "" };
  }

  const request = (action, body, meta) => inLine(() => runOnce(action, body, meta));
  const call = async (action, body, meta) => (await request(action, body, meta)).json;

  async function readData(file, fallback) {
    try { return JSON.parse(await text(DATA + "/" + file)); } catch (e) { return fallback === undefined ? null : fallback; }
  }
  async function writeData(file, data) {
    await php.writeFile(DATA + "/" + file, JSON.stringify(data));
  }

  /* файл из публичной папки uploads — то, что на хостинге отдаёт action=media */
  async function mediaFile(id) {
    if (!/^[A-Za-z0-9_.-]+$/.test(id) || /^pd_/.test(id)) return null;
    try { return await bytes(DATA + "/uploads/" + id); } catch (e) { return null; }
  }

  async function outbox() {
    let raw = "";
    try { raw = await text("/site/outbox.jsonl"); } catch (e) { return []; }
    return raw.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (e) { return null; }
    }).filter(Boolean);
  }

  /* шестизначный код из последнего письма на адрес */
  async function lastCode(email) {
    const mails = (await outbox()).filter((m) => String(m.to).toLowerCase() === String(email).toLowerCase());
    for (let i = mails.length - 1; i >= 0; i--) {
      const m = /(?:^|\D)(\d{6})(?:\D|$)/.exec(mails[i].text || "");
      if (m) return m[1];
    }
    return "";
  }

  /* «пропуск» подтверждения для вошедшего: то же, что выдаётся после кода из письма */
  async function confirmFor(token) {
    const me = await call("me", { token });
    const id = me && me.user ? me.user.id : "";
    if (!id) throw new Error("confirmFor: токен не работает");
    const all = (await readData("confirm-tokens.json", {})) || {};
    const pass = "preview" + Math.random().toString(16).slice(2).padEnd(25, "0").slice(0, 25);
    all[pass] = { user: id, exp: Math.floor(Date.now() / 1000) + 3600, at: Math.floor(Date.now() / 1000) };
    await writeData("confirm-tokens.json", all);
    return pass;
  }

  async function walk(dir, out) {
    let names = [];
    try { names = await php.readdir(dir); } catch (e) { return out; }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const full = dir + "/" + name;
      let isDir = false;
      try { await php.readdir(full); isDir = true; } catch (e) { isDir = false; }
      if (isDir) await walk(full, out);
      else { try { out[full] = (await bytes(full)).toString("base64"); } catch (e) { /* пропускаем */ } }
    }
    return out;
  }

  /* снимок данных: чтобы просмотр переживал перезапуск */
  const dump = () => inLine(() => walk(DATA, {}));
  const restore = (files) => inLine(async () => {
    for (const full of Object.keys(files || {})) {
      const parts = full.split("/").slice(1, -1);
      let dir = "";
      for (const part of parts) { dir += "/" + part; try { await php.mkdir(dir); } catch (e) { /* есть */ } }
      await php.writeFile(full, Buffer.from(files[full], "base64"));
    }
  });

  return { call, request, readData, writeData, mediaFile, outbox, lastCode, confirmFor, dump, restore,
    loadCode: () => inLine(loadCode) };
}

/* ----------------------------------------------------------------------------
   Демонстрационные данные: по одному человеку на каждую ситуацию, чтобы в
   просмотре было что открыть. Пароль у всех один.
   -------------------------------------------------------------------------- */
const DEMO_PASSWORD = "smena2026";
const PNG = "data:image/png;base64," +
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0, 0, 0, 0]).toString("base64");

async function seedDemo(site) {
  const people = [
    ["director", "Никита Сирик", "director@demo.ru", "Директор", "moskva"],
    ["admin", "Алина Админова", "admin@demo.ru", "Администрация", "moskva"],
    ["editor", "Егор Главред", "editor@demo.ru", "Главный редактор", "moskva"],
    ["teacher", "Тамара Учителева", "teacher@demo.ru", "Преподаватель", "moskva"],
    ["head", "Глеб Руководин", "head@demo.ru", "Пользователь", "respublika-tatarstan"],
    ["member", "Мила Участница", "member@demo.ru", "Пользователь", "respublika-tatarstan"],
    ["author", "Анна Авторова", "author@demo.ru", "Пользователь", "moskva"],
    ["waiting", "Вера Ожидаева", "waiting@demo.ru", "Пользователь", "sankt-peterburg"],
    ["newbie", "Нина Новичкова", "newbie@demo.ru", "Пользователь", "moskva"],
  ];
  const tokens = {}; const ids = {}; const users = {};
  for (const [key, name, email, , region] of people) {
    const res = await site.call("reg", { name, email, pass: DEMO_PASSWORD, region, role: "Автор текстов" });
    if (!res || !res.ok) throw new Error("seedDemo: регистрация " + email + " — " + JSON.stringify(res));
    tokens[key] = res.token; ids[key] = res.user.id; users[key] = { name, email };
  }
  const all = await site.readData("users.json", []);
  for (const u of all) {
    const row = people.find((p) => p[2] === u.email);
    u.emailVerified = true;
    u.status = "active";
    if (row) u.access = row[3];
  }
  await site.writeData("users.json", all);

  const director = tokens.director;
  const approve = async (key) => {
    await site.call("consent-send", { token: tokens[key], pages: [PNG, PNG] });
    const q = await site.call("consent-queue", { token: director });
    const row = (q.consents || []).find((c) => c.userId === ids[key]);
    await site.call("consent-review", { token: director, confirm: await site.confirmFor(director), id: row.id, decision: "approved" });
  };
  for (const key of ["admin", "editor", "teacher", "head", "member", "author"]) await approve(key);
  await site.call("consent-send", { token: tokens.waiting, pages: [PNG] });

  const body = ("В школьной редакции вышел новый выпуск: ребята сами сняли репортаж, записали подкаст " +
    "и сверстали газету. Рассказываем, как это было устроено и чему научились.\n\n").repeat(3);
  const titles = [
    "Как школьная редакция собрала первый выпуск за неделю",
    "Репортаж с городского фестиваля молодёжных медиа",
    "Пять приёмов, которые делают интервью живым",
    "Фотолетопись школьного года: как снимать события",
    "Подкаст на перемене: опыт одной редакции",
  ];
  const posts = [];
  for (const title of titles) {
    const res = await site.call("submit", { token: tokens.author, title,
      excerpt: "Короткий рассказ о том, как это было и что получилось.", body, topic: "Школа", format: "Статья", region: "moskva" });
    posts.push(res.post.id);
    await site.call("review", { token: director, confirm: await site.confirmFor(director), id: res.post.id, decision: "approve" });
  }
  const pending = await site.call("submit", { token: tokens.author, title: "Как мы готовили выпуск к Дню учителя",
    excerpt: "Материал ждёт проверки редакции.", body, topic: "Школа", format: "Репортаж", region: "moskva" });

  /* редакция в регионе: заявление руководителя → решение директора → участник */
  const form = {
    name: "Казанский школьный вестник", region: "respublika-tatarstan", city: "Казань", base: "school", baseName: "Лицей № 7",
    about: "Редакция лицея № 7: новости, репортажи с городских событий, подкаст и фотолетопись учебного года.",
    headName: "Руководин Глеб Андреевич", headBirth: "2005-04-12", headPhone: "+7 900 123-45-67",
    team: [{ name: "Мила Участница", role: "Корреспондент", age: 16 }, { name: "Тимур Камеров", role: "Фотограф", age: 15 }],
    confirms: { truth: true, rules: true, consents: true, reports: true },
  };
  const app = await site.call("editorial-open-save", { token: tokens.head, submit: true, form });
  await site.call("editorial-open-received", { token: director, id: app.application.id });
  const opened = await site.call("editorial-open-decide", { token: director,
    confirm: await site.confirmFor(director), id: app.application.id, decision: "approved" });
  const editorialId = opened.application.editorialId;
  const join = await site.call("editorial-apply", { token: tokens.member, editorialId,
    birthDate: "03.09.2009", why: "Хочу писать репортажи о событиях лицея и города каждую неделю." });
  await site.call("editorial-review", { token: tokens.head, id: join.application.id, decision: "approved" });
  const memberPost = await site.call("submit", { token: tokens.member, title: "Лицей № 7 открыл собственную студию подкастов",
    excerpt: "Материал участника редакции ждёт проверки руководителя.", body, topic: "Школа", format: "Новость", region: "respublika-tatarstan" });

  /* Отчёты редакции. Редакция «открыта» три месяца назад — иначе сдавать было
     бы нечего: отчёт сдаётся за завершившийся месяц. Один отчёт принят, один
     ждёт решения центральной редакции, один не сдан. */
  const monthsAgo = (n) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - n);
    return d;
  };
  const period = (n) => monthsAgo(n).toISOString().slice(0, 7);
  const editorials = await site.readData("editorials.json", []);
  for (const e of editorials) {
    if (e.id === editorialId) e.createdAt = period(3) + "-10T09:00:00+00:00";
  }
  await site.writeData("editorials.json", editorials);
  const reportText = (n) => ({
    done: "Выпустили материалы о школьных событиях, записали выпуск подкаста и провели планёрку с новыми авторами.",
    events: n === 3 ? "Освещали городской фестиваль школьных медиа." : "",
    problems: "Не хватает петличного микрофона для интервью.",
    plans: "Серия интервью с учителями и фоторепортаж с олимпиады.",
  });
  const first = await site.call("report-save", { token: tokens.head, period: period(3), form: reportText(3), send: true });
  if (!first || !first.ok) throw new Error("seedDemo: отчёт редакции — " + JSON.stringify(first));
  await site.call("report-review", { token: tokens.editor, id: first.report.id, decision: "accepted", note: "Спасибо, хороший месяц." });
  await site.call("report-save", { token: tokens.head, period: period(2), form: reportText(2), send: true });

  /* карты: одна выдана (есть что открыть и проверить), одна заявка ждёт решения */
  const granted = await site.call("card-grant", { token: director, id: ids.head });
  if (!granted || !granted.ok) throw new Error("seedDemo: карта руководителю — " + JSON.stringify(granted));
  await site.call("card-apply", { token: tokens.author });

  /* второе заявление на открытие редакции — ждёт подписанного скана */
  const second = await site.call("editorial-open-save", { token: tokens.author, submit: true, form: {
    name: "Медиацентр «Перемена»", region: "moskva", city: "Москва", base: "youth", baseName: "Молодёжный центр «Перемена»",
    about: "Команда молодёжного центра: еженедельные новости района, видеосюжеты и интервью с интересными людьми.",
    headName: "Авторова Анна Сергеевна", headBirth: "2009-02-20", headPhone: "+7 900 765-43-21",
    curator: { name: "Орлова Ирина Павловна", role: "педагог-организатор", phone: "+7 900 111-22-33", email: "orlova@demo.ru" },
    team: [{ name: "Пётр Монтажёров", role: "Видео", age: 15 }, { name: "Дина Ведущая", role: "Ведущая", age: 16 }],
    confirms: { truth: true, rules: true, consents: true, reports: true },
  } });
  if (!second || !second.ok) throw new Error("seedDemo: второе заявление — " + JSON.stringify(second));

  /* Медиашкола: один курс опубликован (автор учится: урок пройден, тест сдан,
     задание ждёт проверки), второй — черновик, который ждёт публикации. */
  const lessons = [
    { title: "Что делает новость новостью", check: "none", video: "https://rutube.ru/video/0123456789abcdef0123456789abcdef/",
      body: "Новость — это ответ на простые вопросы: **кто, что, где, когда и почему**. Главное стоит в первом предложении.\n\n" +
        "## С чего начать\n\n- найдите событие, которое только что произошло;\n- проверьте его по двум источникам;\n- запишите факты до того, как писать текст.\n\n" +
        "> Если факт нельзя подтвердить — его не должно быть в тексте." },
    { title: "Проверь себя", check: "test", pass: 60, body: "", questions: [
      { q: "С чего начинается новость?", options: ["С самого главного", "С истории вопроса", "С цитаты героя"], answer: 0 },
      { q: "Сколько источников нужно спорному факту?", options: ["Достаточно одного", "Не меньше двух"], answer: 1 },
      { q: "Можно ли менять слова в цитате?", options: ["Да, если так красивее", "Нет, цитата — дословно"], answer: 1 },
    ] },
    { title: "Напишите свою новость", check: "task",
      body: "Выберите событие в своей школе, дворе или городе, которое произошло на этой неделе. Соберите факты и напишите новость на 800–1200 знаков.",
      task: "Пришлите текст новости: заголовок, первое предложение с главным и два-три абзаца с деталями. Укажите, откуда вы знаете факты." },
    { title: "Что дальше", check: "none",
      body: "Вы написали первую новость. Следующий шаг — отправить материал в редакцию: раздел «Написать материал». Редактор проверит факты и поможет с заголовком." },
  ];
  const course = await site.call("school-course-save", { token: tokens.teacher, course: {
    title: "Новость за один день", level: "Начальный", lessons,
    summary: "Короткий курс для начинающих авторов: как найти событие, проверить факты и написать новость, которую примет редакция.",
  } });
  if (!course || !course.ok) throw new Error("seedDemo: курс — " + JSON.stringify(course));
  await site.call("school-course-status", { token: director, id: course.course.id, status: "published" });
  const ids2 = course.course.lessons.map((l) => l.id);
  await site.call("school-enroll", { token: tokens.author, id: course.course.id });
  await site.call("school-lesson-done", { token: tokens.author, courseId: course.course.id, lessonId: ids2[0] });
  await site.call("school-test-send", { token: tokens.author, courseId: course.course.id, lessonId: ids2[1], answers: [0, 1, 1] });
  await site.call("school-task-send", { token: tokens.author, courseId: course.course.id, lessonId: ids2[2],
    text: "Школьная студия подкастов открылась в лицее № 7. В понедельник ученики девятого класса записали первый выпуск — о том, как выбрать профиль обучения. " +
      "Студию оборудовали в бывшей лаборантской. Об этом рассказала руководитель студии на открытии, я была там сама." });
  await site.call("school-course-save", { token: tokens.teacher, course: {
    title: "Интервью без страха", level: "Средний", ready: true,
    summary: "Как готовиться к разговору, задавать вопросы и превращать запись в текст. Курс ждёт публикации.",
    lessons: [{ title: "Подготовка к разговору", check: "none", body: "Перед интервью узнайте о герое всё, что можно найти, и запишите десять вопросов." }],
  } });

  /* обращение в поддержку — чтобы очередь в панели была не пустой */
  await site.call("support-send", { name: "Нина Новичкова", email: "newbie@demo.ru", topic: "Аккаунт",
    message: "Здравствуйте! Подскажите, как отправить согласие, если мне 13 лет и подписывает мама?" });

  return { tokens, ids, users, password: DEMO_PASSWORD, posts, pendingPost: pending.post.id,
    memberPost: memberPost.post ? memberPost.post.id : "", editorialId, png: PNG,
    cardNumber: granted.number || "", cardId: (granted.card && granted.card.id) || "",
    openDone: app.application.id, openWaiting: second.application.id, courseId: course.course.id };
}

module.exports = { createSite, seedDemo, DEMO_PASSWORD, ROOT };
