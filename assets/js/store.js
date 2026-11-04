/* ============================================================================
   СМЕНА КОНТЕНТА — аккаунты и публикации (без сервера)
   ----------------------------------------------------------------------------
   Как это работает сейчас:
   аккаунт, черновики и опубликованные материалы хранятся в localStorage
   браузера. То есть регистрация и публикация работают по-настоящему, но
   данные видны только на этом устройстве.

   Что это значит для проекта:
   • аккаунт, черновики и пресс-карта живут в этом браузере;
   • отправленный материал уходит в общую приёмную на хостинге (api/index.php),
     поэтому редактор видит его с любого устройства, а после одобрения материал
     появляется у всех посетителей — см. блок «общая приёмная» ниже;
   • если PHP на хостинге недоступен, сайт продолжает работать локально.

   Пароль не передаётся никуда и не хранится в открытом виде, но это НЕ
   полноценная защита: для публичного запуска нужен серверный вход.
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
      email: "",
      phone: "",
      city: "Москва",
      founders: [
        { name: "Сирик Никита Сергеевич", inn: "940802781550", role: "Основатель" },
        { name: "Ильин Борис Павлович", inn: "784304154610", role: "Сооснователь" },
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

  /* Статусы проекта. Это не «профессия» автора, а права в системе:
     директор → администрация (высшая лига) → редакционный администратор
     региона → редакционный основатель → пользователь. */
  var ACCESS = [
    "Директор",
    "Администрация",
    "Редакционный администратор региона",
    "Редакционный основатель",
    "Пользователь",
  ];

  /* кому что можно. Проверяется и в интерфейсе, и в самих операциях store */
  var RIGHTS = {
    "Директор": ["publish", "review", "deleteAny", "manage", "editSettings", "issueCards", "manageUsers"],
    "Администрация": ["publish", "review", "deleteAny", "manage", "editSettings", "issueCards"],
    "Редакционный администратор региона": ["publish", "review", "manage", "issueCards"],
    "Редакционный основатель": ["publish", "review", "manage"],
    "Пользователь": [],
  };

  function can(user, action) {
    if (!user) return false;
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
          return { ok: true, user: res.user, remote: true, recoveryCode: res.recoveryCode || "" };
        }
        if (res && (res.offline || res.serverBroken)) {
          var local = register(payload);
          if (local.ok) local.offline = true;
          return local;
        }
        return { ok: false, error: (res && res.error) || "Сервер не принял регистрацию." };
      })
      .catch(function () {
        var offlineReg = register(payload);
        if (offlineReg.ok) offlineReg.offline = true;
        return offlineReg;
      });
  }

  function signIn(email, pass) {
    return api("login", { email: email, pass: pass })
      .then(function (res) {
        if (res && res.ok && res.token) {
          saveToken(res.token);
          cacheUser(res.user);
          mirrorUser(res.user);
          emit();
          return { ok: true, user: res.user, remote: true };
        }
        if (res && (res.offline || res.serverBroken)) return login(email, pass);
        /* аккаунт был создан раньше только в браузере: переносим на сервер,
           чтобы человек не потерял доступ к своим материалам */
        var legacy = login(email, pass);
        if (legacy.ok) return migrateAccount(legacy.user, pass);
        return { ok: false, error: (res && res.error) || "Не удалось войти." };
      })
      .catch(function () {
        return login(email, pass);
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
    if (pass.length < 6)
      return { ok: false, error: "Пароль должен быть не короче 6 символов." };
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
      access: data.users.length === 0 ? "Директор" : "Пользователь",
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
    var body = {
      token: token,
      name: patch.name,
      bio: patch.bio,
      region: patch.region,
      role: patch.role,
    };
    if (patch.avatar) body.avatar = patch.avatar;
    if (patch.avatarClear) body.avatarClear = true;

    var local = updateUser(patch);
    if (!token) return Promise.resolve(local);

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
        return local;
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

  function updateUser(patch) {
    var data = read();
    var user = currentUser();
    if (!user) return { ok: false, error: "Нужно войти." };
    data.users = data.users.map(function (u) {
      if (u.id !== user.id) return u;
      return {
        id: u.id,
        name: patch.name != null ? String(patch.name).trim() || u.name : u.name,
        email: u.email,
        pass: u.pass,
        region: patch.region != null ? patch.region : u.region,
        role: patch.role != null ? patch.role : u.role,
        bio: patch.bio != null ? String(patch.bio) : u.bio,
        avatar: patch.avatarClear ? "" : patch.avatar || u.avatar || "",
        access: u.access || "Пользователь",
        teamId: u.teamId || null,
        createdAt: u.createdAt,
        number: u.number,
      };
    });
    write(data);
    return { ok: true };
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
    if (!user) return { ok: false };
    data.posts = data.posts.filter(function (p) {
      if (p.id !== id) return true;
      return !(p.authorId === user.id || can(user, "deleteAny"));
    });
    write(data);
    return { ok: true };
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

  function makeCode(teams) {
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var code;
    do {
      code = "";
      for (var i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    } while (
      teams.some(function (t) {
        return t.code === code;
      })
    );
    return code;
  }

  function listTeams() {
    var data = read();
    return data.teams
      .map(function (t) {
        var members = data.users.filter(function (u) {
          return u.teamId === t.id;
        });
        var ids = members.map(function (m) {
          return m.id;
        });
        var published = data.posts.filter(function (p) {
          return p.status === "published" && ids.indexOf(p.authorId) !== -1;
        }).length;
        return {
          id: t.id,
          name: t.name,
          slug: t.slug || slugify(t.name),
          region: t.region || "",
          about: t.about || "",
          code: t.code,
          createdBy: t.createdBy,
          createdAt: t.createdAt,
          members: members.length,
          published: published,
        };
      })
      .sort(function (a, b) {
        return b.published - a.published || b.members - a.members;
      });
  }

  function getTeam(id) {
    return (
      listTeams().filter(function (t) {
        return t.id === id || t.slug === id || t.code === String(id || "").toUpperCase();
      })[0] || null
    );
  }

  function myTeam() {
    var user = currentUser();
    if (!user || !user.teamId) return null;
    return getTeam(user.teamId);
  }

  function createTeam(input) {
    var data = read();
    var user = currentUser();
    if (!user) return { ok: false, error: "Сначала войдите в аккаунт." };
    if (user.teamId) return { ok: false, error: "Вы уже в команде. Сначала выйдите из неё." };

    var name = String(input.name || "").trim();
    if (name.length < 3) return { ok: false, error: "Название команды — хотя бы три символа." };
    if (name.length > 60) return { ok: false, error: "Слишком длинное название — до 60 символов." };
    if (
      data.teams.some(function (t) {
        return t.name.toLowerCase() === name.toLowerCase();
      })
    )
      return { ok: false, error: "Команда с таким названием уже есть. Придумайте другое." };

    var team = {
      id: uid("t_"),
      name: name,
      slug: slugify(name) || uid("team").slice(0, 8),
      region: input.region || user.region || "",
      about: String(input.about || "").trim().slice(0, 400),
      code: makeCode(data.teams),
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    data.teams.push(team);
    data.users = data.users.map(function (u) {
      if (u.id !== user.id) return u;
      return Object.assign({}, u, {
        teamId: team.id,
        access: u.access === "Автор" ? "Редактор" : u.access,
      });
    });
    if (!write(data)) return { ok: false, error: "Не удалось сохранить команду." };
    return { ok: true, team: team };
  }

  function joinTeam(code) {
    var data = read();
    var user = currentUser();
    if (!user) return { ok: false, error: "Сначала войдите в аккаунт." };
    if (user.teamId) return { ok: false, error: "Вы уже в команде — сначала выйдите из текущей." };
    var clean = String(code || "").trim().toUpperCase();
    var team = data.teams.filter(function (t) {
      return t.code === clean || (t.slug || "").toLowerCase() === String(code || "").trim().toLowerCase();
    })[0];
    if (!team) return { ok: false, error: "Команда с таким кодом не найдена. Проверьте код." };
    data.users = data.users.map(function (u) {
      if (u.id !== user.id) return u;
      return Object.assign({}, u, { teamId: team.id });
    });
    write(data);
    return { ok: true, team: team };
  }

  function leaveTeam() {
    var data = read();
    var user = currentUser();
    if (!user) return { ok: false, error: "Нужно войти." };
    if (!user.teamId) return { ok: false, error: "Вы не в команде." };
    data.users = data.users.map(function (u) {
      if (u.id !== user.id) return u;
      return Object.assign({}, u, { teamId: null });
    });
    write(data);
    return { ok: true };
  }

  /* ------------------------------------------------------------- проверка */

  function submitPost(id) {
    var data = read();
    var user = currentUser();
    if (!user) return { ok: false, error: "Нужно войти." };
    var post = data.posts.filter(function (p) {
      return p.id === id && p.authorId === user.id;
    })[0];
    if (!post) return { ok: false, error: "Материал не найден." };
    if (post.status === "pending") return { ok: false, error: "Материал уже на проверке." };

    var direct = can(user, "publish");
    var now = new Date().toISOString();
    data.posts = data.posts.map(function (p) {
      if (p.id !== id) return p;
      return Object.assign({}, p, {
        status: direct ? "published" : "pending",
        date: direct ? now : p.date,
        submittedAt: now,
        reviewNote: "",
        reviewedAt: direct ? now : null,
        reviewedBy: direct ? user.id : null,
      });
    });
    write(data);
    var fresh = data.posts.filter(function (p) {
      return p.id === id;
    })[0];
    pushPost(fresh, user, direct);
    return {
      ok: true,
      direct: direct,
      message: direct
        ? "Материал опубликован — у вас права редакции."
        : "Материал отправлен на проверку. Редакция увидит его в очереди.",
    };
  }

  function reviewPost(id, decision, note) {
    var data = read();
    var user = currentUser();
    if (!can(user, "review")) return { ok: false, error: "Недостаточно прав для проверки." };
    var post = data.posts.filter(function (p) {
      return p.id === id;
    })[0];
    if (!post) return { ok: false, error: "Материал не найден." };
    var now = new Date().toISOString();
    data.posts = data.posts.map(function (p) {
      if (p.id !== id) return p;
      return Object.assign({}, p, {
        status: decision === "approve" ? "published" : "rejected",
        date: decision === "approve" ? now : p.date,
        reviewedAt: now,
        reviewedBy: user.id,
        reviewNote: String(note || "").trim(),
      });
    });
    write(data);
    return { ok: true };
  }

  function pendingPosts() {
    return listPosts({ status: "pending" }).map(function (p) {
      var data = read();
      var author = data.users.filter(function (u) {
        return u.id === p.authorId;
      })[0];
      return Object.assign({}, p, {
        authorName: author ? author.name : "Автор",
        authorAccess: author ? author.access || "Автор" : "Автор",
      });
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

  /* Пресс-карта выдаётся после нужного числа публикаций:
     до этого показываем прогресс, а не номер. */
  function pressCard() {
    var data = read();
    var user = currentUser();
    if (!user) return null;

    var settings = getSettings();
    var card = settings.card;
    var team = user.teamId ? getTeam(user.teamId) : null;
    var scope = team ? "team" : "individual";

    var pool;
    var need;
    if (team) {
      var ids = data.users
        .filter(function (u) {
          return u.teamId === team.id;
        })
        .map(function (u) {
          return u.id;
        });
      pool = data.posts.filter(function (p) {
        return p.status === "published" && ids.indexOf(p.authorId) !== -1;
      });
      need = Math.max(1, Number(card.teamMinPosts) || 20);
    } else {
      pool = data.posts.filter(function (p) {
        return p.status === "published" && p.authorId === user.id;
      });
      need = Math.max(1, Number(card.minPosts) || 5);
    }

    var have = pool.length;
    var issued = have >= need;
    var issuedAt = null;
    var validUntil = null;

    if (issued) {
      var byDate = pool.slice().sort(function (a, b) {
        return new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt);
      });
      var hit = byDate[need - 1] || byDate[byDate.length - 1];
      issuedAt = (hit && (hit.date || hit.createdAt)) || new Date().toISOString();
      validUntil = addMonths(issuedAt, card.validMonths);
    }

    return {
      issued: issued,
      scope: scope,
      posts: have,
      need: need,
      left: Math.max(0, need - have),
      teamName: team ? team.name : "",
      editorial: team
        ? "Редакция «" + team.name + "»"
        : "Индивидуальная редакция «" + (settings.org.name || "Смена контента") + "»",
      number: issued
        ? card.prefix + "-" + card.year + "-" + String(user.number).padStart(3, "0")
        : null,
      name: user.name,
      role: user.role,
      region: regionLabel(user.region) || "Регион не выбран",
      issuer: settings.org.center || settings.org.name,
      head: settings.org.head || "",
      since: user.createdAt,
      issuedAt: issuedAt,
      validUntil: validUntil,
    };
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
  function pushPost(post, user, direct) {
    if (!post || !user) return Promise.resolve(false);
    var payload = {
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
      direct: !!direct,
    };
    return api("submit", payload)
      .then(function (res) {
        var data = read();
        data.posts = data.posts.map(function (p) {
          if (p.id !== post.id) return p;
          return Object.assign({}, p, {
            remoteId: res && res.ok ? res.post.id : "",
            remoteError: res && res.ok ? "" : (res && res.error) || "не удалось отправить редакции",
          });
        });
        write(data);
        if (res && res.ok) pullRemote();
        return !!(res && res.ok);
      })
      .catch(function () {
        var data = read();
        data.posts = data.posts.map(function (p) {
          if (p.id !== post.id) return p;
          return Object.assign({}, p, {
            remoteError: "нет связи с сервером — материал сохранён в браузере",
          });
        });
        write(data);
        return false;
      });
  }

  /* статусы своих материалов с сервера: одобрили, отклонили, ждут */
  function syncMine() {
    return api("mine", { authorKey: authorKey() })
      .then(function (res) {
        if (!res || !res.ok) return false;
        var mine = res.posts || [];
        var data = read();
        data.posts = data.posts.map(function (p) {
          var found = null;
          for (var i = 0; i < mine.length; i++) {
            if (p.remoteId && mine[i].id === p.remoteId) found = mine[i];
          }
          if (!found) return p;
          return Object.assign({}, p, {
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
    return api("queue", { password: String(password || "") });
  }

  function apiReview(password, id, decision, note) {
    return api("review", {
      password: String(password || ""),
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
    return api("mine", { authorKey: authorKey() }).then(function (res) {
      return res && res.ok ? res.posts || [] : [];
    });
  }

  /* заявка на пресс-карту: прикладываются все свои опубликованные материалы */
  function apiCardRequest(payload) {
    return api("card-request", {
      authorKey: authorKey(),
      authorName: payload.authorName || "",
      authorRegion: payload.authorRegion || "",
      authorRole: payload.authorRole || "",
      posts: payload.posts || [],
    });
  }

  function apiCardStatus() {
    return api("card-status", { authorKey: authorKey() }).then(function (res) {
      if (res && res.ok) return res;
      return { ok: false, requests: [], minPosts: 5, error: (res && res.error) || "" };
    });
  }

  function apiCardQueue(password) {
    return api("card-queue", { password: String(password || "") });
  }

  function apiCardReview(password, id, decision, note) {
    return api("card-review", {
      password: String(password || ""),
      id: id,
      decision: decision,
      note: note || "",
    });
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
  var CONSENT_KEY = "smena_consent_v1";

  function readConsentCache() {
    try {
      var raw = window.localStorage.getItem(CONSENT_KEY);
      if (!raw) return { status: "none" };
      var parsed = JSON.parse(raw);
      return parsed && parsed.status ? parsed : { status: "none" };
    } catch (e) {
      return { status: "none" };
    }
  }

  function cacheConsent(consent) {
    try {
      if (consent) window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    } catch (e) {}
  }

  function consent() {
    var cached = readConsentCache();
    if (!readToken()) return cached.status ? cached : { status: "none" };
    return cached;
  }

  /* запрос свежего статуса с сервера */
  function refreshConsent() {
    var token = readToken();
    if (!token) return Promise.resolve(consent());
    return api("consent-status", { token: token }).then(function (res) {
      if (res && res.ok && res.consent) {
        cacheConsent(res.consent);
        emit();
        return res.consent;
      }
      return consent();
    }, function () {
      return consent();
    });
  }

  /* отправка подписанного скана: картинка уходит на сервер, заявка — в комиссию */
  function sendConsent(dataUrl) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт, чтобы отправить согласие."));
    return api("consent-send", { token: token, scan: dataUrl }).then(
      function (res) {
        if (res && res.ok && res.consent) {
          cacheConsent(res.consent);
          emit();
          return res.consent;
        }
        throw new Error((res && res.error) || "Согласие не отправилось.");
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

  /* ------------------------------------------- участники, роли, основатели */

  function diag() {
    return api("diag", {}).then(function (res) {
      return res && res.ok ? res : null;
    }, function () {
      return null;
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
          incoming: res.incoming || [],
        };
      }
      return { applications: [], editorial: null, incoming: [] };
    }, function () {
      return { applications: [], editorial: null, incoming: [] };
    });
  }

  function editorialQueue() {
    var token = readToken();
    if (!token) return Promise.resolve([]);
    return api("editorial-queue", { token: token }).then(function (res) {
      return res && res.ok ? res.applications || [] : [];
    }, function () {
      return [];
    });
  }

  function editorialReview(id, decision, note) {
    var token = readToken();
    if (!token) return Promise.reject(new Error("Войдите в аккаунт."));
    return api("editorial-review", { token: token, id: id, decision: decision, note: note })
      .then(function (res) {
        if (res && res.ok) return true;
        throw new Error((res && res.error) || "Решение не сохранилось.");
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

  function portfolioQueue(password) {
    return api("portfolio-queue", { password: password });
  }

  function portfolioReview(password, id, decision, note, points, publish) {
    return api("portfolio-review", {
      password: password,
      id: id,
      decision: decision,
      note: note,
      points: points,
      publish: publish,
    });
  }

  function portfolioPoints() {
    return portfolio().reduce(function (sum, item) {
      return sum + (item.status === "approved" ? Number(item.points) || 0 : 0);
    }, 0);
  }

  function consentQueue(password) {
    return api("consent-queue", { password: password });
  }

  function consentReview(password, id, decision, note) {
    return api("consent-review", {
      password: password,
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
    updateUser: updateUser,
    listPosts: listPosts,
    getPost: getPost,
    savePost: savePost,
    deletePost: deletePost,
    publishPost: publishPost,
    submitPost: submitPost,
    reviewPost: reviewPost,
    pendingPosts: pendingPosts,
    ACCESS: ACCESS,
    can: can,
    listTeams: listTeams,
    getTeam: getTeam,
    myTeam: myTeam,
    createTeam: createTeam,
    joinTeam: joinTeam,
    leaveTeam: leaveTeam,
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
    diag: diag,
    usersList: usersList,
    userAccess: userAccess,
    founders: founders,
    foundersSave: foundersSave,
    mailStatus: mailStatus,
    mailSave: mailSave,
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
    portfolioPoints: portfolioPoints,
    consent: consent,
    refreshConsent: refreshConsent,
    sendConsent: sendConsent,
    consentQueue: consentQueue,
    consentReview: consentReview,
    pressCard: pressCard,
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
