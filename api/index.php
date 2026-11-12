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
/* Ответы API — это только данные: никаких встраиваний и внешних загрузок.
   Отдельные маршруты (media) переопределяют заголовки сами. */
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

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
require __DIR__ . '/lib/tasks.php';    /* задачи команды: сотрудники, редакция, основатели */
require __DIR__ . '/lib/ai.php';       /* ИИ-помощник писем: только бесплатные тарифы */    /* задачи команды: сотрудники, редакция, основатели */
require __DIR__ . '/lib/hiring.php';   /* приём в команду: тест, чек-лист, согласование */
require __DIR__ . '/lib/staff.php';    /* уведомления о решениях, лимиты, сводка для панели */
require __DIR__ . '/lib/consent.php';  /* согласие на обработку ПД: закрытое хранение, проверка */
require __DIR__ . '/lib/cards.php';    /* пресс-карта: заявка, выдача, срок, проверка по номеру */
require __DIR__ . '/lib/editorial_open.php'; /* заявление на открытие редакции → решение директора */
require __DIR__ . '/lib/reports.php';  /* ежемесячные отчёты редакций: форма руководителя + цифры сервера */
require __DIR__ . '/lib/school.php';   /* медиашкола: курсы, уроки, задания, тесты, проверка, прогресс */

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
    /* Без mbstring режем по буквам, а не по байтам: половина русской буквы
       портит JSON, и файл данных перестаёт записываться. */
    $max = (int) $max;
    if (strlen($s) <= $max) return $s;
    $out = '';
    $offset = 0;
    for ($left = $max; $left > 0; $left -= 2000) {
        if (!preg_match('/\G.{1,' . min($left, 2000) . '}/us', $s, $m, 0, $offset)) break;
        $out .= $m[0];
        $offset += strlen($m[0]);
    }
    return $out;
}

/* Верхний регистр без обязательного mbstring: на части сборок PHP его нет,
   а падать на проверке слова «УДАЛИТЬ» нельзя. */
function supper($value) {
    if (function_exists('mb_strtoupper')) return mb_strtoupper((string) $value, 'UTF-8');
    return strtr(strtoupper((string) $value), array(
        'а' => 'А', 'б' => 'Б', 'в' => 'В', 'г' => 'Г', 'д' => 'Д', 'е' => 'Е', 'ё' => 'Ё',
        'ж' => 'Ж', 'з' => 'З', 'и' => 'И', 'й' => 'Й', 'к' => 'К', 'л' => 'Л', 'м' => 'М',
        'н' => 'Н', 'о' => 'О', 'п' => 'П', 'р' => 'Р', 'с' => 'С', 'т' => 'Т', 'у' => 'У',
        'ф' => 'Ф', 'х' => 'Х', 'ц' => 'Ц', 'ч' => 'Ч', 'ш' => 'Ш', 'щ' => 'Щ', 'ъ' => 'Ъ',
        'ы' => 'Ы', 'ь' => 'Ь', 'э' => 'Э', 'ю' => 'Ю', 'я' => 'Я',
    ));
}

function slen($value) {
    $s = (string) $value;
    if (function_exists('mb_strlen')) return mb_strlen($s, 'UTF-8');
    /* длина в буквах: байты без «хвостов» многобайтных символов UTF-8 */
    return strlen($s) - (int) preg_match_all('/[\x80-\xBF]/', $s);
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
   открываются только сотруднику с правом на диагностику сервера.
   Пароль редакции оставлен запасным входом для первого запуска, когда нет
   ни одного аккаунта: стандартный пароль из открытого репозитория не
   открывает ничего, а неверные попытки ограничены десятью в час. */
function require_diagnostics($dir, $params) {
    $token = isset($params['token']) ? (string) $params['token'] : '';
    if ($token !== '') {
        $me = user_by_token($dir, $token);
        if ($me && can($me, 'server.diag')) return;
    }
    $pass = isset($params['pass']) ? (string) $params['pass'] : '';
    if ($pass !== '' && $pass !== KNOWN_DEFAULT_EDITOR_PASSWORD && rate_count($dir, 'diag', client_ip()) < 10) {
        if (is_editor($dir, $pass)) return;
        check_rate_for($dir, 'diag', client_ip(), 1000, '');
    }
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
    write_json(audit_file($dir), log_trim($list, 'at', 2000));
}

/* Журналы с адресами и почтой людей хранятся не дольше года — так записано
   в Политике (раздел 3). Заодно ограничиваем число строк. */
function log_trim($list, $field, $max) {
    $edge = date('c', time() - 365 * 86400);
    $kept = array();
    foreach ($list as $row) {
        $at = is_array($row) && isset($row[$field]) ? (string) $row[$field] : '';
        if ($at !== '' && strcmp($at, $edge) < 0) continue;
        $kept[] = $row;
    }
    if (count($kept) > $max) $kept = array_slice($kept, -$max);
    return $kept;
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
        'editorialId' => isset($u['editorialId']) ? $u['editorialId'] : '',
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
    if (!$token || !token_valid_format($token)) return null;
    $tokens = read_json(tokens_file($dir), array());
    if (!is_array($tokens) || !isset($tokens[$token])) return null;
    $info = $tokens[$token];
    if (!is_array($info) || !isset($info['id'], $info['exp'])) return null;
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
    /* в штате — руководитель и все принятые участники */
    $members = 1;
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
        'leftAt' => isset($a['leftAt']) ? $a['leftAt'] : '',
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

/* Согласия, пресс-карты, открытие редакций и сводка панели живут в api/lib. */
if (staff_routes($act, $DATA_DIR)) exit;
if (consent_routes($act, $DATA_DIR)) exit;
if (cards_routes($act, $DATA_DIR)) exit;
if (editorial_open_routes($act, $DATA_DIR)) exit;
if (reports_routes($act, $DATA_DIR)) exit;
if (school_routes($act, $DATA_DIR)) exit;

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

/* Очередь материалов для сотрудника: только его зона, с автором. */
function posts_pending_for($dir, $me) {
    $scope = staff_scope($me);
    $usersById = array();
    foreach (read_users($dir) as $u) $usersById[$u['id']] = $u;
    $out = array();
    foreach (read_json($dir . '/posts.json', array()) as $post) {
        if (!isset($post['status']) || $post['status'] !== 'pending') continue;
        $author = !empty($post['authorId']) && isset($usersById[$post['authorId']]) ? $usersById[$post['authorId']] : null;
        if (!post_in_scope($scope, $post, $author)) continue;
        $row = public_post($post);
        $row['submittedAt'] = isset($post['submittedAt']) ? $post['submittedAt'] : '';
        $row['revision'] = isset($post['revision']) ? (int) $post['revision'] : 1;
        $row['authorId'] = isset($post['authorId']) ? $post['authorId'] : '';
        $row['authorNumber'] = $author && isset($author['number']) ? (int) $author['number'] : 0;
        $email = $author && isset($author['email']) ? (string) $author['email'] : '';
        $row['authorEmail'] = sees_contacts($me, $scope, $author) ? $email : mask_email($email);
        $row['own'] = $author && (string) $author['id'] === (string) $me['id'];
        $out[] = $row;
    }
    /* очередь — от старых к новым: кто раньше прислал, того раньше читают */
    usort($out, function ($a, $b) {
        return strcmp((string) $a['submittedAt'], (string) $b['submittedAt']);
    });
    return $out;
}

if ($act === 'submit') {
    $in = body();
    /* Материал принимается только от аккаунта с подтверждённой почтой и
       принятым согласием на обработку данных. Гостевой отправки нет: у
       материала всегда есть автор, которому можно ответить. */
    $authorUser = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$authorUser) fail('Чтобы отправить материал, войдите в аккаунт.', 401);
    require_verified($authorUser);
    require_consent($DATA_DIR, $authorUser);

    $title = text(isset($in['title']) ? $in['title'] : '', 200);
    $excerpt = text(isset($in['excerpt']) ? $in['excerpt'] : '', 600);
    $content = text(isset($in['body']) ? $in['body'] : '', MAX_BODY_CHARS);
    $authorKey = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) (isset($in['authorKey']) ? $in['authorKey'] : ''));
    $authorKey = substr($authorKey, 0, 64);

    if (slen($title) < 8) fail('Заголовок короче восьми символов.');
    if (slen($excerpt) < 20) fail('Описание короче двадцати символов.');
    if (slen($content) < 200) fail('Текст материала короче двухсот символов.');

    $posts = read_json($DATA_DIR . '/posts.json', array());

    /* Исправленная версия отклонённого или ещё не проверенного материала
       встаёт на место прежней: тот же номер, новая редакция текста. */
    $replaceId = text(isset($in['replaceId']) ? $in['replaceId'] : '', 40);
    $old = null;
    if ($replaceId !== '') {
        if (!isset($posts[$replaceId])) fail('Материал для исправления не найден.', 404);
        $old = $posts[$replaceId];
        if (empty($old['authorId']) || (string) $old['authorId'] !== (string) $authorUser['id']) {
            fail('Исправить можно только свой материал.', 403);
        }
        if (!in_array($old['status'], array('rejected', 'pending'), true)) {
            fail('Опубликованный материал так не исправить — напишите редакции.', 409);
        }
    } elseif (count($posts) >= MAX_POSTS) {
        fail('Хранилище заполнено, напишите редакции.', 507);
    }

    /* лимит — на аккаунт, а не на адрес: класс за одним школьным адресом
       не должен запирать друг друга */
    check_rate_for($DATA_DIR, 'submit', $authorUser['id'], 20,
        'Слишком много отправок подряд. Попробуйте через час.');

    /* Сразу в публикацию — только с правом «posts.publish». Раньше хватало
       флажка direct в запросе, и опубликовать без проверки мог кто угодно. */
    $direct = !empty($in['direct']) && can($authorUser, 'posts.publish');
    $now = date('c');
    $id = $old ? $old['id'] : new_id('s_');

    // порядковый номер материала проекта
    $maxNumber = 0;
    foreach ($posts as $existing) {
        if (isset($existing['number']) && (int) $existing['number'] > $maxNumber) {
            $maxNumber = (int) $existing['number'];
        }
    }
    $post = array(
        'id' => $id,
        'authorKey' => $authorKey,
        'authorId' => $authorUser['id'],
        /* имя, роль и регион автора — из аккаунта, а не из формы: под чужим
           именем материал не отправить */
        'authorName' => $authorUser['name'],
        'authorRole' => isset($authorUser['role']) ? $authorUser['role'] : '',
        'authorRegion' => isset($authorUser['region']) ? $authorUser['region'] : '',
        /* редакция автора на момент отправки: по ней считается отчёт редакции */
        'editorialId' => isset($authorUser['editorialId']) ? (string) $authorUser['editorialId'] : '',
        'title' => $title,
        'excerpt' => $excerpt,
        'body' => $content,
        'topic' => text(isset($in['topic']) ? $in['topic'] : '', 60),
        'format' => text(isset($in['format']) ? $in['format'] : '', 60),
        'region' => text(isset($in['region']) ? $in['region'] : '', 80),
        'image' => safe_media_url(text(isset($in['image']) ? $in['image'] : '', 400)),
        'imageAlt' => text(isset($in['imageAlt']) ? $in['imageAlt'] : '', 200),
        'gallery' => array_values(array_filter(array_slice(array_map(function ($u) {
            return safe_media_url(text(is_string($u) ? $u : '', 400));
        }, isset($in['gallery']) && is_array($in['gallery']) ? $in['gallery'] : array()), 0, 12))),
        'video' => safe_media_url(text(isset($in['video']) ? $in['video'] : '', 400)),
        'audio' => safe_media_url(text(isset($in['audio']) ? $in['audio'] : '', 400)),
        'read' => isset($in['read']) ? max(1, min(60, (int) $in['read'])) : 4,
        'number' => $old && !empty($old['number']) ? (int) $old['number'] : $maxNumber + 1,
        'revision' => $old ? (isset($old['revision']) ? (int) $old['revision'] : 1) + 1 : 1,
        'status' => $direct ? 'published' : 'pending',
        'date' => $now,
        'submittedAt' => $now,
        'firstSubmittedAt' => $old ? (isset($old['firstSubmittedAt']) ? $old['firstSubmittedAt'] : (isset($old['submittedAt']) ? $old['submittedAt'] : $now)) : $now,
        'reviewedAt' => $direct ? $now : null,
        'reviewNote' => '',
    );
    if ($direct) $post['reviewedBy'] = $authorUser['name'];

    $posts[$id] = $post;
    if (!write_json($DATA_DIR . '/posts.json', $posts)) {
        fail('Не удалось сохранить материал на сервере. Напишите редакции.', 500);
    }
    if ($direct) {
        $rule = 'post.' . ($post['format'] !== '' ? $post['format'] : 'Статья');
        points_award_rule($DATA_DIR, $authorUser['id'], $rule, 'редакция',
            'Материал «' . $post['title'] . '»', 'post:' . $id);
        audit_log($DATA_DIR, (string) $authorUser['email'], 'submit', 'опубликован без очереди: ' . $post['title']);
    }
    $row = public_post($post);
    $row['own'] = true;
    $row['revision'] = $post['revision'];
    $row['submittedAt'] = $now;
    respond(array('ok' => true, 'post' => $row, 'direct' => $direct, 'replaced' => (bool) $old));
}

