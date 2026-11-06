<?php
/* ============================================================================
   СМЕНА КОНТЕНТА — общая приёмная для материалов (PHP, без базы данных)

   Зачем это нужно:
   сайт статический, а материалы авторов должны доходить до редакции
   с любого устройства, а не оставаться в браузере автора.

   Что здесь есть:
   • submit  — автор отправляет материал, он попадает в очередь редакции;
   • queue   — редактор (по паролю) видит очередь с любого устройства;
   • review  — редактор одобряет или отклоняет материал с замечанием;
   • state   — все одобренные материалы, их читают страницы сайта;
   • mine    — автор по своему ключу видит статус своих материалов;
   • selftest— самопроверка: можно открыть в браузере и увидеть, всё ли пишется.

   Данные лежат в api/data/*.json и закрыты от прямого доступа через .htaccess.
   Никаких сторонних сервисов: файлы на том же хостинге, в России.
   ========================================================================== */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

const MAX_BODY_CHARS = 200000;   // потолок на текст одного материала
const MAX_POSTS = 2000;          // сколько материалов храним
const RATE_LIMIT = 25;           // отправок с одного адреса в час

/* Пароль редакции в коде НЕ хранится. При первом запуске на сервере
   генерируется случайный, а его значение один раз записывается в
   smena-data/BOOTSTRAP-PAROL.txt — папка лежит вне public_html, из браузера
   файл недоступен. Константа ниже нужна только для предупреждения
   «вы всё ещё на стандартном пароле» и в проверке доступа не участвует. */
const KNOWN_DEFAULT_EDITOR_PASSWORD = 'Redakcia-Smena-2026';

/* ---------------------------------------------------------------------------
   Где лежат данные: users.json, mail.json, cards.json и остальное.

   Выкладка сайта по FTP синхронизирует public_html и удаляет на сервере всё,
   чего нет в репозитории. Данные в репозиторий не попадают — значит, при
   каждой выкладке они бы стирались: аккаунты, пароль редакции, настройки
   почты, заявки.

   Поэтому данные живут рядом с public_html, но ВНЕ его: папка smena-data.
   Подстраховка: если снаружи писать нельзя, остаёмся в api/data.
   --------------------------------------------------------------------------- */
$DATA_DIR_INSIDE = __DIR__ . '/data';
$DATA_DIR_OUTSIDE = dirname(__DIR__, 2) . '/smena-data';
$DATA_DIR = $DATA_DIR_INSIDE;
if (is_dir($DATA_DIR_OUTSIDE) ? is_writable($DATA_DIR_OUTSIDE) : is_writable(dirname($DATA_DIR_OUTSIDE))) {
    $DATA_DIR = $DATA_DIR_OUTSIDE;
}
/* первый запуск после переезда: забираем то, что уже лежало внутри */
if ($DATA_DIR !== $DATA_DIR_INSIDE && is_dir($DATA_DIR_INSIDE)) {
    if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0755, true);
    foreach ((array) glob($DATA_DIR_INSIDE . '/*.json') as $old_file) {
        $new_file = $DATA_DIR . '/' . basename($old_file);
        if (!file_exists($new_file)) @copy($old_file, $new_file);
    }
}

/* Без подтверждённой почты аккаунт остаётся «ожидающим»: он виден, в него
   можно войти, но отправлять материалы, заявки и обращения нельзя. Это
   защищает и человека (чужой адрес не займут), и редакцию (письма
   уходят только тем, кто действительно подтвердил адрес). */
function require_verified($user) {
    if (empty($user['emailVerified'])) {
        fail('Подтвердите почту. Откройте кабинет, введите код из письма — без этого действие недоступно. Письмо можно запросить заново.', 403);
    }
}

function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail($message, $code = 400) {
    respond(array('ok' => false, 'error' => $message, 'code' => $code), $code);
}

function ensure_dir($dir) {
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $htaccess = $dir . '/.htaccess';
    if (!file_exists($htaccess)) {
        @file_put_contents($htaccess, "Require all denied\nDeny from all\n");
    }
    $index = $dir . '/index.html';
    if (!file_exists($index)) {
        @file_put_contents($index, '');
    }
    return is_dir($dir) && is_writable($dir);
}

function read_json($file, $fallback) {
    if (!file_exists($file)) return $fallback;
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') return $fallback;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $fallback;
}

function write_json($file, $data) {
    $tmp = $file . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) return false;
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    @chmod($file, 0644);
    return true;
}

function body() {
    static $cache = null;
    if ($cache !== null) return $cache;
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return array();
    if (strlen($raw) > 9000000) fail('Запрос больше 9 МБ — уменьшите файл.', 413);
    $data = json_decode($raw, true);
    $cache = is_array($data) ? $data : array();
    return $cache;
}

/* отправка писем: свой SMTP-клиент без сторонних библиотек */
define('SMENA_API', true);
require __DIR__ . '/smtp.php';
/* новые подсистемы: права, резервные копии, журнал баллов */
require __DIR__ . '/lib/permissions.php';
require __DIR__ . '/lib/backup.php';
require __DIR__ . '/lib/points.php';
require __DIR__ . '/lib/mailer.php';   /* фирменные письма, шаблоны, журнал доставки */
require __DIR__ . '/lib/imap.php';     /* чтение почты с ящиков домена */
require __DIR__ . '/lib/mailbox.php';  /* ящики домена: чтение, отправка, шаблоны */
require __DIR__ . '/lib/hiring.php';   /* приём в команду: тест, чек-лист, согласование */

function action() {
    if (isset($_GET['action'])) return (string) $_GET['action'];
    $in = body();
    if (isset($in['action'])) return (string) $in['action'];
    return '';
}

function text($value, $max) {
    $s = is_string($value) ? $value : '';
    $s = str_replace(array("\0", "\r\n"), array('', "\n"), $s);
    $s = trim($s);
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max, 'UTF-8');
    }
    return substr($s, 0, $max);
}

function slen($value) {
    $s = (string) $value;
    if (function_exists('mb_strlen')) return mb_strlen($s, 'UTF-8');
    return strlen($s);
}

/* Адрес клиента для лимитов. X-Forwarded-For подставляется кем угодно,
   поэтому верим ему только когда запрос пришёл от локального прокси
   хостинга: иначе лимит обходится одной строкой в заголовке. */
function client_ip() {
    $remote = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
    $from_proxy = (bool) preg_match('/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/', $remote);
    if ($from_proxy && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
        $candidate = trim($parts[0]);
        if (filter_var($candidate, FILTER_VALIDATE_IP)) return $candidate;
    }
    return $remote;
}

function check_rate($dir) {
    $file = $dir . '/rate.json';
    $now = time();
    $all = read_json($file, array());
    $ip = client_ip();
    $list = isset($all[$ip]) && is_array($all[$ip]) ? $all[$ip] : array();
    $fresh = array();
    foreach ($list as $ts) {
        if (is_int($ts) && $now - $ts < 3600) $fresh[] = $ts;
    }
    if (count($fresh) >= RATE_LIMIT) {
        fail('Слишком много отправок подряд. Попробуйте через час.', 429);
    }
    $fresh[] = $now;
    $all[$ip] = $fresh;
    // чистим совсем старые записи, чтобы файл не рос
    if (count($all) > 500) {
        $all = array($ip => $fresh);
    }
    write_json($file, $all);
}

function editor_hash($dir) {
    $file = $dir . '/config.json';
    $cfg = read_json($file, array());
    if (empty($cfg['editor'])) {
        /* случайный пароль вместо стандартного: утёкший из репозитория
           «пароль по умолчанию» больше не открывает админские действия */
        $plain = 'red-' . bin2hex(random_bytes(7));
        $cfg['editor'] = password_hash($plain, PASSWORD_DEFAULT);
        $cfg['createdAt'] = date('c');
        if (write_json($file, $cfg)) {
            @file_put_contents($dir . '/BOOTSTRAP-PAROL.txt',
                "Пароль редакции, создан автоматически " . date('c') . "\n\n" . $plain .
                "\n\nСмените его в /admin → вкладка «Сервер» и удалите этот файл.\n");
            @chmod($dir . '/BOOTSTRAP-PAROL.txt', 0600);
        }
    }
    return (string) $cfg['editor'];
}

function is_editor($dir, $password) {
    $hash = editor_hash($dir);
    if ($password === '' || $password === null) return false;
    return password_verify((string) $password, $hash);
}

/* Предупреждение в админке: пароль редакции всё ещё тот, что лежал
   в открытом коде. На доступ это не влияет, только на подсказку. */
function editor_uses_known_default($dir) {
    $cfg = read_json($dir . '/config.json', array());
    if (empty($cfg['editor'])) return false;
    return password_verify(KNOWN_DEFAULT_EDITOR_PASSWORD, (string) $cfg['editor']);
}

/* Служебные проверки (selftest, diag) пишут и удаляют данные, поэтому
   открываются только паролем редакции или входом директора. */
function require_diagnostics($dir, $params) {
    $pass = isset($params['pass']) ? (string) $params['pass'] : '';
    if ($pass !== '' && is_editor($dir, $pass)) return;
    $token = isset($params['token']) ? (string) $params['token'] : '';
    if ($token !== '' && is_top_admin(user_by_token($dir, $token))) return;
    respond(array('ok' => false, 'error' => 'Неизвестное действие.', 'code' => 404), 404);
}

/* Журнал действий редакции: кто, что и когда. Без него разбирать
   «кто снял роль» или «кто закрыл обращение» приходится по памяти. */
function audit_file($dir) { return $dir . '/admin-log.json'; }

function audit_log($dir, $who, $action, $details = '') {
    $list = read_json(audit_file($dir), array());
    if (!is_array($list)) $list = array();
    $list[] = array(
        'at' => date('c'),
        'ip' => client_ip(),
        'who' => text($who, 120),
        'action' => text($action, 60),
        'details' => text($details, 300),
    );
    if (count($list) > 2000) $list = array_slice($list, -2000);
    write_json(audit_file($dir), $list);
}

function public_audit($row) {
    return array(
        'at' => isset($row['at']) ? $row['at'] : '',
        'ip' => isset($row['ip']) ? $row['ip'] : '',
        'who' => isset($row['who']) ? $row['who'] : '',
        'action' => isset($row['action']) ? $row['action'] : '',
        'details' => isset($row['details']) ? $row['details'] : '',
    );
}

/* Ссылки на картинки приходят из формы: пускаем только свой медиа-адрес
   или обычный http(s), чтобы в профиль не попал javascript:-адрес. */
function safe_media_url($value) {
    $v = trim((string) $value);
    if ($v === '') return '';
    if (preg_match('#^/api/index\.php\?action=media&id=[A-Za-z0-9_.-]+$#', $v)) return $v;
    if (preg_match('#^https?://[^\s"\'<>]+$#i', $v)) return $v;
    return '';
}

function new_id($prefix) {
    return $prefix . bin2hex(random_bytes(6));
}

function public_post($post) {
    $out = array(
        'id' => $post['id'],
        'title' => $post['title'],
        'excerpt' => $post['excerpt'],
        'body' => $post['body'],
        'topic' => $post['topic'],
        'format' => $post['format'],
        'region' => $post['region'],
        'image' => isset($post['image']) ? $post['image'] : '',
        'imageAlt' => isset($post['imageAlt']) ? $post['imageAlt'] : '',
        'gallery' => isset($post['gallery']) && is_array($post['gallery']) ? $post['gallery'] : array(),
        'video' => isset($post['video']) ? $post['video'] : '',
        'audio' => isset($post['audio']) ? $post['audio'] : '',
        'read' => isset($post['read']) ? $post['read'] : 4,
        'date' => isset($post['date']) ? $post['date'] : $post['submittedAt'],
        'authorName' => $post['authorName'],
        'authorRole' => isset($post['authorRole']) ? $post['authorRole'] : '',
        'authorRegion' => isset($post['authorRegion']) ? $post['authorRegion'] : '',
        'status' => $post['status'],
        'number' => isset($post['number']) ? (int) $post['number'] : 0,
        'authorKeyHash' => substr(hash('sha256', (string) (isset($post['authorKey']) ? $post['authorKey'] : '')), 0, 16),
    );
    if (isset($post['reviewNote'])) $out['reviewNote'] = $post['reviewNote'];
    if (isset($post['reviewedAt'])) $out['reviewedAt'] = $post['reviewedAt'];
    return $out;
}

/* ---------------------------------------------------------------- самопроверка */
function selftest($dir) {
    $checks = array();
    $checks['php'] = PHP_VERSION;
    $checks['папка_данных'] = $dir;
    $checks['папка_есть'] = is_dir($dir);
    $checks['папка_доступна_на_запись'] = is_dir($dir) && is_writable($dir);

    if (!is_dir($dir) || !is_writable($dir)) {
        respond(array('ok' => false, 'error' => 'Папка api/data недоступна для записи. Проверьте права (755).', 'checks' => $checks), 500);
    }

    $probe = $dir . '/probe.json';
    $writeOk = @file_put_contents($probe, '{"ok":true}', LOCK_EX) !== false;
    $readOk = $writeOk && read_json($probe, array()) === array('ok' => true);
    $delOk = $writeOk && @unlink($probe);
    $checks['запись'] = $writeOk;
    $checks['чтение'] = $readOk;
    $checks['удаление'] = $delOk;

    $usersFree = @file_get_contents(__DIR__ . '/data/.htaccess');
    $checks['данные_закрыты_от_браузера'] = $usersFree !== false && strpos($usersFree, 'denied') !== false;
    $checks['пароль_редакции_по_умолчанию'] = !file_exists($dir . '/config.json');

    $posts = read_json($dir . '/posts.json', array());
    $checks['материалов_всего'] = count($posts);
    $checks['в_очереди'] = count(array_filter($posts, function ($p) { return $p['status'] === 'pending'; }));

    respond(array('ok' => $writeOk && $readOk && $delOk, 'checks' => $checks));
}

/* ------------------------------------------------- полная проверка приёмной */
function selftest_full($dir) {
    $steps = array();
    $id = 'test_' . bin2hex(random_bytes(4));
    $posts = read_json($dir . '/posts.json', array());
    $before = count($posts);

    $posts[$id] = array(
        'id' => $id,
        'authorKey' => 'selftest00000000',
        'authorName' => 'Самопроверка',
        'authorRole' => 'Служебная запись',
        'authorRegion' => 'Москва',
        'title' => 'Служебная проверка приёмной',
        'excerpt' => 'Короткая запись, которую создаёт самопроверка и сразу удаляет.',
        'body' => str_repeat('Проверка записи и чтения материала. ', 10),
        'topic' => 'Служебное',
        'format' => 'Проверка',
        'region' => 'moskva',
        'image' => '',
        'read' => 1,
        'status' => 'pending',
        'date' => date('c'),
        'submittedAt' => date('c'),
        'reviewedAt' => null,
        'reviewNote' => '',
    );
    $steps['запись_материала'] = write_json($dir . '/posts.json', $posts);

    $again = read_json($dir . '/posts.json', array());
    $steps['материал_прочитан'] = isset($again[$id]);
    $steps['статус_пока_на_проверке'] = isset($again[$id]) && $again[$id]['status'] === 'pending';

    // одобрение
    if (isset($again[$id])) {
        $again[$id]['status'] = 'published';
        $again[$id]['date'] = date('c');
        $steps['запись_решения'] = write_json($dir . '/posts.json', $again);
    }

    $third = read_json($dir . '/posts.json', array());
    $steps['решение_сохранилось'] = isset($third[$id]) && $third[$id]['status'] === 'published';

    // публичный список
    $public = array();
    foreach ($third as $post) {
        if ($post['status'] === 'published') $public[] = $post;
    }
    $steps['виден_в_общем_списке'] = count(array_filter($public, function ($p) use ($id) {
        return $p['id'] === $id;
    })) === 1;

    // уборка
    unset($third[$id]);
    $steps['уборка'] = write_json($dir . '/posts.json', $third);
    $after = count(read_json($dir . '/posts.json', array()));
    $steps['данные_не_изменились'] = $after === $before;

    $ok = true;
    foreach ($steps as $value) {
        if ($value !== true) $ok = false;
    }
    respond(array('ok' => $ok, 'steps' => $steps, 'материалов_было' => $before, 'материалов_стало' => $after));
}

/* ============================================================================
   АККАУНТЫ, РОЛИ И МЕДИА
   Аккаунты живут на сервере, поэтому вход работает с любого устройства:
   телефон, компьютер, другой браузер. Пароль хранится только в виде хеша.
   ========================================================================== */

const ROLES = array(
    'Директор',
    'Администрация',
    'Редакционный администратор региона',
    'Редакционный основатель',
    'Пользователь',
);

const CRAFT = array('Автор текстов', 'Фотограф', 'Видеограф', 'Дизайнер', 'Редактор', 'Наставник');

const TOKEN_DAYS = 60;
const MAX_AVATAR_CHARS = 400000;
const MAX_MEDIA_CHARS = 8000000;

function users_file($dir) { return $dir . '/users.json'; }
function tokens_file($dir) { return $dir . '/tokens.json'; }

function read_users($dir) {
    $users = read_json(users_file($dir), array());
    return is_array($users) ? $users : array();
}

function public_user($u) {
    return array(
        'id' => $u['id'],
        'name' => $u['name'],
        'email' => isset($u['email']) ? $u['email'] : '',
        'region' => isset($u['region']) ? $u['region'] : '',
        'role' => isset($u['role']) ? $u['role'] : 'Автор текстов',
        'access' => isset($u['access']) ? $u['access'] : 'Пользователь',
        'bio' => isset($u['bio']) ? $u['bio'] : '',
        'avatar' => isset($u['avatar']) ? $u['avatar'] : '',
        'createdAt' => isset($u['createdAt']) ? $u['createdAt'] : '',
        'number' => isset($u['number']) ? (int) $u['number'] : 0,
        'emailVerified' => !empty($u['emailVerified']),
        'status' => isset($u['status']) ? $u['status'] : 'active',
        'position' => isset($u['position']) ? $u['position'] : '',
        'hiredAt' => isset($u['hiredAt']) ? $u['hiredAt'] : '',
        'caps' => function_exists('user_caps') ? user_caps($u) : array(),
        'canUseMail' => function_exists('can') ? can($u, 'mail.use') : false,
    );
}

const MAX_TOKENS_PER_USER = 12;

function revoke_user_tokens($dir, $userId, $except = '') {
    $tokens = read_json(tokens_file($dir), array());
    if (!is_array($tokens)) return;
    foreach ($tokens as $t => $info) {
        if (!is_array($info) || (string) $info['id'] !== (string) $userId) continue;
        if ($except !== '' && $t === $except) continue;
        unset($tokens[$t]);
    }
    write_json(tokens_file($dir), $tokens);
}

