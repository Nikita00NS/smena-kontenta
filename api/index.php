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
const DEFAULT_EDITOR_PASSWORD = 'Redakcia-Smena-2026';

$DATA_DIR = __DIR__ . '/data';

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

function client_ip() {
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        return trim($parts[0]);
    }
    return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
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
        $cfg['editor'] = password_hash(DEFAULT_EDITOR_PASSWORD, PASSWORD_DEFAULT);
        $cfg['createdAt'] = date('c');
        write_json($file, $cfg);
    }
    return (string) $cfg['editor'];
}

function is_editor($dir, $password) {
    $hash = editor_hash($dir);
    if ($password === '' || $password === null) return false;
    return password_verify((string) $password, $hash);
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
        'number' => isset($u['number']) ? $u['number'] : 0,
    );
}

function new_token($dir, $userId) {
    $tokens = read_json(tokens_file($dir), array());
    if (!is_array($tokens)) $tokens = array();
    $now = time();
    foreach ($tokens as $token => $info) {
        if (!is_array($info) || (int) $info['exp'] < $now) unset($tokens[$token]);
    }
    $token = bin2hex(random_bytes(24));
    $tokens[$token] = array('id' => $userId, 'exp' => $now + TOKEN_DAYS * 86400);
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

function norm_email($value) {
    $email = strtolower(trim((string) $value));
    if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u', $email)) return '';
    return $email;
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
   код письмом: достаточно заполнить SMENA_MAIL_FROM ниже. */
if (!defined('SMENA_MAIL_FROM')) define('SMENA_MAIL_FROM', '');

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
function mail_send($to, $subject, $body) {
    if (SMENA_MAIL_FROM === '' || !function_exists('mail')) return false;
    $headers = "From: Смена контента <" . SMENA_MAIL_FROM . ">\r\n" .
        "Content-Type: text/plain; charset=UTF-8\r\n" .
        "MIME-Version: 1.0\r\n";
    $subject_enc = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    return @mail($to, $subject_enc, $body, $headers);
}

function is_top_admin($user) {
    return $user && in_array(isset($user['access']) ? $user['access'] : '', array('Директор', 'Администрация'), true);
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

$act = action();

if ($act === 'selftest') {
    selftest($DATA_DIR);
}

if ($act === 'selftest_full') {
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
    selftest_recovery($DATA_DIR);
}

if ($act === 'selftest_auth') {
    selftest_auth($DATA_DIR);
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
    if (strlen($key) < 8) fail('Не передан ключ автора.');
    $cards = read_cards($DATA_DIR);
    $mine = array();
    foreach ($cards as $card) {
        if ($card['authorKey'] === $key) {
            $mine[] = array(
                'id' => $card['id'],
                'status' => $card['status'],
                'number' => $card['number'],
                'note' => $card['note'],
                'createdAt' => $card['createdAt'],
                'decidedAt' => $card['decidedAt'],
                'posts' => $card['posts'],
            );
        }
    }
    respond(array('ok' => true, 'requests' => $mine, 'minPosts' => card_min_posts()));
}

if ($act === 'card-queue') {
    $in = body();
    if (!is_editor($DATA_DIR, isset($in['password']) ? $in['password'] : '')) fail('Неверный пароль редакции.', 403);
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
    if (!is_editor($DATA_DIR, isset($in['password']) ? $in['password'] : '')) fail('Неверный пароль редакции.', 403);
    $id = isset($in['id']) ? (string) $in['id'] : '';
    $decision = isset($in['decision']) ? (string) $in['decision'] : '';
    $note = text(isset($in['note']) ? $in['note'] : '', 600);
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
    } else {
        $cards[$id]['status'] = 'rejected';
    }
    $cards[$id]['note'] = $note;
    $cards[$id]['decidedAt'] = $now;
    if (!write_json($DATA_DIR . '/cards.json', $cards)) fail('Не удалось сохранить решение.', 500);
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
    if (slen($new) < 6) fail('Новый пароль короче шести символов.');

    $users = read_users($DATA_DIR);
    foreach ($users as $i => $u) {
        if ($u['id'] !== $user['id']) continue;
        $users[$i]['pass'] = password_hash($new, PASSWORD_DEFAULT);
        if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить пароль.', 500);
        respond(array('ok' => true));
    }
    fail('Аккаунт не найден.', 404);
}

/* ------------------------------------------------------- согласие на обработку */

if ($act === 'consent-send') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);

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
    if (slen($pass) < 6) fail('Пароль должен быть не короче шести символов.');
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
        'access' => count($users) === 0 ? 'Директор' : 'Пользователь',
        'bio' => '',
        'avatar' => '',
        'createdAt' => date('c'),
        'number' => 100 + count($users) + 1,
    );
    $recovery = recovery_code_new();
    $user['recovery'] = recovery_hash($recovery);
    $user['recoveryAt'] = date('c');
    $users[] = $user;
    if (!write_json(users_file($DATA_DIR), $users)) fail('Не удалось сохранить аккаунт.', 500);
    respond(array(
        'ok' => true,
        'user' => public_user($user),
        'token' => new_token($DATA_DIR, $id),
        'recoveryCode' => $recovery,
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
    if (slen($new) < 6) fail('Новый пароль — не короче шести символов.');

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
                "Если вы не запрашивали код, просто проигнорируйте письмо."
            );
            break;
        }
    }
    respond(array('ok' => true, 'mailSent' => $mailSent, 'request' => public_recovery_request($req)));
}

if ($act === 'recovery-queue') {
    $in = body();
    $user = user_by_token($DATA_DIR, isset($in['token']) ? (string) $in['token'] : '');
    if (!$user) fail('Нужно войти в аккаунт.', 401);
    if (!is_top_admin($user)) fail('Заявки видит только директор и администрация.', 403);
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
    if (!is_top_admin($user)) fail('Код выдаёт только директор и администрация.', 403);
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
        "Код восстановления: " . $code . "\n\nВведите его на странице входа."
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
    if (!is_top_admin($user)) fail('Закрывает заявку только директор и администрация.', 403);
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
    respond(array('ok' => true, 'user' => public_user($user)));
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
    header('Content-Type: ' . (isset($types[$ext]) ? $types[$ext] : 'application/octet-stream'));
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Accept-Ranges: bytes');
    readfile($path);
    exit;
}

fail('Неизвестное действие. Доступны: state, submit, reg, login, me, profile-save, media-upload, queue, review, card-request, selftest.', 404);
