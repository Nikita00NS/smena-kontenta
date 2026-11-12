/* Просмотр сайта с работающим сервером — без хостинга.

     node tools/preview/server.js            → http://localhost:8080
     PORT=3000 node tools/preview/server.js  → другой порт
     node tools/preview/server.js --empty    → без демо-людей (чистый сайт)

   Что это: обычный веб-сервер отдаёт файлы сайта, а запросы к /api/index.php
   исполняет настоящий код проекта (api/index.php в php-wasm, см. site.js).
   Вход, согласия, очереди, панель — всё работает как на хостинге.

   Чего здесь нет: данные живут в памяти и пропадают при остановке; письма
   никуда не уходят — их видно на странице /__preview (там же коды из писем
   и список демо-аккаунтов). Живой сайт и его данные этот сервер не трогает. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createSite, seedDemo, DEMO_PASSWORD, ROOT } = require("./site.js");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const EMPTY = process.argv.includes("--empty");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
};
const MEDIA_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};
/* то, что на хостинге не выкладывается или закрыто */
const HIDDEN = /^\/(tools|node_modules|\.git|\.github)(\/|$)|^\/(README|RELEASE)\.md$|\/\.[^/]+$/;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ "Cache-Control": "no-store" }, headers || {}));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { reject(new Error("слишком большой запрос")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* Короткие адреса, как в .htaccess: /about → /about/index.html */
function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p.includes("\0") || p.includes("..")) return null;
  if (HIDDEN.test(p)) return null;
  if (p === "/") p = "/index.html";
  let full = path.join(ROOT, p);
  if (!full.startsWith(ROOT)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) full = path.join(full, "index.html");
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  return null;
}

function previewPage(seed, mails) {
  const people = seed ? [
    ["director@demo.ru", "Директор", "вся панель: люди, согласия, карты, редакции, сайт, сервер"],
    ["admin@demo.ru", "Администрация", "люди, согласия, карты, приём заявлений на редакции"],
    ["editor@demo.ru", "Главный редактор", "материалы, публикация без очереди, отчёты редакций"],
    ["teacher@demo.ru", "Преподаватель", "только медиашкола: уроки и проверка заданий"],
    ["head@demo.ru", "Руководитель редакции", "«Казанский школьный вестник»: штат, заявки, отчёты; есть пресс-карта"],
    ["member@demo.ru", "Участник редакции", "материал ждёт проверки руководителя"],
    ["author@demo.ru", "Автор", "5 публикаций, заявка на карту, заявление на открытие редакции"],
    ["waiting@demo.ru", "Автор", "согласие отправлено и ждёт проверки"],
    ["newbie@demo.ru", "Новичок", "согласия нет: редактор и заявки закрыты"],
  ] : [];
  const rows = people.map((p) => "<tr><td><code>" + esc(p[0]) + "</code></td><td>" + esc(p[1]) + "</td><td>" + esc(p[2]) + "</td></tr>").join("");
  const list = mails.slice(-40).reverse().map((m) => {
    const code = /(?:^|\D)(\d{6})(?:\D|$)/.exec(m.text || "");
    return "<article><header><b>" + esc(m.subject) + "</b><span>" + esc(m.to) + " · " + esc(String(m.at).slice(11, 19)) + "</span></header>" +
      (code ? '<p class="code">Код: <b>' + esc(code[1]) + "</b></p>" : "") +
      "<pre>" + esc(String(m.text || "").slice(0, 900)) + "</pre></article>";
  }).join("");
  return "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Просмотр: аккаунты и почта</title><meta http-equiv=\"refresh\" content=\"20\"><style>" +
    "body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#0f0f0f;color:#eee}main{max-width:980px;margin:0 auto;padding:28px 18px 60px}" +
    "a{color:#ff6a3d}h1{font-size:26px;margin:0 0 6px}h2{font-size:18px;margin:34px 0 10px}p{margin:0 0 10px;color:#bbb}" +
    "table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px 10px;border-bottom:1px solid #2a2a2a;text-align:left;vertical-align:top}" +
    "code{background:#1d1d1d;padding:2px 6px;border-radius:4px;color:#fff}article{border:1px solid #2a2a2a;background:#161616;padding:12px 14px;margin:0 0 10px}" +
    "article header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}article header span{color:#888;font-size:13px}" +
    "pre{white-space:pre-wrap;margin:8px 0 0;color:#aaa;font:13px/1.45 ui-monospace,monospace}.code{margin:8px 0 0;color:#eee}.code b{font-size:20px;letter-spacing:.12em;color:#ff6a3d}" +
    ".bar{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 0}.bar a{border:1px solid #333;padding:7px 12px;text-decoration:none;color:#eee}.bar a:hover{border-color:#ff6a3d}" +
    "</style></head><body><main>" +
    "<h1>Просмотр сайта с работающим сервером</h1>" +
    "<p>Это копия сайта для проверки: данные демонстрационные, хранятся в памяти и пропадают при остановке сервера. Живой сайт не затрагивается.</p>" +
    '<div class="bar"><a href="/">Главная</a><a href="/join#login">Вход</a><a href="/profile">Кабинет</a><a href="/admin">Панель проекта</a>' +
    '<a href="/media-school">Медиашкола</a><a href="/verify' + (seed && seed.cardNumber ? "?n=" + encodeURIComponent(seed.cardNumber) : "") + '">Проверка карты</a><a href="/docs">Документы</a></div>' +
    (seed
      ? "<h2>Демо-аккаунты</h2><p>Пароль у всех один: <code>" + esc(DEMO_PASSWORD) + "</code></p>" +
        "<table><tr><th>Почта</th><th>Кто это</th><th>Что посмотреть</th></tr>" + rows + "</table>"
      : "<h2>Сайт пустой</h2><p>Сервер запущен с ключом --empty: зарегистрируйтесь, первый аккаунт можно сделать директором.</p>") +
    "<h2>Почта: письма, которые «отправил» сайт</h2>" +
    "<p>Важные действия в панели подтверждаются кодом из письма. Здесь письма никуда не уходят — код берите отсюда. Страница обновляется сама раз в 20 секунд.</p>" +
    (list || "<p>Писем пока нет.</p>") +
    "</main></body></html>";
}