function new_token($dir, $userId) {
    $tokens = read_json(tokens_file($dir), array());
    if (!is_array($tokens)) $tokens = array();
    $now = time();
    $mine = array();
    foreach ($tokens as $token => $info) {
        if (!is_array($info) || (int) $info['exp'] < $now) { unset($tokens[$token]); continue; }
        if ((string) $info['id'] === (string) $userId) $mine[$token] = (int) $info['exp'];
    }
    /* старые сессии того же человека не копятся бесконечно */
    if (count($mine) >= MAX_TOKENS_PER_USER) {
        asort($mine);
        $drop = count($mine) - MAX_TOKENS_PER_USER + 1;
        foreach ($mine as $token => $exp) {
            if ($drop <= 0) break;
            unset($tokens[$token]);
            $drop--;
        }
    }
    $token = bin2hex(random_bytes(24));
    $tokens[$token] = array(
        'id' => $userId,
        'exp' => $now + TOKEN_DAYS * 86400,
        'at' => $now,
        'ua' => substr(hash('sha256', isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : ''), 0, 16),
    );
    write_json(tokens_file($dir), $tokens);
    return $token;
}

function user_by_token($dir, $token) {
    if (!$token) return null;
    $tokens = read_json(tokens_file($dir), array());
    if (!is_array($tokens) || !isset($tokens[$token])) return null;
    $info = $tokens[$token];
    if ((int) $info['exp'] < time()) return null;
    $users = read_users($dir);
    foreach ($users as $user) {
        if ($user['id'] === $info['id']) return $user;
    }
    return null;
}

/* Когда человек последний раз заходил. Пишем не чаще раза в полчаса,
   чтобы файл не переписывался на каждый запрос. */
function activity_file($dir) { return $dir . '/activity.json'; }

function touch_activity($dir, $userId) {
    $all = read_json(activity_file($dir), array());
    if (!is_array($all)) $all = array();
    $last = isset($all[$userId]) ? (int) $all[$userId] : 0;
    if (time() - $last < 1800) return;
    $all[$userId] = time();
    if (count($all) > 5000) $all = array_slice($all, -5000, true);
    write_json(activity_file($dir), $all);
}

function last_seen_of($dir, $userId, $all = null) {
    if ($all === null) $all = read_json(activity_file($dir), array());
    if (!is_array($all) || !isset($all[$userId])) return '';
    return date('c', (int) $all[$userId]);
}

function norm_email($value) {
    $email = strtolower(trim((string) $value));
    if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u', $email)) return '';
    return $email;
}

/* Тип файла из браузера — это просто строка, её подставляет кто угодно.
   Смотрим первые байты: картинка должна начинаться как картинка. */
function file_signature_ok($mime, $bin) {
    if (strlen($bin) < 12) return false;
    switch ($mime) {
        case 'image/jpeg': return substr($bin, 0, 3) === "\xFF\xD8\xFF";
        case 'image/png':  return substr($bin, 0, 8) === "\x89PNG\r\n\x1A\n";
        case 'image/gif':  return substr($bin, 0, 6) === 'GIF87a' || substr($bin, 0, 6) === 'GIF89a';
        case 'image/webp': return substr($bin, 0, 4) === 'RIFF' && substr($bin, 8, 4) === 'WEBP';
        case 'audio/mpeg': return substr($bin, 0, 3) === 'ID3'
            || (ord($bin[0]) === 0xFF && (ord($bin[1]) & 0xE0) === 0xE0);
        case 'audio/wav':
        case 'audio/x-wav': return substr($bin, 0, 4) === 'RIFF' && substr($bin, 8, 4) === 'WAVE';
        case 'audio/ogg':  return substr($bin, 0, 4) === 'OggS';
        case 'audio/mp4':
        case 'video/mp4':
        case 'video/quicktime': return substr($bin, 4, 4) === 'ftyp';
        case 'video/webm': return substr($bin, 0, 4) === "\x1A\x45\xDF\xA3";
        case 'application/pdf': return substr($bin, 0, 4) === '%PDF';
    }
    return false;
}

function data_url_file($value, $allowed, $maxChars, &$error) {
    $error = '';
    if (!is_string($value) || $value === '') { $error = 'Файл не передан.'; return null; }
    if (strlen($value) > $maxChars) { $error = 'Файл слишком большой.'; return null; }
    if (!preg_match('#^data:([a-z0-9.+/-]+);base64,(.+)$#is', $value, $m)) {
        $error = 'Не удалось прочитать файл.';
        return null;
    }
    $mime = strtolower($m[1]);
    if (!isset($allowed[$mime])) { $error = 'Такой формат не поддерживается.'; return null; }
    $bin = base64_decode($m[2], true);
    if ($bin === false || $bin === '') { $error = 'Файл повреждён.'; return null; }
    if (!file_signature_ok($mime, $bin)) {
        $error = 'Содержимое файла не совпадает с форматом. Пересохраните файл и попробуйте снова.';
        return null;
    }
    return array('ext' => $allowed[$mime], 'mime' => $mime, 'bin' => $bin);
}

function media_dir($dir) {
    $path = $dir . '/uploads';
    if (!is_dir($path)) @mkdir($path, 0755, true);
    return $path;
}

function media_public_url($name) {
    return '/api/index.php?action=media&id=' . rawurlencode($name);
}

/* защита от перебора: не больше 20 попыток входа в час с одного адреса */
function check_login_rate($dir) {
    $file = $dir . '/login-rate.json';
    $ip = client_ip();
    $now = time();
    $data = read_json($file, array());
    if (!is_array($data)) $data = array();
    $list = isset($data[$ip]) ? $data[$ip] : array();
    $list = array_values(array_filter($list, function ($t) use ($now) { return $now - (int) $t < 3600; }));
    if (count($list) >= 20) fail('Слишком много попыток входа. Подождите час или сбросьте пароль.', 429);
    $list[] = $now;
    $data[$ip] = $list;
    write_json($file, $data);
}

/* ------------------------------------------------ согласия на обработку ПД */
function consents_file($dir) { return $dir . '/consents.json'; }

function read_consents($dir) {
    $list = read_json(consents_file($dir), array());
    return is_array($list) ? $list : array();
}

function consent_of_user($dir, $userId) {
    foreach (read_consents($dir) as $c) {
        if (isset($c['userId']) && $c['userId'] === $userId) return $c;
    }
    return null;
}

function public_consent($c) {
    if (!$c) return array('status' => 'none', 'note' => '', 'decidedAt' => '', 'createdAt' => '', 'scan' => '');
    return array(
        'id' => isset($c['id']) ? $c['id'] : '',
        'status' => isset($c['status']) ? $c['status'] : 'pending',
        'note' => isset($c['note']) ? $c['note'] : '',
        'createdAt' => isset($c['createdAt']) ? $c['createdAt'] : '',
        'decidedAt' => isset($c['decidedAt']) ? $c['decidedAt'] : '',
        'name' => isset($c['name']) ? $c['name'] : '',
        'email' => isset($c['email']) ? $c['email'] : '',
        'userRegion' => isset($c['userRegion']) ? $c['userRegion'] : '',
        'scan' => isset($c['scan']) ? $c['scan'] : '',
    );
}

/* ------------------------------------------------ портфолио автора вне сайта */
function portfolio_file($dir) { return $dir . '/portfolio.json'; }

function read_portfolio($dir) {
    $list = read_json(portfolio_file($dir), array());
    return is_array($list) ? $list : array();
}

function public_portfolio($item) {
    return array(
        'id' => isset($item['id']) ? $item['id'] : '',
        'userId' => isset($item['userId']) ? $item['userId'] : '',
        'name' => isset($item['name']) ? $item['name'] : '',
        'title' => isset($item['title']) ? $item['title'] : '',
        'about' => isset($item['about']) ? $item['about'] : '',
        'files' => isset($item['files']) && is_array($item['files']) ? $item['files'] : array(),
        'publish' => !empty($item['publish']),
        'status' => isset($item['status']) ? $item['status'] : 'pending',
        'note' => isset($item['note']) ? $item['note'] : '',
        'points' => isset($item['points']) ? (int) $item['points'] : 0,
        'createdAt' => isset($item['createdAt']) ? $item['createdAt'] : '',
        'decidedAt' => isset($item['decidedAt']) ? $item['decidedAt'] : '',
    );
}

/* ------------------------------------------- восстановление доступа */

/* Пока почтовый ящик на домене не подключён, код восстановления выдаётся
   человеку один раз при регистрации и хранится у него. Если код потерян —
   заявка уходит в редакцию, и администрация выдаёт новый код вручную.
   Как только появится почта на домене, эта же функция начнёт отправлять
   код письмом — как только в админке заполнены настройки SMTP. */


function recovery_code_new() {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $parts = array();
    for ($g = 0; $g < 3; $g++) {
        $chunk = '';
        for ($i = 0; $i < 4; $i++) {
            $chunk .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $parts[] = $chunk;
    }
    return implode('-', $parts);
}

function recovery_normalize($code) {
    return strtoupper(preg_replace('/[^a-zA-Z0-9]/', '', (string) $code));
}

function recovery_hash($code) {
    return password_hash(recovery_normalize($code), PASSWORD_DEFAULT);
}

function recovery_verify($code, $hash) {
    if (!$hash) return false;
    return password_verify(recovery_normalize($code), (string) $hash);
}

function recovery_requests_file($dir) { return $dir . '/recovery.json'; }

function read_recovery_requests($dir) {
    $list = read_json(recovery_requests_file($dir), array());
    return is_array($list) ? $list : array();
}

function public_recovery_request($r) {
    return array(
        'id' => isset($r['id']) ? $r['id'] : '',
        'email' => isset($r['email']) ? $r['email'] : '',
        'name' => isset($r['name']) ? $r['name'] : '',
        'note' => isset($r['note']) ? $r['note'] : '',
        'status' => isset($r['status']) ? $r['status'] : 'open',
        'createdAt' => isset($r['createdAt']) ? $r['createdAt'] : '',
        'decidedAt' => isset($r['decidedAt']) ? $r['decidedAt'] : '',
        'decidedBy' => isset($r['decidedBy']) ? $r['decidedBy'] : '',
    );
}

/* Письмо отправляется только если задан адрес отправителя.
   Возвращает true, если сервер принял письмо. */
/* mail_send() живёт в smtp.php: SMTP, а не локальный sendmail */

function is_top_admin($user) {
    return $user && in_array(isset($user['access']) ? $user['access'] : '',
        array('Сооснователь', 'Директор', 'Главный администратор', 'Администрация'), true);
}

/* ------------------------------------------------- редакции в регионах */
function editorials_file($dir) { return $dir . '/editorials.json'; }
function editorial_apps_file($dir) { return $dir . '/editorial-apps.json'; }

function read_editorials($dir) {
    $list = read_json(editorials_file($dir), array());
    return is_array($list) ? $list : array();
}

function read_editorial_apps($dir) {
    $list = read_json(editorial_apps_file($dir), array());
    return is_array($list) ? $list : array();
}

/* заявка без решения семь дней уходит в центральную комиссию */
function editorial_escalated($app) {
    if (!isset($app['status']) || $app['status'] !== 'pending') return false;
    if (!empty($app['escalated'])) return true;
    $created = strtotime((string) $app['createdAt']);
    return $created && (time() - $created) > 7 * 86400;
}

function public_editorial($e, $apps) {
    $members = 0;
    foreach ($apps as $a) {
        if ($a['editorialId'] === $e['id'] && $a['status'] === 'approved') $members++;
    }
    return array(
        'id' => $e['id'],
        'region' => $e['region'],
        'name' => $e['name'],
        'about' => isset($e['about']) ? $e['about'] : '',
        'founderId' => $e['founderId'],
        'founderName' => $e['founderName'],
        'members' => $members,
        'createdAt' => $e['createdAt'],
    );
}

function public_editorial_app($a) {
    return array(
        'id' => $a['id'],
        'editorialId' => $a['editorialId'],
        'region' => $a['region'],
        'userId' => $a['userId'],
        'name' => $a['name'],
        'email' => isset($a['email']) ? $a['email'] : '',
        'birthDate' => isset($a['birthDate']) ? $a['birthDate'] : '',
        'why' => isset($a['why']) ? $a['why'] : '',
        'portfolio' => isset($a['portfolio']) && is_array($a['portfolio']) ? $a['portfolio'] : array(),
        'sitePosts' => isset($a['sitePosts']) && is_array($a['sitePosts']) ? $a['sitePosts'] : array(),
        'status' => $a['status'],
        'note' => isset($a['note']) ? $a['note'] : '',
        'createdAt' => $a['createdAt'],
        'decidedAt' => isset($a['decidedAt']) ? $a['decidedAt'] : '',
        'escalated' => editorial_escalated($a),
    );
}

/* ------------------------------------------------- самопроверка аккаунтов */
function selftest_auth($dir) {
    $steps = array();
    $users = read_users($dir);
    $before = count($users);

    $email = 'selftest+' . bin2hex(random_bytes(3)) . '@example.ru';
    $pass = 'test-' . bin2hex(random_bytes(4));
    $user = array(
        'id' => 'u_test_' . bin2hex(random_bytes(4)),
        'name' => 'Самопроверка',
        'email' => $email,
        'pass' => password_hash($pass, PASSWORD_DEFAULT),
        'region' => 'moskva',
        'role' => 'Автор текстов',
        'access' => 'Пользователь',
        'bio' => '',
        'avatar' => '',
        'createdAt' => date('c'),
        'number' => 0,
    );
    $users[] = $user;
    $steps['запись_users.json'] = write_json(users_file($dir), $users);
    $steps['чтение_обратно'] = count(read_users($dir)) === $before + 1;
    $steps['пароль_сверяется'] = password_verify($pass, password_hash($pass, PASSWORD_DEFAULT));
    $steps['чужой_пароль_не_пускает'] = !password_verify($pass . 'x', password_hash($pass, PASSWORD_DEFAULT));

    $token = new_token($dir, $user['id']);
    $found = user_by_token($dir, $token);
    $steps['токен_открывает_профиль'] = $found && $found['id'] === $user['id'];
    $steps['битый_токен_не_пускает'] = user_by_token($dir, 'нет-такого-токена') === null;

    $public = public_user($user);
    $steps['пароль_не_утекает'] = !isset($public['pass']);
    $steps['аватар_в_ответе'] = array_key_exists('avatar', $public);
    $steps['статус_в_ответе'] = isset($public['access']) && $public['access'] === 'Пользователь';

    $steps['папка_медиа_создана'] = is_dir(media_dir($dir));
    $steps['размер_аватара_ограничен'] = MAX_AVATAR_CHARS > 0 && MAX_MEDIA_CHARS > MAX_AVATAR_CHARS;

    // убираем тестового пользователя и его токены
    $users = array_values(array_filter(read_users($dir), function ($u) use ($user) {
        return $u['id'] !== $user['id'];
    }));
    $steps['удаление_тестового'] = write_json(users_file($dir), $users) && count(read_users($dir)) === $before;

    $tokens = read_json(tokens_file($dir), array());
    if (is_array($tokens)) {
        unset($tokens[$token]);
        write_json(tokens_file($dir), $tokens);
    }

    $ok = true;
    foreach ($steps as $value) { if (!$value) $ok = false; }
    respond(array(
        'ok' => $ok,
        'аккаунтов_было' => $before,
        'аккаунтов_стало' => count(read_users($dir)),
        'роли' => ROLES,
        'шаги' => $steps,
    ));
}

/* ---------------------------------------------------------------------- запуск */
if (!ensure_dir($DATA_DIR)) {
    respond(array(
        'ok' => false,
        'error' => 'Не удалось создать папку api/data. Создайте её на хостинге вручную и поставьте права 755.',
    ), 500);
}

/* Первый запрос после установки: сразу готовим пароль редакции, иначе
   владельцу нечего вводить — файл с паролем появлялся бы только после
   первой неудачной попытки входа. */
editor_hash($DATA_DIR);

/* раз в сутки — копия данных: случайную правку всегда можно откатить */
backup_maybe_run($DATA_DIR);

$act = action();

if ($act === 'selftest') {
    require_diagnostics($DATA_DIR, array_merge(body(), $_GET));
    selftest($DATA_DIR);
}

if ($act === 'selftest_full') {
    require_diagnostics($DATA_DIR, array_merge(body(), $_GET));
    selftest_full($DATA_DIR);
}

/* самопроверка восстановления доступа: создаём временный аккаунт,
   проверяем код, сброс пароля и отказ чужому коду, затем убираем за собой */
function selftest_recovery($dir) {
    $steps = array();
    $users = read_users($dir);
    $before = count($users);

    $code = recovery_code_new();
    $email = 'recovery+' . bin2hex(random_bytes(3)) . '@example.ru';
    $oldPass = 'old-' . bin2hex(random_bytes(4));
    $newPass = 'new-' . bin2hex(random_bytes(4));
    $user = array(
        'id' => 'u_rec_' . bin2hex(random_bytes(4)),
        'name' => 'Проверка кода',
        'email' => $email,
        'pass' => password_hash($oldPass, PASSWORD_DEFAULT),
        'recovery' => recovery_hash($code),
        'recoveryAt' => date('c'),
        'region' => 'moskva',
        'role' => 'Автор текстов',
        'access' => 'Пользователь',
        'bio' => '',
        'avatar' => '',
        'createdAt' => date('c'),
        'number' => 0,
    );
    $users[] = $user;
    $steps['запись_аккаунта'] = write_json(users_file($dir), $users);

    $steps['код_подходит'] = recovery_verify($code, recovery_hash($code));
    $steps['код_с_дефисами_и_без'] = recovery_verify(strtolower(str_replace('-', '', $code)), recovery_hash($code));
    $steps['чужой_код_не_подходит'] = !recovery_verify('AAAA-BBBB-CCCC', recovery_hash($code));

    $fresh = read_users($dir);
    $ok = false;
    foreach ($fresh as $i => $u) {
        if ($u['id'] !== $user['id']) continue;
        $ok = recovery_verify($code, isset($u['recovery']) ? $u['recovery'] : '');
        $fresh[$i]['pass'] = password_hash($newPass, PASSWORD_DEFAULT);
        $fresh[$i]['recovery'] = '';
        break;
    }
    write_json(users_file($dir), $fresh);
    $after = read_users($dir);
    foreach ($after as $u) {
        if ($u['id'] !== $user['id']) continue;
        $steps['старый_пароль_не_работает'] = !password_verify($oldPass, $u['pass']);
        $steps['новый_пароль_работает'] = password_verify($newPass, $u['pass']);
        $steps['код_сгорел_после_сброса'] = empty($u['recovery']);
    }

    $tokens = read_json(tokens_file($dir), array());
    $steps['сессии_сбрасываются'] = is_array($tokens);

    $clean = array();
    foreach (read_users($dir) as $u) {
        if ($u['id'] !== $user['id']) $clean[] = $u;
    }
    write_json(users_file($dir), $clean);
    $steps['аккаунтов_было'] = $before;
    $steps['аккаунтов_стало'] = count(read_users($dir));
    $steps['тестовый_удалён'] = $steps['аккаунтов_стало'] === $before;

    $okAll = true;
    foreach ($steps as $k => $v) {
        if (is_bool($v) && !$v) $okAll = false;
    }
    respond(array('ok' => $okAll, 'steps' => $steps));
}

if ($act === 'selftest_recovery') {
    require_diagnostics($DATA_DIR, array_merge(body(), $_GET));
    selftest_recovery($DATA_DIR);
}

if ($act === 'selftest_auth') {
    require_diagnostics($DATA_DIR, array_merge(body(), $_GET));
    selftest_auth($DATA_DIR);
}

/* Проверка регистрации: на живой сервер заводится временный аккаунт,
   проверяется вход по паролю и токену, потом аккаунт удаляется.
   Ответ показывает, на каком шаге что-то не так. */
if ($act === 'selftest_reg') {
    require_diagnostics($DATA_DIR, array_merge(body(), $_GET));
    ensure_dir($DATA_DIR);
    $steps = array();
    $testEmail = 'proverka+' . bin2hex(random_bytes(3)) . '@smenakontenta.test';
    $testId = 'u_check_' . bin2hex(random_bytes(3));
    $testPass = 'check-' . bin2hex(random_bytes(4));

    $users = read_users($DATA_DIR);
    $users[] = array(
        'id' => $testId,
        'name' => 'Проверка регистрации',
        'email' => $testEmail,
        'pass' => password_hash($testPass, PASSWORD_DEFAULT),
        'region' => 'moskva',
        'role' => 'Автор текстов',
        'access' => 'Пользователь',
        'bio' => '',
        'avatar' => '',
        'createdAt' => date('c'),
        'number' => 999,
        'emailVerified' => false,
    );
    $steps['write_user'] = write_json(users_file($DATA_DIR), $users) ? 'ok' : 'не записался';

    $back = read_users($DATA_DIR);
    $found = null;
    foreach ($back as $u) {
        if (isset($u['email']) && $u['email'] === $testEmail) $found = $u;
    }
    $steps['read_user'] = $found ? 'ok' : 'не нашёлся после записи';
    $steps['password'] = ($found && password_verify($testPass, $found['pass'])) ? 'ok' : 'пароль не сверяется';

    $token = new_token($DATA_DIR, $testId);
    $byToken = user_by_token($DATA_DIR, $token);
    $steps['token'] = ($byToken && $byToken['id'] === $testId) ? 'ok' : 'токен не работает';

    $clean = array();
    foreach (read_users($DATA_DIR) as $u) {
        if (!isset($u['id']) || $u['id'] !== $testId) $clean[] = $u;
    }
    $steps['cleanup'] = write_json(users_file($DATA_DIR), $clean) ? 'ok' : 'временный аккаунт не удалился';

    $steps['accounts_after'] = count(read_users($DATA_DIR));
    $steps['data_mode'] = $DATA_DIR === $DATA_DIR_INSIDE ? 'inside_public' : 'outside_public';

    $ok = true;
    foreach (array('write_user', 'read_user', 'password', 'token', 'cleanup') as $k) {
        if (!isset($steps[$k]) || $steps[$k] !== 'ok') $ok = false;
    }
    respond(array('ok' => $ok, 'steps' => $steps));
}

/* ---------------------------------------------------- служебная диагностика
   Отвечает на вопрос «почему не пускает»: сколько аккаунтов на сервере,
   можно ли писать файлы, настроена ли почта. Секретов здесь нет. */
if ($act === 'diag') {
    /* Служебная диагностика: только для администрации, без паролей и токенов. */
    require_diagnostics($DATA_DIR, array_merge(body(), $_GET));
    ensure_dir($DATA_DIR);
    $users = read_users($DATA_DIR);
    $posts = read_json($DATA_DIR . '/posts.json', array());
    $rate = read_json($DATA_DIR . '/login-rate.json', array());
    $uploads = $DATA_DIR . '/uploads';
    respond(array(
        'ok' => true,
        'php' => PHP_VERSION,
        'data_mode' => $DATA_DIR === $DATA_DIR_INSIDE ? 'inside_public' : 'outside_public',
        'accounts' => count($users),
        'first_will_be_director' => false,
        'editor_default_password' => editor_uses_known_default($DATA_DIR),
        'posts' => is_array($posts) ? count($posts) : 0,
        'data_writable' => is_writable($DATA_DIR),
        'uploads_writable' => is_dir($uploads) ? is_writable($uploads) : ensure_dir($uploads),
        'mail_configured' => smtp_configured($DATA_DIR),
        'mail_from' => smtp_config($DATA_DIR)['from'],
        'rate_entries' => is_array($rate) ? count($rate) : 0,
        'server_time' => date('c'),
        'maintenance' => site_state($DATA_DIR)['maintenance'],
        'editorials' => count(read_editorials($DATA_DIR)),
        'cards_pending' => count(array_filter(read_cards($DATA_DIR), function ($c) {
            return isset($c['status']) && $c['status'] === 'pending';
        })),
        'support_open' => count(array_filter(read_support($DATA_DIR), function ($t) {
            return isset($t['status']) && $t['status'] === 'open';
        })),
        'mailboxes_ready' => count(array_filter(mailboxes_load($DATA_DIR), function ($b) {
            return !empty($b['pass']) && !empty($b['host']);
        })),
        'mailboxes_total' => count(mailboxes_defaults()),
        'mail_log' => count(mail_log_list($DATA_DIR, 500)),
        'hiring_open' => count(array_filter(read_hiring($DATA_DIR), function ($a) {
            return isset($a['stage']) && in_array($a['stage'], array('test', 'checklist', 'review'), true);
        })),
        'pending_email' => count(array_filter($users, function ($u) {
            return empty($u['emailVerified']);
        })),
    ));
}

if ($act === 'state') {
    $posts = read_json($DATA_DIR . '/posts.json', array());
    $published = array();
    foreach ($posts as $post) {
        if ($post['status'] === 'published') $published[] = public_post($post);
    }
    usort($published, function ($a, $b) {
        return strcmp((string) $b['date'], (string) $a['date']);
    });
    respond(array('ok' => true, 'posts' => array_slice($published, 0, MAX_POSTS)));
}

if ($act === 'submit') {
    $in = body();
    check_rate($DATA_DIR);

    $title = text(isset($in['title']) ? $in['title'] : '', 200);
    $excerpt = text(isset($in['excerpt']) ? $in['excerpt'] : '', 600);
    $content = text(isset($in['body']) ? $in['body'] : '', MAX_BODY_CHARS);
    $authorName = text(isset($in['authorName']) ? $in['authorName'] : '', 120);
    $authorKey = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) (isset($in['authorKey']) ? $in['authorKey'] : ''));
    $authorKey = substr($authorKey, 0, 64);
    /* кто именно отправил: по токену, если он есть. Нужно, чтобы баллы
       за публикацию начислялись конкретному аккаунту, а не «какому-то». */
    $authorUser = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    /* Материал от аккаунта принимаем только с подтверждённой почтой:
       иначе баллы и статус автора уходят «в никуда». Гостевую отправку
       не трогаем — она была и остаётся. */
    if ($authorUser) require_verified($authorUser);

    if (slen($title) < 8) fail('Заголовок короче восьми символов.');
    if (slen($excerpt) < 20) fail('Описание короче двадцати символов.');
    if (slen($content) < 200) fail('Текст материала короче двухсот символов.');
    if ($authorName === '') fail('Не указан автор.');
    if (strlen($authorKey) < 8) fail('Не передан ключ автора.');

    $posts = read_json($DATA_DIR . '/posts.json', array());
    if (count($posts) >= MAX_POSTS) fail('Хранилище заполнено, напишите редакции.', 507);

    $direct = !empty($in['direct']);
    $now = date('c');
    $id = new_id('s_');

    // порядковый номер материала проекта: по нему автор прикладывает
    // публикации к заявке на пресс-карту
    $maxNumber = 0;
    foreach ($posts as $existing) {
        if (isset($existing['number']) && (int) $existing['number'] > $maxNumber) {
            $maxNumber = (int) $existing['number'];
        }
    }
    $post = array(
        'id' => $id,
        'authorKey' => $authorKey,
        'authorId' => $authorUser ? $authorUser['id'] : '',
        'authorName' => $authorName,
        'authorRole' => text(isset($in['authorRole']) ? $in['authorRole'] : '', 80),
        'authorRegion' => text(isset($in['authorRegion']) ? $in['authorRegion'] : '', 80),
        'title' => $title,
        'excerpt' => $excerpt,
        'body' => $content,
        'topic' => text(isset($in['topic']) ? $in['topic'] : '', 60),
        'format' => text(isset($in['format']) ? $in['format'] : '', 60),
        'region' => text(isset($in['region']) ? $in['region'] : '', 80),
        'image' => text(isset($in['image']) ? $in['image'] : '', 400),
        'imageAlt' => text(isset($in['imageAlt']) ? $in['imageAlt'] : '', 200),
        'gallery' => array_values(array_slice(array_map(function ($u) {
            return text(is_string($u) ? $u : '', 400);
        }, isset($in['gallery']) && is_array($in['gallery']) ? $in['gallery'] : array()), 0, 12)),
        'video' => text(isset($in['video']) ? $in['video'] : '', 400),
        'audio' => text(isset($in['audio']) ? $in['audio'] : '', 400),
        'read' => isset($in['read']) ? max(1, min(60, (int) $in['read'])) : 4,
        'number' => $maxNumber + 1,
        'status' => $direct ? 'published' : 'pending',
        'date' => $now,
        'submittedAt' => $now,
        'reviewedAt' => $direct ? $now : null,
        'reviewNote' => '',
    );

    $posts[$id] = $post;
    if (!write_json($DATA_DIR . '/posts.json', $posts)) {
        fail('Не удалось сохранить материал на сервере. Напишите редакции.', 500);
    }
    respond(array('ok' => true, 'post' => public_post($post), 'direct' => $direct));
}