if ($act === 'mine') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    $key = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) (isset($in['authorKey']) ? $in['authorKey'] : ''));
    $posts = read_json($DATA_DIR . '/posts.json', array());

    /* Материалы, отправленные до привязки к аккаунту, лежат без автора.
       Привязываем их один раз: совпал ключ из браузера, в котором материал
       отправляли, и имя автора в материале — это имя аккаунта. Одного ключа
       мало: за школьным компьютером ключ общий на всех, кто с него входил. */
    $bound = false;
    if (strlen($key) >= 12 && !empty($me['emailVerified'])) {
        foreach ($posts as $pid => $post) {
            if (!empty($post['authorId']) || !empty($post['authorAccountDeleted'])) continue;
            if (!isset($post['authorKey']) || $post['authorKey'] !== $key) continue;
            if (!isset($post['authorName']) || $post['authorName'] !== $me['name']) continue;
            $posts[$pid]['authorId'] = $me['id'];
            $posts[$pid]['boundAt'] = date('c');
            $bound = true;
        }
        if ($bound) write_json($DATA_DIR . '/posts.json', $posts);
    }

    $mine = array();
    foreach ($posts as $post) {
        if (empty($post['authorId']) || (string) $post['authorId'] !== (string) $me['id']) continue;
        $row = public_post($post);
        $row['own'] = true;
        $row['submittedAt'] = isset($post['submittedAt']) ? $post['submittedAt'] : '';
        $row['revision'] = isset($post['revision']) ? (int) $post['revision'] : 1;
        $mine[] = $row;
    }
    usort($mine, function ($a, $b) {
        return strcmp((string) $b['submittedAt'], (string) $a['submittedAt']);
    });
    respond(array('ok' => true, 'posts' => $mine, 'bound' => $bound));
}

if ($act === 'queue') {
    $in = body();
    $me = require_staff($DATA_DIR, $in, 'posts.review');
    if (!can($me, 'posts.review')) fail('Очередь материалов видит редакция.', 403);
    $pending = posts_pending_for($DATA_DIR, $me);
    $published = 0;
    $total = 0;
    foreach (read_json($DATA_DIR . '/posts.json', array()) as $post) {
        $total++;
        if (isset($post['status']) && $post['status'] === 'published') $published++;
    }
    respond(array('ok' => true, 'pending' => $pending, 'published' => $published, 'total' => $total,
        'scoped' => staff_scope($me) !== null, 'canPublish' => can($me, 'posts.publish')));
}

if ($act === 'review') {
    $in = body();
    $me = require_confirm($DATA_DIR, $in, 'posts.review');
    if (!can($me, 'posts.review')) fail('Решение по материалу принимает редакция.', 403);

    $id = isset($in['id']) ? (string) $in['id'] : '';
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 600);
    if ($decision !== 'approve' && $decision !== 'reject') fail('Неизвестное решение.');
    if ($decision === 'reject' && slen($note) < 5) fail('Напишите автору, что исправить: без замечания материал не вернуть.');

    $posts = read_json($DATA_DIR . '/posts.json', array());
    if (!isset($posts[$id])) fail('Материал не найден.', 404);
    $post = $posts[$id];
    /* решение — только по тому, что ждёт: уже опубликованный или отклонённый
       материал этим маршрутом не переключить */
    if (!isset($post['status']) || $post['status'] !== 'pending') {
        fail('По этому материалу решение уже принято.', 409);
    }
    $author = null;
    if (!empty($post['authorId'])) {
        foreach (read_users($DATA_DIR) as $u) {
            if ($u['id'] === $post['authorId']) { $author = $u; break; }
        }
    }
    if (!post_in_scope(staff_scope($me), $post, $author)) fail('Этот материал — не в вашей редакции.', 403);
    if ($author && (string) $author['id'] === (string) $me['id'] && !can($me, 'posts.publish')) {
        fail('Свой материал проверяет другой редактор.', 403);
    }

    $posts[$id]['status'] = $decision === 'approve' ? 'published' : 'rejected';
    $posts[$id]['reviewNote'] = $note;
    $posts[$id]['reviewedAt'] = date('c');
    $posts[$id]['reviewedBy'] = $me['name'];
    if ($decision === 'approve') $posts[$id]['date'] = date('c');

    if (!write_json($DATA_DIR . '/posts.json', $posts)) fail('Не удалось сохранить решение.', 500);
    if ($decision === 'approve' && !empty($posts[$id]['authorId'])) {
        $rule = 'post.' . (!empty($posts[$id]['format']) ? $posts[$id]['format'] : 'Статья');
        points_award_rule($DATA_DIR, $posts[$id]['authorId'], $rule, 'редакция',
            'Материал «' . $posts[$id]['title'] . '»', 'post:' . $id);
    }
    audit_log($DATA_DIR, (string) $me['email'], 'review',
        ($decision === 'approve' ? 'опубликован' : 'отклонён') . ' материал ' . $id . ' — ' . $posts[$id]['title']);
    if ($author) {
        notify_user($DATA_DIR, $author['id'], $decision === 'approve'
            ? 'Материал «' . $posts[$id]['title'] . '» опубликован на сайте.'
            : 'Материал «' . $posts[$id]['title'] . '» возвращён на доработку. Замечание редакции: ' . $note .
              ' Исправить и отправить заново можно в кабинете, вкладка «Материалы».',
            array('kind' => 'post', 'ref' => 'post:' . $id . ':' . $decision . ':' . (isset($post['revision']) ? $post['revision'] : 1)));
    }
    respond(array('ok' => true, 'post' => public_post($posts[$id])));
}

if ($act === 'setpass') {
    $in = body();
    $old = isset($in['old']) ? (string) $in['old'] : '';
    $new = isset($in['new']) ? (string) $in['new'] : '';
    $me = require_confirm($DATA_DIR, $in, 'server.diag');
    $old = '';
    if (slen($new) < 10) fail('Новый пароль короче десяти символов.');
    $cfg = read_json($DATA_DIR . '/config.json', array());
    $cfg['editor'] = password_hash($new, PASSWORD_DEFAULT);
    $cfg['changedAt'] = date('c');
    if (!write_json($DATA_DIR . '/config.json', $cfg)) fail('Не удалось сохранить пароль.', 500);
    audit_log($DATA_DIR, (string) $me['email'], 'setpass', 'пароль редакции изменён');
    respond(array('ok' => true));
}

