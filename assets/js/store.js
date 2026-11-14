/* ============================================================================
   СМЕНА КОНТЕНТА — клиентское хранилище и API
   ----------------------------------------------------------------------------
   Аккаунты, согласия, баллы, пресс-карты, портфолио и очередь материалов живут
   на сервере (api/index.php). В браузере остаются токен сессии, копия профиля
   для отрисовки и черновики, пока автор не отправил их на проверку.

   Старые локальные аккаунты (до серверной версии) переносятся на сервер при
   первом входе; без ответа сервера новый аккаунт не создаётся и вход не
   подменяется локальным.
   ========================================================================== */

window.Store = (function () {
  "use strict";

  var KEY = "smena_content_v1";
  var listeners = [];

  var EMPTY = { users: [], posts: [], teams: [], session: null, settings: null };

  /* данные проекта: их заполняет редакция в панели управления */
  var DEFAULT_SETTINGS = {
    org: {
      name: "Смена контента",
      center: "Редакция «Смена контента»",
      head: "",
      email: "info@smenakontenta.ru",
      phone: "",
      city: "Москва",
      founders: [
        { name: "Сирик Никита Сергеевич", inn: "940802781550", role: "Основатель и генеральный директор медиапроекта" },
        { name: "Ильин Борис Павлович", inn: "784304154610", role: "Основатель и директор медиапроекта" },
      ],
    },
    card: {
      prefix: "СК",
      year: new Date().getFullYear(),
      minPosts: 5,
      teamMinPosts: 20,
      validMonths: 12,
    },
  };

  function merge(base, patch) {
    var out = {};
    Object.keys(base).forEach(function (k) {
      if (Array.isArray(base[k])) out[k] = base[k].slice();
      else out[k] = base[k] && typeof base[k] === "object" ? merge(base[k], {}) : base[k];
    });
    Object.keys(patch || {}).forEach(function (k) {
      if (Array.isArray(patch[k])) {
        out[k] = patch[k].slice();
      } else if (patch[k] && typeof patch[k] === "object") {
        out[k] = merge(out[k] || {}, patch[k]);
      } else if (patch[k] !== undefined) {
        out[k] = patch[k];
      }
    });
    return out;
  }

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(EMPTY));
      var data = JSON.parse(raw);
      return {
        users: data.users || [],
        posts: data.posts || [],
        teams: data.teams || [],
        session: data.session || null,
        settings: data.settings || null,
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(EMPTY));
    }
  }

  function write(data) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
      emit();
      return true;
    } catch (e) {
      return false;
    }
  }

  function emit() {
    listeners.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        /* пусто */
      }
    });
  }

  function uid(prefix) {
    return (
      prefix +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7)
    );
  }

  /* Ключ повторной отправки: один на черновик, живёт в localStorage.
     Сервер по нему отличает повтор того же запроса от нового материала. */
  function newRequestId() {
    return uid("req_") + "_" + Math.random().toString(36).slice(2, 10);
  }

  function apiError(res) {
    var err = new Error((res && res.error) || "Сервер не принял запрос.");
    if (res) {
      err.code = res.code;
      err.needConfirm = !!res.needConfirm;
      err.needConsent = !!res.needConsent;
      err.consentKind = res.consentKind || "";
      err.response = res;
    }
    return err;
  }

  /* не криптография, а защита от «пароль лежит открытым текстом» */
  function hash(str) {
    var h = 5381;
    var text = "smena:" + String(str);
    for (var i = 0; i < text.length; i++) {
      h = (h * 33) ^ text.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
  }

  function initials(name) {
    var parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "А";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function readTime(body) {
    var words = (body || []).join(" ").split(/\s+/).filter(Boolean).length;
    return Math.max(2, Math.round(words / 160));
  }

  /* Роли совпадают с api/lib/permissions.php. Права приходят с сервера
     в user.caps; локальная таблица ниже — только запасной вариант для
     старых записей без caps. Решение всегда принимает сервер. */
  var ACCESS = [
    "Сооснователь",
    "Директор",
    "Главный администратор",
    "Администрация",
    "Администратор",
    "Центральная редакция",
    "Редакционный администратор региона",
    "Редакционный основатель",
    "Руководитель региональной редакции",
    "Руководитель отдела",
    "Главный редактор",
    "Редактор",
    "Технический администратор",
    "Сотрудник",
    "Автор",
    "Преподаватель",
    "Модератор",
    "Участник",
    "Пользователь",
  ];

  var UI_CAPS = {
    publish: "posts.review",
    review: "posts.review",
    deleteAny: "posts.remove",
    manage: "people.view",
    editSettings: "site.manage",
    issueCards: "cards.issue",
    manageUsers: "people.edit",
  };

  var RIGHTS = {
    "Сооснователь": ["publish", "review", "deleteAny", "manage", "editSettings", "issueCards", "manageUsers"],
    "Директор": ["publish", "review", "deleteAny", "manage", "editSettings", "issueCards", "manageUsers"],
    "Главный администратор": ["publish", "review", "deleteAny", "manage", "editSettings", "issueCards", "manageUsers"],
    "Администрация": ["publish", "review", "deleteAny", "manage", "editSettings", "issueCards", "manageUsers"],
    "Администратор": ["review", "manage", "issueCards"],
    "Центральная редакция": ["publish", "review", "deleteAny", "manage", "issueCards"],
    "Редакционный администратор региона": ["review", "manage", "issueCards"],
    "Редакционный основатель": ["review", "manage"],
    "Руководитель региональной редакции": ["review", "manage"],
    "Руководитель отдела": ["review", "manage"],
    "Главный редактор": ["publish", "review", "deleteAny", "manage", "issueCards"],
    "Редактор": ["review", "manage"],
    "Технический администратор": ["manage", "editSettings"],
    "Модератор": ["review", "manage"],
    "Преподаватель": ["manage"],
  };

  function can(user, action) {
    if (!user) return false;
    /* Сырое полномочие сервера («cards.revoke») проверяется напрямую.
       Короткие имена ниже — только запасной вариант для старых записей. */
    var cap = String(action || "").indexOf(".") !== -1 ? action : UI_CAPS[action];
    if (Array.isArray(user.caps)) {
      if (user.caps.indexOf("*") !== -1) return true;
      return !!cap && user.caps.indexOf(cap) !== -1;
    }
    if (String(action || "").indexOf(".") !== -1) return false;
    var list = RIGHTS[user.access || "Пользователь"] || [];
    return list.indexOf(action) !== -1;
  }

  var ROLES = [
    "Автор текстов",
    "Фотограф",
    "Видеограф",
    "Дизайнер",
    "Редактор",
    "Наставник",
  ];

  /* ------------------------------------------------------------------ вход */

  /* Аккаунт живёт на сервере: телефон, компьютер и любой браузер видят
     одного и того же человека. В браузере хранится только токен сессии
     и копия профиля для мгновенной отрисовки страниц. */
  var TOKEN_KEY = "smena_token_v1";
  var USER_KEY = "smena_user_v1";

  function readToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function saveToken(token) {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function readCachedUser() {
    try {
      var raw = window.localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function cacheUser(user) {
    try {
      if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
      else window.localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }

  function currentUser() {
    var cached = readCachedUser();
    if (cached && cached.id) return cached;
    var data = read();
    if (!data.session) return null;
    var user = data.users.filter(function (u) {
      return u.id === data.session;
    })[0];
    return user || null;
  }

  /* вход и регистрация: сначала сервер, при недоступности — локальный режим */
  function signUp(input) {
    var payload = {
      name: String(input.name || "").trim(),
      email: String(input.email || "").trim(),
      pass: String(input.pass || ""),
      region: input.region || "",
      role: input.role || ROLES[0],
    };
    return api("reg", payload)
      .then(function (res) {
        if (res && res.ok && res.token) {
          saveToken(res.token);
          cacheUser(res.user);
          mirrorUser(res.user);
          emit();
          return {
            ok: true, user: res.user, remote: true, recoveryCode: res.recoveryCode || "",
            pending: !!res.pending, needConfirm: res.needConfirm || "", mailSent: !!res.mailSent,
          };
        }
        if (res && (res.offline || res.serverBroken)) {
          return {
            ok: false,
            offline: true,
            error: "Сервер не ответил, поэтому аккаунт не создан. Проверьте связь и попробуйте " +
              "ещё раз — без сервера аккаунт существовал бы только в этом браузере.",
          };
        }
        return { ok: false, error: (res && res.error) || "Сервер не принял регистрацию." };
      })
      .catch(function () {
        return {
          ok: false,
          offline: true,
          error: "Сервер не ответил, поэтому аккаунт не создан. Попробуйте ещё раз через минуту.",
        };
      });
  }

  function signIn(email, pass) {
    return api("login", { email: email, pass: pass })
      .then(function (res) {
        /* включена двухфакторная проверка: пароль верный, но нужен код из письма */
        if (res && res.ok && res.needCode) {
          return { ok: false, needCode: true, email: res.email, message: res.message };
        }
        if (res && res.ok && res.token) {
          saveToken(res.token);
          cacheUser(res.user);
          mirrorUser(res.user);
          emit();
          return { ok: true, user: res.user, remote: true };
        }
        if (res && (res.offline || res.serverBroken)) {
          return { ok: false, offline: true, error: "Сервер не ответил. Вход не выполнен — попробуйте ещё раз через минуту." };
        }
        /* аккаунт был создан раньше только в браузере: переносим на сервер,
           чтобы человек не потерял доступ к своим материалам */
        var legacy = login(email, pass);
        if (legacy.ok) return migrateAccount(legacy.user, pass);
        return { ok: false, error: (res && res.error) || "Не удалось войти." };
      })
      .catch(function () {
        return { ok: false, offline: true, error: "Сервер не ответил. Вход не выполнен — попробуйте ещё раз через минуту." };
      });
  }

  /* перенос старого локального аккаунта на сервер при первом входе */
  function migrateAccount(localUser, pass) {
    return api("reg", {
      name: localUser.name,
      email: localUser.email,
      pass: pass,
      region: localUser.region || "",
      role: localUser.role || ROLES[0],
    }).then(function (res) {
      if (res && res.ok && res.token) {
        saveToken(res.token);
        cacheUser(res.user);
        mirrorUser(res.user);
        emit();
        return { ok: true, user: res.user, migrated: true };
      }
      return { ok: false, error: (res && res.error) || "Не удалось перенести аккаунт." };
    });
  }

  /* копия серверного профиля в локальном списке: чтобы лента, карта
     и карточки авторов видели того же человека */
  function mirrorUser(remote) {
    var data = read();
    var exists = false;
    data.users = data.users.map(function (u) {
      if (u.id !== remote.id && u.email !== remote.email) return u;
      exists = true;
      return Object.assign({}, u, remote, { pass: u.pass || "" });
    });
    if (!exists) {
      data.users.push(Object.assign({ pass: "" }, remote));
    }
    data.session = remote.id;
    write(data);
  }

  /* проверка сессии при загрузке страницы: токен жив — профиль свежий */
  function refreshMe() {
    var token = readToken();
    if (!token) return Promise.resolve(false);
    return api("me", { token: token })
      .then(function (res) {
        if (res && res.ok && res.user) {
          cacheUser(res.user);
          mirrorUser(res.user);
          emit();
          return true;
        }
        /* выходим из аккаунта только если сервер прямо сказал, что сессии нет.
           Сетевая ошибка или сбой сервера — не повод разлогинивать человека */
        if (res && res.code === 401) {
          saveToken("");
          cacheUser(null);
        }
        return false;
      })
      .catch(function () {
        return false;
      });
  }

  function register(input) {
    var data = read();
    var name = String(input.name || "").trim();
    var email = String(input.email || "").trim().toLowerCase();
    var pass = String(input.pass || "");

    if (name.length < 2) return { ok: false, error: "Напишите имя — хотя бы два символа." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
      return { ok: false, error: "Проверьте адрес почты — кажется, там опечатка." };
    if (pass.length < 8)
      return { ok: false, error: "Пароль должен быть не короче 8 символов." };
    if (
      data.users.some(function (u) {
        return u.email === email;
      })
    )
      return { ok: false, error: "Аккаунт с такой почтой уже есть. Попробуйте войти." };

    var user = {
      id: uid("u_"),
      name: name,
      email: email,
      pass: hash(pass),
      region: input.region || "",
      role: input.role || ROLES[0],
      access: "Пользователь",
      teamId: null,
      bio: "",
      createdAt: new Date().toISOString(),
      number: 100 + data.users.length + 1,
    };
    data.users.push(user);
    data.session = user.id;
    if (!write(data)) return { ok: false, error: "Не удалось сохранить данные в браузере." };
    return { ok: true, user: user };
  }

  function login(email, pass) {
    var data = read();
    var mail = String(email || "").trim().toLowerCase();
    var user = data.users.filter(function (u) {
      return u.email === mail;
    })[0];
    if (!user) return { ok: false, error: "Аккаунт с такой почтой не найден." };
    if (user.pass !== hash(pass)) return { ok: false, error: "Пароль не подошёл." };
    data.session = user.id;
    write(data);
    return { ok: true, user: user };
  }

  function logout() {
    var token = readToken();
    if (token) api("logout", { token: token }).catch(function () {});
    saveToken("");
    cacheUser(null);
    var data = read();
    data.session = null;
    write(data);
  }

  /* сохранение профиля: имя, о себе, регион, направление, аватар */
  function saveProfile(patch) {
    var token = readToken();
    if (!token) return Promise.resolve({ ok: false, error: "Войдите в аккаунт, чтобы сохранить профиль." });
    var body = {
      token: token,
      name: patch.name,
      bio: patch.bio,
      region: patch.region,
      role: patch.role,
    };
    if (patch.avatar) body.avatar = patch.avatar;
    if (patch.avatarClear) body.avatarClear = true;

    return api("profile-save", body)
      .then(function (res) {
        if (res && res.ok && res.user) {
          cacheUser(res.user);
          mirrorUser(res.user);
          emit();
          return { ok: true, user: res.user };
        }
        return { ok: false, error: (res && res.error) || "Профиль не сохранился." };
      })
      .catch(function () {
        return { ok: false, error: "Нет связи с сервером. Профиль не сохранён — попробуйте ещё раз." };
      });
  }

  /* загрузка файла на платформу: фото сжимаем в браузере,
     видео и аудио уходят как есть в пределах лимита */
  function uploadMedia(file) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт, чтобы загружать файлы."));
    var isImage = file.type.indexOf("image/") === 0;
    var limit = isImage ? 8 * 1024 * 1024 : 6 * 1024 * 1024;
    if (file.size > limit) {
      return Promise.reject(new Error(
        isImage
          ? "Фото больше 8 МБ — выберите файл поменьше."
          : "Видео или аудио больше 6 МБ — сократите файл или сожмите его."
      ));
    }
    var ready = file.type.indexOf("image/") === 0 ? shrinkImage(file) : readAsDataUrl(file);
    return ready
      .then(function (dataUrl) {
        return api("media-upload", { token: token, data: dataUrl });
      })
      .then(function (res) {
        if (res && res.ok && res.url) return res.url;
        throw new Error((res && res.error) || "Файл не загрузился.");
      });
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Не удалось прочитать файл.")); };
      reader.readAsDataURL(file);
    });
  }

  /* сжатие фото: длинная сторона до 1600 px, jpeg 0.82 — хватает для сайта */
  function shrinkImage(file) {
    return readAsDataUrl(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var max = 1600;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          if (scale === 1 && file.size < 900 * 1024) {
            resolveOptimized();
            return;
          }
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          try {
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          } catch (e) {
            resolve(dataUrl);
          }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;

        function resolveOptimized() { resolve(dataUrl); }
      });
    });
  }

  /* ------------------------------------------------------------- публикации */

  function authorOf(user) {
    return {
      id: user.id,
      name: user.name,
      role: (user.role || "Автор") + (user.region ? ", " + regionLabel(user.region) : ""),
      initials: initials(user.name),
      isUser: true,
    };
  }

  function regionLabel(slug) {
    var map = window.RU_MAP && window.RU_MAP.regions ? window.RU_MAP.regions : [];
    for (var i = 0; i < map.length; i++) if (map[i].slug === slug) return map[i].name;
    return "";
  }

  function listPosts(options) {
    var opts = options || {};
    var data = read();
    var posts = data.posts.slice().sort(function (a, b) {
      return new Date(b.updatedAt || b.date) - new Date(a.updatedAt || a.date);
    });
    if (opts.authorId)
      posts = posts.filter(function (p) {
        return p.authorId === opts.authorId;
      });
    if (opts.status)
      posts = posts.filter(function (p) {
        return p.status === opts.status;
      });
    return posts;
  }

  function getPost(id) {
    return (
      read().posts.filter(function (p) {
        return p.id === id;
      })[0] || null
    );
  }

  function savePost(patch, id) {
    var data = read();
    var user = currentUser();
    if (!user) return { ok: false, error: "Нужно войти в аккаунт." };

    var now = new Date().toISOString();
    var body = (patch.body || "")
      .split(/\n{2,}/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);

    if (id) {
      var exists = data.posts.filter(function (p) {
        return p.id === id && p.authorId === user.id;
      })[0];
      if (!exists) return { ok: false, error: "Материал не найден." };
      data.posts = data.posts.map(function (p) {
        if (p.id !== id) return p;
        return Object.assign({}, p, {
          title: patch.title,
          excerpt: patch.excerpt,
          body: body,
          topic: patch.topic,
          format: patch.format,
          region: patch.region,
          image: patch.image || "",
          imageAlt: patch.imageAlt || "",
          gallery: patch.gallery || p.gallery || [],
          video: patch.video != null ? patch.video : p.video || "",
          audio: patch.audio != null ? patch.audio : p.audio || "",
          status:
            patch.status ||
            (p.status === "published" && !can(user, "review") ? "pending" : p.status),
          read: readTime(body),
          updatedAt: now,
          date: patch.status === "published" && p.status !== "published" ? now : p.date,
        });
      });
      var saved = getPost(id);
      if (!write(data)) return { ok: false, error: "Не хватает места в хранилище браузера." };
      return { ok: true, post: saved };
    }

    var post = {
      id: uid("p_"),
      authorId: user.id,
      title: String(patch.title || "").trim(),
      excerpt: String(patch.excerpt || "").trim(),
      body: body,
      topic: patch.topic,
      format: patch.format,
      region: patch.region,
      image: patch.image || "",
      imageAlt: patch.imageAlt || "",
      gallery: patch.gallery || [],
      video: patch.video || "",
      audio: patch.audio || "",
      status: patch.status || "draft",
      read: readTime(body),
      date: now,
      createdAt: now,
      updatedAt: now,
    };
    data.posts.push(post);
    if (!write(data)) return { ok: false, error: "Не хватает места в хранилище браузера." };
    return { ok: true, post: post };
  }

  function deletePost(id) {
    var data = read();
    var user = currentUser();
    if (!user) return Promise.resolve({ ok: false, error: "Нужно войти в аккаунт." });
    var post = data.posts.filter(function (p) { return p.id === id; })[0];
    if (!post) return Promise.resolve({ ok: false, error: "Материал не найден." });
    if (post.authorId !== user.id && !can(user, "deleteAny")) {
      return Promise.resolve({ ok: false, error: "Удалять можно только свои материалы." });
    }
    var remoteId = post.remoteId || (/^s_/.test(post.id) ? post.id : "");
    if (remoteId) {
      var token = readToken();
      if (!token) return Promise.resolve({ ok: false, error: "Войдите в аккаунт, чтобы удалить материал с сервера." });
      return api("post-delete", { token: token, id: remoteId }).then(function (res) {
        if (!res || !res.ok) return { ok: false, error: (res && res.error) || "Не удалось удалить материал." };
        var fresh = read();
        fresh.posts = fresh.posts.filter(function (p) { return p.id !== id; });
        write(fresh);
        return { ok: true };
      });
    }
    if (post.status === "published") {
      return Promise.resolve({ ok: false, error: "Опубликованный материал снимает редакция." });
    }
    data.posts = data.posts.filter(function (p) { return p.id !== id; });
    if (!write(data)) return Promise.resolve({ ok: false, error: "Не хватает места в хранилище браузера." });
    return Promise.resolve({ ok: true });
  }

  function publishPost(id) {
    var post = getPost(id);
    if (!post) return { ok: false, error: "Материал не найден." };
    return savePost(
      {
        title: post.title,
        excerpt: post.excerpt,
        body: post.body.join("\n\n"),
        topic: post.topic,
        format: post.format,
        region: post.region,
        image: post.image,
        imageAlt: post.imageAlt,
        status: "published",
      },
      id
    );
  }

  /* материалы авторов в том же виде, что и материалы редакции */
  function publishedAsArticles() {
    var data = read();
    return data.posts
      .filter(function (p) {
        return p.status === "published";
      })
      .map(function (p) {
        var user = data.users.filter(function (u) {
          return u.id === p.authorId;
        })[0];
        return {
          id: "u:" + p.id,
          title: p.title,
          excerpt: p.excerpt,
          body: p.body,
          region: p.region,
          topic: p.topic,
          format: p.format,
          author: user ? authorOf(user) : { name: "Автор", role: "", initials: "А" },
          date: p.date,
          read: p.read,
          image: p.image,
          imageAlt: p.imageAlt,
          isUserPost: true,
        };
      });
  }

  /* -------------------------------------------------------------- сообщества */

  var TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
  };

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .split("")
      .map(function (ch) {
        return TRANSLIT[ch] != null ? TRANSLIT[ch] : ch;
      })
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  /* ------------------------------------------------------------- проверка */

  function submitPost(id) {
    var data = read();
    var user = currentUser();
    if (!user) return Promise.resolve({ ok: false, error: "Нужно войти." });
    if (!readToken()) return Promise.resolve({ ok: false, error: "Войдите в аккаунт перед отправкой материала." });
    var post = data.posts.filter(function (p) {
      return p.id === id && p.authorId === user.id;
    })[0];
    if (!post) return Promise.resolve({ ok: false, error: "Материал не найден." });
    if (post.status === "pending") return Promise.resolve({ ok: false, error: "Материал уже на проверке." });
    if (post.status === "published") return Promise.resolve({ ok: false, error: "Материал уже опубликован." });

    var requestId = post.requestId || newRequestId();
    data.posts = data.posts.map(function (p) {
      return p.id === id ? Object.assign({}, p, { requestId: requestId, remoteError: "" }) : p;
    });
    if (!write(data)) return Promise.resolve({ ok: false, error: "Не хватает места в хранилище браузера." });

    return pushPost(getPost(id), user).then(function (res) {
      if (res && res.ok && res.post) {
        var fresh = read();
        fresh.posts = fresh.posts.map(function (p) {
          if (p.id !== id) return p;
          return Object.assign({}, p, {
            status: "pending",
            remoteId: res.post.id,
            requestId: requestId,
            remoteError: "",
            submittedAt: res.post.submittedAt || new Date().toISOString(),
            reviewNote: "",
            reviewedAt: null,
          });
        });
        write(fresh);
        return {
          ok: true,
          direct: false,
          post: res.post,
          message: "Материал отправлен на проверку. Редакция увидит его в очереди.",
        };
      }
      var error = (res && res.error) || "Не удалось отправить материал редакции.";
      var failed = read();
      failed.posts = failed.posts.map(function (p) {
        return p.id === id ? Object.assign({}, p, { remoteError: error }) : p;
      });
      write(failed);
      return { ok: false, error: error, code: res && res.code, needConsent: res && res.needConsent };
    });
  }

  /* ------------------------------------------------------------- пресс-карта */

  function getSettings() {
    return merge(DEFAULT_SETTINGS, read().settings || {});
  }

  function saveSettings(patch) {
    var data = read();
    data.settings = merge(getSettings(), patch || {});
    if (!write(data)) return { ok: false, error: "Не удалось сохранить настройки." };
    return { ok: true, settings: data.settings };
  }

  function addMonths(iso, months) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + Number(months || 12));
    return d.toISOString();
  }

  /* список авторов для панели управления */
  function listUsers() {
    var data = read();
    return data.users.map(function (u) {
      var posts = data.posts.filter(function (p) {
        return p.authorId === u.id && p.status === "published";
      }).length;
      var team = u.teamId
        ? data.teams.filter(function (t) {
            return t.id === u.teamId;
          })[0]
        : null;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        access: u.access || "Автор",
        team: team ? team.name : "",
        teamId: u.teamId || null,
        region: regionLabel(u.region),
        posts: posts,
        createdAt: u.createdAt,
        number: u.number,
      };
    });
  }

  function exportAll() {
    return JSON.stringify(read(), null, 2);
  }

  function importAll(json) {
    try {
      var data = JSON.parse(json);
      if (!data || !Array.isArray(data.users) || !Array.isArray(data.posts))
        return { ok: false, error: "Файл не похож на резервную копию." };
      if (!write({ users: data.users, posts: data.posts, teams: data.teams || [], session: data.session || null, settings: data.settings || null }))
        return { ok: false, error: "Не удалось записать данные." };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "Файл повреждён или это не JSON." };
    }
  }

  /* ================= общая приёмная на сервере (PHP на хостинге) ==========
     Сайт статический: без этого блока материалы автора остаются только в его
     браузере. С блоком материал уходит на хостинг, редактор видит его с любого
     устройства, а после одобрения он появляется у всех посетителей.
     Если PHP недоступен (открыли файл локально), всё работает как раньше.
     ====================================================================== */

  var API_URL = "/api/index.php";
  var REMOTE_KEY = "smena_remote_v1";
  var AUTHOR_KEY = "smena_author_key";

  function makeKey() {
    var bytes = [];
    if (window.crypto && window.crypto.getRandomValues) {
      var arr = new Uint8Array(16);
      window.crypto.getRandomValues(arr);
      for (var i = 0; i < arr.length; i++) bytes.push(("0" + arr[i].toString(16)).slice(-2));
      return bytes.join("");
    }
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    );
  }

  /* ключ автора: по нему человек видит статус своих материалов */
  function authorKey() {
    var key = "";
    try {
      key = window.localStorage.getItem(AUTHOR_KEY) || "";
    } catch (e) {
      key = "";
    }
    if (key.length < 12) {
      key = makeKey();
      try {
        window.localStorage.setItem(AUTHOR_KEY, key);
      } catch (e) {
        /* пусто */
      }
    }
    return key;
  }

  function remoteRead() {
    try {
      var raw = window.localStorage.getItem(REMOTE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      return { posts: (data && data.posts) || [], ts: (data && data.ts) || 0 };
    } catch (e) {
      return { posts: [], ts: 0 };
    }
  }

  function remoteWrite(posts) {
    try {
      window.localStorage.setItem(REMOTE_KEY, JSON.stringify({ posts: posts, ts: Date.now() }));
    } catch (e) {
      /* пусто */
    }
  }

  function api(action, payload) {
    if (!window.fetch) return Promise.reject(new Error("браузер не умеет fetch"));
    var data = Object.assign({ action: action }, payload || {});
    return window
      .fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "same-origin",
      })
      .then(function (res) {
        return res.json().catch(function () {
          return {
            ok: false,
            serverBroken: true,
            error: "Сервер ответил не JSON — возможно, PHP на хостинге выключен.",
          };
        });
      })
      .catch(function () {
        /* нет связи — это не ошибка кода: вызывающий решает, что делать */
        return { ok: false, offline: true, error: "Нет связи с сервером." };
      });
  }

  function pullRemote() {
    return api("state")
      .then(function (data) {
        if (data && data.ok) {
          remoteWrite(data.posts || []);
          emit();
          return true;
        }
        return false;
      })
      .catch(function () {
        return false;
      });
  }

  /* готовность сервера: страницы ждут её не дольше 2,5 секунды */
  var ready = (function () {
    var request = pullRemote();
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 2500);
      request.then(function (value) {
        refreshMe();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      });
    });
  })();

  /* материалы с сервера в том виде, в каком их ждут страницы сайта */
  function remoteArticles() {
    return remoteRead()
      .posts.filter(function (p) {
        return p.status === "published";
      })
      .map(function (p) {
        return {
          id: "s:" + p.id,
          remoteId: p.id,
          title: p.title,
          excerpt: p.excerpt,
          body: String(p.body || "")
            .split(/\n{2,}/)
            .map(function (part) {
              return part.trim();
            })
            .filter(Boolean),
          region: p.region,
          topic: p.topic,
          format: p.format,
          author: {
            name: p.authorName || "Автор",
            role: p.authorRole || "",
            initials: initials(p.authorName || "А"),
            isUser: true,
          },
          date: p.date,
          read: p.read || 4,
          number: p.number || 0,
          image: p.image || "",
          imageAlt: p.title,
          isUserPost: true,
          fromServer: true,
        };
      });
  }

  /* отправка материала в приёмную редакции */
  function pushPost(post, user) {
    if (!post || !user) return Promise.resolve({ ok: false, error: "Нет материала для отправки." });
    var token = readToken();
    if (!token) return Promise.resolve({ ok: false, error: "Войдите в аккаунт перед отправкой материала." });
    var requestId = post.requestId || newRequestId();
    var data = read();
    var changed = false;
    data.posts = data.posts.map(function (p) {
      if (p.id !== post.id || p.requestId) return p;
      changed = true;
      return Object.assign({}, p, { requestId: requestId });
    });
    if (changed) write(data);

    var payload = {
      token: token,
      requestId: requestId,
      authorKey: authorKey(),
      authorName: user.name,
      authorRole: user.role || "",
      authorRegion: user.region || "",
      title: post.title,
      excerpt: post.excerpt,
      body: (post.body || []).join("\n\n"),
      topic: post.topic,
      format: post.format,
      region: post.region,
      image: post.image || "",
      imageAlt: post.imageAlt || "",
      gallery: post.gallery || [],
      video: post.video || "",
      audio: post.audio || "",
      read: post.read || 4,
    };
    return api("submit", payload)
      .then(function (res) {
        var data = read();
        data.posts = data.posts.map(function (p) {
          if (p.id !== post.id) return p;
          return Object.assign({}, p, {
            requestId: requestId,
            remoteId: res && res.ok && res.post ? res.post.id : p.remoteId || "",
            remoteError: res && res.ok ? "" : (res && res.error) || "не удалось отправить редакции",
          });
        });
        write(data);
        if (res && res.ok) pullRemote();
        return res || { ok: false, error: "Сервер не ответил." };
      })
      .catch(function () {
        var data = read();
        data.posts = data.posts.map(function (p) {
          if (p.id !== post.id) return p;
          return Object.assign({}, p, {
            requestId: requestId,
            remoteError: "нет связи с сервером — материал сохранён в браузере",
          });
        });
        write(data);
        return { ok: false, offline: true, error: "Нет связи с сервером. Материал сохранён в браузере — попробуйте отправить ещё раз." };
      });
  }

  /* статусы своих материалов с сервера: одобрили, отклонили, ждут */
  function syncMine() {
    return api("mine", { authorKey: authorKey(), token: readToken() })
      .then(function (res) {
        if (!res || !res.ok) return false;
        var mine = res.posts || [];
        var data = read();
        data.posts = data.posts.map(function (p) {
          var found = null;
          for (var i = 0; i < mine.length; i++) {
            if ((p.remoteId && mine[i].id === p.remoteId) ||
                (p.requestId && mine[i].requestId && mine[i].requestId === p.requestId)) found = mine[i];
          }
          if (!found) return p;
          return Object.assign({}, p, {
            remoteId: found.id,
            status: found.status,
            reviewNote: found.reviewNote || "",
            reviewedAt: found.reviewedAt || null,
            date: found.status === "published" ? found.date : p.date,
          });
        });
        write(data);
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  /* очередь редакции и решения — тоже на сервере */
  function apiQueue(password) {
    return api("queue", {
      password: String(password || ""),
      token: readToken(),
      confirm: getConfirm(),
    });
  }

  function apiReview(password, id, decision, note) {
    return api("review", {
      password: String(password || ""),
      token: readToken(),
      confirm: getConfirm(),
      id: id,
      decision: decision,
      note: note || "",
    }).then(function (res) {
      if (res && res.ok) pullRemote();
      return res;
    });
  }

  /* мои материалы на сервере (с номерами) */
  function apiMyPosts() {
    return api("mine", { authorKey: authorKey(), token: readToken() }).then(function (res) {
      if (res && res.ok) return res.posts || [];
      throw apiError(res);
    });
  }

  /* заявка на пресс-карту: прикладываются все свои опубликованные материалы */
  function apiCardRequest(payload) {
    return api("card-request", {
      token: readToken(),
      authorKey: authorKey(),
      authorName: payload.authorName || "",
      authorRegion: payload.authorRegion || "",
      authorRole: payload.authorRole || "",
      posts: payload.posts || [],
    });
  }

  function apiCardStatus() {
    return api("card-status", { authorKey: authorKey(), token: readToken() }).then(function (res) {
      if (res && res.ok) return res;
      return { ok: false, requests: [], minPosts: 5, error: (res && res.error) || "" };
    });
  }

  function apiCardQueue(password) {
    return api("card-queue", {
      password: String(password || ""),
      token: readToken(),
      confirm: getConfirm(),
    });
  }

  function apiCardReview(password, id, decision, note, place, tracking) {
    return api("card-review", {
      password: String(password || ""),
      token: readToken(),
      confirm: getConfirm(),
      id: id,
      decision: decision,
      note: note || "",
      place: place || "",
      tracking: tracking || "",
    });
  }

  /* Проверка карты открытая: номер и код с самой карты, без входа. */
  function cardVerify(number, code) {
    return api("card-verify", { number: number || "", code: code || "" }).then(function (res) {
      if (res && res.ok) return res;
      throw apiError(res);
    });
  }

  function cardActPdf(id) {
    return withToken("card-act-pdf", { id: id || "" }).then(function (res) {
      if (!res.data) throw new Error("Сервер не вернул акт.");
      var bin = window.atob(res.data);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return {
        blob: new Blob([bytes], { type: res.mime || "application/pdf" }),
        filename: res.filename || "akt-vidachi.pdf",
      };
    });
  }

  function pdfResponse(res) {
    if (!res.data) throw new Error("Сервер не вернул PDF.");
    var bin = window.atob(res.data);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return {
      blob: new Blob([bytes], { type: res.mime || "application/pdf" }),
      filename: res.filename || "document.pdf",
    };
  }

  /* То же для не-PDF файлов (CSV успеваемости): сервер отдаёт base64 + mime. */
  function fileResponse(res) {
    if (!res.data) throw new Error("Сервер не вернул файл.");
    var bin = window.atob(res.data);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return {
      blob: new Blob([bytes], { type: res.mime || "text/plain" }),
      filename: res.filename || "file.csv",
    };
  }

  function personCertPdf(userId) { return withToken("person-cert-pdf", { userId: userId }).then(pdfResponse); }
  function personThanksPdf(userId, text) { return withToken("person-thanks-pdf", { userId: userId, text: text || "" }).then(pdfResponse); }
  function personNote(userId, text) { return withToken("person-note", { userId: userId, text: text || "" }); }
  function personStatus(userId, status, reason) { return withToken("person-status", { userId: userId, status: status, reason: reason || "" }); }

  /* платформа медиашколы */
  function schoolCohorts() { return withToken("school-cohorts"); }
  function schoolCohortCreate(name) { return withToken("school-cohort-create", { name: name || "" }); }
  function schoolCohortSet(id, open) { return withToken("school-cohort-set", { id: id, open: !!open }); }
  function schoolAssignmentAdd(cohortId, title, brief, dueAt) {
    return withToken("school-assignment-add", { cohortId: cohortId, title: title || "", brief: brief || "", dueAt: dueAt || "" });
  }
  function schoolAssignments(cohortId) { return withToken("school-assignments", { cohortId: cohortId || "" }); }
  function schoolSubQueue(cohortId) { return withToken("school-sub-queue", { cohortId: cohortId || "" }); }
  function schoolSubReview(id, decision, points, groupNote, personalNote, aiChecked) {
    return withToken("school-sub-review", {
      id: id, decision: decision, points: points || 0,
      groupNote: groupNote || "", personalNote: personalNote || "", aiChecked: !!aiChecked,
    });
  }
  function schoolMyCourse() { return withToken("school-my-course"); }
  function schoolModules(cohortId) { return withToken("school-modules", { cohortId: cohortId || "" }); }
  function schoolModuleAdd(cohortId, title, body, checklist, assignmentId) {
    return withToken("school-module-add", {
      cohortId: cohortId || "", title: title || "", body: body || "",
      checklist: checklist || "", assignmentId: assignmentId || "",
    });
  }
  function schoolModuleSet(id, fields) {
    var payload = { id: id };
    fields = fields || {};
    if ("title" in fields) payload.title = fields.title;
    if ("checklist" in fields) payload.checklist = fields.checklist;
    if ("body" in fields) payload.body = fields.body;
    if ("assignmentId" in fields) payload.assignmentId = fields.assignmentId;
    return withToken("school-module-set", payload);
  }
  function schoolModuleDelete(id) { return withToken("school-module-delete", { id: id }); }
  function schoolCohortCsv(cohortId) { return withToken("school-cohort-csv", { cohortId: cohortId || "" }).then(fileResponse); }
  function schoolEnroll(appId, cohortId) { return withToken("school-enroll", { appId: appId, cohortId: cohortId }); }
  function schoolSubSend(assignmentId, text, aiNote) {
    return withToken("school-sub-send", { assignmentId: assignmentId, text: text || "", aiNote: aiNote || "" });
  }

  function cardPdf(id) {
    return withToken("card-pdf", { id: id || "" }).then(function (res) {
      if (!res.data) throw new Error("Сервер не вернул PDF карты.");
      var bin = window.atob(res.data);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return {
        blob: new Blob([bytes], { type: res.mime || "application/pdf" }),
        filename: res.filename || "press-karta.pdf",
      };
    });
  }

  function cardDispatch(id, tracking) {
    return withToken("card-dispatch", { id: id, tracking: tracking || "" });
  }

  function cardRevoke(id, note) {
    return api("card-revoke", { token: readToken(), confirm: getConfirm(), id: id, note: note || "" })
      .then(function (res) {
        if (res && res.ok) return res.request;
        throw apiError(res);
      });
  }

  function cardExtend(id, months, note) {
    return api("card-extend", { token: readToken(), confirm: getConfirm(), id: id, months: months || 12, note: note || "" })
      .then(function (res) {
        if (res && res.ok) return res.request;
        throw apiError(res);
      });
  }

  function pointsHistory(userId) {
    return api("points-history", { token: readToken(), userId: userId || "" }).then(function (res) {
      if (res && res.ok) return res;
      throw apiError(res);
    });
  }

  function pointsRules() {
    return api("points-rules", {}).then(function (res) {
      if (res && res.ok) {
        if (Array.isArray(res.rules)) return res.rules;
        if (res.rules && Array.isArray(res.rules.rules)) return res.rules.rules;
      }
      return [];
    }, function () { return []; });
  }

  function apiSetPass(oldPass, newPass) {
    return api("setpass", { old: String(oldPass || ""), new: String(newPass || "") });
  }

  function apiRemove(password, id) {
    return api("remove", { password: String(password || ""), id: id }).then(function (res) {
      if (res && res.ok) pullRemote();
      return res;
    });
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  /* ---------------------------------------------------------- согласие на ПД */

  /* Статус согласия на обработку персональных данных. Без одобрения комиссией
     публикация закрыта: подписанный от руки документ проверяет человек. */
  /* Два документа: processing — обработка данных (условие публикации на сайте),
     distribution — распространение данных для конкурсов в открытых площадках.
     Кеш у каждого свой, чтобы статусы не перетирали друг друга. */
  var CONSENT_KEY = "smena_consent_v1";
  var CONSENT_KEYS = {
    processing: CONSENT_KEY,
    distribution: "smena_consent_distribution_v1",
  };

  function consentKind(kind) {
    return kind === "distribution" ? "distribution" : "processing";
  }

  function readConsentCache(kind) {
    try {
      var raw = window.localStorage.getItem(CONSENT_KEYS[consentKind(kind)]);
      if (!raw) return { status: "none", kind: consentKind(kind) };
      var parsed = JSON.parse(raw);
      return parsed && parsed.status ? parsed : { status: "none", kind: consentKind(kind) };
    } catch (e) {
      return { status: "none", kind: consentKind(kind) };
    }
  }

  function cacheConsent(consent, kind) {
    try {
      if (consent) window.localStorage.setItem(CONSENT_KEYS[consentKind(kind)], JSON.stringify(consent));
    } catch (e) {}
  }

  function consent(kind) {
    return readConsentCache(kind);
  }

  /* Свежие статусы с сервера: приходят оба документа сразу.
     Возвращаем тот, который спросили, — по умолчанию обработку. */
  function refreshConsent(kind) {
    var want = consentKind(kind);
    var token = readToken();
    if (!token) return Promise.resolve(consent(want));
    return api("consent-status", { token: token }).then(function (res) {
      if (res && res.ok && res.consent) {
        cacheConsent(res.consent, "processing");
        if (res.distribution) cacheConsent(res.distribution, "distribution");
        emit();
        return consent(want);
      }
      throw apiError(res);
    });
  }

  /* Отправка подписанного скана: картинка уходит на сервер, заявка — в комиссию.
     kind выбирает документ, purpose — для какого конкурса нужно распространение. */
  function sendConsent(dataUrl, kind, purpose) {
    var token = readToken();
    var want = consentKind(kind);
    if (!token) return Promise.reject(new Error("Войдите в аккаунт, чтобы отправить согласие."));
    return api("consent-send", {
      token: token, scan: dataUrl, kind: want, purpose: purpose || "",
    }).then(
      function (res) {
        if (res && res.ok && res.consent) {
          cacheConsent(res.consent, want);
          emit();
          return res.consent;
        }
        throw apiError(res);
      },
      function () {
        throw new Error("Нет связи с сервером. Попробуйте отправить файл ещё раз.");
      }
    );
  }

  /* ------------------------------------------------- портфолио вне сайта */

  /* «Добавить свои материалы»: работа не обязана быть опубликованной на сайте —
     её смотрит комиссия и решает, интересна ли она и сколько стоит в баллах. */
  var PORTFOLIO_KEY = "smena_portfolio_v1";

  function readPortfolioCache() {
    try {
      var raw = window.localStorage.getItem(PORTFOLIO_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function cachePortfolio(list) {
    try {
      window.localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list || []));
    } catch (e) {}
  }

  function portfolio() {
    return readPortfolioCache();
  }

  function refreshPortfolio() {
    var token = readToken();
    if (!token) return Promise.resolve(portfolio());
    return api("portfolio-mine", { token: token }).then(function (res) {
      if (res && res.ok && res.items) {
        cachePortfolio(res.items);
        emit();
        return res.items;
      }
      return portfolio();
    }, function () {
      return portfolio();
    });
  }

  function portfolioSend(items) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт, чтобы добавить материалы."));
    return api("portfolio-send", {
      token: token,
      title: items.title,
      about: items.about,
      files: items.files || [],
      publish: !!items.publish,
    }).then(function (res) {
      if (res && res.ok && res.item) {
        var list = portfolio();
        list.unshift(res.item);
        cachePortfolio(list);
        emit();
        return res.item;
      }
      throw new Error((res && res.error) || "Работа не отправилась.");
    }, function () {
      throw new Error("Нет связи с сервером. Попробуйте ещё раз.");
    });
  }

  /* Аккаунты, которые сохранились только в этом браузере: их надо перенести
     на сервер, иначе вход не работает на других устройствах. */
  function localOnlyAccounts() {
    if (readToken()) return [];
    var data = read();
    return (data.users || []).filter(function (u) {
      return u && u.email;
    });
  }

  /* -------------------------------------------- состояние сайта */

  function siteStatus() {
    return api("site-status", {}).then(function (res) {
      return res && res.ok ? res.site : null;
    }, function () {
      return null;
    });
  }

  function siteSave(payload) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("site-save", {
      token: token,
      maintenance: !!payload.maintenance,
      noticeOn: !!payload.noticeOn,
      notice: payload.notice || "",
    }).then(function (res) {
      if (res && res.ok) return res.site;
      throw new Error((res && res.error) || "Не сохранилось.");
    });
  }

  /* кто я для сервера: роль, число аккаунтов, есть ли директор */
  function whoami() {
    var token = readToken();
    return api("whoami", { token: token }).then(function (res) {
      return res && res.ok ? res : null;
    }, function () {
      return null;
    });
  }

  function claimDirector() {
    return withToken("claim-director", { confirm: getConfirm() }).then(function (res) {
      if (res && res.ok) {
        cacheUser(res.user);
        mirrorUser(res.user);
        emit();
        return res.user;
      }
      throw new Error((res && res.error) || "Роль не выдалась.");
    });
  }

  /* карточка участника: профиль, заявления, карты, переписка */
  function userCard(id) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("user-card", { token: token, id: id }).then(function (res) {
      if (res && res.ok) return res;
      throw new Error((res && res.error) || "Карточка не открылась.");
    });
  }

  function userUpdate(id, patch) {
    var token = readToken();
    return api("user-update", Object.assign({ token: token, id: id }, patch || {})).then(function (res) {
      if (res && res.ok) return res.user;
      throw new Error((res && res.error) || "Профиль не сохранился.");
    });
  }

  /* то же сохранение, но с ответом целиком: нужно знать, сменилась ли почта */
  /* лучшие авторы на главной: список читают все, настраивает редакция */
  function authorsShow() {
    return api("top-authors", {}).then(function (res) {
      if (res && res.ok) return res;
      return { ok: false, authors: [] };
    });
  }

  function authorsShowSave(cfg) {
    return withToken("authors-show-save", cfg || {});
  }

  function userUpdateFull(id, patch) {
    var token = readToken();
    return api("user-update", Object.assign({ token: token, id: id }, patch || {})).then(function (res) {
      if (res && res.ok) return res;
      throw new Error((res && res.error) || "Профиль не сохранился.");
    });
  }

  /* заявка на пресс-карту: способ получения, контакты, согласие */
  function cardApply(input) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("card-apply", Object.assign({ token: token }, input || {})).then(function (res) {
      if (res && res.ok) return res.request;
      throw new Error((res && res.error) || "Заявка не отправилась.");
    });
  }

  function cardGrant(id, number) {
    var token = readToken();
    return api("card-grant", { token: token, confirm: getConfirm(), id: id, number: number || "" }).then(function (res) {
      if (res && res.ok) return res;
      throw apiError(res);
    });
  }

  function userMessage(id, text) {
    var token = readToken();
    return api("user-message", { token: token, id: id, text: text }).then(function (res) {
      if (res && res.ok) return res.message;
      throw new Error((res && res.error) || "Сообщение не отправилось.");
    });
  }

  function messagesMine() {
    var token = readToken();
    if (!token) return Promise.resolve([]);
    return api("messages-mine", { token: token }).then(function (res) {
      return res && res.ok ? res.messages || [] : [];
    }, function () {
      return [];
    });
  }

  function consentDecide(userId, decision, note, kind) {
    var token = readToken();
    return api("consent-decide", { token: token, confirm: getConfirm(), userId: userId, decision: decision, note: note || "", kind: consentKind(kind) })
      .then(function (res) {
        if (res && res.ok) return true;
        throw apiError(res);
      });
  }

  function portfolioDecide(id, decision, note, points) {
    var token = readToken();
    return api("portfolio-decide", {
      token: token, confirm: getConfirm(), id: id, decision: decision, note: note || "", points: points || 0,
    }).then(function (res) {
      if (res && res.ok) return true;
      throw apiError(res);
    });
  }

  /* очередь материалов по токену: без пароля редакции */
  function apiPendingQueue() {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("posts-queue", { token: token }).then(function (res) {
      if (res && res.ok) return res.posts || [];
      throw apiError(res);
    });
  }

  /* ------------------------------------------- участники, роли, основатели */

  function adminLog() {
    var token = readToken();
    if (!token) return Promise.resolve({ entries: [] });
    return api("admin-log", { token: token }).then(function (res) {
      if (res && res.ok) return { entries: res.entries || [] };
      return { entries: [], error: (res && res.error) || "" };
    }, function () {
      return { entries: [], error: "Сервер недоступен." };
    });
  }

  function diag() {
    var token = readToken();
    return api("diag", token ? { token: token } : {}).then(function (res) {
      return res && res.ok ? res : null;
    }, function () {
      return null;
    });
  }

  /* ------------------------------------------------ чат команды (редакция) */

  function teamChatList() {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("team-chat-list", { token: token }).then(function (res) {
      if (res && res.ok) return res;
      throw new Error((res && res.error) || "Чат недоступен.");
    });
  }

  function teamChatSend(text) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("team-chat-send", { token: token, text: text }).then(function (res) {
      if (res && res.ok) return res.message;
      throw new Error((res && res.error) || "Сообщение не отправилось.");
    });
  }

  function usersList() {
    var token = readToken();
    if (!token) return Promise.resolve({ users: [], roles: ROLES });
    return api("users", { token: token }).then(function (res) {
      if (res && res.ok) return { users: res.users || [], roles: res.roles || ROLES };
      return { users: [], roles: ROLES, error: (res && res.error) || "" };
    }, function () {
      return { users: [], roles: ROLES, error: "Сервер недоступен." };
    });
  }

  function userAccess(id, access) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("user-access", { token: token, id: id, access: access }).then(function (res) {
      if (res && res.ok) return true;
      throw new Error((res && res.error) || "Права не сохранились.");
    });
  }

  function founders() {
    return api("founders", {}).then(function (res) {
      return res && res.ok ? res.founders || [] : [];
    }, function () {
      return [];
    });
  }

  function foundersSave(list) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("founders-save", { token: token, founders: list }).then(function (res) {
      if (res && res.ok) return res.founders || [];
      throw new Error((res && res.error) || "Список не сохранился.");
    });
  }

  /* --------------------------------------------------- почта и поддержка */

  function mailStatus() {
    var token = readToken();
    if (!token) return Promise.resolve(null);
    return api("mail-status", { token: token }).then(function (res) {
      return res && res.ok ? res.mail : null;
    }, function () {
      return null;
    });
  }

  function mailSave(payload) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("mail-save", {
      token: token,
      host: payload.host,
      port: payload.port,
      secure: payload.secure,
      user: payload.user,
      pass: payload.pass || "",
      from: payload.from,
      fromName: payload.fromName,
      notify: payload.notify,
    }).then(function (res) {
      if (res && res.ok) return res.mail;
      throw new Error((res && res.error) || "Настройки не сохранились.");
    });
  }

  function mailTest(to) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("mail-test", { token: token, to: to || "" }).then(function (res) {
      if (res && res.ok) return res;
      throw new Error((res && res.error) || "Письмо не ушло.");
    });
  }

  function confirmSend() {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("confirm-send", { token: token }).then(function (res) {
      if (res && res.ok) return res;
      throw new Error((res && res.error) || "Письмо не ушло.");
    });
  }

  function confirmCheck(code) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("confirm-check", { token: token, code: code }).then(function (res) {
      if (res && res.ok) return true;
      throw new Error((res && res.error) || "Код не подошёл.");
    });
  }

  /* ---------- почта проекта: ящики, письма, шаблоны ---------- */
  /* ---------- подтверждение действий кодом из почты ---------- */
  var CONFIRM_KEY = "smena_confirm";
  function getConfirm() {
    try {
      var raw = window.localStorage.getItem(CONFIRM_KEY) || "";
      if (!raw) return "";
      var obj = JSON.parse(raw);
      if (!obj || !obj.t || !obj.exp || obj.exp < Date.now()) return "";
      return obj.t;
    } catch (e) { return ""; }
  }
  function setConfirm(token, minutes) {
    try {
      window.localStorage.setItem(CONFIRM_KEY, JSON.stringify({
        t: token, exp: Date.now() + (minutes || 30) * 60000,
      }));
    } catch (e) {}
  }
  function clearConfirm() { try { window.localStorage.removeItem(CONFIRM_KEY); } catch (e) {} }
  function actionCode() { return withToken("action-code", {}); }
  function actionConfirm(code) {
    return withToken("action-confirm", { code: String(code || "").trim() }).then(function (res) {
      if (res && res.confirm) setConfirm(res.confirm, res.minutes || 30);
      return res;
    });
  }

  function withToken(action, payload) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    var body = Object.assign({}, payload || {}, { token: token });
    return api(action, body).then(function (res) {
      if (res && res.ok) return res;
      if (res && res.code === 401) {
        /* сервер прямо сказал, что сессии нет — сообщаем интерфейсу,
           чтобы он предложил повторный вход, а не сыпал ошибками по разделам */
        try { window.dispatchEvent(new CustomEvent("smena:unauthorized")); } catch (e) {}
      }
      throw apiError(res);
    }, function () {
      throw new Error("Сервер недоступен. Проверьте связь и попробуйте ещё раз.");
    });
  }

  function mailBoxes() { return withToken("mailboxes"); }
  function mailBoxSave(box) { return withToken("mailboxes-save", { box: box }); }
  function mailBoxTest(key) { return withToken("mailboxes-test", { key: key }); }
  function mailBoxSmtpTest(key, to) {
    return withToken("mailboxes-smtp-test", { key: key, to: to || "" });
  }
  function mailFolders(key) { return withToken("mail-folders", { key: key }); }
  function mailList(params) { return withToken("mail-list", params); }
  function mailGet(params) { return withToken("mail-get", params); }
  function mailAttachment(params) { return withToken("mail-attachment", params); }
  function mailFlag(params) { return withToken("mail-flag", params); }
  function mailMove(params) { return withToken("mail-move", params); }
  function mailSend(payload) { return withToken("mail-send", payload); }
  function mailDrafts() { return withToken("mail-drafts"); }
  function mailDraftSave(draft) { return withToken("mail-draft-save", draft); }
  function mailDraftDelete(id) { return withToken("mail-draft-delete", { id: id }); }
  function mailTemplates() { return withToken("mail-templates"); }
  function mailTemplateSave(tpl) { return withToken("mail-template-save", tpl); }
  function mailTemplatePreview(key) { return withToken("mail-template-preview", { key: key }); }
  function mailTemplateTest(key, to) { return withToken("mail-template-test", { key: key, to: to }); }
  function mailLog() { return withToken("mail-log"); }

  /* Баллы участнику: начисление и списание с основанием (points.award). */
  function pointsAdd(userId, delta, reason, note) {
    return withToken("points-add", { userId: userId, delta: delta, reason: reason || "manual", note: note || "" });
  }

  /* ---------- двухфакторный вход ---------- */
  function loginTwoFactor(email, code) {
    return api("login-2fa", { email: email, code: code }).then(function (res) {
      if (res && res.ok && res.token) {
        saveToken(res.token);
        cacheUser(res.user);
        mirrorUser(res.user);
        emit();
        return { ok: true, user: res.user };
      }
      return { ok: false, error: (res && res.error) || "Код не подошёл." };
    });
  }
  function twofaEnable(pass) { return withToken("twofa-enable", { pass: pass }); }
  function twofaDisable(pass) { return withToken("twofa-disable", { pass: pass }); }

  /* ---------- ИИ-помощник писем ---------- */
  function aiStatus() { return withToken("ai-status"); }
  function aiSave(cfg) { return withToken("ai-save", cfg || {}); }
  function aiTest() { return withToken("ai-test"); }
  function aiAssist(payload) { return withToken("ai-assist", payload); }

  /* ---------- задачи команды ---------- */
  function tasksMine() { return withToken("tasks-mine"); }
  function tasksList() { return withToken("tasks-list"); }
  function tasksCreate(task) { return withToken("tasks-create", task); }
  function tasksUpdate(task) { return withToken("tasks-update", task); }
  function tasksComment(id, text) { return withToken("tasks-comment", { id: id, text: text }); }

  /* ---------- удаление своего аккаунта ---------- */
  function accountDelete(pass, confirm) {
    return withToken("account-delete", { pass: pass, confirm: confirm }).then(function (res) {
      saveToken("");
      cacheUser(null);
      return res;
    });
  }

  /* ---------- приём в команду ---------- */
  function hiringMine() { return withToken("hiring-mine"); }
  function hiringApply(payload) { return withToken("hiring-apply", payload); }
  function hiringTest() { return withToken("hiring-test"); }
  function hiringTestSubmit(answers) { return withToken("hiring-test-submit", { answers: answers }); }
  function hiringList(stage) { return withToken("hiring-list", { stage: stage || "" }); }
  function hiringCheck(id, key, ok, note) {
    return withToken("hiring-checklist", { id: id, key: key, ok: !!ok, note: note || "" });
  }
  function hiringDecide(id, decision, note) {
    return withToken("hiring-decide", { id: id, decision: decision, note: note || "" });
  }
  /* медиашкола: заявка → решение редакции */
  function schoolMine() { return withToken("school-mine"); }
  function schoolApply(payload) { return withToken("school-apply", payload); }
  function schoolList() { return withToken("school-list"); }
  function schoolDecide(id, decision, note) {
    return withToken("school-decide", { id: id, decision: decision, note: note || "" });
  }
  /* доступ администратора по паролю редакции: владелец выдаёт роль по почте */
  function grantAdmin(email, access, password) {
    return api("grant-admin", { email: email, access: access, password: password });
  }

  function supportSend(payload) {
    return api("support-send", {
      name: payload.name,
      email: payload.email,
      topic: payload.topic,
      message: payload.message,
    }).then(function (res) {
      if (res && res.ok) return res.ticket;
      throw new Error((res && res.error) || "Обращение не отправилось.");
    }, function () {
      throw new Error("Сервер недоступен. Попробуйте ещё раз.");
    });
  }

  function supportQueue() {
    var token = readToken();
    if (!token) return Promise.resolve([]);
    return api("support-queue", { token: token }).then(function (res) {
      return res && res.ok ? res.tickets || [] : [];
    }, function () {
      return [];
    });
  }

  function supportClose(id, answer) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("support-close", { token: token, id: id, answer: answer }).then(function (res) {
      if (res && res.ok) return res;
      throw new Error((res && res.error) || "Ответ не сохранился.");
    });
  }

  /* ------------------------------------------ восстановление доступа */

  /* код восстановления: выдаётся один раз и хранится у человека.
     Пока почта на домене не подключена, это единственный способ
     вернуть доступ самому; иначе — заявка в редакцию. */
  function recoveryReset(email, code, pass) {
    return api("recovery-reset", { email: email, code: code, pass: pass }).then(function (res) {
      if (res && res.ok && res.token) {
        saveToken(res.token);
        if (res.user) {
          cacheUser(res.user);
          mirrorUser(res.user);
        }
        emit();
        return { ok: true, user: res.user || null };
      }
      return { ok: false, error: (res && res.error) || "Пароль не сменился." };
    }, function () {
      return { ok: false, error: "Сервер недоступен. Попробуйте ещё раз." };
    });
  }

  function recoveryRequest(email, note) {
    return api("recovery-request", { email: email, note: note }).then(function (res) {
      if (res && res.ok) return { ok: true, mailSent: !!res.mailSent };
      return { ok: false, error: (res && res.error) || "Заявка не отправилась." };
    }, function () {
      return { ok: false, error: "Сервер недоступен. Попробуйте ещё раз." };
    });
  }

  function recoveryCode() {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("recovery-code", { token: token }).then(function (res) {
      if (res && res.ok) return res.recoveryCode;
      throw new Error((res && res.error) || "Код не выдался.");
    });
  }

  function recoveryQueue() {
    var token = readToken();
    if (!token) return Promise.resolve([]);
    return api("recovery-queue", { token: token }).then(function (res) {
      return res && res.ok ? res.requests || [] : [];
    }, function () {
      return [];
    });
  }

  function recoveryIssue(id) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("recovery-issue", { token: token, id: id }).then(function (res) {
      if (res && res.ok) return res;
      throw new Error((res && res.error) || "Код не выдан.");
    });
  }

  function recoveryClose(id, note) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("recovery-close", { token: token, id: id, note: note }).then(function (res) {
      if (res && res.ok) return true;
      throw new Error((res && res.error) || "Заявка не закрылась.");
    });
  }

  /* ---------------------------------------------------- редакции в регионах */

  function editorialList(region) {
    return api("editorial-list", { region: region || "" }).then(function (res) {
      if (res && res.ok && res.editorials) return res.editorials;
      return [];
    }, function () {
      return [];
    });
  }

  function editorialCreate(payload) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт, чтобы создать редакцию."));
    return api("editorial-create", {
      token: token,
      region: payload.region,
      name: payload.name,
      about: payload.about,
    }).then(function (res) {
      if (res && res.ok) return res.editorial;
      throw new Error((res && res.error) || "Редакция не создалась.");
    });
  }

  function editorialApply(payload) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт, чтобы подать заявление."));
    return api("editorial-apply", {
      token: token,
      editorialId: payload.editorialId,
      birthDate: payload.birthDate,
      why: payload.why,
      authorKey: authorKey(),
      portfolio: payload.portfolio || [],
      sitePosts: payload.sitePosts || [],
    }).then(function (res) {
      if (res && res.ok) return res.application;
      throw new Error((res && res.error) || "Заявление не отправилось.");
    });
  }

  function editorialMine() {
    var token = readToken();
    if (!token) return Promise.resolve({ applications: [], editorial: null, incoming: [] });
    return api("editorial-mine", { token: token }).then(function (res) {
      if (res && res.ok) {
        return {
          applications: res.applications || [],
          editorial: res.editorial || null,
          membership: res.membership || null,
          incoming: res.incoming || [],
        };
      }
      return { applications: [], editorial: null, membership: null, incoming: [] };
    }, function () {
      return { applications: [], editorial: null, membership: null, incoming: [] };
    });
  }

  function editorialQueue() {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("editorial-queue", { token: token }).then(function (res) {
      if (res && res.ok) return res.applications || [];
      throw apiError(res);
    });
  }

  function editorialReview(id, decision, note) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("editorial-review", { token: token, confirm: getConfirm(), id: id, decision: decision, note: note })
      .then(function (res) {
        if (res && res.ok) return true;
        throw apiError(res);
      });
  }

  /* смена пароля: сервер проверяет текущий пароль и хранит только хеш */
  function changePassword(oldPass, newPass) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт, чтобы сменить пароль."));
    return api("change-password", { token: token, old: oldPass, new: newPass }).then(
      function (res) {
        if (res && res.ok) return true;
        throw new Error((res && res.error) || "Не удалось сменить пароль.");
      },
      function () {
        throw new Error("Нет связи с сервером. Попробуйте ещё раз.");
      }
    );
  }

  function portfolioQueue() {
    return withToken("portfolio-queue", { confirm: getConfirm() });
  }

  function portfolioReview(id, decision, note, points, publish) {
    return withToken("portfolio-review", {
      confirm: getConfirm(),
      id: id,
      decision: decision,
      note: note,
      points: points,
      publish: publish,
    });
  }

  function consentQueue(kind) {
    return withToken("consent-queue", { confirm: getConfirm(), kind: kind || "" });
  }

  function consentReview(id, decision, note) {
    return withToken("consent-review", {
      confirm: getConfirm(),
      id: id,
      decision: decision,
      note: note,
    });
  }

  return {
    ROLES: ROLES,
    currentUser: currentUser,
    register: register,
    login: login,
    signUp: signUp,
    signIn: signIn,
    refreshMe: refreshMe,
    saveProfile: saveProfile,
    uploadMedia: uploadMedia,
    hasToken: function () { return !!readToken(); },
    logout: logout,
    listPosts: listPosts,
    getPost: getPost,
    savePost: savePost,
    deletePost: deletePost,
    publishPost: publishPost,
    submitPost: submitPost,
    ACCESS: ACCESS,
    can: can,
    publishedAsArticles: publishedAsArticles,
    ready: ready,
    remoteArticles: remoteArticles,
    authorKey: authorKey,
    syncMine: syncMine,
    apiQueue: apiQueue,
    apiReview: apiReview,
    apiRemove: apiRemove,
    apiSetPass: apiSetPass,
    apiMyPosts: apiMyPosts,
    apiCardRequest: apiCardRequest,
    apiCardStatus: apiCardStatus,
    apiCardQueue: apiCardQueue,
    apiCardReview: apiCardReview,
    cardVerify: cardVerify,
    cardPdf: cardPdf,
    personCertPdf: personCertPdf,
    personThanksPdf: personThanksPdf,
    personNote: personNote,
    personStatus: personStatus,
    schoolCohorts: schoolCohorts,
    schoolCohortCreate: schoolCohortCreate,
    schoolCohortSet: schoolCohortSet,
    schoolAssignmentAdd: schoolAssignmentAdd,
    schoolAssignments: schoolAssignments,
    schoolSubQueue: schoolSubQueue,
    schoolSubReview: schoolSubReview,
    schoolMyCourse: schoolMyCourse,
    schoolModules: schoolModules,
    schoolModuleAdd: schoolModuleAdd,
    schoolModuleSet: schoolModuleSet,
    schoolModuleDelete: schoolModuleDelete,
    schoolCohortCsv: schoolCohortCsv,
    schoolEnroll: schoolEnroll,
    schoolSubSend: schoolSubSend,
    cardActPdf: cardActPdf,
    cardDispatch: cardDispatch,
    cardRevoke: cardRevoke,
    cardExtend: cardExtend,
    pointsHistory: pointsHistory,
    pointsRules: pointsRules,
    userCard: userCard,
    userUpdate: userUpdate,
    userUpdateFull: userUpdateFull,
    authorsShow: authorsShow,
    authorsShowSave: authorsShowSave,
    cardApply: cardApply,
    cardGrant: cardGrant,
    userMessage: userMessage,
    messagesMine: messagesMine,
    consentDecide: consentDecide,
    portfolioDecide: portfolioDecide,
    whoami: whoami,
    actionCode: actionCode,
    actionConfirm: actionConfirm,
    getConfirm: getConfirm,
    clearConfirm: clearConfirm,
    hasConfirm: function () { return getConfirm() !== ""; },
    claimDirector: claimDirector,
    apiPendingQueue: apiPendingQueue,
    localOnlyAccounts: localOnlyAccounts,
    siteStatus: siteStatus,
    siteSave: siteSave,
    diag: diag,
    adminLog: adminLog,
    usersList: usersList,
    teamChatList: teamChatList,
    teamChatSend: teamChatSend,
    userAccess: userAccess,
    founders: founders,
    foundersSave: foundersSave,
    mailStatus: mailStatus,
    mailSave: mailSave,
    mailBoxes: mailBoxes,
    mailBoxSave: mailBoxSave,
    mailBoxTest: mailBoxTest,
    mailBoxSmtpTest: mailBoxSmtpTest,
    mailFolders: mailFolders,
    mailList: mailList,
    mailGet: mailGet,
    mailAttachment: mailAttachment,
    mailFlag: mailFlag,
    mailMove: mailMove,
    mailSend: mailSend,
    mailDrafts: mailDrafts,
    mailDraftSave: mailDraftSave,
    mailDraftDelete: mailDraftDelete,
    mailTemplates: mailTemplates,
    mailTemplateSave: mailTemplateSave,
    mailTemplatePreview: mailTemplatePreview,
    mailTemplateTest: mailTemplateTest,
    mailLog: mailLog,
    pointsAdd: pointsAdd,
    hiringMine: hiringMine,
    hiringApply: hiringApply,
    hiringTest: hiringTest,
    hiringTestSubmit: hiringTestSubmit,
    hiringList: hiringList,
    hiringCheck: hiringCheck,
    hiringDecide: hiringDecide,
    schoolMine: schoolMine,
    schoolApply: schoolApply,
    schoolList: schoolList,
    schoolDecide: schoolDecide,
    grantAdmin: grantAdmin,
    loginTwoFactor: loginTwoFactor,
    twofaEnable: twofaEnable,
    twofaDisable: twofaDisable,
    aiStatus: aiStatus,
    aiSave: aiSave,
    aiTest: aiTest,
    aiAssist: aiAssist,
    bossGrant: function (email, access) {
      return withToken("boss-grant", { email: email || "6804979@mail.ru", access: access || "Главный администратор" });
    },
    tasksMine: tasksMine,
    tasksList: tasksList,
    tasksCreate: tasksCreate,
    tasksUpdate: tasksUpdate,
    tasksComment: tasksComment,
    accountDelete: accountDelete,
    mailTest: mailTest,
    confirmSend: confirmSend,
    confirmCheck: confirmCheck,
    supportSend: supportSend,
    supportQueue: supportQueue,
    supportClose: supportClose,
    recoveryReset: recoveryReset,
    recoveryRequest: recoveryRequest,
    recoveryCode: recoveryCode,
    recoveryQueue: recoveryQueue,
    recoveryIssue: recoveryIssue,
    recoveryClose: recoveryClose,
    editorialList: editorialList,
    editorialCreate: editorialCreate,
    editorialApply: editorialApply,
    editorialMine: editorialMine,
    editorialReview: editorialReview,
    editorialQueue: editorialQueue,
    changePassword: changePassword,
    portfolio: portfolio,
    refreshPortfolio: refreshPortfolio,
    portfolioSend: portfolioSend,
    portfolioQueue: portfolioQueue,
    portfolioReview: portfolioReview,
    consent: consent,
    refreshConsent: refreshConsent,
    sendConsent: sendConsent,
    consentQueue: consentQueue,
    consentReview: consentReview,
    getSettings: getSettings,
    saveSettings: saveSettings,
    listUsers: listUsers,
    exportAll: exportAll,
    importAll: importAll,
    authorOf: authorOf,
    initials: initials,
    onChange: onChange,
  };
})();
