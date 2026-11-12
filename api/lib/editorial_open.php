<?php
/* ============================================================================
   ОТКРЫТИЕ РЕДАКЦИИ В РЕГИОНЕ

   Раньше редакция создавалась одной кнопкой: любой вошедший нажимал
   «Создать» и сразу получал роль с правом проверять чужие материалы.
   Теперь это заявление, которое рассматривает директор:

     анкета (draft)
       → заявление сформировано, его печатают и подписывают (awaiting)
       → подписанный скан пришёл на editorial@smenakontenta.ru (review)
       → решение директора (approved | rejected)

   Отозвать заявление можно до решения (withdrawn). Редакция и роль
   руководителя появляются только после решения «открыть».
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

const EDITORIAL_OPEN_MAIL = 'editorial@smenakontenta.ru';
const EDITORIAL_TEAM_MIN = 2;    // кроме руководителя
const EDITORIAL_TEAM_MAX = 30;
const EDITORIAL_HEAD_MIN_AGE = 14;

function editorial_open_file($dir) { return $dir . '/editorial-open.json'; }

function read_editorial_open($dir) {
    $list = read_json(editorial_open_file($dir), array());
    return is_array($list) ? array_values($list) : array();
}

function editorial_open_bases() {
    return array(
        'school' => 'Школа, лицей, гимназия',
        'college' => 'Колледж или вуз',
        'youth' => 'Молодёжный центр, дом творчества',
        'media' => 'Медиацентр, студия, пресс-центр',
        'ngo' => 'Общественная организация',
        'self' => 'Самостоятельная команда',
    );
}

/* Дата рождения: принимаем и «2010-05-17» (поле даты в браузере), и
   «17.05.2010». Возвращаем ГГГГ-ММ-ДД или пустую строку. */
function eo_date($value) {
    $v = trim((string) $value);
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m)) {
        $y = (int) $m[1]; $mo = (int) $m[2]; $d = (int) $m[3];
    } elseif (preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/', $v, $m)) {
        $y = (int) $m[3]; $mo = (int) $m[2]; $d = (int) $m[1];
    } else {
        return '';
    }
    if (!checkdate($mo, $d, $y)) return '';
    return sprintf('%04d-%02d-%02d', $y, $mo, $d);
}

function eo_age($iso) {
    if ($iso === '') return -1;
    list($y, $m, $d) = array_map('intval', explode('-', $iso));
    $age = (int) date('Y') - $y;
    if ((int) date('n') < $m || ((int) date('n') === $m && (int) date('j') < $d)) $age--;
    return $age;
}

function eo_phone($value) {
    return substr(preg_replace('/[^0-9]/', '', (string) $value), 0, 15);
}

/* Анкета из запроса → чистая анкета. Проверок здесь нет: черновик можно
   сохранять недозаполненным. */
function eo_form_clean($raw, $user) {
    $raw = is_array($raw) ? $raw : array();
    $get = function ($key, $max) use ($raw) {
        return text(isset($raw[$key]) ? $raw[$key] : '', $max);
    };
    $bases = editorial_open_bases();
    $base = $get('base', 20);
    if (!isset($bases[$base])) $base = '';

    $team = array();
    if (isset($raw['team']) && is_array($raw['team'])) {
        foreach (array_slice(array_values($raw['team']), 0, EDITORIAL_TEAM_MAX) as $row) {
            if (!is_array($row)) continue;
            $name = text(isset($row['name']) ? $row['name'] : '', 120);
            $role = text(isset($row['role']) ? $row['role'] : '', 60);
            $age = isset($row['age']) ? (int) $row['age'] : 0;
            if ($name === '' && $role === '' && $age === 0) continue;
            $team[] = array('name' => $name, 'role' => $role, 'age' => max(0, min(120, $age)));
        }
    }

    $curatorRaw = isset($raw['curator']) && is_array($raw['curator']) ? $raw['curator'] : array();
    $confirmsRaw = isset($raw['confirms']) && is_array($raw['confirms']) ? $raw['confirms'] : array();
    $headName = $get('headName', 120);

    return array(
        'name' => $get('name', 120),
        'region' => $get('region', 80),
        'city' => $get('city', 80),
        'base' => $base,
        'baseName' => $get('baseName', 160),
        'about' => $get('about', 2000),
        'plan' => $get('plan', 1200),
        'links' => $get('links', 400),
        'headName' => $headName !== '' ? $headName : (string) $user['name'],
        'headBirth' => eo_date(isset($raw['headBirth']) ? $raw['headBirth'] : ''),
        'headPhone' => eo_phone(isset($raw['headPhone']) ? $raw['headPhone'] : ''),
        'curator' => array(
            'name' => text(isset($curatorRaw['name']) ? $curatorRaw['name'] : '', 120),
            'role' => text(isset($curatorRaw['role']) ? $curatorRaw['role'] : '', 120),
            'phone' => eo_phone(isset($curatorRaw['phone']) ? $curatorRaw['phone'] : ''),
            'email' => norm_email(isset($curatorRaw['email']) ? $curatorRaw['email'] : ''),
        ),
        'team' => $team,
        'confirms' => array(
            'truth' => !empty($confirmsRaw['truth']),
            'rules' => !empty($confirmsRaw['rules']),
            'consents' => !empty($confirmsRaw['consents']),
            'reports' => !empty($confirmsRaw['reports']),
        ),
    );
}

