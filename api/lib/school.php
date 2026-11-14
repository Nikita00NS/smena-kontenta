<?php
/* ============================================================================
   МЕДИАШКОЛА: заявка → решение редакции → статус в кабинете.

   Это обучение, а не приём на работу, поэтому без теста и чек-листа:
   1. человек подаёт заявку из кабинета или со страницы медиашколы
      (направление, мотивация; нужны оба согласия — как и везде);
   2. редакция принимает или отклоняет с объяснением;
   3. принятый видит в кабинете следующий шаг — первое задание.

   Одна активная заявка на человека: пока одна «в работе» или принята,
   новую подать нельзя. После отказа можно подать снова.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

function school_file($dir) { return $dir . '/school.json'; }

function school_directions() {
    return array(
        'Текст и работа с фактурой',
        'Интервью',
        'Фотография',
        'Видео и монтаж',
        'Соцсети и дизайн',
        'Проверка информации',
    );
}

function read_school($dir) {
    $list = read_json(school_file($dir), array());
    return is_array($list) ? $list : array();
}

function school_by_user($dir, $userId) {
    /* заявки хранятся в порядке подачи: актуальная — последняя в журнале */
    $best = null;
    foreach (read_school($dir) as $app) {
        if ((string) $app['userId'] !== (string) $userId) continue;
        $best = $app;
    }
    return $best;
}

function school_public($app) {
    if (!$app) return null;
    return array(
        'id' => $app['id'],
        'userId' => $app['userId'],
        'name' => isset($app['name']) ? $app['name'] : '',
        'direction' => isset($app['direction']) ? $app['direction'] : '',
        'motivation' => isset($app['motivation']) ? $app['motivation'] : '',
        'status' => isset($app['status']) ? $app['status'] : 'pending',
        'createdAt' => isset($app['createdAt']) ? $app['createdAt'] : '',
        'decidedAt' => isset($app['decidedAt']) ? $app['decidedAt'] : '',
        'decidedBy' => isset($app['decidedBy']) ? $app['decidedBy'] : '',
        'note' => isset($app['note']) ? $app['note'] : '',
        'cohortId' => isset($app['cohortId']) ? $app['cohortId'] : '',
    );
}

function school_public_list($dir) {
    $out = array();
    foreach (array_reverse(read_school($dir)) as $app) {
        $out[] = school_public($app);
    }
    return $out;
}

/* ============================== маршруты ================================= */