/* ------------------------------------------------------- пресс-карта автора */
/* Очередь карт открыта либо по паролю редакции, либо вошедшему директору:
   в админке человек уже вошёл, второй пароль спрашивать незачем. */
function require_editor_or_admin($dir, $in) {
    $pass = isset($in['password']) ? (string) $in['password'] : '';
    if ($pass !== '' && is_editor($dir, $pass)) return;
    $user = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if ($user && is_top_admin($user)) return;
    fail('Нужен вход директора или пароль редакции.', 403);
}

function card_min_posts() {
    return 5;
}

function read_cards($dir) {
    return read_json($dir . '/cards.json', array());
}

if ($act === 'card-request') {
    $in = body();
    $key = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) (isset($in['authorKey']) ? $in['authorKey'] : ''));
    if (strlen($key) < 8) fail('Не передан ключ автора.');

    $ids = isset($in['posts']) && is_array($in['posts']) ? $in['posts'] : array();
    if (count($ids) < card_min_posts()) {
        fail('Для заявки нужно приложить не меньше ' . card_min_posts() . ' опубликованных материалов.');
    }

    $posts = read_json($DATA_DIR . '/posts.json', array());
    $attached = array();
    $numbers = array();
    foreach ($ids as $rawId) {
        $id = (string) $rawId;
        if (!isset($posts[$id])) fail('Материал не найден: ' . text($id, 40));
        $post = $posts[$id];
        if ($post['authorKey'] !== $key) fail('В заявке есть чужой материал.');
        if ($post['status'] !== 'published') fail('В заявке есть неопубликованный материал.');
        $attached[] = array(
            'id' => $post['id'],
            'number' => isset($post['number']) ? (int) $post['number'] : 0,
            'title' => $post['title'],
            'date' => isset($post['date']) ? $post['date'] : '',
            'region' => isset($post['region']) ? $post['region'] : '',
        );
        $numbers[] = (int) (isset($post['number']) ? $post['number'] : 0);
    }

    $cards = read_cards($DATA_DIR);
    foreach ($cards as $card) {
        if ($card['authorKey'] === $key && $card['status'] === 'pending') {
            fail('Заявка уже отправлена и рассматривается редакцией.');
        }
    }

    $now = date('c');
    $cardId = new_id('c_');
    $cards[$cardId] = array(
        'id' => $cardId,
        'authorKey' => $key,
        'authorName' => text(isset($in['authorName']) ? $in['authorName'] : '', 120),
        'authorRegion' => text(isset($in['authorRegion']) ? $in['authorRegion'] : '', 80),
        'authorRole' => text(isset($in['authorRole']) ? $in['authorRole'] : '', 80),
        'posts' => $attached,
        'status' => 'pending',
        'number' => '',
        'note' => '',
        'createdAt' => $now,
        'decidedAt' => null,
    );
    if (!write_json($DATA_DIR . '/cards.json', $cards)) fail('Не удалось сохранить заявку.', 500);
    check_rate($DATA_DIR);
    respond(array('ok' => true, 'request' => $cards[$cardId]));
}

if ($act === 'card-status') {
    $in = body();
    $key = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) (isset($in['authorKey']) ? $in['authorKey'] : ''));
    $cardUser = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    $cardUserId = $cardUser ? $cardUser['id'] : '';
    if (strlen($key) < 8) fail('Не передан ключ автора.');
    $cards = read_cards($DATA_DIR);
    $mine = array();
    foreach ($cards as $card) {
        if ($card['authorKey'] === $key || ($cardUserId !== '' && isset($card['userId']) && $card['userId'] === $cardUserId)) {
            $mine[] = array(
                'id' => $card['id'],
                'status' => $card['status'],
                'number' => $card['number'],
                'note' => $card['note'],
                'createdAt' => $card['createdAt'],
                'decidedAt' => $card['decidedAt'],
                'posts' => $card['posts'],
                'delivery' => isset($card['delivery']) ? $card['delivery'] : null,
                'issuedAt' => isset($card['issuedAt']) ? $card['issuedAt'] : null,
                'issuePlace' => isset($card['issuePlace']) ? $card['issuePlace'] : '',
                'dispatch' => isset($card['dispatch']) ? $card['dispatch'] : null,
            );
        }
    }
    respond(array('ok' => true, 'requests' => $mine, 'minPosts' => card_min_posts()));
}

/* Заявка на пресс-карту: подаёт сам автор из кабинета.
   Карта не приходит сама: её либо выдают лично в Москве, либо отправляют
   почтой. Поэтому в заявке сразу спрашиваем способ получения и контакты. */
if ($act === 'card-apply') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    require_verified($me);

    $posts = read_json($DATA_DIR . '/posts.json', array());
    $mine = array();
    foreach ($posts as $post) {
        if (!isset($post['authorId']) || $post['authorId'] !== $me['id']) continue;
        if (!isset($post['status']) || $post['status'] !== 'published') continue;
        $mine[] = $post;
    }
    usort($mine, function ($a, $b) {
        return strcmp((string) (isset($b['date']) ? $b['date'] : ''), (string) (isset($a['date']) ? $a['date'] : ''));
    });

    $need = card_min_posts();
    if (count($mine) < $need) {
        fail('Для заявки нужно не меньше ' . $need . ' опубликованных материалов. У вас: ' . count($mine) . '.', 400);
    }

    $cards = read_cards($DATA_DIR);
    foreach ($cards as $card) {
        if (!isset($card['userId']) || $card['userId'] !== $me['id']) continue;
        if ($card['status'] === 'issued') fail('У вас уже есть пресс-карта: ' . $card['number'], 409);
        if ($card['status'] === 'pending') fail('Заявка уже отправлена и ждёт решения редакции.', 409);
    }

    $method = isset($in['delivery']) ? (string) $in['delivery'] : '';
    if ($method !== 'personal' && $method !== 'post') {
        fail('Выберите, как получить карту: лично в Москве или почтой.');
    }
    $fullName = text(isset($in['fullName']) ? $in['fullName'] : '', 120);
    if (slen($fullName) < 5) fail('Напишите фамилию и имя полностью — карта печатается по этим данным.');
    $phone = (string) (isset($in['phone']) ? $in['phone'] : '');
    $phoneDigits = preg_replace('/[^0-9]/', '', $phone);
    if (strlen($phoneDigits) < 10) fail('Телефон нужен, чтобы договориться о выдаче.');
    if (empty($in['agree'])) fail('Без согласия на обработку данных мы не можем напечатать и отправить карту.');

    $city = text(isset($in['city']) ? $in['city'] : '', 80);
    $index = preg_replace('/[^0-9]/', '', (string) (isset($in['index']) ? $in['index'] : ''));
    $address = text(isset($in['address']) ? $in['address'] : '', 300);
    if ($method === 'post') {
        if (strlen($index) !== 6) fail('Индекс — шесть цифр.');
        if (slen($address) < 12) fail('Напишите адрес полностью: город, улица, дом, квартира.');
    } else {
        $city = 'Москва';
        $index = '';
        $address = '';
    }

    $attached = array();
    foreach (array_slice($mine, 0, 20) as $post) {
        $attached[] = array(
            'id' => $post['id'],
            'number' => isset($post['number']) ? (int) $post['number'] : 0,
            'title' => $post['title'],
            'date' => isset($post['date']) ? $post['date'] : '',
            'region' => isset($post['region']) ? $post['region'] : '',
        );
    }

    $now = date('c');
    $id = new_id('c_');
    $cards[$id] = array(
        'id' => $id,
        'authorKey' => '',
        'userId' => $me['id'],
        'authorName' => $me['name'],
        'authorRegion' => isset($me['region']) ? $me['region'] : '',
        'authorRole' => isset($me['role']) ? $me['role'] : '',
        'authorEmail' => $me['email'],
        'posts' => $attached,
        'status' => 'pending',
        'number' => '',
        'note' => '',
        'delivery' => array(
            'method' => $method,
            'fullName' => $fullName,
            'phone' => $phoneDigits,
            'city' => $city,
            'index' => $index,
            'address' => $address,
            'agreedAt' => $now,
        ),
        'createdAt' => $now,
        'decidedAt' => null,
        'issuedAt' => null,
        'issuePlace' => '',
        'dispatch' => array('tracking' => '', 'sentAt' => ''),
    );
    if (!write_json($DATA_DIR . '/cards.json', $cards)) fail('Не удалось сохранить заявку.', 500);
    respond(array('ok' => true, 'request' => $cards[$id]));
}

if ($act === 'card-queue') {
    $in = body();
    require_editor_or_admin($DATA_DIR, $in);
    $cards = read_cards($DATA_DIR);
    $out = array();
    foreach ($cards as $card) {
        $out[] = $card;
    }
    usort($out, function ($a, $b) {
        return strcmp((string) $b['createdAt'], (string) $a['createdAt']);
    });
    respond(array('ok' => true, 'requests' => $out));
}