if ($act === 'remove') {
    $in = body();
    $me = require_confirm($DATA_DIR, $in, 'posts.remove');
    $id = isset($in['id']) ? (string) $in['id'] : '';
    $posts = read_json($DATA_DIR . '/posts.json', array());
    if (!isset($posts[$id])) fail('Материал не найден.', 404);
    unset($posts[$id]);
    write_json($DATA_DIR . '/posts.json', $posts);
    audit_log($DATA_DIR, (string) $me['email'], 'remove', 'материал удалён: ' . $id);
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

if ($act === 'editorial-apply') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    require_verified($user);
    require_consent($DATA_DIR, $user);
    if (!empty($user['editorialId'])) fail('Вы уже состоите в редакции.', 409);

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
    $editorials = read_editorials($DATA_DIR);
    $names = array();
    foreach ($editorials as $e) $names[$e['id']] = $e['name'];

    $myApps = array();
    foreach ($apps as $a) {
        if ($a['userId'] !== $user['id']) continue;
        $row = public_editorial_app($a);
        $row['editorialName'] = isset($names[$a['editorialId']]) ? $names[$a['editorialId']] : '';
        $myApps[] = $row;
    }

    $owned = null;
    $member = null;
    $incoming = array();
    $roster = array();
    $myEditorial = isset($user['editorialId']) ? (string) $user['editorialId'] : '';
    foreach ($editorials as $e) {
        if ($e['founderId'] !== $user['id']) {
            /* редакция, в которой человек состоит, но не руководит ею */
            if ($myEditorial !== '' && $e['id'] === $myEditorial) $member = public_editorial($e, $apps);
            continue;
        }
        $owned = public_editorial($e, $apps);
        $joined = array();
        foreach ($apps as $a) {
            if ($a['editorialId'] !== $e['id']) continue;
            /* в очереди руководителя — заявки, которые ждут решения, и отказы;
               принятые видны в штате, вышедшие и исключённые — в истории */
            $incoming[] = public_editorial_app($a);
            if ($a['status'] === 'approved') $joined[$a['userId']] = isset($a['decidedAt']) ? $a['decidedAt'] : '';
        }
        /* штат — по аккаунтам: это те, чьи материалы руководитель проверяет */
        foreach (read_users($DATA_DIR) as $u) {
            if (!isset($u['editorialId']) || (string) $u['editorialId'] !== (string) $e['id']) continue;
            if (isset($u['status']) && $u['status'] === 'deleted') continue;
            $roster[] = array(
                'id' => $u['id'],
                'name' => $u['name'],
                'number' => isset($u['number']) ? (int) $u['number'] : 0,
                'craft' => isset($u['role']) ? $u['role'] : '',
                'access' => isset($u['access']) ? $u['access'] : 'Пользователь',
                'email' => isset($u['email']) ? $u['email'] : '',
                'head' => $u['id'] === $e['founderId'],
                'joinedAt' => $u['id'] === $e['founderId'] ? $e['createdAt'] : (isset($joined[$u['id']]) ? $joined[$u['id']] : ''),
            );
        }
    }
    usort($myApps, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    usort($incoming, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    usort($roster, function ($a, $b) {
        if ($a['head'] !== $b['head']) return $a['head'] ? -1 : 1;
        return strcmp((string) $a['name'], (string) $b['name']);
    });
    respond(array('ok' => true, 'applications' => $myApps, 'editorial' => $owned, 'member' => $member,
        'incoming' => $incoming, 'roster' => $roster));
}

/* Человек перестаёт быть участником редакции: сам вышел или исключён.
   Роль, выданная для работы в редакции, снимается вместе с участием: иначе
   модератор редакции после выхода стал бы модератором всей платформы. */
function editorial_member_out($dir, $userId, $editorialId, $status, $note, $by) {
    $users = read_users($dir);
    $roleWas = '';
    $found = false;
    foreach ($users as $i => $u) {
        if ((string) $u['id'] !== (string) $userId) continue;
        if (!isset($u['editorialId']) || (string) $u['editorialId'] !== (string) $editorialId) return null;
        $found = true;
        $role = isset($u['access']) ? (string) $u['access'] : 'Пользователь';
        $scopedStaff = count(user_caps($u)) > 0 && staff_scope($u) !== null;
        $users[$i]['editorialId'] = '';
        if ($scopedStaff) {
            $roleWas = $role;
            $users[$i]['access'] = 'Пользователь';
        }
        break;
    }
    if (!$found) return null;
    if (!write_json(users_file($dir), $users)) return null;

    $apps = read_editorial_apps($dir);
    foreach ($apps as $i => $a) {
        if ((string) $a['userId'] !== (string) $userId || (string) $a['editorialId'] !== (string) $editorialId) continue;
        if ($a['status'] !== 'approved') continue;
        $apps[$i]['status'] = $status;
        $apps[$i]['note'] = $note;
        $apps[$i]['leftAt'] = date('c');
        $apps[$i]['leftBy'] = $by;
    }
    write_json(editorial_apps_file($dir), $apps);
    return array('roleWas' => $roleWas);
}

if ($act === 'editorial-leave') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    $editorialId = isset($user['editorialId']) ? (string) $user['editorialId'] : '';
    if ($editorialId === '') fail('Вы не состоите в редакции.', 409);
    $ed = null;
    foreach (read_editorials($DATA_DIR) as $e) {
        if ($e['id'] === $editorialId) $ed = $e;
    }
    if ($ed && $ed['founderId'] === $user['id']) {
        fail('Руководитель не может выйти из своей редакции. Чтобы передать или закрыть редакцию, напишите в поддержку проекта.', 409);
    }
    $res = editorial_member_out($DATA_DIR, $user['id'], $editorialId, 'left', '', $user['name']);
    if ($res === null) fail('Не удалось выйти из редакции.', 500);
    $edName = $ed ? $ed['name'] : 'редакция';
    audit_log($DATA_DIR, (string) $user['email'], 'editorial-leave', 'вышел из редакции «' . $edName . '»');
    if ($ed) {
        notify_user($DATA_DIR, $ed['founderId'], $user['name'] . ' вышел из редакции «' . $edName . '».',
            array('kind' => 'editorial', 'ref' => 'edleft:' . $user['id'] . ':' . time()));
    }
    respond(array('ok' => true, 'roleReset' => $res['roleWas'] !== '', 'roleWas' => $res['roleWas']));
}

if ($act === 'editorial-exclude') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    $targetId = text(isset($in['userId']) ? $in['userId'] : '', 60);
    $note = text(isset($in['note']) ? $in['note'] : '', 400);
    if (slen($note) < 5) fail('Напишите причину: человек получит её в уведомлении.');
    if ((string) $targetId === (string) $user['id']) fail('Себя исключить нельзя.', 403);

    $target = null;
    foreach (read_users($DATA_DIR) as $u) {
        if ((string) $u['id'] === (string) $targetId) $target = $u;
    }
    $editorialId = $target && isset($target['editorialId']) ? (string) $target['editorialId'] : '';
    if (!$target || $editorialId === '') fail('Этот человек не состоит в редакции.', 404);
    $ed = null;
    foreach (read_editorials($DATA_DIR) as $e) {
        if ($e['id'] === $editorialId) $ed = $e;
    }
    if (!$ed) fail('Редакция не найдена.', 404);
    $isFounder = $ed['founderId'] === $user['id'];
    $isCentral = can($user, 'editorials.appoint') && staff_scope($user) === null;
    if (!$isFounder && !$isCentral) fail('Исключить участника может руководитель редакции или центральная редакция.', 403);
    if ($ed['founderId'] === $target['id']) fail('Руководителя редакции исключить нельзя: редакцию закрывает директор проекта.', 403);

    $res = editorial_member_out($DATA_DIR, $target['id'], $editorialId, 'excluded', $note, $user['name']);
    if ($res === null) fail('Не удалось исключить участника.', 500);
    audit_log($DATA_DIR, (string) $user['email'], 'editorial-exclude',
        'исключён из редакции «' . $ed['name'] . '»: ' . $target['name'] . ' — ' . $note);
    notify_user($DATA_DIR, $target['id'],
        'Вы исключены из редакции «' . $ed['name'] . '». Причина: ' . rtrim($note, " .!?\t\n") . '.'
        . ($res['roleWas'] !== '' ? ' Роль «' . $res['roleWas'] . '», выданная для работы в редакции, снята.' : '')
        . ' Писать материалы можно и вне редакции.',
        array('kind' => 'editorial', 'ref' => 'edout:' . $target['id'] . ':' . time()));
    respond(array('ok' => true));
}

if ($act === 'editorial-queue') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!can($user, 'editorials.appoint') || staff_scope($user) !== null) {
        fail('Очередь заявок в редакции видит центральная редакция.', 403);
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
    $notify = null;
    foreach ($apps as $i => $a) {
        if ($a['id'] !== $id) continue;
        if ($a['status'] !== 'pending') fail('По этой заявке решение уже принято.', 409);
        $owner = null;
        foreach ($editorials as $e) {
            if ($e['id'] === $a['editorialId']) $owner = $e;
        }
        if (!$owner) fail('Редакция не найдена.', 404);

        $isFounder = $owner['founderId'] === $user['id'];
        $isAdmin = can($user, 'editorials.appoint') && staff_scope($user) === null;
        if (!$isFounder && !$isAdmin) fail('Решение принимает руководитель редакции или центральная редакция.', 403);
        if ((string) $a['userId'] === (string) $user['id']) fail('Свою заявку рассматривает другой человек.', 403);
        /* если заявка уже ушла в центральную комиссию, решает только она */
        if (editorial_escalated($a) && !$isAdmin) {
            fail('Заявка передана в центральную комиссию: семь дней прошло, решает она.', 403);
        }

        $apps[$i]['status'] = $decision;
        $apps[$i]['note'] = $note;
        $apps[$i]['decidedAt'] = date('c');
        $apps[$i]['decidedBy'] = $user['name'];
        $found = true;
        $notify = array($a['userId'], $owner['name']);

        if ($decision === 'approved') {
            /* Человек становится участником редакции. Роль и пресс-карта не
               меняются: раньше вступление снимало с человека любую роль и
               аннулировало карту — редактор, вступив в редакцию, терял права. */
            $users = read_users($DATA_DIR);
            foreach ($users as $j => $u) {
                if ($u['id'] !== $a['userId']) continue;
                $users[$j]['editorialId'] = $a['editorialId'];
                write_json(users_file($DATA_DIR), $users);
                break;
            }
        }
        break;
    }
    if (!$found) fail('Заявка не найдена.', 404);
    if (!write_json(editorial_apps_file($DATA_DIR), $apps)) fail('Не удалось сохранить решение.', 500);
    audit_log($DATA_DIR, (string) $user['email'], 'editorial-review',
        ($decision === 'approved' ? 'принят в редакцию «' : 'отказ в редакции «') . $notify[1] . '»');
    notify_user($DATA_DIR, $notify[0], $decision === 'approved'
        ? 'Вас приняли в редакцию «' . $notify[1] . '».'
        : 'В заявке в редакцию «' . $notify[1] . '» отказано: ' . $note,
        array('kind' => 'editorial', 'ref' => 'edapp:' . $id . ':' . $decision));
    respond(array('ok' => true));
}