/* Что мешает отправить заявление. Пустой список — можно отправлять. */
function eo_form_problems($form) {
    $bad = array();
    if (slen($form['name']) < 3) $bad[] = 'Название редакции — хотя бы три символа.';
    if ($form['region'] === '') $bad[] = 'Выберите регион.';
    if (slen($form['city']) < 2) $bad[] = 'Укажите город или населённый пункт.';
    if ($form['base'] === '') $bad[] = 'Выберите, на базе чего работает редакция.';
    if ($form['base'] !== '' && $form['base'] !== 'self' && slen($form['baseName']) < 3) {
        $bad[] = 'Напишите название организации, на базе которой работает редакция.';
    }
    if (slen($form['about']) < 50) $bad[] = 'Расскажите о редакции подробнее: не меньше 50 символов.';
    if (slen($form['headName']) < 5) $bad[] = 'Напишите фамилию, имя и отчество руководителя полностью.';

    $age = eo_age($form['headBirth']);
    if ($form['headBirth'] === '') {
        $bad[] = 'Укажите дату рождения руководителя.';
    } elseif ($age < EDITORIAL_HEAD_MIN_AGE) {
        $bad[] = 'Руководителем редакции может быть человек не младше ' . EDITORIAL_HEAD_MIN_AGE . ' лет.';
    } elseif ($age > 100) {
        $bad[] = 'Проверьте дату рождения руководителя.';
    }
    if (strlen($form['headPhone']) < 10) $bad[] = 'Телефон руководителя — не меньше десяти цифр.';

    if ($age >= 0 && $age < 18) {
        $c = $form['curator'];
        if (slen($c['name']) < 5 || slen($c['role']) < 3 || strlen($c['phone']) < 10) {
            $bad[] = 'Руководителю меньше 18 лет: нужен взрослый куратор — ФИО, кем приходится или должность, телефон.';
        }
    }

    $members = 0;
    foreach ($form['team'] as $n => $row) {
        if (slen($row['name']) < 3) { $bad[] = 'Команда, строка ' . ($n + 1) . ': напишите имя и фамилию.'; continue; }
        if ($row['age'] < EDITORIAL_HEAD_MIN_AGE) {
            $bad[] = 'Команда, строка ' . ($n + 1) . ': участнику должно быть не меньше ' . EDITORIAL_HEAD_MIN_AGE . ' лет.';
            continue;
        }
        $members++;
    }
    if ($members < EDITORIAL_TEAM_MIN) {
        $bad[] = 'В команде, кроме руководителя, должно быть не меньше ' . EDITORIAL_TEAM_MIN . ' человек.';
    }
    foreach ($form['confirms'] as $key => $on) {
        if (!$on) { $bad[] = 'Отметьте все четыре подтверждения в конце анкеты.'; break; }
    }
    return $bad;
}

function eo_number_next($list) {
    $max = 0;
    foreach ($list as $a) {
        if (!empty($a['number']) && preg_match('/(\d+)$/', (string) $a['number'], $m)) $max = max($max, (int) $m[1]);
    }
    return 'ЗР-' . date('Y') . '-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
}

function eo_history_add(&$app, $action, $by, $note = '') {
    if (!isset($app['history']) || !is_array($app['history'])) $app['history'] = array();
    $app['history'][] = array('at' => date('c'), 'action' => $action, 'by' => text($by, 120), 'note' => text($note, 400));
    if (count($app['history']) > 40) $app['history'] = array_slice($app['history'], -40);
}