function school_routes($act, $dir) {
    $handled = array('school-directions', 'school-apply', 'school-mine', 'school-list', 'school-decide');
    if (!in_array($act, $handled, true)) return false;

    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);

    if ($act === 'school-directions') {
        respond(array('ok' => true, 'directions' => school_directions()));
    }

    if ($act === 'school-mine') {
        respond(array(
            'ok' => true,
            'application' => school_public(school_by_user($dir, $me['id'])),
            'directions' => school_directions(),
        ));
    }

    if ($act === 'school-apply') {
        require_consent($dir, $me);
        $existing = school_by_user($dir, $me['id']);
        if ($existing && in_array($existing['status'], array('pending', 'accepted'), true)) {
            fail('Заявка уже есть. Откройте кабинет — там видно, на каком она этапе.', 409);
        }
        /* набор создаёт и открывает редакция: пока приём закрыт — заявок нет */
        if (!school_open_cohort($dir)) {
            fail('Набор медиашколы пока не открыт. Создайте аккаунт — как откроем, подать заявку можно будет прямо здесь.', 409);
        }
        $direction = text((string) (isset($in['direction']) ? $in['direction'] : ''), 80);
        if (!in_array($direction, school_directions(), true)) fail('Выберите направление из списка.');
        $motivation = text((string) (isset($in['motivation']) ? $in['motivation'] : ''), 1500);
        if (slen($motivation) < 40) fail('Расскажите о себе хотя бы в 40 символах — это часть отбора.');

        $app = array(
            'id' => 'sc_' . bin2hex(random_bytes(5)),
            'userId' => $me['id'],
            'name' => $me['name'],
            'email' => $me['email'],
            'direction' => $direction,
            'motivation' => $motivation,
            'status' => 'pending',
            'createdAt' => date('c'),
            'history' => array(array('at' => date('c'), 'by' => $me['email'], 'what' => 'Заявка подана')),
        );
        $list = read_school($dir);
        $list[] = $app;
        if (!write_json(school_file($dir), $list)) fail('Заявка не сохранилась.', 500);
        audit_log($dir, $me['email'], 'заявка в медиашколу', $direction);
        mail_notify($dir, 'school_new', 'support@smenakontenta.ru', array(
            'name' => $me['name'], 'direction' => $direction, 'link' => 'https://smenakontenta.ru/admin/',
        ), array('dedupe' => 'school:' . $app['id']));
        respond(array('ok' => true, 'application' => school_public($app)));
    }

    if ($act === 'school-list') {
        if (!can($me, 'hiring.view')) fail('Заявки видит только редакция и администрация.', 403);
        respond(array('ok' => true, 'applications' => school_public_list($dir), 'canDecide' => can($me, 'hiring.decide')));
    }

    if ($act === 'school-decide') {
        if (!can($me, 'hiring.decide')) fail('Решение принимает главный редактор или администрация.', 403);
        $id = (string) (isset($in['id']) ? $in['id'] : '');
        $decision = (string) (isset($in['decision']) ? $in['decision'] : '');
        $note = text((string) (isset($in['note']) ? $in['note'] : ''), 500);
        if (!in_array($decision, array('approve', 'reject'), true)) fail('Решение — «approve» или «reject».');

        $list = read_school($dir);
        $index = -1;
        foreach ($list as $i => $row) {
            if ($row['id'] === $id) { $index = $i; break; }
        }
        if ($index < 0) fail('Заявка не найдена.', 404);
        $app = $list[$index];
        if ($app['status'] !== 'pending') fail('Заявка уже решена.', 409);

        $users = read_users($dir);
        $target = null;
        foreach ($users as $u) {
            if ($u['id'] === $app['userId']) { $target = $u; break; }
        }
        if (!$target) fail('Аккаунт заявителя не найден.', 404);

        if ($decision === 'approve') {
            $list[$index]['status'] = 'accepted';
            $list[$index]['decidedAt'] = date('c');
            $list[$index]['decidedBy'] = $me['email'];
            $list[$index]['note'] = $note;
            $list[$index]['history'][] = array('at' => date('c'), 'by' => $me['email'], 'what' => 'Принят в медиашколу');
            mail_notify($dir, 'school_accepted', $target['email'], array(
                'name' => $target['name'], 'direction' => $app['direction'],
                'link' => 'https://smenakontenta.ru/profile/',
            ), array('dedupe' => 'school-ok:' . $app['id']));
            audit_log($dir, $me['email'], 'принят в медиашколу', $target['email'] . ' → ' . $app['direction']);
        } else {
            if (slen($note) < 5) fail('Напишите причину отказа — человек должен понимать, что улучшить.');
            $list[$index]['status'] = 'rejected';
            $list[$index]['decidedAt'] = date('c');
            $list[$index]['decidedBy'] = $me['email'];
            $list[$index]['note'] = $note;
            $list[$index]['history'][] = array('at' => date('c'), 'by' => $me['email'], 'what' => 'Отказ');
            mail_notify($dir, 'school_rejected', $target['email'], array(
                'name' => $target['name'], 'direction' => $app['direction'], 'reason' => $note,
                'link' => 'https://smenakontenta.ru/media-school',
            ), array('dedupe' => 'school-no:' . $app['id']));
            audit_log($dir, $me['email'], 'отказ в медиашколе', $app['email'] . ': ' . $note);
        }
        if (!write_json(school_file($dir), $list)) fail('Решение не сохранилось.', 500);
        respond(array('ok' => true, 'application' => school_public($list[$index])));
    }

    return true;
}

/* ============================================================================
   ПЛАТФОРМА МЕДИАШКОЛЫ: наборы (группы), задания, домашние работы, разборы.
   Набор = группа учеников с общим темпом: у заданий общий дедлайн,
   групповые разборы видит весь набор, личные комментарии — только автор.
   Приём в набор управляется флагом intakeOpen: пока он закрыт, новые
   заявки сервер не принимает — «набор ещё не открыт».
   ========================================================================== */