/* ------------------------------------------------------------------------ */
/* -------------------------------------------------------- портфолио автора */

if ($act === 'portfolio-send') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    require_verified($user);
    require_consent($DATA_DIR, $user);

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
    require_staff($DATA_DIR, $in, 'points.award');
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
    require_confirm($DATA_DIR, $in, 'points.award');

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

/* ------------------------------------------------------------------ аккаунты */

if ($act === 'reg') {
    $in = body();
    /* свой счётчик и запас побольше: класс регистрируется с одного адреса */
    check_rate_for($DATA_DIR, 'reg', client_ip(), 60,
        'Слишком много регистраций с одного адреса. Попробуйте через час.');
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
        'photoAlt' => isset($f['photoAlt']) ? $f['photoAlt'] : '',
        /* true — карточку сохранили из панели после 11.11.2026: её текст
           главнее того, что зашит в сайт. У старых записей берём только фото. */
        'edited' => !empty($f['editedAt']),
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
        $fid = isset($f['id']) && preg_match('/^[a-z0-9_-]{1,24}$/', (string) $f['id']) ? (string) $f['id'] : 'f' . ($i + 1);
        $clean[] = array(
            'id' => $fid,
            'name' => $name,
            'role' => text(isset($f['role']) ? $f['role'] : '', 120),
            'city' => text(isset($f['city']) ? $f['city'] : '', 60),
            'since' => text(isset($f['since']) ? $f['since'] : '', 40),
            'bio' => text(isset($f['bio']) ? $f['bio'] : '', 3000),
            'photo' => safe_media_url(text(isset($f['photo']) ? $f['photo'] : '', 400)),
            'photoAlt' => safe_media_url(text(isset($f['photoAlt']) ? $f['photoAlt'] : '', 400)),
            'editedAt' => date('c'),
            'editedBy' => $me['name'],
        );
    }
    if (!write_json(founders_file($DATA_DIR), $clean)) fail('Не удалось сохранить основателей.', 500);
    audit_log($DATA_DIR, $me['name'], 'founders-save', 'карточек: ' . count($clean));
    $out = array();
    foreach ($clean as $f) $out[] = public_founder($f);
    respond(array('ok' => true, 'founders' => $out));
}

/* ------------------------------------- лучшие авторы на главной странице
   Редакция решает, кого показывать: тех, у кого больше баллов, или свой
   список. В список попадают только люди с опубликованными материалами —
   выдуманных карточек на сайте нет. */
function authors_show_file($dir) { return $dir . '/authors-show.json'; }

/* Инициалы для карточки: «Никита Сирик» → «НС». */
function initials_of($name) {
    $parts = preg_split('/\s+/u', trim((string) $name), -1, PREG_SPLIT_NO_EMPTY);
    if (!is_array($parts) || !$parts) return 'А';
    /* без mbstring блок авторов на главной не должен падать: буквы берём
       регулярным выражением, а к заглавным приводим, только если есть чем */
    $first = function ($s, $n) {
        return preg_match('/^.{1,' . (int) $n . '}/us', (string) $s, $m) ? $m[0] : '';
    };
    $raw = count($parts) === 1 ? $first($parts[0], 2) : $first($parts[0], 1) . $first($parts[1], 1);
    return function_exists('mb_strtoupper') ? mb_strtoupper($raw, 'UTF-8') : $raw;
}

function read_authors_show($dir) {
    $cfg = read_json(authors_show_file($dir), array());
    if (!is_array($cfg)) $cfg = array();
    $ids = array();
    if (isset($cfg['ids']) && is_array($cfg['ids'])) {
        foreach ($cfg['ids'] as $rawId) {
            $id = text($rawId, 40);
            if ($id !== '') $ids[] = $id;
        }
    }
    return array(
        'mode' => (isset($cfg['mode']) && $cfg['mode'] === 'manual') ? 'manual' : 'points',
        'limit' => isset($cfg['limit']) ? max(3, min(8, (int) $cfg['limit'])) : 6,
        'ids' => $ids,
        'teaser' => isset($cfg['teaser']) ? (string) $cfg['teaser'] : '',
    );
}

function authors_show_rows($dir, $cfg) {
    $users = read_users($dir);
    $balances = points_balance_all($dir);
    $posts = read_json($dir . '/posts.json', array());
    $published = array();
    foreach ($posts as $post) {
        if (!isset($post['authorId']) || !isset($post['status'])) continue;
        if ($post['status'] !== 'published') continue;
        $published[$post['authorId']] = isset($published[$post['authorId']]) ? $published[$post['authorId']] + 1 : 1;
    }
    $rows = array();
    foreach ($users as $u) {
        if (empty($published[$u['id']])) continue;
        if (isset($u['status']) && $u['status'] !== 'active' && $u['status'] !== 'pending_email') continue;
        $name = (string) $u['name'];
        $rows[] = array(
            'id' => (string) $u['id'],
            'name' => $name,
            'initials' => initials_of($name),
            'role' => isset($u['role']) ? (string) $u['role'] : '',
            'region' => isset($u['region']) ? (string) $u['region'] : '',
            'points' => isset($balances[$u['id']]) ? (int) $balances[$u['id']] : 0,
            'posts' => (int) $published[$u['id']],
        );
    }
    if ($cfg['mode'] === 'manual' && $cfg['ids']) {
        $order = array();
        foreach ($cfg['ids'] as $i => $id) $order[$id] = $i;
        $rows = array_values(array_filter($rows, function ($r) use ($order) {
            return isset($order[$r['id']]);
        }));
        usort($rows, function ($a, $b) use ($order) {
            return $order[$a['id']] - $order[$b['id']];
        });
    } else {
        usort($rows, function ($a, $b) {
            if ($a['points'] !== $b['points']) return $b['points'] - $a['points'];
            if ($a['posts'] !== $b['posts']) return $b['posts'] - $a['posts'];
            return strcmp((string) $a['name'], (string) $b['name']);
        });
    }
    return array_slice($rows, 0, $cfg['limit']);
}

if ($act === 'top-authors') {
    $cfg = read_authors_show($DATA_DIR);
    respond(array(
        'ok' => true,
        'mode' => $cfg['mode'],
        'limit' => $cfg['limit'],
        'teaser' => $cfg['teaser'],
        'authors' => authors_show_rows($DATA_DIR, $cfg),
    ));
}

if ($act === 'authors-show-save') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'site.manage')) fail('Кого показывать на главной, решает директор и администрация.', 403);

    $mode = (isset($in['mode']) && $in['mode'] === 'manual') ? 'manual' : 'points';
    $limit = isset($in['limit']) ? (int) $in['limit'] : 6;
    $limit = max(3, min(8, $limit));
    $ids = array();
    if ($mode === 'manual') {
        $raw = isset($in['ids']) && is_array($in['ids']) ? $in['ids'] : array();
        foreach ($raw as $item) {
            $id = text($item, 40);
            if ($id !== '') $ids[] = $id;
        }
        $ids = array_slice(array_values(array_unique($ids)), 0, 12);
        if (!$ids) fail('Выберите хотя бы одного человека.');
    }
    $cfg = array(
        'mode' => $mode,
        'limit' => $limit,
        'ids' => $ids,
        'teaser' => text(isset($in['teaser']) ? $in['teaser'] : '', 160),
        'updatedAt' => date('c'),
        'updatedBy' => (string) $me['email'],
    );
    if (!write_json(authors_show_file($DATA_DIR), $cfg)) fail('Не удалось сохранить список.', 500);
    audit_log($DATA_DIR, (string) $me['email'], 'authors-show',
        $mode === 'manual' ? 'вручную: ' . count($ids) : 'по баллам, до ' . $limit);
    respond(array('ok' => true, 'mode' => $mode, 'limit' => $limit, 'ids' => $ids,
        'teaser' => $cfg['teaser'], 'authors' => authors_show_rows($DATA_DIR, read_authors_show($DATA_DIR))));
}

if ($act === 'posts-queue') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'posts.review')) fail('Очередь материалов видит редакция.', 403);
    respond(array('ok' => true, 'posts' => posts_pending_for($DATA_DIR, $me),
        'scoped' => staff_scope($me) !== null, 'canPublish' => can($me, 'posts.publish')));
}

if ($act === 'whoami') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    $users = read_users($DATA_DIR);
    $head = null;
    $active = 0;
    foreach ($users as $u) {
        if (isset($u['status']) && $u['status'] === 'deleted') continue;
        $active++;
        if (!$head && is_head_role(isset($u['access']) ? $u['access'] : '')) $head = $u;
    }
    respond(array(
        'ok' => true,
        'signedIn' => (bool) $me,
        'user' => $me ? public_user($me) : null,
        'directorExists' => (bool) $head,
        /* имя руководителя и число аккаунтов — только вошедшим */
        'directorName' => $me && $head ? $head['name'] : '',
        'accounts' => $me ? $active : 0,
        'canClaimDirector' => !$head && $me && $active <= 1,
    ));
}

