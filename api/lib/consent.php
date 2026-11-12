<?php
/* ============================================================================
   СОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ

   Человек скачивает бланк, подписывает и загружает скан в кабинете. В пакете
   два документа: согласие на обработку и отдельное согласие на
   распространение (ст. 10.1 закона № 152-ФЗ) — имя автора стоит под
   материалами на открытом сайте.

   Три правила, ради которых этот файл существует:
   1. Сканы лежат в закрытой папке consents/ и не имеют публичного адреса.
      Раньше они сохранялись рядом с картинками материалов и открывались
      любому по ссылке — а в них паспорт и адрес.
   2. Скан видит только сам человек и сотрудник с правом «consents.review»;
      каждый просмотр сотрудником пишется в журнал.
   3. Без принятого согласия сервер не принимает материалы, портфолио,
      заявки на карту и в редакции. Проверка стоит здесь, а не в интерфейсе.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

const CONSENT_MAX_PAGES = 4;
const CONSENT_PAGE_CHARS = 3200000;   // один лист в base64, около 2,3 МБ файла

function consents_file($dir) { return $dir . '/consents.json'; }

function consent_dir($dir) {
    $path = $dir . '/consents';
    ensure_dir($path);
    return $path;
}

function read_consents($dir) {
    $list = read_json(consents_file($dir), array());
    return is_array($list) ? $list : array();
}

function consent_of_user($dir, $userId) {
    foreach (read_consents($dir) as $c) {
        if (isset($c['userId']) && (string) $c['userId'] === (string) $userId) return $c;
    }
    return null;
}

/* Руководство проекта подписывает документы само и согласие самому себе
   не загружает: директор и сооснователь. Остальные — без исключений. */
function consent_exempt($user) {
    return $user && is_head_role(isset($user['access']) ? $user['access'] : '');
}

function consent_ok($dir, $user) {
    if (!$user) return false;
    if (consent_exempt($user)) return true;
    $c = consent_of_user($dir, $user['id']);
    return $c && isset($c['status']) && $c['status'] === 'approved';
}

/* Список файлов согласия: новые лежат в consents/, старые (до переноса) —
   в uploads/ под именем pd_*; публичный маршрут media их больше не отдаёт. */
function consent_page_paths($dir, $c) {
    $out = array();
    if (isset($c['pages']) && is_array($c['pages'])) {
        foreach ($c['pages'] as $name) {
            $name = basename((string) $name);
            if ($name !== '') $out[] = consent_dir($dir) . '/' . $name;
        }
        return $out;
    }
    if (!empty($c['scan']) && preg_match('/[?&]id=([A-Za-z0-9_.-]+)/', (string) $c['scan'], $m)) {
        $out[] = media_dir($dir) . '/' . basename($m[1]);
    }
    return $out;
}

function consent_drop_files($dir, $c) {
    foreach (consent_page_paths($dir, $c) as $path) {
        if (is_file($path)) @unlink($path);
    }
}

/* Что о согласии видит сам человек. Имён файлов и путей здесь нет. */
function public_consent($c, $staff = false) {
    if (!$c) {
        return array('id' => '', 'status' => 'none', 'note' => '', 'createdAt' => '', 'decidedAt' => '', 'pages' => 0);
    }
    $pages = isset($c['pages']) && is_array($c['pages']) ? count($c['pages']) : (!empty($c['scan']) ? 1 : 0);
    $out = array(
        'id' => isset($c['id']) ? $c['id'] : '',
        'status' => isset($c['status']) ? $c['status'] : 'pending',
        'note' => isset($c['note']) ? $c['note'] : '',
        'createdAt' => isset($c['createdAt']) ? $c['createdAt'] : '',
        'decidedAt' => isset($c['decidedAt']) ? $c['decidedAt'] : '',
        'pages' => $pages,
    );
    if ($staff) {
        $out['userId'] = isset($c['userId']) ? $c['userId'] : '';
        $out['name'] = isset($c['name']) ? $c['name'] : '';
        $out['email'] = isset($c['email']) ? $c['email'] : '';
        $out['userRegion'] = isset($c['userRegion']) ? $c['userRegion'] : '';
        $out['decidedBy'] = isset($c['decidedBy']) ? $c['decidedBy'] : '';
        $out['history'] = isset($c['history']) && is_array($c['history']) ? array_slice($c['history'], -20) : array();
    }
    return $out;
}

