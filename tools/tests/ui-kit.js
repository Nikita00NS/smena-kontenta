/* Стенд для проверки интерфейса: страницы сайта в jsdom, запросы идут в
   настоящий сервер проекта (api/index.php в php-wasm, см. tools/preview/site.js).

   Так проверяется связка целиком: страница → Store → сервер → данные → экран.
   Браузера в стенде нет, поэтому вёрстку и печать он не видит — только
   поведение: что нарисовалось, что ушло на сервер, что сервер ответил. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { JSDOM, VirtualConsole } = require("jsdom");
const { createSite, seedDemo, ROOT } = require("../preview/site.js");

/* jsdom не умеет навигацию, canvas и печать — это шум стенда, не ошибки сайта */
const ARTIFACT = /Not implemented/i;

const scripts = {};
function inline(html) {
  return html
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "")
    .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      const clean = src.split("?")[0];
      const file = path.join(ROOT, clean);
      if (!fs.existsSync(file)) return "<script>window.__missing = (window.__missing || []).concat(" + JSON.stringify(clean) + ");</script>";
      if (!scripts[file]) scripts[file] = fs.readFileSync(file, "utf8");
      return "<script>\n" + scripts[file] + "\n</script>";
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Открыть страницу. rel — папка страницы ("profile", "admin", "" — главная).
   opts: token (войти под аккаунтом), confirm (готовый пропуск подтверждения),
   hash, search, storage (что положить в localStorage до загрузки). */
async function openPage(site, rel, opts) {
  opts = opts || {};
  const file = path.join(ROOT, rel ? rel + "/index.html" : "index.html");
  if (!fs.existsSync(file)) throw new Error("нет страницы " + rel);
  const errors = [];
  const calls = [];
  const opened = [];
  const alerts = [];
  let printed = 0;
  const vc = new VirtualConsole();
  const push = (msg) => { if (!ARTIFACT.test(msg)) errors.push(String(msg).slice(0, 500)); };
  vc.on("jsdomError", (e) => push("jsdomError: " + ((e && (e.detail && (e.detail.stack || e.detail.message) || e.stack || e.message)) || e)));
  vc.on("error", (...a) => push("console.error: " + a.map(String).join(" ")));

  let user = null;
  if (opts.token) {
    const me = await site.call("me", { token: opts.token });
    if (!me || !me.ok) throw new Error("openPage: токен не работает (" + rel + ")");
    user = me.user;
  }

  let blobs = 0;
  const dom = new JSDOM(inline(fs.readFileSync(file, "utf8")), {
    url: "https://smenakontenta.ru/" + (rel ? rel : "") + (opts.search || "") + (opts.hash || ""),
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (opts.token) {
        window.localStorage.setItem("smena_token_v1", opts.token);
        window.localStorage.setItem("smena_user_v1", JSON.stringify(user));
      }
      if (opts.confirm) {
        window.localStorage.setItem("smena_confirm", JSON.stringify({ t: opts.confirm, exp: Date.now() + 1800000 }));
      }
      Object.keys(opts.storage || {}).forEach((k) => window.localStorage.setItem(k, opts.storage[k]));
      window.fetch = (url, init) => {
        let body = {};
        try { body = JSON.parse((init && init.body) || "{}"); } catch (e) { body = {}; }
        const action = body.action || (/[?&]action=([\w-]+)/.exec(String(url)) || [])[1] || "";
        return site.request(action, body).then((r) => {
          calls.push({ action, status: r.status, ok: !!(r.json && r.json.ok), error: (r.json && r.json.error) || "", body, json: r.json });
          return {
            ok: r.status < 400,
            status: r.status,
            json: () => (r.json === null ? Promise.reject(new Error("не JSON")) : Promise.resolve(JSON.parse(JSON.stringify(r.json)))),
          };
        });
      };
      window.scrollTo = () => {};
      window.print = () => { printed++; };
      window.open = (url) => { opened.push(String(url)); return null; };
      window.alert = (m) => { alerts.push(String(m)); };
      window.confirm = () => true;
      window.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
      window.URL.createObjectURL = () => "blob:https://smenakontenta.ru/" + (++blobs);
      window.URL.revokeObjectURL = () => {};
      window.Element.prototype.scrollIntoView = function () {};
    },
  });

  const win = dom.window;
  const doc = win.document;
  const $ = (sel, root) => (root || doc).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || doc).querySelectorAll(sel));

  /* ждём, пока условие не станет истинным; иначе — понятная ошибка, а не зависание */
  async function wait(what, fn, ms) {
    const until = Date.now() + (ms || 20000);
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() > until) throw new Error("не дождались: " + what);
      await sleep(40);
    }
  }
  /* пока сервер не ответит на всё, что страница уже спросила */
  async function settle(ms) {
    let last = -1;
    const until = Date.now() + (ms || 20000);
    for (;;) {
      await sleep(160);
      if (calls.length === last && site.idle()) return;
      last = calls.length;
      if (Date.now() > until) return;
    }
  }
  function type(el, value) {
    if (!el) throw new Error("type: нет поля");
    el.value = value;
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
  }
  function click(el) {
    if (!el) throw new Error("click: нет элемента");
    el.click();
  }
  /* «выбрать файл» в поле загрузки */
  function attach(input, files) {
    const list = files.map((f) => new win.File([f.data], f.name, { type: f.type }));
    Object.defineProperty(input, "files", { configurable: true, value: list });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  }
  const text = (el) => String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  const last = (action) => { for (let i = calls.length - 1; i >= 0; i--) if (calls[i].action === action) return calls[i]; return null; };

  return {
    dom, win, doc, $, $$, wait, settle, type, click, attach, text, last,
    errors, calls, opened, alerts,
    get printed() { return printed; },
    main: () => doc.getElementById("main") || doc.body,
    close: () => { try { win.close(); } catch (e) { /* закрыто */ } },
  };
}