function eo_public($a, $staff = false, $applicant = null) {
    $out = array(
        'id' => $a['id'],
        'number' => isset($a['number']) ? $a['number'] : '',
        'status' => isset($a['status']) ? $a['status'] : 'draft',
        'form' => isset($a['form']) && is_array($a['form']) ? $a['form'] : array(),
        'note' => isset($a['note']) ? $a['note'] : '',
        'createdAt' => isset($a['createdAt']) ? $a['createdAt'] : '',
        'updatedAt' => isset($a['updatedAt']) ? $a['updatedAt'] : '',
        'submittedAt' => isset($a['submittedAt']) ? $a['submittedAt'] : '',
        'receivedAt' => isset($a['receivedAt']) ? $a['receivedAt'] : '',
        'decidedAt' => isset($a['decidedAt']) ? $a['decidedAt'] : '',
        'decidedBy' => isset($a['decidedBy']) ? $a['decidedBy'] : '',
        'editorialId' => isset($a['editorialId']) ? $a['editorialId'] : '',
        'applicant' => array(
            'name' => $applicant ? $applicant['name'] : (isset($a['userName']) ? $a['userName'] : ''),
            'email' => $applicant && isset($applicant['email']) ? $applicant['email'] : (isset($a['userEmail']) ? $a['userEmail'] : ''),
            'number' => $applicant && isset($applicant['number']) ? (int) $applicant['number'] : 0,
        ),
    );
    if ($staff) {
        $out['userId'] = isset($a['userId']) ? $a['userId'] : '';
        $out['receivedBy'] = isset($a['receivedBy']) ? $a['receivedBy'] : '';
        $out['history'] = isset($a['history']) && is_array($a['history']) ? array_slice($a['history'], -20) : array();
    }
    return $out;
}

function eo_active_index($list, $userId) {
    foreach ($list as $i => $a) {
        if ((string) $a['userId'] !== (string) $userId) continue;
        if (in_array(isset($a['status']) ? $a['status'] : '', array('draft', 'awaiting', 'review'), true)) return $i;
    }
    return -1;
}

function eo_owned_editorial($dir, $userId) {
    foreach (read_editorials($dir) as $e) {
        if (isset($e['founderId']) && (string) $e['founderId'] === (string) $userId) return $e;
    }
    return null;
}

