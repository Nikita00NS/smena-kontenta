<?php
/* ============================================================================
   ОБЩЕЕ ДЛЯ РЕДАКЦИИ: уведомления о решениях, лимиты, сводка для панели.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

/* Токен сессии — 48 шестнадцатеричных символов. Всё остальное не ищем в
   файле вовсе: после сбоя записи ключами становились «0», «1», «2», и такая
   строка открывала чужую сессию. */
function token_valid_format($token) {
    return is_string($token) && (bool) preg_match('/^[a-f0-9]{48}$/', $token);
}

/* Лимит по произвольному ключу (аккаунт, адрес): не больше $limit действий
   в час. У каждого вида действий свой файл — регистрация класса с одного
   школьного адреса не должна запирать отправку материалов. */
function check_rate_for($dir, $bucket, $key, $limit, $message) {
    $file = $dir . '/rate-' . preg_replace('/[^a-z0-9-]/', '', (string) $bucket) . '.json';
    $now = time();
    $all = read_json($file, array());
    if (!is_array($all)) $all = array();
    $key = (string) $key;
    $fresh = array();
    foreach (isset($all[$key]) && is_array($all[$key]) ? $all[$key] : array() as $ts) {
        if (is_int($ts) && $now - $ts < 3600) $fresh[] = $ts;
    }
    if (count($fresh) >= $limit) fail($message, 429);
    $fresh[] = $now;
    $all[$key] = $fresh;
    if (count($all) > 2000) {
        /* выбрасываем тех, у кого за час ничего не было */
        foreach ($all as $k => $list) {
            $last = is_array($list) && count($list) ? (int) end($list) : 0;
            if ($now - $last >= 3600) unset($all[$k]);
        }
    }
    write_json($file, $all);
}

/* Сколько попыток уже было — без записи новой (для неверных паролей). */
function rate_count($dir, $bucket, $key) {
    $all = read_json($dir . '/rate-' . $bucket . '.json', array());
    $n = 0;
    foreach (isset($all[$key]) && is_array($all[$key]) ? $all[$key] : array() as $ts) {
        if (is_int($ts) && time() - $ts < 3600) $n++;
    }
    return $n;
}

/* Уведомление человеку о решении: сообщение в кабинете и письмо.
   Решение без уведомления — это когда автор неделю гадает, что с заявкой. */
function notify_user($dir, $userId, $message, $opts = array()) {
    $target = null;
    foreach (read_users($dir) as $u) {
        if ((string) $u['id'] === (string) $userId) { $target = $u; break; }
    }
    if (!$target || (isset($target['status']) && $target['status'] === 'deleted')) return false;

    $message = text($message, 2000);
    $list = read_messages($dir);
    $row = array(
        'id' => 'ms_' . bin2hex(random_bytes(4)),
        'userId' => $target['id'],
        'from' => 'Смена контента',
        'fromRole' => 'Уведомление',
        'kind' => isset($opts['kind']) ? text($opts['kind'], 20) : 'notice',
        'text' => $message,
        'createdAt' => date('c'),
        'read' => false,
        'mailed' => false,
    );
    if (!empty($target['email']) && !empty($target['emailVerified'])) {
        $row['mailed'] = (bool) mail_notify($dir, 'notice', $target['email'],
            array('name' => $target['name'], 'text' => $message),
            array('dedupe' => isset($opts['ref']) ? 'notice:' . $opts['ref'] : '', 'kind' => 'redakcia'));
    }
    $list[] = $row;
    if (count($list) > 20000) $list = array_slice($list, -20000);
    write_json(messages_file($dir), $list);
    return true;
}

/* Сводка для панели: сколько чего ждёт. Каждая цифра есть в ответе только
   если у человека есть право на этот раздел — по ней же панель решает,
   какие вкладки показывать. */