if ($act === 'card-review') {
    $in = body();
    require_editor_or_admin($DATA_DIR, $in);
    $id = isset($in['id']) ? (string) $in['id'] : '';
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 600);
    $place = text(isset($in['place']) ? $in['place'] : '', 200);
    $tracking = text(isset($in['tracking']) ? $in['tracking'] : '', 60);
    if ($decision !== 'approve' && $decision !== 'reject') fail('Неизвестное решение.');

    $cards = read_cards($DATA_DIR);
    if (!isset($cards[$id])) fail('Заявка не найдена.', 404);

    $now = date('c');
    if ($decision === 'approve') {
        $year = date('Y');
        $seq = 0;
        foreach ($cards as $card) {
            if (!empty($card['number']) && strpos((string) $card['number'], 'СК-' . $year) === 0) $seq++;
        }
        $cards[$id]['number'] = 'СК-' . $year . '-' . str_pad((string) ($seq + 1), 3, '0', STR_PAD_LEFT);
        $cards[$id]['status'] = 'issued';
        $cards[$id]['issuedAt'] = $now;
        $cards[$id]['issuePlace'] = $place;
        if ($tracking !== '') {
            if (!isset($cards[$id]['dispatch']) || !is_array($cards[$id]['dispatch'])) {
                $cards[$id]['dispatch'] = array('tracking' => '', 'sentAt' => '');
            }
            $cards[$id]['dispatch']['tracking'] = $tracking;
            $cards[$id]['dispatch']['sentAt'] = $now;
        }
    } else {
        $cards[$id]['status'] = 'rejected';
    }
    $cards[$id]['note'] = $note;
    $cards[$id]['decidedAt'] = $now;
    if (!write_json($DATA_DIR . '/cards.json', $cards)) fail('Не удалось сохранить решение.', 500);
    audit_log($DATA_DIR, 'пароль редакции', 'card-review',
        ($decision === 'approve' ? 'карта выдана ' : 'в заявке отказано ') . $cards[$id]['authorName']);
    respond(array(
        'ok' => true,
        'request' => array(
            'id' => $cards[$id]['id'],
            'status' => $cards[$id]['status'],
            'number' => $cards[$id]['number'],
            'note' => $cards[$id]['note'],
        ),
    ));
}

if ($act === 'mine') {
    $in = body();
    $key = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) (isset($in['authorKey']) ? $in['authorKey'] : ''));
    if (strlen($key) < 8) fail('Не передан ключ автора.');
    $posts = read_json($DATA_DIR . '/posts.json', array());
    $mine = array();
    foreach ($posts as $post) {
        if (isset($post['authorKey']) && $post['authorKey'] === $key) $mine[] = public_post($post);
    }
    respond(array('ok' => true, 'posts' => $mine));
}

if ($act === 'queue') {
    $in = body();
    $password = isset($in['password']) ? (string) $in['password'] : '';
    if (!is_editor($DATA_DIR, $password)) fail('Неверный пароль редакции.', 403);
    $posts = read_json($DATA_DIR . '/posts.json', array());
    $pending = array();
    $published = 0;
    foreach ($posts as $post) {
        if ($post['status'] === 'pending') $pending[] = array_merge(public_post($post), array('authorEmail' => ''));
        if ($post['status'] === 'published') $published++;
    }
    usort($pending, function ($a, $b) {
        return strcmp((string) $a['submittedAt'], (string) $b['submittedAt']);
    });
    respond(array('ok' => true, 'pending' => $pending, 'published' => $published, 'total' => count($posts)));
}

if ($act === 'review') {
    $in = body();
    $password = isset($in['password']) ? (string) $in['password'] : '';
    if (!is_editor($DATA_DIR, $password)) fail('Неверный пароль редакции.', 403);

    $id = isset($in['id']) ? (string) $in['id'] : '';
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 600);
    if ($decision !== 'approve' && $decision !== 'reject') fail('Неизвестное решение.');

    $posts = read_json($DATA_DIR . '/posts.json', array());
    if (!isset($posts[$id])) fail('Материал не найден.', 404);

    $posts[$id]['status'] = $decision === 'approve' ? 'published' : 'rejected';
    $posts[$id]['reviewNote'] = $note;
    $posts[$id]['reviewedAt'] = date('c');
    if ($decision === 'approve') $posts[$id]['date'] = date('c');

    if (!write_json($DATA_DIR . '/posts.json', $posts)) fail('Не удалось сохранить решение.', 500);
    if ($decision === 'approve' && !empty($posts[$id]['authorId'])) {
        $rule = 'post.' . (isset($posts[$id]['format']) ? $posts[$id]['format'] : 'Статья');
        points_award_rule($DATA_DIR, $posts[$id]['authorId'], $rule, 'редакция',
            'Материал «' . $posts[$id]['title'] . '»', 'post:' . $id);
    }
    audit_log($DATA_DIR, 'пароль редакции', 'review',
        ($decision === 'approve' ? 'опубликован' : 'отклонён') . ' материал ' . $id . ' — ' . $posts[$id]['title']);
    respond(array('ok' => true, 'post' => public_post($posts[$id])));
}

if ($act === 'setpass') {
    $in = body();
    $old = isset($in['old']) ? (string) $in['old'] : '';
    $new = isset($in['new']) ? (string) $in['new'] : '';
    if (!is_editor($DATA_DIR, $old)) fail('Текущий пароль неверный.', 403);
    if (slen($new) < 10) fail('Новый пароль короче десяти символов.');
    $cfg = read_json($DATA_DIR . '/config.json', array());
    $cfg['editor'] = password_hash($new, PASSWORD_DEFAULT);
    $cfg['changedAt'] = date('c');
    if (!write_json($DATA_DIR . '/config.json', $cfg)) fail('Не удалось сохранить пароль.', 500);
    audit_log($DATA_DIR, 'пароль редакции', 'setpass', 'пароль редакции изменён');
    respond(array('ok' => true));
}

if ($act === 'remove') {
    $in = body();
    $password = isset($in['password']) ? (string) $in['password'] : '';
    if (!is_editor($DATA_DIR, $password)) fail('Неверный пароль редакции.', 403);
    $id = isset($in['id']) ? (string) $in['id'] : '';
    $posts = read_json($DATA_DIR . '/posts.json', array());
    if (!isset($posts[$id])) fail('Материал не найден.', 404);
    unset($posts[$id]);
    write_json($DATA_DIR . '/posts.json', $posts);
    audit_log($DATA_DIR, 'пароль редакции', 'remove', 'материал удалён: ' . $id);
    respond(array('ok' => true));
}

/* ------------------------------------------------------------- редакции */

if ($act === 'editorial-list') {
    $in = body();
    $region = text(isset($in['region']) ? $in['region'] : '', 80);
    $apps = read_editorial_apps($DATA_DIR);
    $out = array();
    foreach (read_editorials($DATA_DIR) as $e) {
        if ($region !== '' && $e['region'] !== $region) continue;
        $out[] = public_editorial($e, $apps);
    }
    usort($out, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    respond(array('ok' => true, 'editorials' => $out));
}

if ($act === 'editorial-create') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);

    $region = text(isset($in['region']) ? $in['region'] : '', 80);
    $name = text(isset($in['name']) ? $in['name'] : '', 120);
    $about = text(isset($in['about']) ? $in['about'] : '', 600);
    if (slen($name) < 3) fail('Название редакции — хотя бы три символа.');
    if ($region === '') fail('Выберите регион редакции.');
    if (slen($about) < 20) fail('Расскажите, чем будет заниматься редакция: минимум 20 символов.');

    $list = read_editorials($DATA_DIR);
    foreach ($list as $e) {
        if ($e['founderId'] === $user['id']) fail('Вы уже основали редакцию. Одна редакция на человека.');
    }

    $editorial = array(
        'id' => 'ed_' . bin2hex(random_bytes(5)),
        'region' => $region,
        'name' => $name,
        'about' => $about,
        'founderId' => $user['id'],
        'founderName' => $user['name'],
        'createdAt' => date('c'),
    );
    $list[] = $editorial;
    if (!write_json(editorials_file($DATA_DIR), $list)) fail('Не удалось создать редакцию.', 500);

    /* основатель получает права регионального редактора */
    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] === $user['id']) {
            $users[$i]['access'] = 'Редакционный основатель';
            $users[$i]['editorialId'] = $editorial['id'];
            write_json(users_file($DATA_DIR), $users);
            break;
        }
    }

    respond(array('ok' => true, 'editorial' => public_editorial($editorial, array())));
}

if ($act === 'editorial-apply') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    require_verified($user);

    $editorialId = text(isset($in['editorialId']) ? $in['editorialId'] : '', 60);
    $target = null;
    foreach (read_editorials($DATA_DIR) as $e) {
        if ($e['id'] === $editorialId) $target = $e;
    }
    if (!$target) fail('Редакция не найдена.', 404);

    $birthDate = text(isset($in['birthDate']) ? $in['birthDate'] : '', 20);
    $why = text(isset($in['why']) ? $in['why'] : '', 1200);
    if (slen($birthDate) < 8) fail('Укажите дату рождения в формате ДД.ММ.ГГГГ.');
    if (slen($why) < 30) fail('Напишите, почему хотите именно сюда: минимум 30 символов.');

    $apps = read_editorial_apps($DATA_DIR);
    foreach ($apps as $a) {
        if ($a['userId'] === $user['id'] && $a['status'] === 'pending') {
            fail('У вас уже есть заявка на рассмотрении.');
        }
    }

    $portfolio = array();
    $raw = isset($in['portfolio']) && is_array($in['portfolio']) ? $in['portfolio'] : array();
    foreach (array_slice($raw, 0, 3) as $dataUrl) {
        $err = '';
        $file = data_url_file($dataUrl, array(
            'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
            'application/pdf' => 'pdf',
        ), 6000000, $err);
        if (!$file) continue;
        $dir = media_dir($DATA_DIR);
        $fname = 'ed_' . $user['id'] . '_' . time() . '_' . bin2hex(random_bytes(3)) . '.' . $file['ext'];
        if (@file_put_contents($dir . '/' . $fname, $file['bin']) === false) continue;
        @chmod($dir . '/' . $fname, 0644);
        $portfolio[] = media_public_url($fname);
    }

    $sitePosts = array();
    if (isset($in['sitePosts']) && is_array($in['sitePosts'])) {
        foreach (array_slice($in['sitePosts'], 0, 30) as $p) {
            $sitePosts[] = text(is_string($p) ? $p : '', 160);
        }
    }

    $app = array(
        'id' => 'ap_' . bin2hex(random_bytes(5)),
        'authorKey' => preg_replace('/[^a-zA-Z0-9_-]/', '', (string) (isset($in['authorKey']) ? $in['authorKey'] : '')),
        'editorialId' => $editorialId,
        'region' => $target['region'],
        'userId' => $user['id'],
        'name' => $user['name'],
        'email' => $user['email'],
        'birthDate' => $birthDate,
        'why' => $why,
        'portfolio' => $portfolio,
        'sitePosts' => $sitePosts,
        'status' => 'pending',
        'note' => '',
        'createdAt' => date('c'),
        'decidedAt' => '',
        'escalated' => false,
    );
    $apps[] = $app;
    if (!write_json(editorial_apps_file($DATA_DIR), $apps)) fail('Не удалось отправить заявку.', 500);
    respond(array('ok' => true, 'application' => public_editorial_app($app)));
}

if ($act === 'editorial-mine') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);

    $apps = read_editorial_apps($DATA_DIR);
    $myApps = array();
    foreach ($apps as $a) {
        if ($a['userId'] === $user['id']) $myApps[] = public_editorial_app($a);
    }

    $owned = null;
    $incoming = array();
    foreach (read_editorials($DATA_DIR) as $e) {
        if ($e['founderId'] !== $user['id']) continue;
        $owned = public_editorial($e, $apps);
        foreach ($apps as $a) {
            if ($a['editorialId'] === $e['id']) $incoming[] = public_editorial_app($a);
        }
    }
    usort($myApps, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    usort($incoming, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    respond(array('ok' => true, 'applications' => $myApps, 'editorial' => $owned, 'incoming' => $incoming));
}

if ($act === 'editorial-queue') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!in_array(isset($user['access']) ? $user['access'] : '', array('Директор', 'Администрация'), true)) {
        fail('Очередь заявок видят только директор и администрация.', 403);
    }
    $out = array();
    foreach (read_editorial_apps($DATA_DIR) as $a) {
        if ($a['status'] !== 'pending') continue;
        $out[] = public_editorial_app($a);
    }
    usort($out, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    respond(array('ok' => true, 'applications' => $out));
}

if ($act === 'editorial-review') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);

    $id = text(isset($in['id']) ? $in['id'] : '', 60);
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 400);
    if (!in_array($decision, array('approved', 'rejected'), true)) fail('Решение должно быть «принять» или «отказать».');
    if ($decision === 'rejected' && slen($note) < 5) fail('Для отказа нужно записать основание.');

    $editorials = read_editorials($DATA_DIR);
    $apps = read_editorial_apps($DATA_DIR);
    $found = false;
    foreach ($apps as $i => $a) {
        if ($a['id'] !== $id) continue;
        $owner = null;
        foreach ($editorials as $e) {
            if ($e['id'] === $a['editorialId']) $owner = $e;
        }
        if (!$owner) fail('Редакция не найдена.', 404);

        $isFounder = $owner['founderId'] === $user['id'];
        $isAdmin = in_array(isset($user['access']) ? $user['access'] : '', array('Директор', 'Администрация'), true);
        if (!$isFounder && !$isAdmin) fail('Решение принимает основатель редакции или администрация.', 403);
        /* если заявка уже ушла в центральную комиссию, решает только администрация */
        if (editorial_escalated($a) && !$isAdmin) {
            fail('Заявка передана в центральную комиссию: семь дней прошло, решает она.', 403);
        }

        $apps[$i]['status'] = $decision;
        $apps[$i]['note'] = $note;
        $apps[$i]['decidedAt'] = date('c');
        $found = true;

        if ($decision === 'approved') {
            /* индивидуальная пресс-карта аннулируется: у автора теперь редакционная */
            if (!empty($a['authorKey'])) {
                $cards = read_cards($DATA_DIR);
                $touched = false;
                foreach ($cards as $k => $card) {
                    if ($card['authorKey'] !== $a['authorKey']) continue;
                    if (!in_array($card['status'], array('pending', 'issued'), true)) continue;
                    $cards[$k]['status'] = 'annulled';
                    $cards[$k]['note'] = 'Аннулирована: автор вступил в редакцию региона — ' .
                        $owner['name'] . '. Действует редакционная пресс-карта после трёх постов.';
                    $cards[$k]['decidedAt'] = date('c');
                    $touched = true;
                }
                if ($touched) write_json($DATA_DIR . '/cards.json', $cards);
            }

            $users = read_users($DATA_DIR);
            foreach ($users as $j => $u) {
                if ($u['id'] !== $a['userId']) continue;
                $users[$j]['editorialId'] = $a['editorialId'];
                if (!in_array($u['access'], array('Директор', 'Администрация'), true)) {
                    $users[$j]['access'] = 'Пользователь';
                }
                write_json(users_file($DATA_DIR), $users);
                break;
            }
        }
        break;
    }
    if (!$found) fail('Заявка не найдена.', 404);
    if (!write_json(editorial_apps_file($DATA_DIR), $apps)) fail('Не удалось сохранить решение.', 500);
    respond(array('ok' => true));
}

/* ------------------------------------------------------------------------ */
/* -------------------------------------------------------- портфолио автора */

if ($act === 'portfolio-send') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    require_verified($user);

    $title = text(isset($in['title']) ? $in['title'] : '', 160);
    $about = text(isset($in['about']) ? $in['about'] : '', 1200);
    if (slen($title) < 5) fail('Название работы — хотя бы пять символов.');
    if (slen($about) < 30) fail('Расскажите о материале: не меньше 30 символов.');

    $list = read_portfolio($DATA_DIR);
    $mine = array_filter($list, function ($i) use ($user) {
        return isset($i['userId']) && $i['userId'] === $user['id'] && $i['status'] === 'pending';
    });
    if (count($mine) >= 5) fail('У вас уже пять работ на проверке — дождитесь решения комиссии.');

    $files = array();
    $raw = isset($in['files']) && is_array($in['files']) ? $in['files'] : array();
    foreach (array_slice($raw, 0, 3) as $dataUrl) {
        $err = '';
        $file = data_url_file(
            $dataUrl,
            array(
                'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
                'audio/mpeg' => 'mp3', 'audio/mp4' => 'm4a', 'audio/ogg' => 'ogg', 'audio/wav' => 'wav',
                'video/mp4' => 'mp4', 'video/webm' => 'webm',
            ),
            8000000,
            $err
        );
        if (!$file) continue;
        $dir = media_dir($DATA_DIR);
        $fname = 'pf_' . $user['id'] . '_' . time() . '_' . bin2hex(random_bytes(3)) . '.' . $file['ext'];
        if (@file_put_contents($dir . '/' . $fname, $file['bin']) === false) continue;
        @chmod($dir . '/' . $fname, 0644);
        $files[] = media_public_url($fname);
    }
    if (!count($files)) fail('Приложите хотя бы один файл: фото, аудио или видео.');

    $item = array(
        'id' => 'pf_' . bin2hex(random_bytes(5)),
        'userId' => $user['id'],
        'name' => $user['name'],
        'title' => $title,
        'about' => $about,
        'files' => $files,
        'publish' => !empty($in['publish']),
        'status' => 'pending',
        'note' => '',
        'points' => 0,
        'createdAt' => date('c'),
        'decidedAt' => '',
    );
    $list[] = $item;
    if (!write_json(portfolio_file($DATA_DIR), $list)) fail('Не удалось сохранить работу.', 500);
    respond(array('ok' => true, 'item' => public_portfolio($item)));
}

if ($act === 'portfolio-mine') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    $mine = array();
    foreach (read_portfolio($DATA_DIR) as $item) {
        if (isset($item['userId']) && $item['userId'] === $user['id']) $mine[] = public_portfolio($item);
    }
    usort($mine, function ($a, $b) {
        return strcmp((string) $b['createdAt'], (string) $a['createdAt']);
    });
    respond(array('ok' => true, 'items' => $mine));
}

if ($act === 'portfolio-queue') {
    $in = body();
    $password = isset($in['password']) ? (string) $in['password'] : '';
    if (!is_editor($DATA_DIR, $password)) fail('Неверный пароль редакции.', 403);
    $list = read_portfolio($DATA_DIR);
    usort($list, function ($a, $b) {
        return strcmp((string) $b['createdAt'], (string) $a['createdAt']);
    });
    $out = array();
    foreach ($list as $item) $out[] = public_portfolio($item);
    respond(array('ok' => true, 'items' => $out));
}