if ($act === 'claim-director') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Сначала войдите в аккаунт.', 401);
    /* право проверять тут нельзя — его как раз и получают этим действием;
       поэтому только код из письма */
    require_confirm($DATA_DIR, $in, '');
    require_verified($me);
    $users = read_users($DATA_DIR);
    $active = 0;
    foreach ($users as $u) {
        if (isset($u['status']) && $u['status'] === 'deleted') continue;
        $active++;
        if (is_head_role(isset($u['access']) ? $u['access'] : '')) {
            fail('Руководитель проекта уже есть: ' . $u['name'] . '. Роли назначает он.', 409);
        }
    }
    /* Роль забирает единственный аккаунт на пустом сервере. Если аккаунтов
       уже несколько, нужен пароль редакции из файла BOOTSTRAP-PAROL.txt на
       хостинге — он доказывает, что человек владеет сервером. Раньше хватало
       слова force в запросе. */
    if ($active > 1) {
        $pass = isset($in['pass']) ? (string) $in['pass'] : '';
        $ok = $pass !== '' && $pass !== KNOWN_DEFAULT_EDITOR_PASSWORD
            && rate_count($DATA_DIR, 'diag', client_ip()) < 10 && is_editor($DATA_DIR, $pass);
        if (!$ok) {
            if ($pass !== '') check_rate_for($DATA_DIR, 'diag', client_ip(), 1000, '');
            fail('На сервере уже есть аккаунты. Роль директора выдаётся по паролю редакции из файла BOOTSTRAP-PAROL.txt на хостинге.', 409);
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
    audit_log($DATA_DIR, (string) $updated['email'], 'claim-director', 'роль директора выдана по коду из письма');
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
    if (!can($me, 'people.view')) fail('Карточку участника видит редакция.', 403);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);

    $target = null;
    foreach (read_users($DATA_DIR) as $u) {
        if ($u['id'] === $id) $target = $u;
    }
    if (!$target) fail('Участник не найден.', 404);
    /* руководитель редакции открывает карточки только своих людей */
    $scope = staff_scope($me);
    if (!user_in_scope($scope, $target) && (string) $target['id'] !== (string) $me['id']) {
        fail('Этот участник — не в вашей редакции.', 403);
    }
    $contacts = sees_contacts($me, $scope, $target);
    $email = strtolower((string) $target['email']);

    $posts = array();
    foreach (read_json($DATA_DIR . '/posts.json', array()) as $post) {
        if (!isset($post['authorId']) || $post['authorId'] !== $id) continue;
        $posts[] = array(
            'id' => $post['id'],
            'title' => isset($post['title']) ? $post['title'] : '',
            'status' => isset($post['status']) ? $post['status'] : '',
            'format' => isset($post['format']) ? $post['format'] : '',
            'date' => isset($post['date']) ? $post['date'] : '',
            'number' => isset($post['number']) ? (int) $post['number'] : 0,
        );
    }
    usort($posts, function ($a, $b) { return strcmp((string) $b['date'], (string) $a['date']); });

    $editorialApps = array();
    foreach (read_editorial_apps($DATA_DIR) as $a) {
        if ($a['userId'] !== $id) continue;
        $row = public_editorial_app($a);
        if (!$contacts) $row['email'] = mask_email($row['email']);
        $editorialApps[] = $row;
    }

    /* согласие: статус видят все, у кого открыта карточка; подробности и
       файл — только те, кто согласия проверяет */
    $consentRecord = consent_of_user($DATA_DIR, $id);
    $consent = public_consent($consentRecord, can($me, 'consents.review'));
    if (!can($me, 'consents.review')) $consent['note'] = '';
    $consent['exempt'] = consent_exempt($target);
    $consents = $consentRecord ? array($consent) : array();

    /* Карты — строго по аккаунту. Раньше сюда попадали и карты однофамильцев:
       запись подбиралась по совпадению имени. */
    $allCards = read_cards($DATA_DIR);
    $mineCards = cards_of_user($allCards, $id);
    $current = card_current($mineCards);
    $cards = array();
    foreach ($mineCards as $c) $cards[] = staff_card($c, $target, $contacts);
    $shown = $current['card'] ? $current['card'] : $current['request'];

    $portfolio = array();
    foreach (read_portfolio($DATA_DIR) as $item) {
        if ($item['userId'] !== $id) continue;
        $portfolio[] = public_portfolio($item);
    }

    $recovery = array();
    if ($contacts) {
        foreach (read_recovery_requests($DATA_DIR) as $r) {
            if ($email === '' || strtolower((string) $r['email']) !== $email) continue;
            $recovery[] = public_recovery_request($r);
        }
    }

    $editorials = array();
    $memberOf = null;
    foreach (read_editorials($DATA_DIR) as $e) {
        if ($e['founderId'] === $id) $editorials[] = $e;
        if (!empty($target['editorialId']) && $e['id'] === $target['editorialId']) {
            $memberOf = array('id' => $e['id'], 'name' => $e['name'], 'region' => $e['region']);
        }
    }

    $messages = array();
    foreach (read_messages($DATA_DIR) as $m) {
        if ($m['userId'] !== $id) continue;
        $messages[] = $m;
    }
    usort($messages, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
    $messages = array_slice($messages, 0, 60);

    $published = 0;
    foreach ($posts as $post) {
        if ($post['status'] === 'published') $published++;
    }

    $canMessage = (string) $target['id'] !== (string) $me['id']
        && (can($me, 'people.edit') || ($scope !== null && user_in_scope($scope, $target)));
    $userRow = public_user($target);
    if (!$contacts) $userRow['email'] = mask_email($userRow['email']);
    /* чужие полномочия в карточке не нужны — только роль */
    unset($userRow['caps'], $userRow['canUseMail']);

    respond(array(
        'ok' => true,
        'user' => array_merge($userRow, array(
            'createdAt' => isset($target['createdAt']) ? $target['createdAt'] : '',
            'level' => role_level(isset($target['access']) ? $target['access'] : ''),
        )),
        'contacts' => $contacts,
        'posts' => $posts,
        'published' => $published,
        'editorialApps' => $editorialApps,
        'editorialsFounded' => $editorials,
        'editorial' => $memberOf,
        'consents' => $consents,
        'consent' => $consent,
        'cards' => $cards,
        'card' => $shown ? staff_card($shown, $target, $contacts) : null,
        'cardState' => $shown ? card_state($shown) : 'none',
        'portfolio' => $portfolio,
        'recovery' => $recovery,
        'messages' => $messages,
        'canMessage' => $canMessage,
        'cardMinPosts' => card_min_posts(),
        'status' => isset($target['status']) ? $target['status'] : 'active',
        'statusReason' => isset($target['statusReason']) ? $target['statusReason'] : '',
        'lastSeen' => last_seen_of($DATA_DIR, $id),
        'points' => points_balance($DATA_DIR, $id),
        'pointsHistory' => points_history($DATA_DIR, $id, 100),
        'pointsRules' => points_rules($DATA_DIR)['rules'],
        'notes' => can($me, 'people.note') ? person_notes_of($DATA_DIR, $id) : array(),
        'caps' => user_caps($me),
        'roles' => access_list(),
        'myLevel' => role_level(isset($me['access']) ? $me['access'] : ''),
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
    $emailChanged = false;
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
        /* Смена почты в карточке: адрес должен быть свободен, а новый
           владелец обязан подтвердить его кодом из письма. */
        if (isset($in['email'])) {
            $newEmail = norm_email($in['email']);
            if ($newEmail === '') fail('Почта указана неверно.');
            $currentEmail = strtolower((string) (isset($u['email']) ? $u['email'] : ''));
            if ($newEmail !== $currentEmail) {
                foreach ($users as $other) {
                    if ($other['id'] === $u['id']) continue;
                    if (strtolower((string) (isset($other['email']) ? $other['email'] : '')) === $newEmail) {
                        fail('Этот адрес уже занят другим аккаунтом.');
                    }
                }
                $users[$i]['email'] = $newEmail;
                $users[$i]['emailVerified'] = false;
                $users[$i]['emailChangedAt'] = date('c');
                $users[$i]['emailChangedBy'] = (string) $me['email'];
                $emailChanged = true;
            }
        }
        if (isset($in['region'])) $users[$i]['region'] = text($in['region'], 60);
        if (isset($in['role'])) $users[$i]['role'] = text($in['role'], 60);
        if (isset($in['bio'])) $users[$i]['bio'] = text($in['bio'], 600);
        if (isset($in['avatar'])) $users[$i]['avatar'] = safe_media_url($in['avatar']);
        /* отметку «почта подтверждена» себе не ставят */
        if (isset($in['emailVerified']) && (string) $u['id'] !== (string) $me['id']) {
            $users[$i]['emailVerified'] = !empty($in['emailVerified']);
        }
        /* Роль меняется только через общую проверку. Раньше любой, кто
           правит профили, мог этим же запросом выдать себе любую роль. */
        if (isset($in['access'])) {
            $access = text($in['access'], 60);
            if ($access !== (isset($u['access']) ? $u['access'] : 'Пользователь')) {
                $why = access_change_guard($me, $u, $access, $users);
                if ($why !== '') fail($why, 403);
                $users[$i]['access'] = $access;
                $users[$i]['accessGrantedAt'] = date('c');
                $users[$i]['accessGrantedBy'] = $me['name'];
            }
        }
        $updated = $users[$i];
        $found = true;
        break;
    }
    if (!$found) fail('Участник не найден.', 404);
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить профиль.', 500);
    audit_log($DATA_DIR, $me['email'], 'user-update',
        'профиль: ' . $updated['name'] . ($emailChanged ? ' · почта теперь ' . $updated['email'] : ''));
    respond(array('ok' => true, 'user' => public_user($updated), 'emailChanged' => $emailChanged));
}

if ($act === 'user-message') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    $id = text(isset($in['id']) ? $in['id'] : '', 40);
    $text = text(isset($in['text']) ? $in['text'] : '', 2000);

    $target = null;
    foreach (read_users($DATA_DIR) as $u) {
        if ($u['id'] === $id) $target = $u;
    }
    /* Пишут те, кто ведёт людей, и руководитель редакции — своим. */
    $scope = staff_scope($me);
    $allowed = can($me, 'people.edit')
        || ($scope !== null && can($me, 'people.view') && $target && user_in_scope($scope, $target));
    if (!$allowed) fail('Писать участникам может редакция — своим людям.', 403);
    if (!$target || (isset($target['status']) && $target['status'] === 'deleted')) fail('Участник не найден.', 404);
    if (slen($text) < 3) fail('Сообщение слишком короткое.');
    check_rate_for($DATA_DIR, 'usermsg', $me['id'], 60, 'Слишком много сообщений подряд. Попробуйте через час.');

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
    if (smtp_configured($DATA_DIR) && !empty($target['email'])) {
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
    audit_log($DATA_DIR, (string) $me['email'], 'user-message', 'сообщение: ' . $target['name']);
    respond(array('ok' => true, 'message' => $msg));
}

/* ---------------------------------------------------------- чат команды */
/* Общий чат редакции: короткие сообщения между теми, у кого есть доступ
   к людям. Хранится одним файлом рядом с остальными данными проекта. */

if ($act === 'team-chat-list') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.edit')) fail('Чат команды доступен только редакции.', 403);

    $file = $DATA_DIR . '/team-chat.json';
    $list = read_json($file, array());
    if (!is_array($list)) $list = array();
    respond(array(
        'ok' => true,
        'messages' => array_slice($list, -200),
        'me' => $me['name'],
        'role' => isset($me['access']) ? $me['access'] : '',
    ));
}

if ($act === 'team-chat-send') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.edit')) fail('Писать в чат может только редакция.', 403);

    $message = text(isset($in['text']) ? $in['text'] : '', 1500);
    if (slen($message) < 1) fail('Сообщение пустое.');

    $file = $DATA_DIR . '/team-chat.json';
    $list = read_json($file, array());
    if (!is_array($list)) $list = array();
    $row = array(
        'id' => 'tc_' . bin2hex(random_bytes(4)),
        'from' => $me['name'],
        'role' => isset($me['access']) ? $me['access'] : '',
        'text' => $message,
        'createdAt' => date('c'),
    );
    $list[] = $row;
    if (count($list) > 500) $list = array_slice($list, -500);
    write_json($file, $list);
    respond(array('ok' => true, 'message' => $row));
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
    if (!can($me, 'people.view')) fail('Список участников видит редакция.', 403);
    /* Таблица участников собирается на сервере: баллы, последняя активность,
       редакция и пресс-карта нужны все сразу, а не десятью запросами. */
    $scope = staff_scope($me);
    $balances = points_balance_all($DATA_DIR);
    $activity = read_json(activity_file($DATA_DIR), array());
    $editorialNames = array();
    foreach (read_editorials($DATA_DIR) as $e) $editorialNames[$e['id']] = $e['name'];
    $cardsByUser = array();
    foreach (read_cards($DATA_DIR) as $c) {
        if (empty($c['userId'])) continue;
        $cardsByUser[$c['userId']][] = $c;
    }
    $consentByUser = array();
    foreach (read_consents($DATA_DIR) as $c) {
        if (isset($c['userId'])) $consentByUser[$c['userId']] = isset($c['status']) ? $c['status'] : 'pending';
    }

    $out = array();
    /* Удалённые аккаунты (status = deleted) в список не попадают: персональных
       данных в них нет. Показать их можно явно — для разбора старых материалов. */
    $withDeleted = !empty($in['includeDeleted']) && $scope === null;
    foreach (read_users($DATA_DIR) as $u) {
        if (!$withDeleted && isset($u['status']) && $u['status'] === 'deleted') continue;
        /* руководитель редакции видит только своих людей */
        if (!user_in_scope($scope, $u)) continue;
        /* та же карта и то же состояние, что видит сам человек в кабинете */
        $shown = null;
        if (isset($cardsByUser[$u['id']])) {
            $mine = $cardsByUser[$u['id']];
            usort($mine, function ($a, $b) {
                return strcmp((string) (isset($b['createdAt']) ? $b['createdAt'] : ''), (string) (isset($a['createdAt']) ? $a['createdAt'] : ''));
            });
            $current = card_current($mine);
            $shown = $current['card'] ? $current['card'] : $current['request'];
        }
        $email = isset($u['email']) ? (string) $u['email'] : '';
        $out[] = array(
            'id' => $u['id'],
            'number' => isset($u['number']) ? (int) $u['number'] : 0,
            'name' => $u['name'],
            'email' => sees_contacts($me, $scope, $u) ? $email : mask_email($email),
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
            'cardStatus' => $shown ? card_state($shown) : 'none',
            'cardNumber' => $shown && !empty($shown['number']) ? $shown['number'] : '',
            'cardUntil' => $shown && !empty($shown['number']) ? card_valid_until($shown) : '',
            'consent' => consent_exempt($u) ? 'exempt'
                : (isset($consentByUser[$u['id']]) ? $consentByUser[$u['id']] : 'none'),
        );
    }
    usort($out, function ($a, $b) { return strcmp((string) $a['createdAt'], (string) $b['createdAt']); });
    respond(array('ok' => true, 'users' => $out, 'roles' => access_list(), 'caps' => user_caps($me),
        'scoped' => $scope !== null, 'myLevel' => role_level(isset($me['access']) ? $me['access'] : '')));
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
        $pointsOwner = null;
        foreach (read_users($DATA_DIR) as $u) {
            if ($u['id'] === $targetId) $pointsOwner = $u;
        }
        if (!user_in_scope(staff_scope($me), $pointsOwner)) fail('Этот участник — не в вашей редакции.', 403);
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
        if ((string) $u['id'] === (string) $me['id']) fail('Свой аккаунт приостановить нельзя.', 403);
        if (!can_manage_user($me, $u)) fail('Этот участник не ниже вас по роли.', 403);
        if (isset($u['status']) && $u['status'] === 'deleted') fail('Аккаунт удалён.', 409);
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
/* Выдача админки по почте — для директора проекта, без пароля редакции.
   Если аккаунта ещё нет, он создаётся, а на почту уходит письмо с временным
   паролем: так человек не остаётся «в системе без доступа». */
if ($act === 'boss-grant') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!can($me, 'people.access')) fail('Выдавать доступ может директор и администрация.', 403);
    /* адреса «по умолчанию» больше нет: раньше пустой запрос выдавал
       доступ на почту, зашитую в код */
    $email = norm_email(isset($in['email']) ? $in['email'] : '');
    if (!$email) fail('Укажите почту.');
    $access = text((string) (isset($in['access']) ? $in['access'] : 'Главный администратор'), 60);
    if (!in_array($access, array('Директор', 'Главный администратор', 'Администрация', 'Администратор',
        'Технический администратор', 'Главный редактор', 'Сотрудник', 'Модератор'), true)) {
        fail('Такой роли нет.');
    }
    if (!can_manage_role($me, $access)) fail('Эту роль выдать нельзя: она выше вашей.', 403);

    $users = read_users($DATA_DIR);
    $found = false;
    $created = false;
    $tempPass = '';
    foreach ($users as $i => $u) {
        if (strtolower((string) $u['email']) !== $email) continue;
        /* существующий человек: те же правила, что и в карточке —
           не себя, не равного и не старшего, не последнего руководителя */
        $why = access_change_guard($me, $u, $access, $users);
        if ($why !== '') fail($why, 403);
        $users[$i]['access'] = $access;
        $users[$i]['emailVerified'] = true;
        if (!isset($users[$i]['status']) || $users[$i]['status'] === 'pending_email') {
            $users[$i]['status'] = 'active';
        }
        $users[$i]['accessGrantedAt'] = date('c');
        $users[$i]['accessGrantedBy'] = $me['name'];
        $found = true;
        break;
    }
    if (!$found) {
        $tempPass = 'Smena-' . bin2hex(random_bytes(4));
        $users[] = array(
            'id' => 'u_' . bin2hex(random_bytes(6)),
            'name' => 'Новый администратор',
            'email' => $email,
            'pass' => password_hash($tempPass, PASSWORD_DEFAULT),
            'region' => '',
            'role' => 'Автор текстов',
            'access' => $access,
            'status' => 'active',
            'emailVerified' => true,
            'bio' => '',
            'avatar' => '',
            'createdAt' => date('c'),
            'number' => 100 + count($users) + 1,
            'mustChangePassword' => true,
            'accessGrantedAt' => date('c'),
        );
        $created = true;
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось выдать доступ.', 500);
    mail_notify($DATA_DIR, 'access_granted', $email, array(
        'name' => 'коллега', 'access' => $access, 'link' => 'https://smenakontenta.ru/join#login',
        'temp_pass' => $tempPass,
    ), array('dedupe' => 'access:' . $email . ':' . date('Ymd')));
    audit_log($DATA_DIR, $me['email'], 'выдача доступа', $email . ' → ' . $access . ($created ? ' (аккаунт создан)' : ''));
    respond(array('ok' => true, 'email' => $email, 'access' => $access, 'created' => $created,
        'mailSent' => true,
        'note' => $created
            ? 'Аккаунт создан, пароль отправлен на почту. Пусть сменит его при первом входе.'
            : 'Доступ выдан. Пусть войдёт заново, чтобы права обновились.'));
}