/* Сервер с демо-данными. Заполнение идёт полминуты, поэтому снимок можно
   запомнить на диске: UI_SEED_CACHE=/tmp/ui-seed.json node ui-checks.js.
   Снимок привязан к коду сервера — после правки api/ он пересоздаётся. */
async function demoSite() {
  const site = await createSite();
  let busy = 0;
  const request = site.request;
  site.request = (action, body, meta) => {
    busy++;
    return request(action, body, meta).then((r) => { busy--; return r; }, (e) => { busy--; throw e; });
  };
  site.call = async (action, body, meta) => (await site.request(action, body, meta)).json;
  site.idle = () => busy === 0;

  const cacheFile = process.env.UI_SEED_CACHE || "";
  const hash = crypto.createHash("sha1");
  const walk = (dir) => fs.readdirSync(dir).sort().forEach((n) => {
    const full = path.join(dir, n);
    if (fs.statSync(full).isDirectory()) walk(full); else hash.update(n).update(fs.readFileSync(full));
  });
  walk(path.join(ROOT, "api"));
  hash.update(fs.readFileSync(path.join(ROOT, "tools", "preview", "site.js")));
  const key = hash.digest("hex");

  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (saved.key === key) {
        await site.restore(saved.files);
        return { site, seed: saved.seed, cached: true };
      }
    } catch (e) { /* снимок испорчен — пересоздаём */ }
  }
  const seed = await seedDemo(site);
  if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify({ key, seed, files: await site.dump() }));
  return { site, seed, cached: false };
}

/* Учёт проверок в том же виде, что у api-checks.js */
function makeChecks() {
  const results = [];
  return {
    results,
    check(name, cond, extra) {
      results.push({ name, ok: !!cond, extra });
      if (!cond) {
        let shown = extra;
        try { shown = typeof extra === "string" ? extra : JSON.stringify(extra); } catch (e) { shown = String(extra); }
        console.log("  FAIL " + name + " → " + String(shown === undefined ? "" : shown).slice(0, 600));
      }
    },
    finish() {
      console.log("\n=== ИТОГ ===");
      let bad = 0;
      results.forEach((x) => {
        if (!x.ok) bad++;
        let shown = x.extra;
        try { shown = typeof shown === "string" ? shown : JSON.stringify(shown); } catch (e) { shown = String(shown); }
        console.log((x.ok ? "  ok   " : "  FAIL ") + x.name + (x.ok ? "" : " → " + String(shown === undefined ? "" : shown).slice(0, 300)));
      });
      console.log(bad === 0 ? "\nвсе проверки пройдены: " + results.length : "\nпровалено: " + bad + " из " + results.length);
      return bad;
    },
  };
}

module.exports = { openPage, demoSite, makeChecks, sleep, ROOT };
