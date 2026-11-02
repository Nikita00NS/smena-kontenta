/* ============================================================================
   СМЕНА КОНТЕНТА — аккаунты и публикации (без сервера)
   ----------------------------------------------------------------------------
   Как это работает сейчас:
   аккаунт, черновики и опубликованные материалы хранятся в localStorage
   браузера. То есть регистрация и публикация работают по-настоящему, но
   данные видны только на этом устройстве.

   Что это значит для проекта:
   • прямо сейчас можно зарегистрироваться, получить пресс-карту, написать
     материал и опубликовать его — он появится в ленте и на странице региона;
   • когда понадобится, чтобы авторы видели материалы друг друга с разных
     устройств, этот файл заменяется на обращение к бесплатному серверу
     (например, Supabase / Firebase). Всё остальное меню и вёрстка останутся.

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
        { name: "", inn: "", role: "Директор" },
        { name: "", inn: "", role: "Директор" },
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

  /* права доступа: что человек может делать в редакции */
  var ACCESS = ["Владелец", "Главный редактор", "Редактор", "Автор"];

  /* кому что можно. Проверяется и в интерфейсе, и в самих операциях store */
  var RIGHTS = {
    "Владелец": ["publish", "review", "deleteAny", "manage", "editSettings", "issueCards"],
    "Главный редактор": ["publish", "review", "deleteAny", "manage", "editSettings", "issueCards"],
    "Редактор": ["publish", "review", "deleteAny", "manage"],
    "Автор": [],
  };

  function can(user, action) {
    if (!user) return false;
    var list = RIGHTS[user.access || "Автор"] || [];
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

  function currentUser() {
    var data = read();
    if (!data.session) return null;
    var user = data.users.filter(function (u) {
      return u.id === data.session;
    })[0];
    return user || null;
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
      access: data.users.length === 0 ? "Владелец" : "Автор",
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
    var data = read();
    data.session = null;
    write(data);
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
        access: u.access || "Автор",
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

  function onChange(fn) {
    listeners.push(fn);
  }

  return {
    ROLES: ROLES,
    currentUser: currentUser,
    register: register,
    login: login,
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