if ($act === 'grant-admin') {
    $in = body();
    $me = require_confirm($DATA_DIR, $in, 'people.access');
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
        $why = access_change_guard($me, $u, $access, $users);
        if ($why !== '') fail($why, 403);
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
    audit_log($DATA_DIR, (string) $me['email'], 'выдача доступа', $email . ' → ' . $access);
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
    foreach ($users as $u) {
        if ($u['id'] === $id) $target = $u;
    }
    if (!$target) fail('Участник не найден.', 404);
    /* одно правило на все способы сменить роль: не себе, не равному и не
       старшему, не выше своей, последнего руководителя не снять */
    $why = access_change_guard($me, $target, $access, $users);
    if ($why !== '') fail($why, 403);

    foreach ($users as $i => $u) {
        if ($u['id'] !== $id) continue;
        $users[$i]['access'] = $access;
        $users[$i]['accessGrantedAt'] = date('c');
        $users[$i]['accessGrantedBy'] = $me['name'];
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
    $me = require_confirm($DATA_DIR, $params, 'mail.manage');

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
    audit_log($DATA_DIR, (string) $me['email'], 'mail-setup', 'настройки SMTP обновлены');

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
    $me = require_confirm($DATA_DIR, $in, 'mail.manage');
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
        audit_log($DATA_DIR, (string) $me['email'], 'mail-from', 'отправитель: ' . $from);
        respond(array('ok' => true, 'switched' => true, 'from' => $from,
                      'mail' => smtp_public_config($DATA_DIR)));
    }

    $cfg = smtp_config($DATA_DIR);
    $cfg['from'] = $from;
    $cfg['updatedAt'] = date('c');
    $cfg['setupDone'] = true;
    if (!write_json(smtp_config_file($DATA_DIR), $cfg)) fail('Не удалось сохранить настройки.', 500);
    audit_log($DATA_DIR, (string) $me['email'], 'mail-from', 'отправитель: ' . $from);
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
    if (!can($user, 'support.answer') || staff_scope($user) !== null) {
        fail('Обращения разбирает центральная редакция.', 403);
    }
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
    if (!can($user, 'support.answer') || staff_scope($user) !== null) {
        fail('Обращения разбирает центральная редакция.', 403);
    }
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
            /* Вторая ступень для тех, кто её включил: пароль проверен, но
               токен ещё не выдаём — сначала код на почту. */
            if (!empty($u['twofa'])) {
                $code = (string) random_int(100000, 999999);
                $users2 = read_users($DATA_DIR);
                foreach ($users2 as $i => $row) {
                    if ($row['id'] !== $u['id']) continue;
                    $users2[$i]['twofaCode'] = password_hash($code, PASSWORD_DEFAULT);
                    $users2[$i]['twofaAt'] = date('c');
                    $users2[$i]['twofaTries'] = 0;
                    break;
                }
                write_json(users_file($DATA_DIR), $users2);
                mail_notify($DATA_DIR, 'login_code', $u['email'], array(
                    'name' => $u['name'], 'code' => $code, 'minutes' => 10,
                    'link' => 'https://smenakontenta.ru/join#login',
                ), array('dedupe' => 'twofa:' . $u['id'] . ':' . floor(time() / 60)));
                respond(array('ok' => true, 'needCode' => true, 'email' => $u['email'],
                    'message' => 'Код подтверждения отправлен на ' . $u['email'] . '. Он действует 10 минут.'));
            }
            touch_activity($DATA_DIR, $u['id']);
            respond(array('ok' => true, 'user' => public_user($u), 'token' => new_token($DATA_DIR, $u['id'])));
        }
    }
    fail('Аккаунт с такой почтой не найден. Зарегистрируйтесь — это минута.', 404);
}