function staff_summary($dir, $me) {
    $scope = staff_scope($me);
    $usersById = array();
    foreach (read_users($dir) as $u) $usersById[$u['id']] = $u;
    $out = array();

    if (can($me, 'posts.review')) {
        $n = 0;
        foreach (read_json($dir . '/posts.json', array()) as $post) {
            if (!isset($post['status']) || $post['status'] !== 'pending') continue;
            $author = isset($post['authorId'], $usersById[$post['authorId']]) ? $usersById[$post['authorId']] : null;
            if (post_in_scope($scope, $post, $author)) $n++;
        }
        $out['posts'] = $n;
    }
    if (can($me, 'consents.review')) {
        $n = 0;
        foreach (read_consents($dir) as $c) {
            if (isset($c['status']) && $c['status'] === 'pending') $n++;
        }
        $out['consents'] = $n;
    }
    if (can_any($me, array('cards.view', 'cards.issue'))) {
        $n = 0;
        foreach (read_cards($dir) as $card) {
            if ((isset($card['status']) ? $card['status'] : '') !== 'pending') continue;
            if (card_in_scope($scope, $card, $usersById)) $n++;
        }
        $out['cards'] = $n;
    }
    if (can_any($me, array('editorials.intake', 'editorials.open'))) {
        $n = 0;
        $decide = can($me, 'editorials.open');
        foreach (read_editorial_open($dir) as $a) {
            /* директору важнее то, что ждёт его решения; приёму — то, что ждёт документа */
            if ($a['status'] === 'review' || (!$decide && $a['status'] === 'awaiting')) $n++;
        }
        $out['editorialOpen'] = $n;
    }
    if (can($me, 'editorials.appoint') && $scope === null) {
        $n = 0;
        foreach (read_editorial_apps($dir) as $a) {
            if (isset($a['status']) && $a['status'] === 'pending') $n++;
        }
        $out['editorialApps'] = $n;
    }
    if (can($me, 'points.award') && $scope === null) {
        $n = 0;
        foreach (read_portfolio($dir) as $item) {
            if (isset($item['status']) && $item['status'] === 'pending') $n++;
        }
        $out['portfolio'] = $n;
    }
    if (can($me, 'support.answer') && $scope === null) {
        $n = 0;
        foreach (read_support($dir) as $t) {
            if (isset($t['status']) && $t['status'] === 'open') $n++;
        }
        $out['support'] = $n;
    }
    if (can($me, 'recovery.issue')) {
        $n = 0;
        foreach (read_recovery_requests($dir) as $r) {
            if (isset($r['status']) && $r['status'] === 'open') $n++;
        }
        $out['recovery'] = $n;
    }
    if (can($me, 'hiring.view') && $scope === null) {
        $n = 0;
        foreach (read_hiring($dir) as $a) {
            if (isset($a['stage']) && $a['stage'] === 'review') $n++;
        }
        $out['hiring'] = $n;
    }
    if (can($me, 'people.view')) {
        $n = 0;
        foreach ($usersById as $u) {
            if (isset($u['status']) && $u['status'] === 'deleted') continue;
            if (user_in_scope($scope, $u)) $n++;
        }
        $out['people'] = $n;
    }
    if (can($me, 'reports.review') && function_exists('reports_waiting')) {
        $out['reports'] = reports_waiting($dir);
    }
    if (can_any($me, array('school.review', 'school.teach')) && function_exists('school_waiting')) {
        $out['school'] = school_waiting($dir, $me);
    }
    if (can($me, 'site.manage')) {
        $state = site_state($dir);
        $out['site'] = $state['maintenance'] ? 1 : 0;
    }
    return $out;
}

function staff_routes($act, $dir) {
    if ($act !== 'staff-summary') return false;
    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    if (!is_staff_user($me)) fail('Панель проекта открыта только редакции.', 403);
    $scope = staff_scope($me);
    respond(array(
        'ok' => true,
        'role' => isset($me['access']) ? $me['access'] : 'Пользователь',
        'caps' => user_caps($me),
        'scoped' => $scope !== null,
        'scope' => $scope,
        'summary' => staff_summary($dir, $me),
    ));
}