(async () => {
  const t0 = Date.now();
  process.stdout.write("Запускаем сервер проекта (PHP в браузерном движке)… ");
  const site = await createSite();
  let seed = null;
  if (!EMPTY) {
    process.stdout.write("готово.\nСоздаём демо-данные (около минуты)… ");
    seed = await seedDemo(site);
  }
  console.log("готово за " + Math.round((Date.now() - t0) / 1000) + " с.");

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, "http://preview.local"); } catch (e) { send(res, 400, "bad request"); return; }
    const p = url.pathname;
    try {
      /* сервер проекта */
      if (p === "/api/index.php" || p === "/api/") {
        const query = {};
        url.searchParams.forEach((v, k) => { query[k] = v; });
        if (req.method === "GET" && query.action === "media") {
          const id = path.basename(String(query.id || ""));
          const ext = id.split(".").pop().toLowerCase();
          const bin = MEDIA_TYPES[ext] ? await site.mediaFile(id) : null;
          if (!bin) { send(res, 404, ""); return; }
          send(res, 200, bin, { "Content-Type": MEDIA_TYPES[ext], "Content-Disposition": 'inline; filename="' + id + '"', "X-Content-Type-Options": "nosniff" });
          return;
        }
        let body = {};
        if (req.method === "POST") {
          const raw = await readBody(req);
          try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; }
        }
        const action = String(query.action || body.action || "");
        const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "203.0.113.9").split(",")[0].trim();
        const out = await site.request(action, body, { query, ip, ua: req.headers["user-agent"] || "" });
        send(res, out.status || 200, out.raw || JSON.stringify(out.json), { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        return;
      }
      if (p.startsWith("/api/")) { send(res, 403, "закрыто"); return; }

      /* служебная страница просмотра */
      if (p === "/__preview" || p === "/__preview/") {
        send(res, 200, previewPage(seed, await site.outbox()), { "Content-Type": "text/html; charset=utf-8" });
        return;
      }

      /* старые адреса вида /about.html → /about, как в .htaccess */
      if (/\.html$/.test(p) && !/\/index\.html$/.test(p) && p !== "/404.html") {
        send(res, 301, "", { Location: p.replace(/\.html$/, "") + url.search });
        return;
      }
      if (p === "/index.html") { send(res, 301, "", { Location: "/" + url.search }); return; }

      const file = resolveFile(p);
      if (file) {
        const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
        send(res, 200, fs.readFileSync(file), { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
        return;
      }
      const notFound = path.join(ROOT, "404.html");
      send(res, 404, fs.existsSync(notFound) ? fs.readFileSync(notFound) : "Страница не найдена", { "Content-Type": "text/html; charset=utf-8" });
    } catch (e) {
      console.log("ошибка запроса", p, e && e.message);
      send(res, 500, JSON.stringify({ ok: false, error: "Ошибка сервера просмотра: " + (e && e.message) }), { "Content-Type": "application/json; charset=utf-8" });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log("");
    console.log("Сайт:            http://localhost:" + PORT + "/");
    console.log("Аккаунты и почта: http://localhost:" + PORT + "/__preview");
    if (seed) console.log("Пароль демо-аккаунтов: " + DEMO_PASSWORD + " (director@demo.ru, author@demo.ru, head@demo.ru …)");
    console.log("Остановить: Ctrl+C. Данные хранятся в памяти и после остановки пропадают.");
  });
})().catch((e) => {
  console.log("\nНе удалось запустить просмотр: " + (e && (e.message || e)));
  process.exit(1);
});