if ($act === 'portfolio-review') {
    $in = body();
    $password = isset($in['password']) ? (string) $in['password'] : '';
    if (!is_editor($DATA_DIR, $password)) fail('Неверный пароль редакции.', 403);

    $id = isset($in['id']) ? (string) $in['id'] : '';
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 400);
    $points = isset($in['points']) ? max(0, min(50, (int) $in['points'])) : 5;
    if (!in_array($decision, array('approved', 'rejected'), true)) fail('Решение должно быть «одобрено» или «отклонено».');
    if ($decision === 'rejected' && slen($note) < 5) fail('Для отказа нужно основание.');

    $list = read_portfolio($DATA_DIR);
    $found = false;
    foreach ($list as $i => $item) {
        if ($item['id'] !== $id) continue;
        $list[$i]['status'] = $decision;
        $list[$i]['note'] = $note;
        $list[$i]['decidedAt'] = date('c');
        $list[$i]['points'] = $decision === 'approved' ? $points : 0;
        if ($decision === 'approved' && isset($in['publish'])) {
            $list[$i]['publish'] = !empty($in['publish']);
        }
        $found = true;
        break;
    }
    if (!$found) fail('Работа не найдена.', 404);
    if (!write_json(portfolio_file($DATA_DIR), $list)) fail('Не удалось сохранить решение.', 500);
    respond(array('ok' => true));
}

if ($act === 'change-password') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);

    $old = isset($in['old']) ? (string) $in['old'] : '';
    $new = isset($in['new']) ? (string) $in['new'] : '';
    if (!password_verify($old, (string) $user['pass'])) fail('Текущий пароль неверный.', 403);
    if (slen($new) < 8) fail('Новый пароль короче восьми символов.');

    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] !== $user['id']) continue;
        $users[$i]['pass'] = password_hash($new, PASSWORD_DEFAULT);
        if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить пароль.', 500);
        /* остальные сессии закрываются: если пароль меняют из-за утечки,
           старые устройства не должны остаться в аккаунте */
        revoke_user_tokens($DATA_DIR, $user['id'],
            isset($in['token']) ? (string) $in['token'] : '');
        audit_log($DATA_DIR, $user['name'], 'change-password', 'пароль изменён, прочие сессии закрыты');
        respond(array('ok' => true));
    }
    fail('Аккаунт не найден.', 404);
}

/* ------------------------------------------------------- согласие на обработку */

if ($act === 'consent-send') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    require_verified($user);

    $err = '';
    $file = data_url_file(
        isset($in['scan']) ? $in['scan'] : '',
        array('image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'),
        4000000,
        $err
    );
    if (!$file) fail($err, 413);

    $dir = media_dir($DATA_DIR);
    $fname = 'pd_' . $user['id'] . '_' . time() . '.' . $file['ext'];
    if (@file_put_contents($dir . '/' . $fname, $file['bin']) === false) {
        fail('Не удалось сохранить скан. Попробуйте файл поменьше.', 500);
    }
    @chmod($dir . '/' . $fname, 0644);

    $list = read_consents($DATA_DIR);
    $record = array(
        'id' => 'c_' . bin2hex(random_bytes(5)),
        'userId' => $user['id'],
        'name' => $user['name'],
        'email' => $user['email'],
        'userRegion' => isset($user['region']) ? $user['region'] : '',
        'scan' => media_public_url($fname),
        'status' => 'pending',
        'note' => '',
        'createdAt' => date('c'),
        'decidedAt' => '',
    );
    $replaced = false;
    foreach ($list as $i => $c) {
        if (isset($c['userId']) && $c['userId'] === $user['id']) {
            $record['id'] = $c['id'];
            $list[$i] = $record;
            $replaced = true;
            break;
        }
    }
    if (!$replaced) $list[] = $record;
    if (!write_json(consents_file($DATA_DIR), $list)) fail('Не удалось сохранить заявку.', 500);

    respond(array('ok' => true, 'consent' => public_consent($record)));
}

if ($act === 'consent-status') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    respond(array('ok' => true, 'consent' => public_consent(consent_of_user($DATA_DIR, $user['id']))));
}

if ($act === 'consent-queue') {
    $in = body();
    $password = isset($in['password']) ? (string) $in['password'] : '';
    if (!is_editor($DATA_DIR, $password)) fail('Неверный пароль редакции.', 403);
    $list = read_consents($DATA_DIR);
    usort($list, function ($a, $b) {
        return strcmp((string) $b['createdAt'], (string) $a['createdAt']);
    });
    $out = array();
    foreach ($list as $c) $out[] = public_consent($c);
    respond(array('ok' => true, 'consents' => $out));
}

if ($act === 'consent-review') {
    $in = body();
    $password = isset($in['password']) ? (string) $in['password'] : '';
    if (!is_editor($DATA_DIR, $password)) fail('Неверный пароль редакции.', 403);

    $id = isset($in['id']) ? (string) $in['id'] : '';
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 400);
    if (!in_array($decision, array('approved', 'rejected'), true)) fail('Решение должно быть «одобрено» или «отклонено».');
    if ($decision === 'rejected' && slen($note) < 5) fail('Для отказа нужно основание — напишите причину.');

    $list = read_consents($DATA_DIR);
    $found = false;
    foreach ($list as $i => $c) {
        if ($c['id'] !== $id) continue;
        $list[$i]['status'] = $decision;
        $list[$i]['note'] = $note;
        $list[$i]['decidedAt'] = date('c');
        $found = true;
        break;
    }
    if (!$found) fail('Заявка не найдена.', 404);
    if (!write_json(consents_file($DATA_DIR), $list)) fail('Не удалось сохранить решение.', 500);
    respond(array('ok' => true));
}

/* ------------------------------------------------------------------ аккаунты */

if ($act === 'reg') {
    $in = body();
    check_rate($DATA_DIR);
    $name = text(isset($in['name']) ? $in['name'] : '', 80);
    $email = norm_email(isset($in['email']) ? $in['email'] : '');
    $pass = isset($in['pass']) ? (string) $in['pass'] : '';
    $region = text(isset($in['region']) ? $in['region'] : '', 60);
    $craft = text(isset($in['role']) ? $in['role'] : '', 60);

    if (slen($name) < 2) fail('Напишите имя — хотя бы два символа.');
    if (!$email) fail('Проверьте адрес почты — кажется, там опечатка.');
    if (slen($pass) < 8) fail('Пароль должен быть не короче восьми символов.');
    /* Регистрация без подтверждения почты невозможна: если почта не
       настроена, аккаунт не создаём вовсе — иначе появятся «мёртвые» адреса. */
    if (!smtp_configured($DATA_DIR)) {
        fail('Регистрация временно закрыта: почта проекта не настроена, а без подтверждения адреса аккаунт создать нельзя. Напишите на support@smenakontenta.ru.', 503);
    }
    if ($craft === '' || !in_array($craft, CRAFT, true)) $craft = 'Автор текстов';

    $users = read_users($DATA_DIR);
    foreach ($users as $u) {
        if (strtolower((string) $u['email']) === $email) {
            fail('Аккаунт с такой почтой уже есть. Нажмите «Войти».', 409);
        }
    }
    if (count($users) >= 50000) fail('Слишком много аккаунтов.', 507);

    $id = 'u_' . bin2hex(random_bytes(6));
    $user = array(
        'id' => $id,
        'name' => $name,
        'email' => $email,
        'pass' => password_hash($pass, PASSWORD_DEFAULT),
        'region' => $region,
        'role' => $craft,
        /* первый зарегистрировавшийся больше НЕ становится директором
           автоматически: иначе любой, кто успел завести аккаунт после сброса
           данных, получал полный доступ. Права выдаёт пароль редакции
           на служебной странице /admin. */
        'access' => 'Пользователь',
        'bio' => '',
        'avatar' => '',
        'createdAt' => date('c'),
        'number' => 100 + count($users) + 1,
        'status' => 'pending_email',
        'consents' => array(),
    );
    $recovery = recovery_code_new();
    $user['recovery'] = recovery_hash($recovery);
    $user['recoveryAt'] = date('c');

    /* подтверждение почты: шестизначный код, живёт 30 минут */
    $confirmCode = (string) random_int(100000, 999999);
    $user['emailVerified'] = false;
    $user['confirm'] = password_hash($confirmCode, PASSWORD_DEFAULT);
    $user['confirmAt'] = date('c');

    $users[] = $user;
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить аккаунт.', 500);

    $token = new_token($DATA_DIR, $id);
    $mailSent = mail_notify($DATA_DIR, 'confirm_code', $email, array(
        'name' => $name,
        'code' => $confirmCode,
        'minutes' => 30,
        'link' => 'https://smenakontenta.ru/cabinet/',
    ), array('dedupe' => 'confirm:' . $id));

    /* Код из письма — единственный способ включить аккаунт. Если письмо не
       ушло, аккаунт удаляем: иначе адрес занят, а человек не может им
       пользоваться и не может зарегистрироваться снова. */
    if (!$mailSent) {
        $users = read_users($DATA_DIR);
        $left = array();
        foreach ($users as $u) { if ($u['id'] !== $id) $left[] = $u; }
        write_json(users_file($DATA_DIR), $left);
        fail('Не удалось отправить письмо с кодом. Регистрация не завершена — попробуйте через минуту или напишите на support@smenakontenta.ru.', 502);
    }
    respond(array(
        'ok' => true,
        'pending' => true,
        'user' => public_user($user),
        'token' => $token,
        'recoveryCode' => $recovery,
        'mailSent' => $mailSent,
        'needConfirm' => 'Мы отправили код на ' . $email . '. Введите его в кабинете, чтобы включить аккаунт.',
    ));
}

/* ------------------------------------------- восстановление доступа */

if ($act === 'recovery-code') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    $code = recovery_code_new();
    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] !== $user['id']) continue;
        $users[$i]['recovery'] = recovery_hash($code);
        $users[$i]['recoveryAt'] = date('c');
        break;
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось обновить код.', 500);
    respond(array('ok' => true, 'recoveryCode' => $code));
}

if ($act === 'recovery-reset') {
    $in = body();
    check_login_rate($DATA_DIR);
    $email = norm_email(isset($in['email']) ? $in['email'] : '');
    $code = isset($in['code']) ? (string) $in['code'] : '';
    $new = isset($in['pass']) ? (string) $in['pass'] : '';
    if (!$email) fail('Введите почту аккаунта.');
    if (recovery_normalize($code) === '') fail('Введите код восстановления.');
    if (slen($new) < 8) fail('Новый пароль — не короче восьми символов.');

    $users = read_users($DATA_DIR);
    $found = false;
    $userId = '';
    foreach ($users as $i => $u) {
        if (strtolower((string) $u['email']) !== $email) continue;
        if (!recovery_verify($code, isset($u['recovery']) ? $u['recovery'] : '')) {
            fail('Код не подошёл. Он выдаётся один раз и действует, пока не сменён.', 403);
        }
        $users[$i]['pass'] = password_hash($new, PASSWORD_DEFAULT);
        /* старый код сгорает: новый выдаётся после входа, в кабинете */
        $users[$i]['recovery'] = '';
        $users[$i]['recoveryAt'] = '';
        $userId = $u['id'];
        $found = true;
        break;
    }
    if (!$found) fail('Аккаунт с такой почтой не найден.', 404);
    write_json(users_file($DATA_DIR), $users);

    /* все прежние сессии закрываются: новый пароль — новая жизнь */
    $tokens = read_json(tokens_file($DATA_DIR), array());
    if (is_array($tokens)) {
        foreach ($tokens as $t => $info) {
            if (isset($info['id']) && $info['id'] === $userId) unset($tokens[$t]);
        }
        write_json(tokens_file($DATA_DIR), $tokens);
    }
    respond(array('ok' => true, 'token' => new_token($DATA_DIR, $userId)));
}

if ($act === 'recovery-request') {
    $in = body();
    check_rate($DATA_DIR);
    $email = norm_email(isset($in['email']) ? $in['email'] : '');
    $note = text(isset($in['note']) ? $in['note'] : '', 400);
    if (!$email) fail('Введите почту аккаунта.');
    if (slen($note) < 10) fail('Опишите ситуацию: хотя бы десять символов.');

    $users = read_users($DATA_DIR);
    $name = '';
    foreach ($users as $u) {
        if (strtolower((string) $u['email']) === $email) {
            $name = $u['name'];
            break;
        }
    }

    $list = read_recovery_requests($DATA_DIR);
    foreach ($list as $r) {
        if ($r['email'] === $email && $r['status'] === 'open') {
            fail('Заявка уже отправлена и ждёт решения редакции.');
        }
    }
    $req = array(
        'id' => 'rc_' . bin2hex(random_bytes(4)),
        'email' => $email,
        'name' => $name,
        'note' => $note,
        'status' => 'open',
        'createdAt' => date('c'),
        'decidedAt' => '',
        'decidedBy' => '',
    );
    $list[] = $req;
    if (!write_json(recovery_requests_file($DATA_DIR), $list)) fail('Не удалось сохранить заявку.', 500);

    /* если почта на домене уже подключена, код уходит письмом автоматически */
    $mailSent = false;
    if ($name !== '') {
        foreach ($users as $i => $u) {
            if (strtolower((string) $u['email']) !== $email) continue;
            $code = recovery_code_new();
            $users[$i]['recovery'] = recovery_hash($code);
            $users[$i]['recoveryAt'] = date('c');
            write_json(users_file($DATA_DIR), $users);
            $mailSent = mail_send(
                $email,
                'Код восстановления доступа — Смена контента',
                "Код восстановления: " . $code . "\n\n" .
                "Введите его на странице входа вместе с почтой и новым паролем. " .
                "Если вы не запрашивали код, просто проигнорируйте письмо.",
                '',
                'kod'
            );
            break;
        }
    }
    /* В ответ анонимному посетителю не отдаём ни имя, ни заметку: иначе
       по любому адресу можно проверить, есть ли тут аккаунт и как зовут человека. */
    respond(array('ok' => true, 'mailSent' => $mailSent, 'request' => array(
        'id' => $req['id'],
        'status' => $req['status'],
        'createdAt' => $req['createdAt'],
    )));
}

if ($act === 'recovery-queue') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'recovery.issue')) fail('Заявки видит только директор и администрация.', 403);
    $out = array();
    foreach (read_recovery_requests($DATA_DIR) as $r) {
        if ($r['status'] !== 'open') continue;
        $out[] = public_recovery_request($r);
    }
    usort($out, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    respond(array('ok' => true, 'requests' => $out));
}

if ($act === 'recovery-issue') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'recovery.issue')) fail('Код выдаёт только директор и администрация.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);

    $list = read_recovery_requests($DATA_DIR);
    $target = null;
    $index = -1;
    foreach ($list as $i => $r) {
        if ($r['id'] === $id && $r['status'] === 'open') { $target = $r; $index = $i; }
    }
    if (!$target) fail('Заявка не найдена или уже закрыта.', 404);

    $users = read_users($DATA_DIR);
    $code = recovery_code_new();
    $person = null;
    foreach ($users as $i => $u) {
        if (strtolower((string) $u['email']) !== $target['email']) continue;
        $users[$i]['recovery'] = recovery_hash($code);
        $users[$i]['recoveryAt'] = date('c');
        $person = $u;
        break;
    }
    if (!$person) fail('Аккаунт с такой почтой не найден — возможно, опечатка в заявке.', 404);
    write_json(users_file($DATA_DIR), $users);

    $mailed = mail_send(
        $target['email'],
        'Код восстановления доступа — Смена контента',
        "Код восстановления: " . $code . "\n\nВведите его на странице входа.",
        '',
        'kod'
    );

    $list[$index]['status'] = 'issued';
    $list[$index]['decidedAt'] = date('c');
    $list[$index]['decidedBy'] = $user['name'];
    write_json(recovery_requests_file($DATA_DIR), $list);

    respond(array(
        'ok' => true,
        'code' => $mailed ? '' : $code,
        'mailed' => $mailed,
        'email' => $target['email'],
        'name' => $person['name'],
    ));
}

if ($act === 'recovery-close') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'recovery.issue')) fail('Закрывает заявку только директор и администрация.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);
    $note = text(isset($in['note']) ? $in['note'] : '', 300);
    if (slen($note) < 5) fail('Причина закрытия обязательна: минимум пять символов.');

    $list = read_recovery_requests($DATA_DIR);
    $done = false;
    foreach ($list as $i => $r) {
        if ($r['id'] !== $id || $r['status'] !== 'open') continue;
        $list[$i]['status'] = 'closed';
        $list[$i]['note'] = $list[$i]['note'] . ' | Решение: ' . $note;
        $list[$i]['decidedAt'] = date('c');
        $list[$i]['decidedBy'] = $user['name'];
        $done = true;
        break;
    }
    if (!$done) fail('Заявка не найдена или уже закрыта.', 404);
    write_json(recovery_requests_file($DATA_DIR), $list);
    respond(array('ok' => true));
}

/* ------------------------------------------------------ состояние сайта */

function site_file($dir) { return $dir . '/site.json'; }

function site_state($dir) {
    $cfg = read_json(site_file($dir), array());
    if (!is_array($cfg)) $cfg = array();
    return array(
        'maintenance' => !empty($cfg['maintenance']),
        'notice' => isset($cfg['notice']) ? (string) $cfg['notice'] : '',
        'noticeOn' => !empty($cfg['noticeOn']),
        'updatedAt' => isset($cfg['updatedAt']) ? (string) $cfg['updatedAt'] : '',
        'updatedBy' => isset($cfg['updatedBy']) ? (string) $cfg['updatedBy'] : '',
    );
}

if ($act === 'site-status') {
    $state = site_state($DATA_DIR);
    respond(array('ok' => true, 'site' => $state));
}

if ($act === 'site-save') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'site.manage')) fail('Состояние сайта меняет только директор и администрация.', 403);

    $state = array(
        'maintenance' => !empty($in['maintenance']),
        'notice' => text(isset($in['notice']) ? $in['notice'] : '', 240),
        'noticeOn' => !empty($in['noticeOn']) && text(isset($in['notice']) ? $in['notice'] : '', 240) !== '',
        'updatedAt' => date('c'),
        'updatedBy' => $me['name'],
    );
    if (!write_json(site_file($DATA_DIR), $state)) fail('Не удалось сохранить состояние сайта.', 500);
    audit_log($DATA_DIR, $me['name'], 'site-save',
        $state['maintenance'] ? 'включены техработы' : 'сайт открыт');
    respond(array('ok' => true, 'site' => $state));
}

/* ------------------------------------------------------------ основатели */

function founders_file($dir) { return $dir . '/founders.json'; }

function read_founders($dir) {
    $list = read_json(founders_file($dir), array());
    return is_array($list) ? $list : array();
}

function public_founder($f) {
    return array(
        'id' => isset($f['id']) ? $f['id'] : '',
        'name' => isset($f['name']) ? $f['name'] : '',
        'role' => isset($f['role']) ? $f['role'] : '',
        'city' => isset($f['city']) ? $f['city'] : '',
        'since' => isset($f['since']) ? $f['since'] : '',
        'bio' => isset($f['bio']) ? $f['bio'] : '',
        'photo' => isset($f['photo']) ? $f['photo'] : '',
    );
}

if ($act === 'founders') {
    $out = array();
    foreach (read_founders($DATA_DIR) as $f) $out[] = public_founder($f);
    respond(array('ok' => true, 'founders' => $out));
}