function school_cohorts_file($dir) { return $dir . '/school-cohorts.json'; }
function school_assignments_file($dir) { return $dir . '/school-assignments.json'; }
function school_subs_file($dir) { return $dir . '/school-subs.json'; }

function read_school_cohorts($dir) {
    $v = read_json(school_cohorts_file($dir), array());
    return is_array($v) ? $v : array();
}
function read_school_assignments($dir) {
    $v = read_json(school_assignments_file($dir), array());
    return is_array($v) ? $v : array();
}
function read_school_subs($dir) {
    $v = read_json(school_subs_file($dir), array());
    return is_array($v) ? $v : array();
}

function school_cohort_public($c, $dir) {
    $students = 0;
    foreach (read_school($dir) as $app) {
        if (isset($app['cohortId']) && (string) $app['cohortId'] === (string) $c['id']
            && $app['status'] === 'accepted') $students++;
    }
    $subs = read_school_subs($dir);
    $checked = 0;
    foreach ($subs as $s) {
        if ((string) $s['cohortId'] === (string) $c['id'] && !empty($s['reviewedAt'])) $checked++;
    }
    return array(
        'id' => $c['id'],
        'name' => $c['name'],
        'open' => !empty($c['open']),
        'createdAt' => $c['createdAt'],
        'openedAt' => isset($c['openedAt']) ? $c['openedAt'] : '',
        'students' => $students,
        'assignments' => count(array_filter(read_school_assignments($dir), function ($a) use ($c) {
            return (string) $a['cohortId'] === (string) $c['id'];
        })),
        'checked' => $checked,
    );
}

function school_open_cohort($dir) {
    foreach (read_school_cohorts($dir) as $c) {
        if (!empty($c['open'])) return $c;
    }
    return null;
}

function school_user_cohort($dir, $userId) {
    $app = null;
    foreach (read_school($dir) as $a) {
        if ((string) $a['userId'] === (string) $userId
            && $a['status'] === 'accepted' && !empty($a['cohortId'])) $app = $a;
    }
    if (!$app) return null;
    foreach (read_school_cohorts($dir) as $c) {
        if ((string) $c['id'] === (string) $app['cohortId']) return $c;
    }
    return null;
}

function school_sub_public($s) {
    return array(
        'id' => $s['id'],
        'cohortId' => $s['cohortId'],
        'assignmentId' => $s['assignmentId'],
        'userId' => $s['userId'],
        'userName' => isset($s['userName']) ? $s['userName'] : '',
        'text' => $s['text'],
        'aiNote' => isset($s['aiNote']) ? $s['aiNote'] : '',
        'status' => $s['status'],
        'createdAt' => $s['createdAt'],
        'reviewedAt' => isset($s['reviewedAt']) ? $s['reviewedAt'] : '',
        'points' => isset($s['points']) ? (int) $s['points'] : 0,
        'groupNote' => isset($s['groupNote']) ? $s['groupNote'] : '',
        'personalNote' => isset($s['personalNote']) ? $s['personalNote'] : '',
        'aiChecked' => !empty($s['aiChecked']),
        'attempt' => isset($s['attempt']) ? (int) $s['attempt'] : 1,
    );
}