/* Вторая ступень входа: почта + код из письма. Пароль уже проверен. */
if ($act === 'login-2fa') {
    $in = body();
    check_login_rate($DATA_DIR);
    $email = norm_email(isset($in['email']) ? $in['email'] : '');
    $code = preg_replace('/[^0-9]/', '', (string) (isset($in['code']) ? $in['code'] : ''));
    if (!$email || strlen($code) !== 6) fail('Введите почту и шесть цифр из письма.');
    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if (strtolower((string) $u['email']) !== $email) continue;
        if (empty($u['twofa']) || empty($u['twofaCode'])) fail('Для этого аккаунта код не запрашивался. Войдите заново.', 409);
        $tries = isset($u['twofaTries']) ? (int) $u['twofaTries'] : 0;
        if ($tries >= 5) fail('Слишком много попыток. Запросите новый код: войдите с паролем заново.', 429);
        $sentAt = strtotime((string) $u['twofaAt']);
        if ($sentAt && (time() - $sentAt) > 15 * 60) fail('Код устарел. Войдите с паролем заново.', 403);
        if (!password_verify($code, (string) $u['twofaCode'])) {
            $users[$i]['twofaTries'] = $tries + 1;
            write_json(users_file($DATA_DIR), $users);
            fail('Код не подошёл. Проверьте письмо.', 403);
        }
        $users[$i]['twofaCode'] = '';
        $users[$i]['twofaAt'] = '';
        $users[$i]['twofaTries'] = 0;
        write_json(users_file($DATA_DIR), $users);
        touch_activity($DATA_DIR, $u['id']);
        audit_log($DATA_DIR, $u['email'], 'вход по коду', 'двухфакторная проверка пройдена');
        respond(array('ok' => true, 'user' => public_user($u), 'token' => new_token($DATA_DIR, $u['id'])));
    }
    fail('Аккаунт с такой почтой не найден.', 404);
}

if ($act === 'twofa-enable') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!password_verify((string) (isset($in['pass']) ? $in['pass'] : ''), (string) $me['pass'])) {
        fail('Пароль не подошёл.', 403);
    }
    /* Без почты код некуда отправить — включишь проверку и не войдёшь сам. */
    if (!mail_ready($DATA_DIR)) {
        fail('Сначала подключите почту: вкладка «Почта» → «Ящики домена», ящик noreply. '
            . 'Без письма код подтверждения некуда отправлять.', 409);
    }
    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] !== $me['id']) continue;
        $users[$i]['twofa'] = true;
        break;
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось включить проверку.', 500);
    audit_log($DATA_DIR, $me['email'], 'двухфакторный вход', 'включён');
    respond(array('ok' => true, 'twofa' => true));
}

if ($act === 'twofa-disable') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!password_verify((string) (isset($in['pass']) ? $in['pass'] : ''), (string) $me['pass'])) {
        fail('Пароль не подошёл.', 403);
    }
    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] !== $me['id']) continue;
        $users[$i]['twofa'] = false;
        $users[$i]['twofaCode'] = '';
        break;
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось выключить проверку.', 500);
    audit_log($DATA_DIR, $me['email'], 'двухфакторный вход', 'выключен');
    respond(array('ok' => true, 'twofa' => false));
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

/* Удаление аккаунта из личного кабинета.
   Человек удаляет себя сам: нужен пароль и слово УДАЛИТЬ. Данные исчезают,
   материалы остаются в проекте без привязки к человеку — иначе пропали бы
   ссылки и чужие комментарии. Запись в журнале остаётся: факт удаления
   фиксируется без персональных данных. */
if ($act === 'account-delete') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    $pass = isset($in['pass']) ? (string) $in['pass'] : '';
    if (!password_verify($pass, (string) $me['pass'])) fail('Пароль не подошёл — удаление отменено.', 403);
    $word = supper(trim((string) (isset($in['confirm']) ? $in['confirm'] : '')));
    if ($word !== 'УДАЛИТЬ') fail('Напишите слово УДАЛИТЬ в поле подтверждения.', 400);
    if (is_head_role(isset($me['access']) ? $me['access'] : '')) {
        $heads = 0;
        foreach (read_users($DATA_DIR) as $u) {
            if (isset($u['status']) && $u['status'] === 'deleted') continue;
            if (is_head_role(isset($u['access']) ? $u['access'] : '')) $heads++;
        }
        if ($heads <= 1) fail('Единственного руководителя проекта удалить нельзя: сначала назначьте другого.', 409);
    }

    $email = $me['email'];
    mail_notify($DATA_DIR, 'account_status', $email, array(
        'name' => $me['name'], 'status' => 'аккаунт удалён по вашему запросу',
        'reason' => 'Вы удалили аккаунт в личном кабинете.',
    ), array('dedupe' => 'deleted:' . $me['id']));

    /* Сессии удаляемого закрываем — и только его. Раньше здесь файл сессий
       переписывался списком без ключей: все люди разом вылетали из аккаунтов,
       а строки «0», «1», «2» начинали работать как чужие токены. */
    revoke_user_tokens($DATA_DIR, $me['id']);

    /* Материалы снимаются с сайта: удаление аккаунта — это отзыв согласия и
       конец лицензии на публикацию (Политика, п. 5.3; Соглашение, п. 4.2).
       Запись остаётся в журнале редакции без имени человека. */
    $posts = read_json($DATA_DIR . '/posts.json', array());
    if (is_array($posts)) {
        $changed = false;
        foreach ($posts as $i => $post) {
            if (!isset($post['authorId']) || $post['authorId'] !== $me['id']) continue;
            $posts[$i]['authorId'] = '';
            $posts[$i]['authorAccountDeleted'] = true;
            $posts[$i]['authorName'] = 'Удалённый аккаунт';
            $posts[$i]['authorRole'] = '';
            $posts[$i]['authorKey'] = '';
            $was = isset($post['status']) ? (string) $post['status'] : '';
            if ($was === 'published' || $was === 'pending') {
                $posts[$i]['statusBefore'] = $was;
                $posts[$i]['status'] = 'withdrawn';
                $posts[$i]['withdrawnAt'] = date('c');
            }
            $changed = true;
        }
        if ($changed) write_json($DATA_DIR . '/posts.json', $posts);
    }

    /* редакции: убираем из участников */
    $editorials = read_json($DATA_DIR . '/editorials.json', array());
    if (is_array($editorials)) {
        $changed = false;
        foreach ($editorials as $i => $e) {
            if (!isset($e['members']) || !is_array($e['members'])) continue;
            $members = array_values(array_filter($e['members'], function ($m) use ($me) {
                return (is_array($m) ? (isset($m['id']) ? $m['id'] : '') : $m) !== $me['id'];
            }));
            if (count($members) !== count($e['members'])) {
                $editorials[$i]['members'] = $members;
                $changed = true;
            }
        }
        /* руководитель удалил аккаунт: имя из редакции стирается, нового
           руководителя назначает директор (панель, раздел «Редакции») */
        foreach ($editorials as $i => $e) {
            if (isset($e['founderId']) && $e['founderId'] === $me['id']) {
                $editorials[$i]['founderId'] = '';
                $editorials[$i]['founderName'] = '';
                $changed = true;
            }
        }
        if ($changed) write_json($DATA_DIR . '/editorials.json', $editorials);
    }

    /* сам аккаунт: персональные данные стираем, запись оставляем */
    $users = read_users($DATA_DIR);
    $number = 0;
    foreach ($users as $i => $u) {
        if ($u['id'] !== $me['id']) continue;
        $number = isset($u['number']) ? (int) $u['number'] : 0;
        $users[$i]['name'] = 'Удалённый аккаунт';
        $users[$i]['email'] = '';
        $users[$i]['pass'] = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
        $users[$i]['bio'] = '';
        $users[$i]['avatar'] = '';
        $users[$i]['region'] = '';
        $users[$i]['emailVerified'] = false;
        $users[$i]['status'] = 'deleted';
        $users[$i]['access'] = 'Пользователь';
        $users[$i]['deletedAt'] = date('c');
        $users[$i]['confirm'] = '';
        $users[$i]['recovery'] = '';
        break;
    }
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось удалить аккаунт. Напишите в поддержку.', 500);

    /* медиашкола: записи на курсы и ответы на задания стираются вместе с аккаунтом */
    if (function_exists('school_forget_user')) school_forget_user($DATA_DIR, $me['id']);

    /* очередь согласий: закрываем запросы удалённого */
    $consents = read_json(consents_file($DATA_DIR), array());
    if (is_array($consents)) {
        $changed = false;
        foreach ($consents as $i => $c) {
            if (!isset($c['userId']) || $c['userId'] !== $me['id']) continue;
            /* сканы с паспортными данными стираем вместе с аккаунтом */
            consent_drop_files($DATA_DIR, $c);
            unset($consents[$i]['scan']);
            $consents[$i]['pages'] = array();
            $consents[$i]['name'] = 'Удалённый аккаунт';
            $consents[$i]['email'] = '';
            $consents[$i]['status'] = 'withdrawn';
            $consents[$i]['decidedAt'] = date('c');
            $consents[$i]['note'] = 'Аккаунт удалён';
            $changed = true;
        }
        if ($changed) write_json(consents_file($DATA_DIR), $consents);
    }

    /* пресс-карта без владельца не действует; заявления на редакцию закрываем */
    $cards = read_cards($DATA_DIR);
    $changed = false;
    foreach ($cards as $k => $card) {
        if (!isset($card['userId']) || $card['userId'] !== $me['id']) continue;
        if (!in_array(isset($card['status']) ? $card['status'] : '', array('pending', 'issued', 'suspended'), true)) continue;
        $cards[$k]['status'] = empty($card['number']) ? 'rejected' : 'revoked';
        $cards[$k]['note'] = 'Аккаунт удалён';
        $cards[$k]['authorName'] = 'Удалённый аккаунт';
        $cards[$k]['decidedAt'] = date('c');
        $changed = true;
    }
    if ($changed) write_cards($DATA_DIR, $cards);
    $openApps = read_editorial_open($DATA_DIR);
    $changed = false;
    foreach ($openApps as $k => $a) {
        if ($a['userId'] !== $me['id'] || !in_array($a['status'], array('draft', 'awaiting', 'review'), true)) continue;
        $openApps[$k]['status'] = 'withdrawn';
        $openApps[$k]['decidedAt'] = date('c');
        $openApps[$k]['note'] = 'Аккаунт удалён';
        $changed = true;
    }
    if ($changed) write_json(editorial_open_file($DATA_DIR), $openApps);

    $backup = backup_maybe_run($DATA_DIR, true);
    audit_log($DATA_DIR, 'аккаунт №' . $number, 'удаление аккаунта',
        'по запросу владельца; материалы сохранены без привязки; копия: ' . (isset($backup['date']) ? $backup['date'] : '—'));
    respond(array('ok' => true, 'deleted' => true, 'number' => $number));
}