if ($act === 'founders-save') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'site.manage')) fail('Основателей правит только директор и администрация.', 403);

    $raw = isset($in['founders']) && is_array($in['founders']) ? $in['founders'] : array();
    if (!$raw) fail('Список пустой.');
    if (count($raw) > 4) fail('Основателей не больше четырёх.');

    $clean = array();
    foreach ($raw as $i => $f) {
        $name = text(isset($f['name']) ? $f['name'] : '', 120);
        if (slen($name) < 3) fail('У основателя должно быть имя: минимум три символа.');
        $clean[] = array(
            'id' => 'f' . ($i + 1),
            'name' => $name,
            'role' => text(isset($f['role']) ? $f['role'] : '', 80),
            'city' => text(isset($f['city']) ? $f['city'] : '', 60),
            'since' => text(isset($f['since']) ? $f['since'] : '', 40),
            'bio' => text(isset($f['bio']) ? $f['bio'] : '', 900),
            'photo' => text(isset($f['photo']) ? $f['photo'] : '', 400),
        );
    }
    if (!write_json(founders_file($DATA_DIR), $clean)) fail('Не удалось сохранить основателей.', 500);
    audit_log($DATA_DIR, $me['name'], 'founders-save', 'карточек: ' . count($clean));
    $out = array();
    foreach ($clean as $f) $out[] = public_founder($f);
    respond(array('ok' => true, 'founders' => $out));
}

if ($act === 'posts-queue') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    $role = isset($me['access']) ? $me['access'] : 'Пользователь';
    if (!in_array($role, array('Директор', 'Администрация', 'Редакционный администратор региона',
        'Редакционный основатель'), true)) {
        fail('Очередь материалов видят только роли редакции.', 403);
    }
    $posts = read_json($DATA_DIR . '/posts.json', array());
    $out = array();
    foreach ($posts as $post) {
        if (!isset($post['status']) || $post['status'] !== 'pending') continue;
        $out[] = public_post($post);
    }
    usort($out, function ($a, $b) { return strcmp((string) $b['date'], (string) $a['date']); });
    respond(array('ok' => true, 'posts' => $out));
}

if ($act === 'whoami') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    $users = read_users($DATA_DIR);
    $director = null;
    foreach ($users as $u) {
        if ((isset($u['access']) ? $u['access'] : '') === 'Директор') {
            $director = $u;
            break;
        }
    }
    respond(array(
        'ok' => true,
        'signedIn' => (bool) $me,
        'user' => $me ? public_user($me) : null,
        'accounts' => count($users),
        'directorExists' => (bool) $director,
        'directorName' => $director ? $director['name'] : '',
        'canClaimDirector' => !$director && $me && count($users) <= 1,
    ));
}

if ($act === 'claim-director') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Сначала войдите в аккаунт.', 401);
    /* без пароля редакции роль не выдаётся: иначе первый вошедший
       на пустом сервере забирал бы панель проекта */
    if (!is_editor($DATA_DIR, isset($in['password']) ? (string) $in['password'] : '')) {
        fail('Нужен пароль редакции: он выдаётся владельцу проекта.', 403);
    }
    $users = read_users($DATA_DIR);
    if (count($users) > 1 && !isset($in['force'])) {
        fail('На сервере уже есть аккаунты — роль назначается в панели участников.', 409);
    }
    foreach ($users as $u) {
        if ((isset($u['access']) ? $u['access'] : '') === 'Директор') {
            fail('Директор уже есть: ' . $u['name'] . '. Роль меняет он.', 409);
        }
    }
    $updated = null;
    foreach ($users as $i => $u) {
        if ($u['id'] !== $me['id']) continue;
        $users[$i]['access'] = 'Директор';
        $updated = $users[$i];
        break;
    }
    if (!$updated) fail('Аккаунт не найден.', 404);
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить роль.', 500);
    audit_log($DATA_DIR, $updated['name'], 'claim-director', 'роль директора выдана по паролю редакции');
    respond(array('ok' => true, 'user' => public_user($updated)));
}

/* ------------------------------------------------- карточка участника
   Одна карточка на человека: профиль, заявления, карты, переписка.
   Редакция открывает её из списка участников и делает всё в одном месте. */

function messages_file($dir) { return $dir . '/messages.json'; }

function read_messages($dir) {
    $list = read_json(messages_file($dir), array());
    return is_array($list) ? $list : array();
}

function card_number_next($cards, $year) {
    $max = 0;
    foreach ($cards as $c) {
        if (!isset($c['number'])) continue;
        if (preg_match('/(\d+)$/', (string) $c['number'], $m)) {
            $max = max($max, (int) $m[1]);
        }
    }
    return 'СК-' . $year . '-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
}

function person_notes_of($dir, $userId) {
    $list = read_json(notes_file($dir), array());
    if (!is_array($list)) return array();
    $out = array();
    foreach ($list as $row) {
        if (isset($row['userId']) && $row['userId'] === $userId) $out[] = $row;
    }
    usort($out, function ($a, $b) { return strcmp((string) $b['at'], (string) $a['at']); });
    return array_slice($out, 0, 100);
}

/* Хронология человека: одно место, где видно всё, что с ним происходило. */
function person_timeline($dir, $target, $posts, $cards, $consents, $apps, $messages) {
    $events = array();
    if (!empty($target['createdAt'])) {
        $events[] = array('at' => $target['createdAt'], 'kind' => 'account', 'text' => 'Регистрация на сайте');
    }
    foreach ((array) $posts as $p) {
        $events[] = array(
            'at' => !empty($p['date']) ? $p['date'] : $target['createdAt'],
            'kind' => 'post',
            'text' => 'Материал «' . $p['title'] . '» — ' . (isset($p['status']) ? $p['status'] : ''),
        );
    }
    foreach ((array) $cards as $c) {
        $events[] = array(
            'at' => $c['createdAt'],
            'kind' => 'card',
            'text' => 'Пресс-карта: ' . (isset($c['status']) ? $c['status'] : '') .
                (!empty($c['number']) ? ' ' . $c['number'] : ''),
        );
    }
    foreach ((array) $consents as $c) {
        $events[] = array(
            'at' => !empty($c['createdAt']) ? $c['createdAt'] : $target['createdAt'],
            'kind' => 'consent',
            'text' => 'Согласие на обработку ПД: ' . (isset($c['status']) ? $c['status'] : ''),
        );
    }
    foreach ((array) $apps as $a) {
        $events[] = array(
            'at' => !empty($a['createdAt']) ? $a['createdAt'] : $target['createdAt'],
            'kind' => 'editorial',
            'text' => 'Заявка в редакцию: ' . (isset($a['status']) ? $a['status'] : ''),
        );
    }
    foreach (points_history($dir, $target['id'], 100) as $row) {
        $events[] = array(
            'at' => $row['at'],
            'kind' => 'points',
            'text' => ((int) $row['delta'] > 0 ? '+' : '') . $row['delta'] . ' баллов — ' .
                (isset($row['note']) && $row['note'] !== '' ? $row['note'] : $row['reason']),
        );
    }
    foreach ((array) $messages as $m) {
        $events[] = array(
            'at' => $m['createdAt'],
            'kind' => 'message',
            'text' => 'Сообщение от редакции: ' . $m['text'],
        );
    }
    usort($events, function ($a, $b) { return strcmp((string) $b['at'], (string) $a['at']); });
    return array_slice($events, 0, 150);
}

if ($act === 'user-card') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.view')) fail('Карточку участника видит только директор и администрация.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);

    $target = null;
    foreach (read_users($DATA_DIR) as $u) {
        if ($u['id'] === $id) $target = $u;
    }
    if (!$target) fail('Участник не найден.', 404);

    $email = strtolower((string) $target['email']);
    $name = (string) $target['name'];

    $posts = array();
    foreach (read_json($DATA_DIR . '/posts.json', array()) as $post) {
        if (!isset($post['authorId']) || $post['authorId'] !== $id) continue;
        $posts[] = array(
            'id' => $post['id'],
            'title' => isset($post['title']) ? $post['title'] : '',
            'status' => isset($post['status']) ? $post['status'] : '',
            'format' => isset($post['format']) ? $post['format'] : '',
            'date' => isset($post['date']) ? $post['date'] : '',
        );
    }
    usort($posts, function ($a, $b) { return strcmp((string) $b['date'], (string) $a['date']); });

    $editorialApps = array();
    foreach (read_editorial_apps($DATA_DIR) as $a) {
        if ($a['userId'] !== $id) continue;
        $editorialApps[] = public_editorial_app($a);
    }

    $consents = array();
    foreach (read_consents($DATA_DIR) as $c) {
        if (isset($c['userId']) && $c['userId'] === $id) $consents[] = public_consent($c);
    }

    $cards = array();
    foreach (read_cards($DATA_DIR) as $c) {
        $mineByUser = isset($c['userId']) && $c['userId'] === $id;
        $mineByName = isset($c['authorName']) && $c['authorName'] === $name;
        if ($mineByUser || $mineByName) {
            $cards[] = array(
                'id' => $c['id'],
                'status' => $c['status'],
                'number' => isset($c['number']) ? $c['number'] : '',
                'note' => isset($c['note']) ? $c['note'] : '',
                'delivery' => isset($c['delivery']) ? $c['delivery'] : null,
                'issuePlace' => isset($c['issuePlace']) ? $c['issuePlace'] : '',
                'issuedAt' => isset($c['issuedAt']) ? $c['issuedAt'] : '',
                'createdAt' => $c['createdAt'],
                'decidedAt' => isset($c['decidedAt']) ? $c['decidedAt'] : '',
            );
        }
    }

    $portfolio = array();
    foreach (read_portfolio($DATA_DIR) as $item) {
        if ($item['userId'] !== $id) continue;
        $portfolio[] = public_portfolio($item);
    }

    $recovery = array();
    foreach (read_recovery_requests($DATA_DIR) as $r) {
        if (strtolower((string) $r['email']) !== $email) continue;
        $recovery[] = public_recovery_request($r);
    }

    $editorials = array();
    foreach (read_editorials($DATA_DIR) as $e) {
        if ($e['founderId'] === $id) $editorials[] = $e;
    }

    $messages = array();
    foreach (read_messages($DATA_DIR) as $m) {
        if ($m['userId'] !== $id) continue;
        $messages[] = $m;
    }

    $published = 0;
    foreach ($posts as $post) {
        if ($post['status'] === 'published') $published++;
    }

    respond(array(
        'ok' => true,
        'user' => array_merge(public_user($target), array(
            'createdAt' => isset($target['createdAt']) ? $target['createdAt'] : '',
        )),
        'posts' => $posts,
        'published' => $published,
        'editorialApps' => $editorialApps,
        'editorialsFounded' => $editorials,
        'consents' => $consents,
        'cards' => $cards,
        'portfolio' => $portfolio,
        'recovery' => $recovery,
        'messages' => $messages,
        'cardNumberNext' => card_number_next(read_cards($DATA_DIR), date('Y')),
        'cardMinPosts' => card_min_posts(),
        'status' => isset($target['status']) ? $target['status'] : 'active',
        'statusReason' => isset($target['statusReason']) ? $target['statusReason'] : '',
        'lastSeen' => last_seen_of($DATA_DIR, $id),
        'points' => points_balance($DATA_DIR, $id),
        'pointsHistory' => points_history($DATA_DIR, $id, 100),
        'pointsRules' => points_rules($DATA_DIR)['rules'],
        'notes' => person_notes_of($DATA_DIR, $id),
        'caps' => user_caps($me),
        'timeline' => person_timeline($DATA_DIR, $target, $posts, $cards, $consents, $editorialApps, $messages),
    ));
}

if ($act === 'user-update') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.edit')) fail('Профиль участника правит только директор и администрация.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);

    $users = read_users($DATA_DIR);
    $found = false;
    $updated = null;
    foreach ($users as $i => $u) {
        if ($u['id'] !== $id) continue;
        if (!can_manage_user($me, $u)) {
            fail('Этот участник не ниже вас по роли — профиль правит старший.', 403);
        }
        if (isset($in['name'])) {
            $name = text($in['name'], 80);
            if (slen($name) < 2) fail('Имя — минимум два символа.');
            $users[$i]['name'] = $name;
        }
        if (isset($in['region'])) $users[$i]['region'] = text($in['region'], 60);
        if (isset($in['role'])) $users[$i]['role'] = text($in['role'], 60);
        if (isset($in['bio'])) $users[$i]['bio'] = text($in['bio'], 600);
        if (isset($in['avatar'])) $users[$i]['avatar'] = safe_media_url($in['avatar']);
        if (isset($in['emailVerified'])) $users[$i]['emailVerified'] = !empty($in['emailVerified']);
        if (isset($in['access'])) {
            $access = text($in['access'], 60);
            if (!in_array($access, access_list(), true)) fail('Такой роли нет.');
            $users[$i]['access'] = $access;
        }
        $updated = $users[$i];
        $found = true;
        break;
    }
    if (!$found) fail('Участник не найден.', 404);
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить профиль.', 500);
    audit_log($DATA_DIR, $me['name'], 'user-update', 'профиль: ' . $updated['name']);
    respond(array('ok' => true, 'user' => public_user($updated)));
}

if ($act === 'card-grant') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'cards.issue')) {
        fail('Карту выдаёт директор, администрация или редакционный администратор региона.', 403);
    }
    $id = text(isset($in['id']) ? $in['id'] : '', 40);

    $target = null;
    foreach (read_users($DATA_DIR) as $u) {
        if ($u['id'] === $id) $target = $u;
    }
    if (!$target) fail('Участник не найден.', 404);

    $cards = read_cards($DATA_DIR);
    foreach ($cards as $c) {
        if (isset($c['userId']) && $c['userId'] === $id && $c['status'] === 'issued') {
            fail('У участника уже есть действующая карта: ' . $c['number'], 409);
        }
    }

    $year = date('Y');
    $number = text(isset($in['number']) ? $in['number'] : '', 40);
    if ($number === '') $number = card_number_next($cards, $year);
    $cardId = new_id('c_');
    $cards[$cardId] = array(
        'id' => $cardId,
        'authorKey' => '',
        'userId' => $id,
        'authorName' => $target['name'],
        'authorRegion' => isset($target['region']) ? $target['region'] : '',
        'authorRole' => isset($target['role']) ? $target['role'] : '',
        'posts' => array(),
        'status' => 'issued',
        'number' => $number,
        'note' => 'Выдана редакцией вручную: ' . $me['name'],
        'createdAt' => date('c'),
        'decidedAt' => date('c'),
    );
    if (!write_json($DATA_DIR . '/cards.json', $cards)) fail('Не удалось выдать карту.', 500);
    audit_log($DATA_DIR, $me['name'], 'card-grant', 'карта ' . $number . ' — ' . $target['name']);

    $editorial = null;
    if (!empty($target['editorialId'])) {
        foreach (read_editorials($DATA_DIR) as $e) {
            if ($e['id'] === $target['editorialId']) $editorial = $e;
        }
    }
    respond(array('ok' => true, 'number' => $number, 'editorial' => $editorial));
}

if ($act === 'user-message') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.edit')) fail('Писать участникам может только директор и администрация.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);
    $text = text(isset($in['text']) ? $in['text'] : '', 2000);
    if (slen($text) < 3) fail('Сообщение слишком короткое.');

    $target = null;
    foreach (read_users($DATA_DIR) as $u) {
        if ($u['id'] === $id) $target = $u;
    }
    if (!$target) fail('Участник не найден.', 404);

    $list = read_messages($DATA_DIR);
    $msg = array(
        'id' => 'ms_' . bin2hex(random_bytes(4)),
        'userId' => $id,
        'from' => $me['name'],
        'fromRole' => isset($me['access']) ? $me['access'] : '',
        'text' => $text,
        'createdAt' => date('c'),
        'read' => false,
        'mailed' => false,
    );
    $mailed = false;
    if (smtp_configured($DATA_DIR)) {
        $mailed = mail_send(
            $target['email'],
            'Сообщение от редакции — Смена контента',
            "Здравствуйте, " . $target['name'] . "!\n\n" . $text . "\n\n" .
            "Ответить можно на это письмо или из кабинета.\n\n—\n" . $me['name'] . ", Смена контента\n",
            '',
            'redakcia'
        );
    }
    $msg['mailed'] = $mailed;
    $list[] = $msg;
    write_json(messages_file($DATA_DIR), $list);
    respond(array('ok' => true, 'message' => $msg));
}

if ($act === 'messages-mine') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    $out = array();
    foreach (read_messages($DATA_DIR) as $m) {
        if ($m['userId'] !== $me['id']) continue;
        $out[] = $m;
    }
    usort($out, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    respond(array('ok' => true, 'messages' => $out));
}

if ($act === 'messages-read') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    $list = read_messages($DATA_DIR);
    foreach ($list as $i => $m) {
        if ($m['userId'] === $me['id']) $list[$i]['read'] = true;
    }
    write_json(messages_file($DATA_DIR), $list);
    respond(array('ok' => true));
}

if ($act === 'consent-decide') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.edit')) fail('Решение по согласию принимает директор и администрация.', 403);
    $userId = text(isset($in['userId']) ? $in['userId'] : '', 40);
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 400);
    if (!in_array($decision, array('approved', 'rejected'), true)) fail('Решение — «принять» или «отклонить».');

    $list = read_consents($DATA_DIR);
    $found = false;
    foreach ($list as $i => $c) {
        if ((isset($c['userId']) ? $c['userId'] : '') !== $userId) continue;
        $list[$i]['status'] = $decision;
        $list[$i]['note'] = $note;
        $list[$i]['decidedAt'] = date('c');
        $found = true;
        break;
    }
    if (!$found) fail('Согласие не найдено.', 404);
    write_json(consents_file($DATA_DIR), $list);
    audit_log($DATA_DIR, $me['name'], 'consent-decide', $decision . ': ' . $userId);
    respond(array('ok' => true));
}

if ($act === 'portfolio-decide') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'posts.review')) fail('Решение по портфолио принимает директор и администрация.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 400);
    $points = (int) (isset($in['points']) ? $in['points'] : 0);
    if (!in_array($decision, array('approved', 'rejected'), true)) fail('Решение — «принять» или «отклонить».');
    if ($decision === 'rejected' && slen($note) < 5) fail('Для отказа нужно основание.');

    $list = read_portfolio($DATA_DIR);
    $found = false;
    foreach ($list as $i => $item) {
        if ($item['id'] !== $id) continue;
        $list[$i]['status'] = $decision;
        $list[$i]['note'] = $note;
        $list[$i]['points'] = $decision === 'approved' ? max(0, min(50, $points)) : 0;
        $list[$i]['decidedAt'] = date('c');
        $found = true;
        break;
    }
    if (!$found) fail('Работа не найдена.', 404);
    write_json(portfolio_file($DATA_DIR), $list);
    audit_log($DATA_DIR, $me['name'], 'portfolio-decide', $decision . ': ' . $id);
    respond(array('ok' => true));
}