/* Отказ с подсказкой: интерфейс по needConsent ведёт человека во вкладку
   «Документы», а не показывает безликое «нет прав». */
function require_consent($dir, $user) {
    if (consent_ok($dir, $user)) return;
    $c = consent_of_user($dir, $user['id']);
    $status = $c && isset($c['status']) ? (string) $c['status'] : 'none';
    $msg = 'Сначала нужно согласие на обработку персональных данных: скачайте бланк, подпишите и загрузите его в кабинете, вкладка «Документы».';
    if ($status === 'pending') {
        $msg = 'Согласие на обработку данных ещё проверяется. Действие откроется, как только редакция его примет.';
    } elseif ($status === 'rejected') {
        $msg = 'Согласие не принято' . (!empty($c['note']) ? ': ' . $c['note'] : '') . '. Загрузите исправленный документ в кабинете, вкладка «Документы».';
    } elseif ($status === 'withdrawn') {
        $msg = 'Согласие отозвано. Чтобы продолжить, загрузите новое в кабинете, вкладка «Документы».';
    }
    respond(array(
        'ok' => false,
        'error' => $msg,
        'code' => 403,
        'needConsent' => true,
        'consent' => public_consent($c),
    ), 403);
}

function consent_history_add(&$record, $action, $by, $note = '') {
    if (!isset($record['history']) || !is_array($record['history'])) $record['history'] = array();
    $record['history'][] = array(
        'at' => date('c'),
        'action' => $action,
        'by' => text($by, 120),
        'note' => text($note, 400),
    );
    if (count($record['history']) > 40) $record['history'] = array_slice($record['history'], -40);
}

/* Решение по согласию: общее для очереди и для карточки человека. */
function consent_apply_decision($dir, $me, $index, &$list, $decision, $note) {
    $c = $list[$index];
    if (isset($c['userId']) && (string) $c['userId'] === (string) $me['id']) {
        fail('Своё согласие проверяет другой сотрудник.', 403);
    }
    $was = isset($c['status']) ? (string) $c['status'] : 'pending';
    if ($was === 'withdrawn') fail('Согласие отозвано: решать по нему уже нечего.', 409);
    if ($was === $decision) fail($decision === 'approved' ? 'Согласие уже принято.' : 'Согласие уже отклонено.', 409);
    if ($decision === 'approved' && !count(consent_page_paths($dir, $c))) {
        fail('В заявке нет файла согласия — принимать нечего.', 409);
    }
    $list[$index]['status'] = $decision;
    $list[$index]['note'] = $note;
    $list[$index]['decidedAt'] = date('c');
    $list[$index]['decidedBy'] = $me['name'];
    $list[$index]['decidedById'] = $me['id'];
    consent_history_add($list[$index], $decision, $me['name'], $note);
    if (!write_json(consents_file($dir), $list)) fail('Не удалось сохранить решение.', 500);

    audit_log($dir, (string) $me['email'], 'consent-review',
        ($decision === 'approved' ? 'согласие принято: ' : 'согласие отклонено: ') .
        (isset($c['name']) ? $c['name'] : '') . ($was !== 'pending' ? ' (было: ' . $was . ')' : ''));

    if (!empty($c['userId'])) {
        notify_user($dir, $c['userId'], $decision === 'approved'
            ? 'Согласие на обработку персональных данных принято. Теперь можно отправлять материалы, подавать заявку на пресс-карту и в редакцию.'
            : 'Согласие на обработку персональных данных не принято: ' . $note . ' Загрузите исправленный документ в кабинете, вкладка «Документы».',
            array('kind' => 'consent', 'ref' => 'consent:' . (isset($c['id']) ? $c['id'] : '') . ':' . $decision . ':' . date('YmdHi')));
    }
    return $list[$index];
}

