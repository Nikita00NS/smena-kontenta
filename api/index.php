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
    respond(array('ok' => false, 'error' => $message), $code);
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
    if (strlen($raw) > 1200000) fail('Слишком большой запрос.', 413);
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
        'read' => isset($post['read']) ? $post['read'] : 4,
        'date' => isset($post['date']) ? $post['date'] : $post['submittedAt'],
        'authorName' => $post['authorName'],
        'authorRole' => isset($post['authorRole']) ? $post['authorRole'] : '',
        'authorRegion' => isset($post['authorRegion']) ? $post['authorRegion'] : '',
        'status' => $post['status'],
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
        'image' => text(isset($in['image']) ? $in['image'] : '', 300),
        'read' => isset($in['read']) ? max(1, min(60, (int) $in['read'])) : 4,
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

fail('Неизвестное действие. Доступны: state, submit, mine, queue, review, remove, selftest.', 404);