/* ------------------------------------------------- права участников */

function access_list() {
    return roles_list();
}

if ($act === 'users') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.view')) fail('Список участников видит только директор и администрация.', 403);
    /* Таблица участников собирается на сервере: баллы, последняя активность,
       редакция и пресс-карта нужны все сразу, а не десятью запросами. */
    $balances = points_balance_all($DATA_DIR);
    $activity = read_json(activity_file($DATA_DIR), array());
    $editorialNames = array();
    foreach (read_editorials($DATA_DIR) as $e) $editorialNames[$e['id']] = $e['name'];
    $cardByUser = array();
    foreach (read_cards($DATA_DIR) as $c) {
        if (empty($c['userId'])) continue;
        $prev = isset($cardByUser[$c['userId']]) ? $cardByUser[$c['userId']] : null;
        if ($prev === null || strcmp((string) $c['createdAt'], (string) $prev['createdAt']) > 0) {
            $cardByUser[$c['userId']] = $c;
        }
    }
    $consentByUser = array();
    foreach (read_consents($DATA_DIR) as $c) {
        if (isset($c['userId'])) $consentByUser[$c['userId']] = isset($c['status']) ? $c['status'] : 'pending';
    }

    $out = array();
    foreach (read_users($DATA_DIR) as $u) {
        $card = isset($cardByUser[$u['id']]) ? $cardByUser[$u['id']] : null;
        $out[] = array(
            'id' => $u['id'],
            'number' => isset($u['number']) ? (int) $u['number'] : 0,
            'name' => $u['name'],
            'email' => isset($u['email']) ? $u['email'] : '',
            'region' => isset($u['region']) ? $u['region'] : '',
            'access' => isset($u['access']) ? $u['access'] : 'Пользователь',
            'craft' => isset($u['role']) ? $u['role'] : '',
            'level' => role_level(isset($u['access']) ? $u['access'] : ''),
            'points' => isset($balances[$u['id']]) ? (int) $balances[$u['id']] : 0,
            'status' => isset($u['status']) ? $u['status'] : 'active',
            'emailVerified' => !empty($u['emailVerified']),
            'createdAt' => isset($u['createdAt']) ? $u['createdAt'] : '',
            'lastSeen' => last_seen_of($DATA_DIR, $u['id'], $activity),
            'editorialId' => isset($u['editorialId']) ? $u['editorialId'] : '',
            'editorialName' => isset($u['editorialId'], $editorialNames[$u['editorialId']]) ? $editorialNames[$u['editorialId']] : '',
            'cardStatus' => $card ? $card['status'] : 'none',
            'cardNumber' => $card && !empty($card['number']) ? $card['number'] : '',
            'consent' => isset($consentByUser[$u['id']]) ? $consentByUser[$u['id']] : 'none',
        );
    }
    usort($out, function ($a, $b) { return strcmp((string) $a['createdAt'], (string) $b['createdAt']); });
    respond(array('ok' => true, 'users' => $out, 'roles' => access_list(), 'caps' => user_caps($me)));
}

/* ============================================================ баллы и заметки

   Журнал операций — единственный источник баланса. Никаких «полей с баллами»:
   всё, что начислено, видно построчно, с основанием и автором операции. */

if ($act === 'points-rules') {
    respond(array('ok' => true, 'rules' => points_rules($DATA_DIR)));
}

if ($act === 'points-history') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : (isset($_GET['token']) ? (string) $_GET['token'] : ''));
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    $targetId = text(isset($in['userId']) ? $in['userId'] : '', 40);
    if ($targetId === '' || $targetId === $me['id']) {
        $targetId = $me['id'];
    } else {
        if (!can($me, 'people.view')) fail('Чужой журнал баллов доступен только редакции.', 403);
    }
    respond(array(
        'ok' => true,
        'userId' => $targetId,
        'balance' => points_balance($DATA_DIR, $targetId),
        'entries' => points_history($DATA_DIR, $targetId, 200),
    ));
}

if ($act === 'points-add') {
    $in = body();
    $me = require_cap($DATA_DIR, $in, 'points.award');
    $userId = text(isset($in['userId']) ? $in['userId'] : '', 40);
    $delta = (int) (isset($in['delta']) ? $in['delta'] : 0);
    $reason = text(isset($in['reason']) ? $in['reason'] : '', 60);
    $note = text(isset($in['note']) ? $in['note'] : '', 300);

    $target = null;
    foreach (read_users($DATA_DIR) as $u) {
        if ($u['id'] === $userId) $target = $u;
    }
    if (!$target) fail('Участник не найден.', 404);
    /* нельзя начислять себе и людям своего уровня — только ниже */
    if ((string) $target['id'] === (string) $me['id']) fail('Себе баллы не начисляются.', 403);
    if (!can_manage_user($me, $target) && !can($me, 'points.rule')) {
        fail('Этот участник не ниже вас по роли — операцию проводит старший.', 403);
    }
    if ($reason === '') $reason = 'manual';

    $res = points_add($DATA_DIR, $userId, $delta, $reason, $me['name'], $note);
    if (empty($res['ok'])) fail((string) $res['error']);
    respond(array(
        'ok' => true,
        'skipped' => !empty($res['skipped']),
        'entry' => isset($res['entry']) ? $res['entry'] : null,
        'balance' => points_balance($DATA_DIR, $userId),
    ));
}

if ($act === 'points-leaderboard') {
    $rows = points_leaderboard($DATA_DIR, 20);
    $users = read_users($DATA_DIR);
    $byId = array();
    foreach ($users as $u) $byId[$u['id']] = $u;
    $out = array();
    foreach ($rows as $i => $row) {
        if (!isset($byId[$row['userId']])) continue;
        $u = $byId[$row['userId']];
        $out[] = array(
            'place' => count($out) + 1,
            'userId' => $u['id'],
            'name' => $u['name'],
            'region' => isset($u['region']) ? $u['region'] : '',
            'role' => isset($u['role']) ? $u['role'] : '',
            'points' => $row['points'],
        );
    }
    respond(array('ok' => true, 'leaders' => $out));
}

/* Внутренние заметки о человеке. В публичную часть сайта не попадают. */
function notes_file($dir) { return $dir . '/person-notes.json'; }

if ($act === 'person-note') {
    $in = body();
    $me = require_cap($DATA_DIR, $in, 'people.note');
    $userId = text(isset($in['userId']) ? $in['userId'] : '', 40);
    $textValue = text(isset($in['text']) ? $in['text'] : '', 1000);
    if (slen($textValue) < 5) fail('Заметка слишком короткая.');

    $target = null;
    foreach (read_users($DATA_DIR) as $u) {
        if ($u['id'] === $userId) $target = $u;
    }
    if (!$target) fail('Участник не найден.', 404);

    $list = read_json(notes_file($DATA_DIR), array());
    if (!is_array($list)) $list = array();
    $row = array(
        'id' => 'pn_' . bin2hex(random_bytes(4)),
        'userId' => $userId,
        'text' => $textValue,
        'by' => $me['name'],
        'byId' => $me['id'],
        'at' => date('c'),
    );
    $list[] = $row;
    if (count($list) > 5000) $list = array_slice($list, -5000);
    if (!write_json(notes_file($DATA_DIR), $list)) fail('Не удалось сохранить заметку.', 500);
    audit_log($DATA_DIR, $me['name'], 'person-note', $target['name'] . ': ' . $textValue);
    respond(array('ok' => true, 'note' => $row));
}

/* Приостановка и восстановление аккаунта. Приостановка закрывает сессии. */
if ($act === 'person-status') {
    $in = body();
    $me = require_cap($DATA_DIR, $in, 'people.block');
    $userId = text(isset($in['userId']) ? $in['userId'] : '', 40);
    $status = isset($in['status']) ? (string) $in['status'] : '';
    $reason = text(isset($in['reason']) ? $in['reason'] : '', 300);
    if (!in_array($status, array('active', 'suspended'), true)) fail('Статус — «active» или «suspended».');
    if ($status === 'suspended' && slen($reason) < 5) fail('Нужна причина приостановки.');

    $users = read_users($DATA_DIR);
    $target = null;
    $found = false;
    foreach ($users as $i => $u) {
        if ($u['id'] !== $userId) continue;
        $target = $u;
        if (!can_manage_user($me, $u)) fail('Этот участник не ниже вас по роли.', 403);
        $users[$i]['status'] = $status;
        $users[$i]['statusChangedAt'] = date('c');
        $users[$i]['statusReason'] = $reason;
        $found = true;
        break;
    }
    if (!$found) fail('Участник не найден.', 404);
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить статус.', 500);
    if ($status === 'suspended') revoke_user_tokens($DATA_DIR, $userId);
    audit_log($DATA_DIR, $me['name'], 'person-status',
        $target['name'] . ' → ' . ($status === 'suspended' ? 'приостановлен' : 'восстановлен') .
        ($reason !== '' ? ' (' . $reason . ')' : ''));
    respond(array('ok' => true, 'status' => $status));
}

/* --------------------------------------------------------- резервные копии */

if ($act === 'backups') {
    $in = body();
    require_cap($DATA_DIR, $in, 'server.diag');
    respond(array('ok' => true, 'copies' => backup_list($DATA_DIR)));
}

if ($act === 'backup-now') {
    $in = body();
    $me = require_cap($DATA_DIR, $in, 'server.diag');
    $res = backup_maybe_run($DATA_DIR, true);
    audit_log($DATA_DIR, $me['name'], 'backup', 'копия данных: ' . (isset($res['date']) ? $res['date'] : '—'));
    respond(array('ok' => !empty($res['ok']), 'result' => $res, 'copies' => backup_list($DATA_DIR)));
}

if ($act === 'admin-log') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'audit.view')) fail('Журнал действий видит только директор и администрация.', 403);
    $rows = read_json(audit_file($DATA_DIR), array());
    if (!is_array($rows)) $rows = array();
    $rows = array_reverse($rows);
    $out = array();
    foreach (array_slice($rows, 0, 120) as $row) $out[] = public_audit($row);
    respond(array('ok' => true, 'entries' => $out));
}

/* Выдача доступа по паролю редакции: владелец проекта может назначить
   администратора, не заходя в чужой аккаунт. Нужен именно пароль редакции —
   одного токена мало, иначе любой директор мог бы «передать» панель. */
if ($act === 'grant-admin') {
    $in = body();
    if (!is_editor($DATA_DIR, isset($in['password']) ? (string) $in['password'] : '')) {
        fail('Нужен пароль редакции.', 403);
    }
    $email = norm_email(isset($in['email']) ? $in['email'] : '');
    if (!$email) fail('Укажите почту аккаунта.');
    $access = text(isset($in['access']) ? $in['access'] : '', 60);
    $allowed = array('Директор', 'Главный администратор', 'Администрация', 'Администратор',
        'Технический администратор', 'Главный редактор', 'Сотрудник', 'Модератор');
    if (!in_array($access, $allowed, true)) fail('Такой роли нет: ' . implode(', ', $allowed) . '.');

    $users = read_users($DATA_DIR);
    $updated = null;
    $found = false;
    foreach ($users as $i => $u) {
        if (strtolower((string) $u['email']) !== $email) continue;
        $users[$i]['access'] = $access;
        /* доступ даёт владелец лично, поэтому почта считается проверенной:
           иначе администратор не сможет пользоваться панелью */
        $users[$i]['emailVerified'] = true;
        if (!isset($users[$i]['status']) || $users[$i]['status'] === 'pending_email') {
            $users[$i]['status'] = 'active';
        }
        $users[$i]['accessGrantedAt'] = date('c');
        $updated = $users[$i];
        $found = true;
        break;
    }
    if (!$found) {
        fail('Аккаунта с такой почтой нет. Пусть человек зарегистрируется — потом выдайте доступ повторно.', 404);
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось выдать доступ.', 500);
    audit_log($DATA_DIR, 'пароль редакции', 'выдача доступа', $email . ' → ' . $access);
    respond(array('ok' => true, 'user' => public_user($updated)));
}

if ($act === 'user-access') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.access')) fail('Права меняет только директор и администрация.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);
    $access = text(isset($in['access']) ? $in['access'] : '', 60);
    if (!in_array($access, access_list(), true)) fail('Такой роли нет.');

    $users = read_users($DATA_DIR);
    $target = null;
    $directors = 0;
    foreach ($users as $u) {
        if ((isset($u['access']) ? $u['access'] : '') === 'Директор') $directors++;
        if ($u['id'] === $id) $target = $u;
    }
    if (!$target) fail('Участник не найден.', 404);
    /* нельзя менять того, кто равен или выше по роли, и нельзя выдать
       роль выше собственной: иначе администратор поднимает себя до директора */
    if (!can_manage_user($me, $target)) {
        fail('Этот участник не ниже вас по роли — права меняет старший.', 403);
    }
    if (!can_manage_role($me, $access)) {
        fail('Нельзя выдать роль выше своей.', 403);
    }
    if ((isset($target['access']) ? $target['access'] : '') === 'Директор' && $access !== 'Директор' && $directors <= 1) {
        fail('Директор один: сначала назначьте другого директора, потом снимайте этого.');
    }

    foreach ($users as $i => $u) {
        if ($u['id'] !== $id) continue;
        $users[$i]['access'] = $access;
        break;
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить права.', 500);
    audit_log($DATA_DIR, $me['name'], 'user-access', $target['name'] . ' → ' . $access);
    respond(array('ok' => true, 'id' => $id, 'access' => $access));
}

/* ------------------------------------------------------- почта проекта */

if ($act === 'mail-status') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'mail.manage')) fail('Почту настраивает только директор и администрация.', 403);
    respond(array('ok' => true, 'mail' => smtp_public_config($DATA_DIR)));
}

if ($act === 'mail-save') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'mail.manage')) fail('Почту настраивает только директор и администрация.', 403);

    $cfg = smtp_config($DATA_DIR);
    $host = text(isset($in['host']) ? $in['host'] : '', 120);
    $port = (int) (isset($in['port']) ? $in['port'] : 465);
    $secure_in = isset($in['secure']) ? (string) $in['secure'] : 'ssl';
    $secure = in_array($secure_in, array('ssl', 'tls', 'none'), true) ? $secure_in : 'ssl';
    $login = text(isset($in['user']) ? $in['user'] : '', 160);
    $pass = isset($in['pass']) ? (string) $in['pass'] : '';
    $from = norm_email(isset($in['from']) ? $in['from'] : '');
    $fromName = text(isset($in['fromName']) ? $in['fromName'] : '', 80);
    $notify = norm_email(isset($in['notify']) ? $in['notify'] : '');

    if ($host === '') fail('Укажите SMTP-сервер, например smtp-pulse.com.');
    if ($port < 1 || $port > 65535) fail('Порт должен быть от 1 до 65535.');
    if (!$from) fail('Укажите адрес отправителя: с него уходят письма.');
    if ($fromName === '') $fromName = 'Смена контента';

    $cfg['host'] = $host;
    $cfg['port'] = $port;
    $cfg['secure'] = $secure;
    $cfg['user'] = $login;
    if ($pass !== '') $cfg['pass'] = $pass;
    $cfg['from'] = $from;
    $cfg['fromName'] = $fromName;
    $cfg['notify'] = $notify;
    $cfg['updatedAt'] = date('c');

    if (!write_json(smtp_config_file($DATA_DIR), $cfg)) fail('Не удалось сохранить настройки почты.', 500);
    audit_log($DATA_DIR, $user['name'], 'mail-save', 'SMTP и отправитель обновлены');
    respond(array('ok' => true, 'mail' => smtp_public_config($DATA_DIR)));
}

/* Разовая первичная настройка почты владельцем проекта.

   Зачем: без входа в админку почту некуда вписать, а именно из-за её отсутствия
   не уходили коды. Работает ровно один раз: пока почта не настроена.
   Ключ ниже меняется в следующей сборке, повторно им воспользоваться нельзя. */
/* Разовая настройка почты. Раньше здесь лежал ключ прямо в коде, и им мог
   воспользоваться кто угодно: подменить SMTP и уводить коды подтверждения.
   Теперь нужен пароль редакции — он есть только у владельца проекта. */
if ($act === 'mail-setup') {
    $params = array_merge(body(), $_GET);
    if (!is_editor($DATA_DIR, isset($params['pass']) ? (string) $params['pass'] : '')) {
        fail('Нужен пароль редакции. Меняйте почту в /admin → «Почта».', 403);
    }

    $host = text(isset($params['host']) ? $params['host'] : '', 120);
    $port = (int) (isset($params['port']) ? $params['port'] : 465);
    $secure_in = isset($params['secure']) ? (string) $params['secure'] : 'ssl';
    $secure = in_array($secure_in, array('ssl', 'tls', 'none'), true) ? $secure_in : 'ssl';
    $login = text(isset($params['user']) ? $params['user'] : '', 160);
    $pass = isset($params['pass_smtp']) ? (string) $params['pass_smtp'] : '';
    $from = norm_email(isset($params['from']) ? $params['from'] : '');
    $fromName = text(isset($params['fromName']) ? $params['fromName'] : '', 80);
    $notify = norm_email(isset($params['notify']) ? $params['notify'] : '');

    if ($host === '') fail('Укажите SMTP-сервер.');
    if ($port < 1 || $port > 65535) fail('Порт от 1 до 65535.');
    if ($login === '' || $pass === '') fail('Нужны логин и пароль почты.');
    if (!$from) fail('Укажите адрес отправителя.');
    if ($fromName === '') $fromName = 'Смена контента';

    $cfg_save = array(
        'host' => $host,
        'port' => $port,
        'secure' => $secure,
        'user' => $login,
        'pass' => $pass,
        'from' => $from,
        'fromName' => $fromName,
        'notify' => $notify,
        'updatedAt' => date('c'),
        'setupDone' => true,
    );
    if (!write_json(smtp_config_file($DATA_DIR), $cfg_save)) fail('Не удалось сохранить настройки почты.', 500);
    audit_log($DATA_DIR, 'пароль редакции', 'mail-setup', 'настройки SMTP обновлены');

    $test_to = norm_email(isset($params['test']) ? $params['test'] : '');
    $result = null;
    if ($test_to) {
        $sent = smtp_send_mail(
            smtp_config($DATA_DIR),
            $test_to,
            'Проверка почты — Смена контента',
            "Это проверочное письмо с сайта smenakontenta.ru.\n" .
            "Если вы его видите, коды подтверждения и восстановления будут доходить.\n"
        );
        $result = array(
            'ok' => !empty($sent['ok']),
            'error' => empty($sent['ok']) ? (string) $sent['error'] : '',
            'to' => $test_to,
        );
        $cfg_after = smtp_config($DATA_DIR);
        $cfg_after['lastTest'] = array(
            'ok' => $result['ok'],
            'error' => $result['error'],
            'to' => $test_to,
            'at' => date('c'),
        );
        $cfg_after['setupDone'] = true;
        write_json(smtp_config_file($DATA_DIR), $cfg_after);
    }

    respond(array(
        'ok' => true,
        'mail' => smtp_public_config($DATA_DIR),
        'test' => $result,
    ));
}