function consent_routes($act, $dir) {
    $handled = array('consent-send', 'consent-status', 'consent-queue', 'consent-review',
        'consent-decide', 'consent-file');
    if (!in_array($act, $handled, true)) return false;
    $in = body();

    if ($act === 'consent-send') {
        $user = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
        if (!$user) fail('Нужно войти в аккаунт.', 401);
        require_verified($user);
        check_rate_for($dir, 'consent', $user['id'], 10,
            'Слишком много загрузок подряд. Попробуйте через час.');

        $raw = array();
        if (isset($in['pages']) && is_array($in['pages'])) $raw = array_values($in['pages']);
        elseif (isset($in['scan'])) $raw = array($in['scan']);
        if (!count($raw)) fail('Приложите скан или фотографию подписанного согласия.');
        if (count($raw) > CONSENT_MAX_PAGES) {
            fail('Не больше ' . CONSENT_MAX_PAGES . ' файлов: листы согласия на обработку и на распространение.');
        }

        $list = read_consents($dir);
        $index = -1;
        foreach ($list as $i => $c) {
            if (isset($c['userId']) && (string) $c['userId'] === (string) $user['id']) { $index = $i; break; }
        }
        if ($index >= 0 && isset($list[$index]['status']) && $list[$index]['status'] === 'approved') {
            fail('Согласие уже принято, повторно загружать его не нужно. Если данные изменились — напишите на info@smenakontenta.ru.', 409);
        }

        $files = array();
        foreach ($raw as $n => $dataUrl) {
            $err = '';
            $file = data_url_file($dataUrl, array(
                'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
                'application/pdf' => 'pdf',
            ), CONSENT_PAGE_CHARS, $err);
            if (!$file) fail('Файл ' . ($n + 1) . ': ' . $err, 413);
            $files[] = $file;
        }

        $folder = consent_dir($dir);
        $names = array();
        $stamp = time();
        foreach ($files as $n => $file) {
            $name = 'pd_' . preg_replace('/[^A-Za-z0-9_]/', '', (string) $user['id']) . '_' . $stamp . '_' . ($n + 1) .
                '_' . bin2hex(random_bytes(3)) . '.' . $file['ext'];
            if (@file_put_contents($folder . '/' . $name, $file['bin']) === false) {
                foreach ($names as $done) @unlink($folder . '/' . $done);
                fail('Не удалось сохранить файл. Попробуйте файл поменьше.', 500);
            }
            @chmod($folder . '/' . $name, 0600);
            $names[] = $name;
        }

        $record = $index >= 0 ? $list[$index] : array('id' => 'c_' . bin2hex(random_bytes(5)), 'history' => array());
        if ($index >= 0) consent_drop_files($dir, $record);
        unset($record['scan']);
        $record['userId'] = $user['id'];
        $record['name'] = $user['name'];
        $record['email'] = $user['email'];
        $record['userRegion'] = isset($user['region']) ? $user['region'] : '';
        $record['pages'] = $names;
        $record['status'] = 'pending';
        $record['note'] = '';
        $record['createdAt'] = date('c');
        $record['decidedAt'] = '';
        $record['decidedBy'] = '';
        consent_history_add($record, 'sent', $user['name'], 'файлов: ' . count($names));
        if ($index >= 0) $list[$index] = $record; else $list[] = $record;
        if (!write_json(consents_file($dir), $list)) {
            foreach ($names as $done) @unlink($folder . '/' . $done);
            fail('Не удалось сохранить заявку.', 500);
        }
        respond(array('ok' => true, 'consent' => public_consent($record)));
    }

    if ($act === 'consent-status') {
        $user = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
        if (!$user) fail('Нужно войти в аккаунт.', 401);
        respond(array(
            'ok' => true,
            'consent' => public_consent(consent_of_user($dir, $user['id'])),
            'exempt' => consent_exempt($user),
            'granted' => consent_ok($dir, $user),
        ));
    }

    if ($act === 'consent-queue') {
        require_staff($dir, $in, 'consents.review');
        $users = array();
        foreach (read_users($dir) as $u) $users[$u['id']] = $u;
        $out = array();
        $counts = array('pending' => 0, 'approved' => 0, 'rejected' => 0);
        foreach (read_consents($dir) as $c) {
            $row = public_consent($c, true);
            if (isset($counts[$row['status']])) $counts[$row['status']]++;
            /* имя и почта — актуальные из аккаунта: человек мог их поправить */
            if (isset($users[$row['userId']])) {
                $u = $users[$row['userId']];
                if (isset($u['status']) && $u['status'] === 'deleted') continue;
                $row['name'] = $u['name'];
                $row['email'] = isset($u['email']) ? $u['email'] : '';
                $row['userRegion'] = isset($u['region']) ? $u['region'] : '';
                $row['userNumber'] = isset($u['number']) ? (int) $u['number'] : 0;
            }
            $out[] = $row;
        }
        usort($out, function ($a, $b) {
            $pa = $a['status'] === 'pending' ? 0 : 1;
            $pb = $b['status'] === 'pending' ? 0 : 1;
            if ($pa !== $pb) return $pa - $pb;
            /* очередь — от старых к новым, разобранные — от новых к старым */
            return $pa === 0
                ? strcmp((string) $a['createdAt'], (string) $b['createdAt'])
                : strcmp((string) $b['decidedAt'], (string) $a['decidedAt']);
        });
        respond(array('ok' => true, 'consents' => array_slice($out, 0, 400), 'counts' => $counts));
    }

    if ($act === 'consent-review' || $act === 'consent-decide') {
        $me = require_confirm($dir, $in, 'consents.review');
        if (!can($me, 'consents.review')) fail('Согласия проверяет администрация проекта.', 403);
        $id = text(isset($in['id']) ? $in['id'] : '', 40);
        $userId = text(isset($in['userId']) ? $in['userId'] : '', 40);
        $decision = isset($in['decision']) ? (string) $in['decision'] : '';
        $note = text(isset($in['note']) ? $in['note'] : '', 400);
        if (!in_array($decision, array('approved', 'rejected'), true)) fail('Решение — «принять» или «отклонить».');
        if ($decision === 'rejected' && slen($note) < 5) fail('Для отказа нужна причина: человек увидит её в кабинете.');

        $list = read_consents($dir);
        $index = -1;
        foreach ($list as $i => $c) {
            if ($id !== '' && isset($c['id']) && $c['id'] === $id) { $index = $i; break; }
            if ($id === '' && $userId !== '' && isset($c['userId']) && $c['userId'] === $userId) { $index = $i; break; }
        }
        if ($index < 0) fail('Согласие не найдено.', 404);
        /* очередь решает только то, что ждёт; изменить уже принятое решение
           можно из карточки человека — там это отдельная осознанная кнопка */
        if ($act === 'consent-review' && (isset($list[$index]['status']) ? $list[$index]['status'] : '') !== 'pending') {
            fail('По этому согласию решение уже принято. Изменить его можно в карточке человека.', 409);
        }
        $saved = consent_apply_decision($dir, $me, $index, $list, $decision, $note);
        respond(array('ok' => true, 'consent' => public_consent($saved, true)));
    }

    if ($act === 'consent-file') {
        $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
        if (!$me) fail('Нужно войти в аккаунт.', 401);
        $id = text(isset($in['id']) ? $in['id'] : '', 40);
        $page = isset($in['page']) ? max(1, (int) $in['page']) : 1;

        $record = null;
        if ($id === '') {
            $record = consent_of_user($dir, $me['id']);
        } else {
            foreach (read_consents($dir) as $c) {
                if (isset($c['id']) && $c['id'] === $id) { $record = $c; break; }
            }
        }
        if (!$record) fail('Согласие не найдено.', 404);
        $own = isset($record['userId']) && (string) $record['userId'] === (string) $me['id'];
        if (!$own && !can($me, 'consents.review')) {
            fail('Скан согласия видит только сам человек и администрация проекта.', 403);
        }
        $paths = consent_page_paths($dir, $record);
        if ($page > count($paths) || !is_file($paths[$page - 1])) fail('Файл не найден.', 404);
        $path = $paths[$page - 1];
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $types = array('jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
            'webp' => 'image/webp', 'pdf' => 'application/pdf');
        if (!isset($types[$ext])) fail('Файл не найден.', 404);
        $bin = @file_get_contents($path);
        if ($bin === false) fail('Файл не читается.', 500);
        if (!$own) {
            audit_log($dir, (string) $me['email'], 'consent-file',
                'просмотр согласия: ' . (isset($record['name']) ? $record['name'] : '') . ', лист ' . $page);
        }
        respond(array(
            'ok' => true,
            'page' => $page,
            'pages' => count($paths),
            'mime' => $types[$ext],
            'data' => 'data:' . $types[$ext] . ';base64,' . base64_encode($bin),
        ));
    }

    return false;
}