function editorial_open_routes($act, $dir) {
    $handled = array('editorial-open-save', 'editorial-open-mine', 'editorial-open-withdraw',
        'editorial-open-get', 'editorial-open-queue', 'editorial-open-received',
        'editorial-open-return', 'editorial-open-decide', 'editorial-create',
        'editorial-all', 'editorial-head', 'editorial-close');
    if (!in_array($act, $handled, true)) return false;

    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);

    /* ---------------------------------------------- действующие редакции */

    /* Список всех редакций со штатом — для директора и центральной редакции. */
    if ($act === 'editorial-all') {
        if (!can_any($me, array('editorials.open', 'editorials.appoint')) || staff_scope($me) !== null) {
            fail('Список редакций видит руководство проекта.', 403);
        }
        $users = read_users($dir);
        $out = array();
        foreach (read_editorials($dir) as $e) {
            $roster = array();
            foreach ($users as $u) {
                if (!isset($u['editorialId']) || (string) $u['editorialId'] !== (string) $e['id']) continue;
                if (isset($u['status']) && $u['status'] === 'deleted') continue;
                $roster[] = array('id' => $u['id'], 'name' => $u['name'], 'head' => $u['id'] === $e['founderId'],
                    'access' => isset($u['access']) ? $u['access'] : 'Пользователь');
            }
            $out[] = array(
                'id' => $e['id'], 'name' => $e['name'], 'region' => $e['region'],
                'headId' => $e['founderId'], 'headName' => $e['founderName'],
                'createdAt' => $e['createdAt'], 'roster' => $roster,
            );
        }
        usort($out, function ($a, $b) { return strcmp((string) $a['name'], (string) $b['name']); });
        respond(array('ok' => true, 'editorials' => $out, 'canDecide' => can($me, 'editorials.open')));
    }

    /* Смена руководителя и закрытие редакции — решение директора, под код из письма. */
    if ($act === 'editorial-head' || $act === 'editorial-close') {
        $me = require_confirm($dir, $in, 'editorials.open');
        $id = text(isset($in['id']) ? $in['id'] : '', 60);
        $editorials = read_editorials($dir);
        $index = -1;
        foreach ($editorials as $i => $e) {
            if ((string) $e['id'] === $id) $index = $i;
        }
        if ($index < 0) fail('Редакция не найдена.', 404);
        $ed = $editorials[$index];
        $now = date('c');

        if ($act === 'editorial-head') {
            $userId = text(isset($in['userId']) ? $in['userId'] : '', 60);
            if ($userId === (string) $ed['founderId']) fail('Этот человек уже руководит редакцией.', 409);
            $users = read_users($dir);
            $newIndex = -1; $oldIndex = -1;
            foreach ($users as $i => $u) {
                if ((string) $u['id'] === $userId) $newIndex = $i;
                if ((string) $u['id'] === (string) $ed['founderId']) $oldIndex = $i;
            }
            if ($newIndex < 0 || (isset($users[$newIndex]['status']) && $users[$newIndex]['status'] !== 'active')) {
                fail('Участник не найден.', 404);
            }
            if (!isset($users[$newIndex]['editorialId']) || (string) $users[$newIndex]['editorialId'] !== $id) {
                fail('Руководителем можно назначить участника этой редакции.', 409);
            }
            if (!consent_ok($dir, $users[$newIndex])) fail('У участника нет принятого согласия на обработку данных.', 409);
            $oldName = $ed['founderName'];
            $editorials[$index]['founderId'] = $users[$newIndex]['id'];
            $editorials[$index]['founderName'] = $users[$newIndex]['name'];
            $editorials[$index]['headChangedAt'] = $now;
            if (role_level(isset($users[$newIndex]['access']) ? $users[$newIndex]['access'] : '') < ROLE_LEVELS['Редакционный основатель']) {
                $users[$newIndex]['access'] = 'Редакционный основатель';
            }
            /* прежний руководитель остаётся участником, но права руководителя с него снимаются */
            if ($oldIndex >= 0 && isset($users[$oldIndex]['access']) && $users[$oldIndex]['access'] === 'Редакционный основатель') {
                $users[$oldIndex]['access'] = 'Пользователь';
            }
            if (!write_json(users_file($dir), $users) || !write_json(editorials_file($dir), $editorials)) {
                fail('Не удалось сохранить.', 500);
            }
            audit_log($dir, (string) $me['email'], 'editorial-head',
                'редакция «' . $ed['name'] . '»: руководитель ' . ($oldName !== '' ? $oldName : '—') . ' → ' . $users[$newIndex]['name']);
            notify_user($dir, $users[$newIndex]['id'], 'Вы назначены руководителем редакции «' . $ed['name'] . '». Заявки, штат и отчёты — в кабинете, вкладка «Редакция».',
                array('kind' => 'editorial', 'ref' => 'edhead:' . $id . ':' . time()));
            if ($oldIndex >= 0) {
                notify_user($dir, $users[$oldIndex]['id'], 'Руководителем редакции «' . $ed['name'] . '» назначен(а) ' . $users[$newIndex]['name'] . '. Вы остаётесь участником редакции.',
                    array('kind' => 'editorial', 'ref' => 'edheadold:' . $id . ':' . time()));
            }
            respond(array('ok' => true, 'headId' => $users[$newIndex]['id'], 'headName' => $users[$newIndex]['name']));
        }

        /* закрытие: люди остаются авторами проекта, редакция уходит в архив */
        $note = text(isset($in['note']) ? $in['note'] : '', 400);
        if (slen($note) < 5) fail('Напишите причину закрытия: участники получат её в уведомлении.');
        $members = array();
        foreach (read_users($dir) as $u) {
            if (isset($u['editorialId']) && (string) $u['editorialId'] === $id
                && !(isset($u['status']) && $u['status'] === 'deleted')) $members[] = $u['id'];
        }
        foreach ($members as $userId) {
            editorial_member_out($dir, $userId, $id, 'closed', $note, $me['name']);
        }
        $apps = read_editorial_apps($dir);
        foreach ($apps as $i => $a) {
            if ((string) $a['editorialId'] === $id && $a['status'] === 'pending') {
                $apps[$i]['status'] = 'closed';
                $apps[$i]['note'] = 'Редакция закрыта';
                $apps[$i]['decidedAt'] = $now;
            }
        }
        write_json(editorial_apps_file($dir), $apps);
        $closed = read_json($dir . '/editorials-closed.json', array());
        if (!is_array($closed)) $closed = array();
        $ed['closedAt'] = $now;
        $ed['closedBy'] = $me['name'];
        $ed['closeNote'] = $note;
        $closed[] = $ed;
        array_splice($editorials, $index, 1);
        if (!write_json(editorials_file($dir), $editorials) || !write_json($dir . '/editorials-closed.json', $closed)) {
            fail('Не удалось сохранить.', 500);
        }
        audit_log($dir, (string) $me['email'], 'editorial-close', 'закрыта редакция «' . $ed['name'] . '»: ' . $note);
        foreach ($members as $userId) {
            notify_user($dir, $userId, 'Редакция «' . $ed['name'] . '» закрыта решением директора проекта. Причина: ' . rtrim($note, " .!?") . '. Вы остаётесь автором проекта: материалы можно отправлять как раньше.',
                array('kind' => 'editorial', 'ref' => 'edclose:' . $id . ':' . $userId));
        }
        respond(array('ok' => true, 'members' => count($members)));
    }
    $list = read_editorial_open($dir);

    if ($act === 'editorial-open-mine') {
        $active = null;
        $past = array();
        foreach ($list as $a) {
            if ((string) $a['userId'] !== (string) $me['id']) continue;
            if (in_array($a['status'], array('draft', 'awaiting', 'review'), true)) $active = eo_public($a, false, $me);
            else $past[] = eo_public($a, false, $me);
        }
        usort($past, function ($a, $b) { return strcmp((string) $b['updatedAt'], (string) $a['updatedAt']); });
        respond(array(
            'ok' => true,
            'application' => $active,
            'past' => array_slice($past, 0, 10),
            'bases' => editorial_open_bases(),
            'teamMin' => EDITORIAL_TEAM_MIN,
            'teamMax' => EDITORIAL_TEAM_MAX,
            'headMinAge' => EDITORIAL_HEAD_MIN_AGE,
            'mailTo' => EDITORIAL_OPEN_MAIL,
            'ownsEditorial' => (bool) eo_owned_editorial($dir, $me['id']),
            'consentOk' => consent_ok($dir, $me),
        ));
    }

    /* Анкета: сохранить черновик или отправить. Прежняя кнопка «Создать
       редакцию» приходит сюда же и получает черновик заявления. */
    if ($act === 'editorial-open-save' || $act === 'editorial-create') {
        require_verified($me);
        require_consent($dir, $me);
        if (eo_owned_editorial($dir, $me['id'])) {
            fail('У вас уже есть редакция. Одна редакция на руководителя.', 409);
        }
        $raw = $act === 'editorial-create'
            ? array(
                'name' => isset($in['name']) ? $in['name'] : '',
                'region' => isset($in['region']) ? $in['region'] : '',
                'about' => isset($in['about']) ? $in['about'] : '',
            )
            : (isset($in['form']) ? $in['form'] : array());
        $submit = $act === 'editorial-open-save' && !empty($in['submit']);

        $index = eo_active_index($list, $me['id']);
        if ($index >= 0 && $list[$index]['status'] !== 'draft') {
            fail('Заявление уже отправлено. Чтобы исправить анкету, отзовите его и подайте заново.', 409);
        }
        $form = eo_form_clean($raw, $me);
        /* короткая форма со страницы региона не затирает уже заполненную анкету */
        if ($act === 'editorial-create' && $index >= 0) {
            $old = $list[$index]['form'];
            foreach (array('name', 'region', 'about') as $key) $old[$key] = $form[$key];
            $form = $old;
        }
        $now = date('c');
        if ($index < 0) {
            check_rate_for($dir, 'editorial-open', $me['id'], 12, 'Слишком много заявлений подряд. Попробуйте через час.');
            $list[] = array(
                'id' => 'eo_' . bin2hex(random_bytes(5)),
                'number' => '',
                'userId' => $me['id'],
                'userName' => $me['name'],
                'userEmail' => $me['email'],
                'status' => 'draft',
                'form' => $form,
                'note' => '',
                'createdAt' => $now,
                'updatedAt' => $now,
                'history' => array(),
            );
            $index = count($list) - 1;
        } else {
            $list[$index]['form'] = $form;
            $list[$index]['updatedAt'] = $now;
            $list[$index]['userName'] = $me['name'];
            $list[$index]['userEmail'] = $me['email'];
        }

        $problems = eo_form_problems($form);
        if ($submit) {
            if (count($problems)) {
                /* черновик сохраняем в любом случае: человек не теряет набранное */
                write_json(editorial_open_file($dir), $list);
                respond(array('ok' => false, 'error' => $problems[0], 'code' => 400, 'problems' => $problems,
                    'application' => eo_public($list[$index], false, $me)), 400);
            }
            if ($list[$index]['number'] === '') $list[$index]['number'] = eo_number_next($list);
            $list[$index]['status'] = 'awaiting';
            $list[$index]['submittedAt'] = $now;
            $list[$index]['note'] = '';
            eo_history_add($list[$index], 'submitted', $me['name']);
        }
        if (!write_json(editorial_open_file($dir), $list)) fail('Не удалось сохранить анкету.', 500);

        if ($submit) {
            $a = $list[$index];
            notify_user($dir, $me['id'], 'Заявление ' . $a['number'] . ' на открытие редакции «' . $form['name'] .
                '» сформировано. Распечатайте его в кабинете, подпишите и отправьте скан на ' . EDITORIAL_OPEN_MAIL .
                ' с почты аккаунта. После этого его рассмотрит директор.',
                array('kind' => 'editorial', 'ref' => 'eo:' . $a['id'] . ':submitted:' . date('YmdHi')));
            /* в ящик приёма — короткая отметка, чтобы ждали письмо со сканом */
            if (function_exists('mail_ready') && mail_ready($dir)) {
                mail_send(EDITORIAL_OPEN_MAIL, 'Заявление ' . $a['number'] . ': ждём подписанный скан',
                    "Сформировано заявление на открытие редакции.\n\n" .
                    'Номер: ' . $a['number'] . "\n" .
                    'Редакция: ' . $form['name'] . "\n" .
                    'Руководитель: ' . $form['headName'] . "\n" .
                    'Почта аккаунта: ' . $me['email'] . "\n\n" .
                    "Когда придёт подписанный скан, отметьте это в панели: «Редакции» → «Документ получен».\n",
                    '', 'redakcia');
            }
            audit_log($dir, (string) $me['email'], 'editorial-open', 'заявление ' . $a['number'] . ' — ' . $form['name']);
        }
        respond(array(
            'ok' => true,
            'pending' => true,
            'application' => eo_public($list[$index], false, $me),
            'problems' => $problems,
        ));
    }

    if ($act === 'editorial-open-withdraw') {
        $index = eo_active_index($list, $me['id']);
        if ($index < 0) fail('Активного заявления нет.', 404);
        $wasDraft = $list[$index]['status'] === 'draft';
        $list[$index]['status'] = 'withdrawn';
        $list[$index]['updatedAt'] = date('c');
        $list[$index]['decidedAt'] = date('c');
        eo_history_add($list[$index], 'withdrawn', $me['name']);
        if (!write_json(editorial_open_file($dir), $list)) fail('Не удалось сохранить.', 500);
        if (!$wasDraft) {
            audit_log($dir, (string) $me['email'], 'editorial-open', 'заявление ' . $list[$index]['number'] . ' отозвано заявителем');
        }
        respond(array('ok' => true, 'application' => eo_public($list[$index], false, $me)));
    }

    $intake = can_any($me, array('editorials.intake', 'editorials.open'));

    if ($act === 'editorial-open-get') {
        $id = text(isset($in['id']) ? $in['id'] : '', 40);
        $found = null;
        foreach ($list as $a) {
            if ($id !== '' && $a['id'] === $id) { $found = $a; break; }
            /* без номера — своё активное заявление */
            if ($id === '' && (string) $a['userId'] === (string) $me['id']
                && in_array($a['status'], array('draft', 'awaiting', 'review'), true)) { $found = $a; break; }
        }
        if (!$found) fail('Заявление не найдено.', 404);
        $own = (string) $found['userId'] === (string) $me['id'];
        if (!$own && !$intake) fail('Заявление видит заявитель и администрация проекта.', 403);
        $applicant = null;
        foreach (read_users($dir) as $u) {
            if ($u['id'] === $found['userId']) $applicant = $u;
        }
        respond(array(
            'ok' => true,
            'application' => eo_public($found, !$own, $applicant),
            'bases' => editorial_open_bases(),
            'mailTo' => EDITORIAL_OPEN_MAIL,
            'own' => $own,
        ));
    }

    /* ------------------------------------------------------ администрация */
    if (!$intake) fail('Заявления на открытие редакций видит администрация проекта.', 403);

    $usersById = array();
    foreach (read_users($dir) as $u) $usersById[$u['id']] = $u;

    if ($act === 'editorial-open-queue') {
        $out = array();
        $counts = array('awaiting' => 0, 'review' => 0, 'approved' => 0, 'rejected' => 0);
        foreach ($list as $a) {
            if ($a['status'] === 'draft') continue;
            if (isset($counts[$a['status']])) $counts[$a['status']]++;
            $out[] = eo_public($a, true, isset($usersById[$a['userId']]) ? $usersById[$a['userId']] : null);
        }
        $order = array('review' => 0, 'awaiting' => 1);
        usort($out, function ($a, $b) use ($order) {
            $pa = isset($order[$a['status']]) ? $order[$a['status']] : 2;
            $pb = isset($order[$b['status']]) ? $order[$b['status']] : 2;
            if ($pa !== $pb) return $pa - $pb;
            return $pa < 2
                ? strcmp((string) $a['submittedAt'], (string) $b['submittedAt'])
                : strcmp((string) $b['decidedAt'], (string) $a['decidedAt']);
        });
        respond(array(
            'ok' => true,
            'applications' => array_slice($out, 0, 300),
            'counts' => $counts,
            'bases' => editorial_open_bases(),
            'mailTo' => EDITORIAL_OPEN_MAIL,
            'canDecide' => can($me, 'editorials.open'),
        ));
    }

    $id = text(isset($in['id']) ? $in['id'] : '', 40);
    $note = text(isset($in['note']) ? $in['note'] : '', 600);

    if ($act === 'editorial-open-decide') {
        /* решение — только директор, и только под код из письма */
        $me = require_confirm($dir, $in, 'editorials.open');
        if (!can($me, 'editorials.open')) fail('Открыть редакцию решает только директор.', 403);
    }

    $index = -1;
    foreach ($list as $i => $a) {
        if ($a['id'] === $id) { $index = $i; break; }
    }
    if ($index < 0) fail('Заявление не найдено.', 404);
    $app = $list[$index];
    $applicant = isset($usersById[$app['userId']]) ? $usersById[$app['userId']] : null;
    $now = date('c');

    if ($act === 'editorial-open-received') {
        if ($app['status'] !== 'awaiting') fail('Отметить получение можно только у заявления, которое ждёт подписанный документ.', 409);
        $list[$index]['status'] = 'review';
        $list[$index]['receivedAt'] = $now;
        $list[$index]['receivedBy'] = $me['name'];
        $list[$index]['updatedAt'] = $now;
        eo_history_add($list[$index], 'received', $me['name'], $note);
        if (!write_json(editorial_open_file($dir), $list)) fail('Не удалось сохранить.', 500);
        audit_log($dir, (string) $me['email'], 'editorial-open', 'документ получен: ' . $app['number']);
        notify_user($dir, $app['userId'], 'Подписанное заявление ' . $app['number'] . ' получено и передано директору на решение.',
            array('kind' => 'editorial', 'ref' => 'eo:' . $app['id'] . ':received'));
        respond(array('ok' => true, 'application' => eo_public($list[$index], true, $applicant)));
    }

    if ($act === 'editorial-open-return') {
        if (!in_array($app['status'], array('awaiting', 'review'), true)) fail('Вернуть можно только заявление, по которому ещё нет решения.', 409);
        if (slen($note) < 5) fail('Напишите, что нужно исправить: заявитель увидит это в кабинете.');
        $list[$index]['status'] = 'draft';
        $list[$index]['note'] = $note;
        $list[$index]['updatedAt'] = $now;
        $list[$index]['receivedAt'] = '';
        eo_history_add($list[$index], 'returned', $me['name'], $note);
        if (!write_json(editorial_open_file($dir), $list)) fail('Не удалось сохранить.', 500);
        audit_log($dir, (string) $me['email'], 'editorial-open', 'возвращено на доработку: ' . $app['number']);
        notify_user($dir, $app['userId'], 'Заявление ' . $app['number'] . ' возвращено на доработку: ' . $note .
            ' Исправьте анкету в кабинете и отправьте заново.',
            array('kind' => 'editorial', 'ref' => 'eo:' . $app['id'] . ':returned:' . date('YmdHi')));
        respond(array('ok' => true, 'application' => eo_public($list[$index], true, $applicant)));
    }

    if ($act === 'editorial-open-decide') {
        $decision = isset($in['decision']) ? (string) $in['decision'] : '';
        if (!in_array($decision, array('approved', 'rejected'), true)) fail('Решение — «открыть» или «отказать».');
        if ($app['status'] !== 'review') {
            fail($app['status'] === 'awaiting'
                ? 'Подписанное заявление ещё не получено. Сначала отметьте «Документ получен».'
                : 'По этому заявлению решение уже принято.', 409);
        }
        if ((string) $app['userId'] === (string) $me['id']) fail('Своё заявление рассматривает другой руководитель.', 403);
        if ($decision === 'rejected' && slen($note) < 5) fail('Для отказа нужна причина: заявитель увидит её в кабинете.');
        if (!$applicant || (isset($applicant['status']) && $applicant['status'] === 'deleted')) {
            fail('Аккаунт заявителя удалён — открывать редакцию некому.', 409);
        }
        $form = $app['form'];

        if ($decision === 'approved') {
            if (eo_owned_editorial($dir, $app['userId'])) fail('У заявителя уже есть редакция.', 409);
            $editorials = read_editorials($dir);
            $editorial = array(
                'id' => 'ed_' . bin2hex(random_bytes(5)),
                'region' => $form['region'],
                'name' => $form['name'],
                'about' => $form['about'],
                'city' => $form['city'],
                'base' => $form['base'],
                'baseName' => $form['baseName'],
                'founderId' => $app['userId'],
                'founderName' => $applicant['name'],
                'applicationId' => $app['id'],
                'applicationNumber' => $app['number'],
                'openedBy' => $me['name'],
                'createdAt' => $now,
            );
            $editorials[] = $editorial;
            if (!write_json(editorials_file($dir), $editorials)) fail('Не удалось создать редакцию.', 500);

            /* руководитель получает роль редакции — если у него не старше */
            $users = read_users($dir);
            foreach ($users as $i => $u) {
                if ($u['id'] !== $app['userId']) continue;
                /* был участником другой редакции — оттуда он выходит */
                $before = isset($u['editorialId']) ? (string) $u['editorialId'] : '';
                if ($before !== '') {
                    $apps = read_editorial_apps($dir);
                    foreach ($apps as $k => $a) {
                        if ((string) $a['userId'] === (string) $u['id'] && (string) $a['editorialId'] === $before && $a['status'] === 'approved') {
                            $apps[$k]['status'] = 'left';
                            $apps[$k]['leftAt'] = $now;
                            $apps[$k]['note'] = 'открыл свою редакцию';
                        }
                    }
                    write_json(editorial_apps_file($dir), $apps);
                }
                $users[$i]['editorialId'] = $editorial['id'];
                if (role_level(isset($u['access']) ? $u['access'] : '') < ROLE_LEVELS['Редакционный основатель']) {
                    $users[$i]['access'] = 'Редакционный основатель';
                }
                break;
            }
            if (!write_json(users_file($dir), $users)) fail('Редакция создана, но роль руководителя не сохранилась. Выдайте её в карточке человека.', 500);
            $list[$index]['editorialId'] = $editorial['id'];
        }

        $list[$index]['status'] = $decision;
        $list[$index]['note'] = $note;
        $list[$index]['decidedAt'] = $now;
        $list[$index]['decidedBy'] = $me['name'];
        $list[$index]['updatedAt'] = $now;
        eo_history_add($list[$index], $decision, $me['name'], $note);
        if (!write_json(editorial_open_file($dir), $list)) fail('Не удалось сохранить решение.', 500);

        audit_log($dir, (string) $me['email'], 'editorial-open',
            ($decision === 'approved' ? 'редакция открыта: ' : 'отказ в открытии: ') . $app['number'] . ' — ' . $form['name']);
        notify_user($dir, $app['userId'], $decision === 'approved'
            ? 'Редакция «' . $form['name'] . '» открыта решением директора. Вы — её руководитель: заявки участников и материалы редакции теперь в вашем кабинете и в панели.'
            : 'В открытии редакции «' . $form['name'] . '» отказано: ' . $note,
            array('kind' => 'editorial', 'ref' => 'eo:' . $app['id'] . ':' . $decision));
        respond(array('ok' => true, 'application' => eo_public($list[$index], true, $applicant)));
    }

    return false;
}