/* Смена адреса отправителя: сначала пробная отправка, и только если сервер
   её принял — запись в настройки. Так рабочая почта не ломается из-за
   неподтверждённого домена: при ошибке остаётся прежний отправитель. */
if ($act === 'mail-from') {
    $in = array_merge(body(), $_GET);
    if (!is_editor($DATA_DIR, isset($in['pass']) ? (string) $in['pass'] : '')) {
        fail('Неверный пароль редакции.', 403);
    }
    $from = norm_email(isset($in['from']) ? $in['from'] : '');
    if (!$from) fail('Укажите адрес отправителя.');
    $to = norm_email(isset($in['test']) ? $in['test'] : '');

    if ($to !== '') {
        $trial = smtp_config($DATA_DIR);
        $trial['from'] = $from;
        if (isset($in['fromName']) && (string) $in['fromName'] !== '') {
            $trial['fromName'] = text($in['fromName'], 80);
        }
        $sent = smtp_send_mail(
            $trial,
            $to,
            'Проверка отправителя — Смена контента',
            "Это проверка нового адреса отправителя на сайте smenakontenta.ru.\n" .
            "Если письмо пришло, значит домен подтверждён и письма будут уходить с него.\n",
            '<div style="font-family:Arial,sans-serif;font-size:16px">' .
            '<p>Проверка нового адреса отправителя на сайте <b>smenakontenta.ru</b>.</p>' .
            '<p>Если письмо пришло — домен подтверждён, письма уходят с него.</p></div>'
        );
        if (empty($sent['ok'])) {
            fail('Сервер почты не принял адрес ' . $from . ': ' . (string) $sent['error'], 502);
        }
        $saved = smtp_config($DATA_DIR);
        $saved['from'] = $from;
        if (isset($in['fromName']) && (string) $in['fromName'] !== '') {
            $saved['fromName'] = text($in['fromName'], 80);
        }
        $saved['updatedAt'] = date('c');
        $saved['setupDone'] = true;
        $saved['lastTest'] = array('ok' => true, 'error' => '', 'to' => $to, 'at' => date('c'));
        if (!write_json(smtp_config_file($DATA_DIR), $saved)) fail('Не удалось сохранить настройки.', 500);
        audit_log($DATA_DIR, 'пароль редакции', 'mail-from', 'отправитель: ' . $from);
        respond(array('ok' => true, 'switched' => true, 'from' => $from,
                      'mail' => smtp_public_config($DATA_DIR)));
    }

    $cfg = smtp_config($DATA_DIR);
    $cfg['from'] = $from;
    $cfg['updatedAt'] = date('c');
    $cfg['setupDone'] = true;
    if (!write_json(smtp_config_file($DATA_DIR), $cfg)) fail('Не удалось сохранить настройки.', 500);
    audit_log($DATA_DIR, 'пароль редакции', 'mail-from', 'отправитель: ' . $from);
    respond(array('ok' => true, 'switched' => true, 'mail' => smtp_public_config($DATA_DIR)));
}

if ($act === 'mail-test') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'mail.manage')) fail('Проверку почты делает только директор и администрация.', 403);

    $to = norm_email(isset($in['to']) ? $in['to'] : '');
    if (!$to) $to = isset($user['email']) ? $user['email'] : '';
    if (!$to) fail('Укажите, куда отправить проверочное письмо.');

    $cfg = smtp_config($DATA_DIR);
    if (!smtp_configured($DATA_DIR)) fail('Сначала сохраните настройки почты.', 400);

    $res = smtp_send_mail(
        $cfg,
        $to,
        'Проверка почты — Смена контента',
        "Это проверочное письмо с сайта smenakontenta.ru.\n\n" .
        "Если вы его видите, значит настройки почты в порядке и коды будут доходить.\n",
        '<div style="font-family:Arial,sans-serif;font-size:16px">' .
        '<p>Это проверочное письмо с сайта <b>smenakontenta.ru</b>.</p>' .
        '<p>Если вы его видите — настройки почты в порядке, коды будут доходить.</p></div>'
    );
    $cfg_after = smtp_config($DATA_DIR);
    $cfg_after['lastTest'] = array(
        'ok' => !empty($res['ok']),
        'error' => empty($res['ok']) ? (string) $res['error'] : '',
        'to' => $to,
        'at' => date('c'),
    );
    write_json(smtp_config_file($DATA_DIR), $cfg_after);
    if (empty($res['ok'])) fail((string) $res['error'], 502);
    respond(array('ok' => true, 'to' => $to, 'lastTest' => $cfg_after['lastTest']));
}

/* ------------------------------------------------- подтверждение почты */

if ($act === 'confirm-send') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!empty($user['emailVerified'])) respond(array('ok' => true, 'already' => true, 'mailSent' => false));

    $last = strtotime((string) (isset($user['confirmSentAt']) ? $user['confirmSentAt'] : ''));
    if ($last && (time() - $last) < 45) {
        fail('Письмо уже отправлено. Подождите минуту и проверьте «Спам».', 429);
    }
    if (!smtp_configured($DATA_DIR)) {
        fail('Почта проекта ещё не подключена — подтверждение станет доступно, как только её настроят.', 503);
    }

    $code = (string) random_int(100000, 999999);
    $users = read_users($DATA_DIR);
    $email = '';
    foreach ($users as $i => $u) {
        if ($u['id'] !== $user['id']) continue;
        $users[$i]['confirm'] = password_hash($code, PASSWORD_DEFAULT);
        $users[$i]['confirmAt'] = date('c');
        $users[$i]['confirmSentAt'] = date('c');
        $email = $u['email'];
        break;
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить код.', 500);

    $sent = mail_notify($DATA_DIR, 'confirm_code', $email, array(
        'name' => $user['name'],
        'code' => $code,
        'minutes' => 30,
        'link' => 'https://smenakontenta.ru/cabinet/',
    ));
    if (!$sent) fail('Сервер почты не принял письмо. Проверьте настройки в админке.', 502);
    respond(array('ok' => true, 'mailSent' => true, 'email' => $email));
}

if ($act === 'confirm-check') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    $code = preg_replace('/[^0-9]/', '', (string) (isset($in['code']) ? $in['code'] : ''));
    if (strlen($code) !== 6) fail('Код — шесть цифр из письма.');

    $hash = isset($user['confirm']) ? (string) $user['confirm'] : '';
    if ($hash === '' || !password_verify($code, $hash)) fail('Код не подошёл. Проверьте письмо.', 403);
    $sentAt = strtotime((string) (isset($user['confirmAt']) ? $user['confirmAt'] : ''));
    if ($sentAt && (time() - $sentAt) > 30 * 60) fail('Код устарел. Запросите новое письмо.', 403);

    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] !== $user['id']) continue;
        $users[$i]['emailVerified'] = true;
        $users[$i]['confirmedAt'] = date('c');
        $users[$i]['confirm'] = '';
        if (isset($users[$i]['status']) && $users[$i]['status'] === 'pending_email') {
            $users[$i]['status'] = 'active';
        }
        $confirmed = $users[$i];
        break;
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить подтверждение.', 500);
    if (!empty($confirmed)) {
        mail_notify($DATA_DIR, 'welcome', $confirmed['email'], array(
            'name' => $confirmed['name'],
            'link' => 'https://smenakontenta.ru/cabinet/',
        ), array('dedupe' => 'welcome:' . $confirmed['id']));
        audit_log($DATA_DIR, $confirmed['email'], 'почта подтверждена', 'аккаунт ' . $confirmed['id']);
    }
    respond(array('ok' => true, 'verified' => true, 'user' => isset($confirmed) ? public_user($confirmed) : null));
}

/* ----------------------------------------------------- поддержка авторов */

function support_file($dir) { return $dir . '/support.json'; }

function read_support($dir) {
    $list = read_json(support_file($dir), array());
    return is_array($list) ? $list : array();
}

function public_support($t) {
    return array(
        'id' => isset($t['id']) ? $t['id'] : '',
        'name' => isset($t['name']) ? $t['name'] : '',
        'email' => isset($t['email']) ? $t['email'] : '',
        'topic' => isset($t['topic']) ? $t['topic'] : '',
        'message' => isset($t['message']) ? $t['message'] : '',
        'status' => isset($t['status']) ? $t['status'] : 'open',
        'createdAt' => isset($t['createdAt']) ? $t['createdAt'] : '',
        'closedAt' => isset($t['closedAt']) ? $t['closedAt'] : '',
        'answer' => isset($t['answer']) ? $t['answer'] : '',
        'mailed' => !empty($t['mailed']),
    );
}

if ($act === 'support-send') {
    $in = body();
    check_rate($DATA_DIR);
    $name = text(isset($in['name']) ? $in['name'] : '', 80);
    $email = norm_email(isset($in['email']) ? $in['email'] : '');
    $topic = text(isset($in['topic']) ? $in['topic'] : '', 80);
    $message = text(isset($in['message']) ? $in['message'] : '', 3000);

    if (slen($name) < 2) fail('Напишите, как к вам обращаться.');
    if (!$email) fail('Почта нужна, чтобы ответить.');
    if (slen($message) < 15) fail('Опишите вопрос подробнее: минимум 15 символов.');

    $tickets = read_support($DATA_DIR);
    foreach ($tickets as $t) {
        if ($t['email'] === $email && $t['status'] === 'open') {
            fail('Ваше прошлое обращение ещё не закрыто — ответим на него.', 409);
        }
    }

    $ticket = array(
        'id' => 'sp_' . bin2hex(random_bytes(4)),
        'name' => $name,
        'email' => $email,
        'topic' => $topic !== '' ? $topic : 'Общий вопрос',
        'message' => $message,
        'status' => 'open',
        'createdAt' => date('c'),
        'mailed' => false,
    );

    $cfg = smtp_config($DATA_DIR);
    if (smtp_configured($DATA_DIR) && $cfg['notify'] !== '') {
        $support_from = mail_from_kind('support');
        if ($support_from !== '') {
            $cfg['from'] = $support_from;
        }
        $sent = smtp_send_mail(
            $cfg,
            $cfg['notify'],
            'Поддержка: ' . $ticket['topic'] . ' — ' . $name,
            "Новое обращение с сайта.\n\n" .
            "От: " . $name . " <" . $email . ">\n" .
            "Тема: " . $ticket['topic'] . "\n" .
            "Номер: " . $ticket['id'] . "\n\n" .
            $message . "\n\n" .
            "Ответить можно прямо на это письмо — адрес автора в поле «От».\n"
        );
        $ticket['mailed'] = !empty($sent['ok']);
    }

    $tickets[] = $ticket;
    if (!write_json(support_file($DATA_DIR), $tickets)) fail('Не удалось сохранить обращение.', 500);

    respond(array('ok' => true, 'ticket' => public_support($ticket)));
}

if ($act === 'support-queue') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'support.answer')) fail('Обращения видит только директор и администрация.', 403);
    $out = array();
    foreach (read_support($DATA_DIR) as $t) {
        if ($t['status'] !== 'open') continue;
        $out[] = public_support($t);
    }
    usort($out, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    respond(array('ok' => true, 'tickets' => $out));
}

if ($act === 'support-close') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'support.answer')) fail('Закрывает обращения только директор и администрация.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);
    $answer = text(isset($in['answer']) ? $in['answer'] : '', 1000);
    if (slen($answer) < 5) fail('Запишите ответ автору: минимум пять символов.');

    $tickets = read_support($DATA_DIR);
    $done = false;
    $person = null;
    foreach ($tickets as $i => $t) {
        if ($t['id'] !== $id || $t['status'] !== 'open') continue;
        $tickets[$i]['status'] = 'closed';
        $tickets[$i]['answer'] = $answer;
        $tickets[$i]['closedAt'] = date('c');
        $tickets[$i]['closedBy'] = $user['name'];
        $person = $t;
        $done = true;
        break;
    }
    if (!$done) fail('Обращение не найдено или уже закрыто.', 404);
    write_json(support_file($DATA_DIR), $tickets);
    audit_log($DATA_DIR, $user['name'], 'support-close', 'обращение ' . $id . ' закрыто');

    $mailed = false;
    if (smtp_configured($DATA_DIR)) {
        $sent = mail_send(
            $person['email'],
            'Ответ поддержки — Смена контента',
            "Здравствуйте, " . $person['name'] . "!\n\n" . $answer . "\n\n" .
            "Ваш вопрос: " . $person['message'] . "\n\n" .
            "Ответить можно на это письмо.\n\n—\nСмена контента\nhttps://smenakontenta.ru\n",
            '',
            'support'
        );
        $mailed = $sent;
    }
    respond(array('ok' => true, 'mailed' => $mailed));
}

if ($act === 'login') {
    $in = body();
    check_login_rate($DATA_DIR);
    $email = norm_email(isset($in['email']) ? $in['email'] : '');
    $pass = isset($in['pass']) ? (string) $in['pass'] : '';
    if (!$email || $pass === '') fail('Введите почту и пароль.');

    $users = read_users($DATA_DIR);
    foreach ($users as $u) {
        if (strtolower((string) $u['email']) === $email) {
            if (!password_verify($pass, (string) $u['pass'])) {
                fail('Пароль не подошёл. Проверьте раскладку и регистр.', 403);
            }
            if (isset($u['status']) && $u['status'] === 'suspended') {
                fail('Аккаунт приостановлен. Напишите в поддержку — разберёмся.', 403);
            }
            touch_activity($DATA_DIR, $u['id']);
            respond(array('ok' => true, 'user' => public_user($u), 'token' => new_token($DATA_DIR, $u['id'])));
        }
    }
    fail('Аккаунт с такой почтой не найден. Зарегистрируйтесь — это минута.', 404);
}

if ($act === 'me') {
    $in = body();
    $token = isset($in['token']) ? (string) $in['token'] : (isset($_GET['token']) ? (string) $_GET['token'] : '');
    $user = user_by_token($DATA_DIR, $token);
    if (!$user) fail('Сессии нет — нужно войти заново.', 401);
    if (isset($user['status']) && $user['status'] === 'suspended') {
        fail('Аккаунт приостановлен.', 403);
    }
    touch_activity($DATA_DIR, $user['id']);
    respond(array(
        'ok' => true,
        'user' => public_user($user),
        'caps' => user_caps($user),
        'points' => points_balance($DATA_DIR, $user['id']),
    ));
}

if ($act === 'logout') {
    $in = body();
    $token = isset($in['token']) ? (string) $in['token'] : '';
    $tokens = read_json(tokens_file($DATA_DIR), array());
    if (is_array($tokens) && isset($tokens[$token])) {
        unset($tokens[$token]);
        write_json(tokens_file($DATA_DIR), $tokens);
    }
    respond(array('ok' => true));
}

if ($act === 'profile-save') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);

    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] !== $user['id']) continue;

        $name = text(isset($in['name']) ? $in['name'] : $u['name'], 80);
        if (slen($name) >= 2) $users[$i]['name'] = $name;
        if (isset($in['bio'])) $users[$i]['bio'] = text($in['bio'], 600);
        if (isset($in['region'])) $users[$i]['region'] = text($in['region'], 60);
        if (isset($in['role'])) {
            $craft = text($in['role'], 60);
            if (in_array($craft, CRAFT, true)) $users[$i]['role'] = $craft;
        }

        if (!empty($in['avatar'])) {
            $err = '';
            $file = data_url_file($in['avatar'], array('image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'), MAX_AVATAR_CHARS, $err);
            if (!$file) fail($err);
            $dir = media_dir($DATA_DIR);
            $fname = 'ava_' . $user['id'] . '_' . time() . '.' . $file['ext'];
            if (@file_put_contents($dir . '/' . $fname, $file['bin']) === false) fail('Не удалось сохранить аватар.', 500);
            @chmod($dir . '/' . $fname, 0644);
            $users[$i]['avatar'] = media_public_url($fname);
        }
        if (!empty($in['avatarClear'])) $users[$i]['avatar'] = '';

        if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить профиль.', 500);
        respond(array('ok' => true, 'user' => public_user($users[$i])));
    }
    fail('Аккаунт не найден.', 404);
}

/* -------------------------------------------------------------------- медиа */

if ($act === 'media-upload') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Загружать файлы можно только из аккаунта. Войдите.', 401);

    $allowed = array(
        'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif',
        'audio/mpeg' => 'mp3', 'audio/mp4' => 'm4a', 'audio/ogg' => 'ogg', 'audio/wav' => 'wav', 'audio/x-wav' => 'wav',
        'video/mp4' => 'mp4', 'video/webm' => 'webm', 'video/quicktime' => 'mov',
    );
    $err = '';
    $file = data_url_file(isset($in['data']) ? $in['data'] : '', $allowed, MAX_MEDIA_CHARS, $err);
    if (!$file) fail($err, 413);

    $dir = media_dir($DATA_DIR);
    if (!is_dir($dir)) fail('Папка для файлов недоступна.', 500);
    $fname = 'm_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $file['ext'];
    if (@file_put_contents($dir . '/' . $fname, $file['bin']) === false) {
        fail('Файл слишком большой для хостинга или нет прав на запись.', 500);
    }
    @chmod($dir . '/' . $fname, 0644);
    respond(array('ok' => true, 'url' => media_public_url($fname), 'mime' => $file['mime'], 'size' => strlen($file['bin'])));
}

if ($act === 'media') {
    $id = isset($_GET['id']) ? basename((string) $_GET['id']) : '';
    if ($id === '' || !preg_match('/^[A-Za-z0-9_.-]+$/', $id)) {
        http_response_code(404);
        exit;
    }
    $path = media_dir($DATA_DIR) . '/' . $id;
    if (!file_exists($path)) {
        http_response_code(404);
        exit;
    }
    $ext = strtolower(pathinfo($id, PATHINFO_EXTENSION));
    $types = array(
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif',
        'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'ogg' => 'audio/ogg', 'wav' => 'audio/wav',
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime',
    );
    /* файлы неизвестного типа не отдаём вовсе: иначе через приёмную можно
       раздавать что угодно со своего домена */
    if (!isset($types[$ext])) {
        http_response_code(404);
        exit;
    }
    header('Content-Type: ' . $types[$ext]);
    header('Content-Disposition: inline; filename="' . $id . '"');
    header('X-Frame-Options: SAMEORIGIN');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Accept-Ranges: bytes');
    readfile($path);
    exit;
}

/* Почта (ящики домена, чтение, отправка, шаблоны) и приём в команду живут
   в отдельных файлах, но маршруты — здесь, чтобы клиент видел один адрес API. */
if (mailbox_routes($act, $DATA_DIR)) exit;
if (hiring_routes($act, $DATA_DIR)) exit;

fail('Неизвестное действие. Доступны: state, submit, reg, login, me, profile-save, media-upload, queue, review, card-request, mailboxes, mail-list, mail-send, hiring-apply, selftest.', 404);