/* платформенные действия; возвращает true, если действие обработано */
function school_platform_routes($act, $dir) {
    $handled = array(
        'school-cohort-create', 'school-cohort-set', 'school-cohorts',
        'school-assignment-add', 'school-assignments',
        'school-sub-send', 'school-sub-queue', 'school-sub-review', 'school-my-course',
        'school-enroll',
    );
    if (!in_array($act, $handled, true)) return false;

    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);

    /* ---- наборы ---- */
    if ($act === 'school-cohort-create') {
        if (!can($me, 'school.manage')) fail('Наборы создаёт редакция школы.', 403);
        $name = text((string) (isset($in['name']) ? $in['name'] : ''), 80);
        if (slen($name) < 3) fail('Дайте набору название — хотя бы 3 символа.');
        $list = read_school_cohorts($dir);
        foreach ($list as $c) {
            if (mb_strtolower($c['name']) === mb_strtolower($name)) fail('Набор с таким названием уже есть.', 409);
        }
        $n = count($list) + 1;
        $cohort = array(
            'id' => 'scg_' . bin2hex(random_bytes(4)),
            'name' => $name,
            /* набор создаётся с ЗАКРЫТЫМ приёмом: открывает редакция */
            'open' => false,
            'createdAt' => date('c'),
        );
        $list[] = $cohort;
        if (!write_json(school_cohorts_file($dir), $list)) fail('Не удалось сохранить набор.', 500);
        audit_log($dir, $me['email'], 'медиашкола', 'создан набор «' . $name . '» (приём закрыт)');
        respond(array('ok' => true, 'cohort' => school_cohort_public($cohort, $dir)));
    }

    if ($act === 'school-cohort-set') {
        if (!can($me, 'school.manage')) fail('Наборами управляет редакция школы.', 403);
        $id = text((string) (isset($in['id']) ? $in['id'] : ''), 40);
        $open = !empty($in['open']);
        $list = read_school_cohorts($dir);
        foreach ($list as $i => $c) {
            if ((string) $c['id'] !== (string) $id) continue;
            $list[$i]['open'] = $open ? true : false;
            if ($open && empty($c['openedAt'])) $list[$i]['openedAt'] = date('c');
            if (!write_json(school_cohorts_file($dir), $list)) fail('Не удалось сохранить набор.', 500);
            audit_log($dir, $me['email'], 'медиашкола', 'набор «' . $c['name'] . '»: приём ' . ($open ? 'открыт' : 'закрыт'));
            respond(array('ok' => true, 'cohort' => school_cohort_public($list[$i], $dir)));
        }
        fail('Набор не найден.', 404);
    }

    if ($act === 'school-cohorts') {
        if (!can($me, 'school.manage') && !can($me, 'school.teach') && !can($me, 'school.review')) {
            fail('Раздел школы доступен редакции.', 403);
        }
        $out = array();
        foreach (read_school_cohorts($dir) as $c) $out[] = school_cohort_public($c, $dir);
        respond(array('ok' => true, 'cohorts' => $out,
            'applications' => school_public_list($dir), 'directions' => school_directions()));
    }

    /* ---- задания ---- */
    if ($act === 'school-assignment-add') {
        if (!can($me, 'school.manage')) fail('Задания добавляет редакция школы.', 403);
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $title = text((string) (isset($in['title']) ? $in['title'] : ''), 120);
        $brief = text((string) (isset($in['brief']) ? $in['brief'] : ''), 4000);
        $dueAt = text((string) (isset($in['dueAt']) ? $in['dueAt'] : ''), 40);
        $order = (int) (isset($in['order']) ? $in['order'] : 0);
        if (slen($title) < 4) fail('Название задания слишком короткое.');
        if (slen($brief) < 20) fail('Опишите задание — хотя бы 20 символов.');
        $found = false;
        foreach (read_school_cohorts($dir) as $c) {
            if ((string) $c['id'] === (string) $cohortId) { $found = true; break; }
        }
        if (!$found) fail('Набор не найден.', 404);
        $list = read_school_assignments($dir);
        if ($order <= 0) $order = count(array_filter($list, function ($a) use ($cohortId) {
            return (string) $a['cohortId'] === (string) $cohortId;
        })) + 1;
        $row = array(
            'id' => 'sca_' . bin2hex(random_bytes(4)),
            'cohortId' => $cohortId,
            'order' => $order,
            'title' => $title,
            'brief' => $brief,
            'dueAt' => $dueAt,
            'createdAt' => date('c'),
        );
        $list[] = $row;
        if (!write_json(school_assignments_file($dir), $list)) fail('Не удалось сохранить задание.', 500);
        audit_log($dir, $me['email'], 'медиашкола', 'задание «' . $title . '» добавлено');
        respond(array('ok' => true, 'assignment' => $row));
    }

    if ($act === 'school-assignments') {
        if (!can($me, 'school.manage') && !can($me, 'school.teach') && !can($me, 'school.review')
            && !can($me, 'school.enroll')) {
            fail('Задания доступны редакции и ученикам школы.', 403);
        }
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $list = array_values(array_filter(read_school_assignments($dir), function ($a) use ($cohortId) {
            return (string) $a['cohortId'] === (string) $cohortId;
        }));
        usort($list, function ($a, $b) { return (int) $a['order'] - (int) $b['order']; });
        respond(array('ok' => true, 'assignments' => $list));
    }

    /* ---- домашние работы ---- */
    if ($act === 'school-sub-send') {
        $cohort = school_user_cohort($dir, $me['id']);
        if (!$cohort) fail('Вы не зачислены в набор школы. Статус заявки — в кабинете.', 403);
        $assignmentId = text((string) (isset($in['assignmentId']) ? $in['assignmentId'] : ''), 40);
        $textValue = text((string) (isset($in['text']) ? $in['text'] : ''), 20000);
        $aiNote = text((string) (isset($in['aiNote']) ? $in['aiNote'] : ''), 500);
        $assignment = null;
        foreach (read_school_assignments($dir) as $a) {
            if ((string) $a['id'] === (string) $assignmentId && (string) $a['cohortId'] === (string) $cohort['id']) {
                $assignment = $a; break;
            }
        }
        if (!$assignment) fail('Задание не найдено в вашем наборе.', 404);
        if (slen($textValue) < 40) fail('Работа слишком короткая — минимум 40 символов.');
        $subs = read_school_subs($dir);
        $attempt = 1;
        foreach ($subs as $s) {
            if ((string) $s['assignmentId'] === (string) $assignmentId
                && (string) $s['userId'] === (string) $me['id']) $attempt++;
        }
        $row = array(
            'id' => 'scs_' . bin2hex(random_bytes(5)),
            'cohortId' => $cohort['id'],
            'assignmentId' => $assignmentId,
            'cohortId' => $cohort['id'],
            'userId' => $me['id'],
            'userName' => $me['name'],
            'text' => $textValue,
            'aiNote' => $aiNote,
            'status' => 'pending',
            'createdAt' => date('c'),
            'attempt' => $attempt,
        );
        $subs[] = $row;
        if (!write_json(school_subs_file($dir), $subs)) fail('Не удалось сохранить работу.', 500);
        audit_log($dir, $me['email'], 'медиашкола', 'работа сдана: ' . $assignment['title'] . ' (попытка ' . $attempt . ')');
        respond(array('ok' => true, 'submission' => school_sub_public($row)));
    }

    if ($act === 'school-sub-queue') {
        if (!can($me, 'school.review') && !can($me, 'school.manage')) fail('Работы проверяет редакция школы.', 403);
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $out = array();
        foreach (read_school_subs($dir) as $s) {
            if ((string) $s['cohortId'] === (string) $cohortId) $out[] = school_sub_public($s);
        }
        usort($out, function ($a, $b) {
            if ($a['status'] !== $b['status']) return $a['status'] === 'pending' ? -1 : 1;
            return strcmp($a['createdAt'], $b['createdAt']);
        });
        respond(array('ok' => true, 'subs' => $out));
    }

    if ($act === 'school-sub-review') {
        if (!can($me, 'school.review')) fail('Разбор работ делает редакция школы.', 403);
        $id = text((string) (isset($in['id']) ? $in['id'] : ''), 40);
        $decision = (string) (isset($in['decision']) ? $in['decision'] : '');
        $points = max(0, min(50, (int) (isset($in['points']) ? $in['points'] : 0)));
        $groupNote = text((string) (isset($in['groupNote']) ? $in['groupNote'] : ''), 3000);
        $personalNote = text((string) (isset($in['personalNote']) ? $in['personalNote'] : ''), 3000);
        $aiChecked = !empty($in['aiChecked']);
        if (!in_array($decision, array('accepted', 'returned'), true)) fail('Решение — «accepted» или «returned».');
        $subs = read_school_subs($dir);
        foreach ($subs as $i => $s) {
            if ((string) $s['id'] !== (string) $id) continue;
            $subs[$i]['status'] = $decision;
            $subs[$i]['points'] = $points;
            $subs[$i]['groupNote'] = $groupNote;
            $subs[$i]['personalNote'] = $personalNote;
            $subs[$i]['aiChecked'] = $aiChecked;
            $subs[$i]['reviewedAt'] = date('c');
            $subs[$i]['reviewedBy'] = $me['name'];
            if (!write_json(school_subs_file($dir), $subs)) fail('Не удалось сохранить разбор.', 500);
            /* баллы за принятую работу — в общий баланс участника */
            if ($decision === 'accepted' && $points > 0 && function_exists('points_add')) {
                points_add($dir, $s['userId'], $points, 'school', $me['name'],
                    'Медиашкола: ' . (isset($s['userName']) ? $s['userName'] : ''));
            }
            audit_log($dir, $me['email'], 'медиашкола',
                'работа ' . ($decision === 'accepted' ? 'принята' : 'возвращена') . ' · ' . $points . ' б.');
            respond(array('ok' => true, 'submission' => school_sub_public($subs[$i])));
        }
        fail('Работа не найдена.', 404);
    }

    /* ---- зачисление в набор ---- */
    if ($act === 'school-enroll') {
        if (!can($me, 'school.manage')) fail('Зачисляет в набор редакция школы.', 403);
        $appId = text((string) (isset($in['appId']) ? $in['appId'] : ''), 40);
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $cohortFound = false;
        foreach (read_school_cohorts($dir) as $c) {
            if ((string) $c['id'] === (string) $cohortId) { $cohortFound = true; break; }
        }
        if (!$cohortFound) fail('Набор не найден.', 404);
        $list = read_school($dir);
        foreach ($list as $i => $a) {
            if ((string) $a['id'] !== (string) $appId) continue;
            if ($a['status'] !== 'accepted') fail('Зачислить можно только принятую заявку.', 409);
            $list[$i]['cohortId'] = $cohortId;
            if (!write_json(school_file($dir), $list)) fail('Не удалось зачислить.', 500);
            audit_log($dir, $me['email'], 'медиашкола', 'зачисление в набор: ' . (isset($a['name']) ? $a['name'] : ''));
            respond(array('ok' => true, 'application' => school_public($list[$i])));
        }
        fail('Заявка не найдена.', 404);
    }

    /* ---- курс ученика ---- */
    if ($act === 'school-my-course') {
        $cohort = school_user_cohort($dir, $me['id']);
        if (!$cohort) {
            respond(array('ok' => true, 'cohort' => null, 'assignments' => array(), 'subs' => array(),
                'open' => !is_null(school_open_cohort($dir))));
        }
        $assignments = array_values(array_filter(read_school_assignments($dir), function ($a) use ($cohort) {
            return (string) $a['cohortId'] === (string) $cohort['id'];
        }));
        usort($assignments, function ($a, $b) { return (int) $a['order'] - (int) $b['order']; });
        $mine = array();
        foreach (read_school_subs($dir) as $s) {
            if ((string) $s['userId'] === (string) $me['id']) {
                $mine[] = school_sub_public($s);
            } else if ((string) $s['cohortId'] === (string) $cohort['id']
                && $s['status'] === 'accepted' && slen(isset($s['groupNote']) ? $s['groupNote'] : '') > 0) {
                /* групповой разбор видит весь набор: без текста работы, только разбор */
                $mine[] = array(
                    'id' => $s['id'], 'assignmentId' => $s['assignmentId'],
                    'userName' => isset($s['userName']) ? $s['userName'] : '', 'text' => '',
                    'status' => 'accepted', 'groupNote' => $s['groupNote'],
                    'reviewedAt' => isset($s['reviewedAt']) ? $s['reviewedAt'] : '',
                    'group' => true, 'points' => 0,
                );
            }
        }
        respond(array('ok' => true, 'cohort' => array('id' => $cohort['id'], 'name' => $cohort['name']),
            'assignments' => $assignments, 'subs' => $mine,
            'points' => function_exists('points_balance') ? points_balance($dir, $me['id']) : 0));
    }

    return true;
}