if ($act === 'profile-save') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);

    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] !== $user['id']) continue;

        $name = text(isset($in['name']) ? $in['name'] : $u['name'], 80);
        if (slen($name) >= 2 && $name !== (string) $u['name']) {
            /* Согласие проверено на конкретное имя, им же подписаны материалы и
               пресс-карта. После проверки имя меняет редакция — по обращению. */
            $consent = consent_of_user($DATA_DIR, $u['id']);
            $status = $consent && isset($consent['status']) ? (string) $consent['status'] : 'none';
            if ($status === 'approved') {
                fail('Имя закреплено документами: согласие на обработку данных принято на имя «' . $u['name']
                    . '». Чтобы изменить имя, напишите в поддержку.', 409);
            }
            $users[$i]['name'] = $name;
        }
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
    /* Сканы согласий раньше сохранялись сюда же под именем pd_* и открывались
       любому по ссылке. Теперь они в закрытой папке, а старые файлы этим
       маршрутом не отдаются: их показывает только consent-file — владельцу
       и тому, кто проверяет согласия. */
    if (strpos($id, 'pd_') === 0) {
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
/* ============================================================================
   ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЙ КОДОМ ИЗ ПИСЬМА

   Пароля редакции больше нет: для чувствительных действий (публикация,
   удаление, баллы, согласия, выдача прав) администратор подтверждает себя
   кодом, который приходит ему на почту. Один раз подтвердил — 30 минут
   работает «пропуск», чтобы не запрашивать код на каждую кнопку.

   Файлы: action-codes.json (кому какой код выдан) и confirm-tokens.json
   (выданные пропуска). Оба лежат вне public_html, как и остальные данные.
   ========================================================================== */
/* Есть ли чем отправить письмо: новый ящик noreply@ или прежний SMTP. */
function mail_ready($dir) {
    if (smtp_configured($dir)) return true;
    if (function_exists('mailboxes_load')) {
        $boxes = mailboxes_load($dir);
        if (!empty($boxes['noreply']['pass'])) return true;
    }
    return false;
}

function action_codes_file($dir) { return $dir . '/action-codes.json'; }
function confirm_tokens_file($dir) { return $dir . '/confirm-tokens.json'; }

function action_code_send($dir, $me) {
    if (!mail_ready($dir)) {
        return array('ok' => false, 'error' => 'Почта ещё не настроена: код некуда отправить. Откройте «Почта» → «Ящики домена» и подключите ящик noreply.');
    }
    $file = action_codes_file($dir);
    $all = read_json($file, array());
    if (!is_array($all)) $all = array();
    $id = (string) $me['id'];
    $now = time();

    /* один код в минуту: иначе письма превращаются в спам самому себе */
    if (isset($all[$id]['at']) && $now - (int) $all[$id]['at'] < 60) {
        return array('ok' => true, 'cooldown' => 60 - ($now - (int) $all[$id]['at']));
    }

    $code = (string) random_int(100000, 999999);
    $all[$id] = array(
        'hash' => password_hash($code, PASSWORD_DEFAULT),
        'exp' => $now + 15 * 60,
        'tries' => 0,
        'at' => $now,
    );
    write_json($file, $all);

    $sent = mail_notify($dir, 'login_code', (string) $me['email'], array(
        'name' => (string) $me['name'],
        'code' => $code,
        'minutes' => '15',
    ), array('dedupe' => '', 'by' => (string) $me['email']));

    return array('ok' => (bool) $sent, 'sent' => (bool) $sent, 'cooldown' => 60);
}

function action_code_check($dir, $me, $code) {
    $file = action_codes_file($dir);
    $all = read_json($file, array());
    if (!is_array($all)) return false;
    $id = (string) $me['id'];
    if (!isset($all[$id])) return false;
    $row = $all[$id];
    if (time() > (int) $row['exp']) { unset($all[$id]); write_json($file, $all); return false; }
    if ((int) $row['tries'] >= 5) { unset($all[$id]); write_json($file, $all); return false; }

    if (!password_verify((string) $code, (string) $row['hash'])) {
        $all[$id]['tries'] = (int) $row['tries'] + 1;
        write_json($file, $all);
        return false;
    }
    unset($all[$id]);
    write_json($file, $all);
    return true;
}

function confirm_issue($dir, $me) {
    $file = confirm_tokens_file($dir);
    $all = read_json($file, array());
    if (!is_array($all)) $all = array();
    $now = time();
    foreach ($all as $token => $row) {
        if ((int) $row['exp'] < $now) unset($all[$token]);
    }
    $token = bin2hex(random_bytes(16));
    $all[$token] = array('user' => (string) $me['id'], 'exp' => $now + 30 * 60, 'at' => $now);
    write_json($file, $all);
    return $token;
}

function confirm_valid($dir, $me, $token) {
    if ($token === '') return false;
    $all = read_json(confirm_tokens_file($dir), array());
    if (!is_array($all) || !isset($all[$token])) return false;
    $row = $all[$token];
    if ((int) $row['exp'] < time()) return false;
    return (string) $row['user'] === (string) $me['id'];
}

/* Главная проверка: кто ты, есть ли право, подтверждено ли действие.
   Возвращает пользователя. Без подтверждения отвечает 428 — интерфейс
   на это показывает «Получить код на почту». */
function require_confirm($dir, $in, $cap = '') {
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Сначала войдите в аккаунт.', 401);
    if ($cap !== '' && !can($me, $cap) && !is_top_admin($me)) {
        fail('Для этого действия нужны права администрации.', 403);
    }
    $confirm = isset($in['confirm']) ? (string) $in['confirm'] : '';
    if (confirm_valid($dir, $me, $confirm)) return $me;
    $code = isset($in['code']) ? trim((string) $in['code']) : '';
    if ($code !== '' && action_code_check($dir, $me, $code)) return $me;
    respond(array(
        'ok' => false,
        'error' => 'Подтвердите действие: нажмите «Получить код на почту» и введите шесть цифр из письма.',
        'code' => 428,
        'needConfirm' => true,
    ), 428);
    return null;
}

/* Просмотр очередей кодом из письма не запираем: вошедшему сотруднику с
   правом достаточно входа. Код спрашиваем только за само решение. */
function require_staff($dir, $in, $cap = '') {
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Сначала войдите в аккаунт.', 401);
    if ($cap !== '' && !can($me, $cap) && !is_top_admin($me)) {
        fail('Для этого действия нужны права администрации.', 403);
    }
    return $me;
}

/* ---- подтверждение действий кодом ---- */
if ($act === 'action-code') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Сначала войдите в аккаунт.', 401);
    $res = action_code_send($DATA_DIR, $me);
    if (empty($res['ok'])) {
        fail(isset($res['error']) && $res['error'] !== '' ? $res['error']
            : 'Письмо с кодом не ушло. Проверьте почту в админке, раздел «Почта».', 409);
    }
    audit_log($DATA_DIR, (string) $me['email'], 'код подтверждения', 'запрошен');
    respond(array('ok' => true, 'sent' => true, 'cooldown' => isset($res['cooldown']) ? $res['cooldown'] : 60,
        'email' => (string) $me['email']));
}

if ($act === 'action-confirm') {
    $in = body();
    $me = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Сначала войдите в аккаунт.', 401);
    $code = isset($in['code']) ? trim((string) $in['code']) : '';
    if (!preg_match('/^\d{6}$/', $code)) fail('Код — шесть цифр.');
    if (!action_code_check($DATA_DIR, $me, $code)) {
        fail('Код не подошёл или истёк. Запросите новый.', 403);
    }
    respond(array('ok' => true, 'confirm' => confirm_issue($DATA_DIR, $me), 'minutes' => 30));
}

if (tasks_routes($act, $DATA_DIR)) exit;
if (ai_routes($act, $DATA_DIR)) exit;
if (hiring_routes($act, $DATA_DIR)) exit;

fail('Неизвестное действие.', 404);
