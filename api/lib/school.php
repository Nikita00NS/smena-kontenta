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

/* ---- учебные модули набора: теория, пример разбора, чек-лист к заданию ---- */
function school_modules_file($dir) { return $dir . '/school-modules.json'; }

function read_school_modules($dir) {
    $v = read_json(school_modules_file($dir), array());
    return is_array($v) ? $v : array();
}

function school_module_public($m) {
    return array(
        'id' => $m['id'],
        'cohortId' => isset($m['cohortId']) ? $m['cohortId'] : '',
        'assignmentId' => isset($m['assignmentId']) ? $m['assignmentId'] : '',
        'title' => isset($m['title']) ? $m['title'] : '',
        'checklist' => isset($m['checklist']) ? $m['checklist'] : '',
        'body' => isset($m['body']) ? $m['body'] : '',
        'order' => isset($m['order']) ? (int) $m['order'] : 0,
        'createdAt' => isset($m['createdAt']) ? $m['createdAt'] : '',
    );
}

/* ---- тесты набора: вопросы с вариантами, автопроверка, баллы за первый зачёт ---- */
function school_quizzes_file($dir) { return $dir . '/school-quizzes.json'; }

function read_school_quizzes($dir) {
    $v = read_json(school_quizzes_file($dir), array());
    return is_array($v) ? $v : array();
}

function school_quiz_public($q) {
    $questions = array();
    foreach ((isset($q['questions']) && is_array($q['questions'])) ? $q['questions'] : array() as $qs) {
        $options = array();
        foreach ((isset($qs['options']) && is_array($qs['options'])) ? $qs['options'] : array() as $oi => $opt) {
            $options[] = array('text' => (string) (isset($opt['text']) ? $opt['text'] : ''), 'correct' => !empty($opt['correct']));
        }
        $questions[] = array(
            'id' => (string) (isset($qs['id']) ? $qs['id'] : ('q' . $oi)),
            'text' => (string) (isset($qs['text']) ? $qs['text'] : ''),
            'explanation' => (string) (isset($qs['explanation']) ? $qs['explanation'] : ''),
            'options' => $options,
        );
    }
    return array(
        'id' => isset($q['id']) ? $q['id'] : '',
        'cohortId' => isset($q['cohortId']) ? $q['cohortId'] : '',
        'assignmentId' => isset($q['assignmentId']) ? $q['assignmentId'] : '',
        'title' => isset($q['title']) ? $q['title'] : '',
        'intro' => isset($q['intro']) ? $q['intro'] : '',
        'passScore' => isset($q['passScore']) ? (int) $q['passScore'] : 70,
        'points' => isset($q['points']) ? (int) $q['points'] : 5,
        'questions' => $questions,
        'createdAt' => isset($q['createdAt']) ? $q['createdAt'] : '',
    );
}

function school_quiz_result_public($r) {
    return array(
        'quizId' => isset($r['quizId']) ? $r['quizId'] : '',
        'userId' => isset($r['userId']) ? $r['userId'] : '',
        'userName' => isset($r['userName']) ? $r['userName'] : '',
        'score' => isset($r['score']) ? (int) $r['score'] : 0,
        'passed' => !empty($r['passed']),
        'attempt' => isset($r['attempt']) ? (int) $r['attempt'] : 1,
        'answers' => isset($r['answers']) && is_array($r['answers']) ? $r['answers'] : array(),
        'createdAt' => isset($r['createdAt']) ? $r['createdAt'] : '',
    );
}

function school_cohort_students($dir, $cohortId) {
    $out = array();
    foreach (read_school($dir) as $app) {
        if (!isset($app['cohortId']) || (string) $app['cohortId'] !== (string) $cohortId) continue;
        if (!isset($app['status']) || $app['status'] !== 'accepted') continue;
        if (empty($app['email'])) continue;
        $out[] = $app;
    }
    return $out;
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
        'school-module-add', 'school-module-set', 'school-module-delete',
        'school-modules', 'school-cohort-csv',
        'school-quiz-add', 'school-quiz-delete', 'school-quizzes',
        'school-quiz-submit', 'school-quiz-results', 'school-diary',
        'school-sub-remind',
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
        /* письмо каждому ученику набора: новое задание и общий дедлайн */
        $cohortName = '';
        foreach (read_school_cohorts($dir) as $c) {
            if ((string) $c['id'] === (string) $cohortId) { $cohortName = isset($c['name']) ? $c['name'] : ''; break; }
        }
        foreach (school_cohort_students($dir, $cohortId) as $st) {
            mail_notify($dir, 'school_assignment_new', (string) $st['email'], array(
                'name' => isset($st['name']) ? $st['name'] : '',
                'cohort' => $cohortName,
                'title' => $title,
                'due' => $dueAt !== '' ? $dueAt : 'без жёсткого срока',
            ), array(
                'kind' => 'school_assignment_new',
                'by' => isset($me['name']) ? $me['name'] : 'редакция',
                'dedupe' => 'assignment:' . $row['id'] . ':' . (isset($st['userId']) ? $st['userId'] : ''),
            ));
        }
        respond(array('ok' => true, 'assignment' => $row, 'notified' => count(school_cohort_students($dir, $cohortId))));
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

    /* ---- учебные модули набора ---- */
    if ($act === 'school-module-add') {
        if (!can($me, 'school.manage')) fail('Модули добавляет редакция школы.', 403);
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $assignmentId = text((string) (isset($in['assignmentId']) ? $in['assignmentId'] : ''), 40);
        $title = text((string) (isset($in['title']) ? $in['title'] : ''), 120);
        $checklist = text((string) (isset($in['checklist']) ? $in['checklist'] : ''), 600);
        $body = text((string) (isset($in['body']) ? $in['body'] : ''), 8000);
        if (slen($title) < 4) fail('Название модуля слишком короткое.');
        if (slen($body) < 20) fail('Напишите материал модуля — хотя бы 20 символов.');
        $found = false;
        foreach (read_school_cohorts($dir) as $c) {
            if ((string) $c['id'] === (string) $cohortId) { $found = true; break; }
        }
        if (!$found) fail('Набор не найден.', 404);
        if ($assignmentId !== '') {
            $linked = false;
            foreach (read_school_assignments($dir) as $a) {
                if ((string) $a['id'] === (string) $assignmentId && (string) $a['cohortId'] === (string) $cohortId) { $linked = true; break; }
            }
            if (!$linked) fail('Задание не найдено в этом наборе.', 404);
        }
        $list = read_school_modules($dir);
        $order = count(array_filter($list, function ($m) use ($cohortId) {
            return (string) (isset($m['cohortId']) ? $m['cohortId'] : '') === (string) $cohortId;
        })) + 1;
        $row = array(
            'id' => 'scm_' . bin2hex(random_bytes(4)),
            'cohortId' => $cohortId,
            'assignmentId' => $assignmentId,
            'title' => $title,
            'checklist' => $checklist,
            'body' => $body,
            'order' => $order,
            'createdAt' => date('c'),
        );
        $list[] = $row;
        if (!write_json(school_modules_file($dir), $list)) fail('Не удалось сохранить модуль.', 500);
        audit_log($dir, $me['email'], 'медиашкола', 'модуль «' . $title . '» добавлен');
        respond(array('ok' => true, 'module' => school_module_public($row)));
    }

    if ($act === 'school-module-set') {
        if (!can($me, 'school.manage')) fail('Модули правит редакция школы.', 403);
        $id = text((string) (isset($in['id']) ? $in['id'] : ''), 40);
        $list = read_school_modules($dir);
        foreach ($list as $i => $m) {
            if ((string) $m['id'] !== (string) $id) continue;
            if (isset($in['title'])) {
                $t = text((string) $in['title'], 120);
                if (slen($t) < 4) fail('Название модуля слишком короткое.');
                $list[$i]['title'] = $t;
            }
            if (isset($in['checklist'])) $list[$i]['checklist'] = text((string) $in['checklist'], 600);
            if (isset($in['body'])) {
                $b = text((string) $in['body'], 8000);
                if (slen($b) < 20) fail('Материал модуля — минимум 20 символов.');
                $list[$i]['body'] = $b;
            }
            if (isset($in['assignmentId'])) {
                $aid = text((string) $in['assignmentId'], 40);
                if ($aid !== '') {
                    $linked = false;
                    foreach (read_school_assignments($dir) as $a) {
                        if ((string) $a['id'] === (string) $aid && (string) $a['cohortId'] === (string) $m['cohortId']) { $linked = true; break; }
                    }
                    if (!$linked) fail('Задание не найдено в этом наборе.', 404);
                }
                $list[$i]['assignmentId'] = $aid;
            }
            if (!write_json(school_modules_file($dir), $list)) fail('Не удалось сохранить модуль.', 500);
            audit_log($dir, $me['email'], 'медиашкола', 'модуль изменён: ' . $list[$i]['title']);
            respond(array('ok' => true, 'module' => school_module_public($list[$i])));
        }
        fail('Модуль не найден.', 404);
    }

    if ($act === 'school-module-delete') {
        if (!can($me, 'school.manage')) fail('Модули удаляет редакция школы.', 403);
        $id = text((string) (isset($in['id']) ? $in['id'] : ''), 40);
        $list = read_school_modules($dir);
        $left = array();
        $removed = '';
        foreach ($list as $m) {
            if ((string) $m['id'] === (string) $id) { $removed = isset($m['title']) ? $m['title'] : ''; continue; }
            $left[] = $m;
        }
        if ($removed === '') fail('Модуль не найден.', 404);
        if (!write_json(school_modules_file($dir), $left)) fail('Не удалось удалить модуль.', 500);
        audit_log($dir, $me['email'], 'медиашкола', 'модуль удалён: ' . $removed);
        respond(array('ok' => true));
    }

    if ($act === 'school-modules') {
        if (!can($me, 'school.manage') && !can($me, 'school.teach') && !can($me, 'school.review')
            && !can($me, 'school.enroll')) {
            fail('Модули доступны редакции и ученикам школы.', 403);
        }
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $list = array_values(array_filter(read_school_modules($dir), function ($m) use ($cohortId) {
            return (string) (isset($m['cohortId']) ? $m['cohortId'] : '') === (string) $cohortId;
        }));
        usort($list, function ($a, $b) { return (int) (isset($a['order']) ? $a['order'] : 0) - (int) (isset($b['order']) ? $b['order'] : 0); });
        $out = array();
        foreach ($list as $m) $out[] = school_module_public($m);
        respond(array('ok' => true, 'modules' => $out));
    }

    /* ---- тесты с автопроверкой (этап 3) ---- */
    if ($act === 'school-quiz-add') {
        if (!can($me, 'school.manage')) fail('Тесты добавляет редакция школы.', 403);
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $assignmentId = text((string) (isset($in['assignmentId']) ? $in['assignmentId'] : ''), 40);
        $title = text((string) (isset($in['title']) ? $in['title'] : ''), 120);
        $intro = text((string) (isset($in['intro']) ? $in['intro'] : ''), 600);
        $passScore = max(30, min(100, (int) (isset($in['passScore']) ? $in['passScore'] : 70)));
        $points = max(1, min(20, (int) (isset($in['points']) ? $in['points'] : 5)));
        if (slen($title) < 4) fail('Название теста слишком короткое.');
        $questionsIn = isset($in['questions']) && is_array($in['questions']) ? $in['questions'] : array();
        if (count($questionsIn) < 1) fail('Добавьте хотя бы один вопрос.');
        $questions = array();
        foreach ($questionsIn as $qi => $qs) {
            $qText = text((string) (isset($qs['text']) ? $qs['text'] : ''), 500);
            if (slen($qText) < 5) fail('Вопрос ' . ($qi + 1) . ' слишком короткий.');
            $optsIn = isset($qs['options']) && is_array($qs['options']) ? $qs['options'] : array();
            if (count($optsIn) < 2) fail('В вопросе ' . ($qi + 1) . ' нужно минимум два варианта ответа.');
            $correctCount = 0;
            $options = array();
            foreach ($optsIn as $opt) {
                $oText = text((string) (isset($opt['text']) ? $opt['text'] : ''), 300);
                $correct = !empty($opt['correct']);
                if ($correct) $correctCount++;
                $options[] = array('text' => $oText, 'correct' => $correct);
            }
            if ($correctCount !== 1) fail('В вопросе ' . ($qi + 1) . ' должен быть ровно один правильный вариант.');
            $questions[] = array(
                'id' => 'sq' . $qi . '_' . bin2hex(random_bytes(2)),
                'text' => $qText,
                'explanation' => text((string) (isset($qs['explanation']) ? $qs['explanation'] : ''), 500),
                'options' => $options,
            );
        }
        $found = false;
        foreach (read_school_cohorts($dir) as $c) {
            if ((string) $c['id'] === (string) $cohortId) { $found = true; break; }
        }
        if (!$found) fail('Набор не найден.', 404);
        if ($assignmentId !== '') {
            $linked = false;
            foreach (read_school_assignments($dir) as $a) {
                if ((string) $a['id'] === (string) $assignmentId && (string) $a['cohortId'] === (string) $cohortId) { $linked = true; break; }
            }
            if (!$linked) fail('Задание не найдено в этом наборе.', 404);
        }
        $list = read_school_quizzes($dir);
        $row = array(
            'id' => 'scq_' . bin2hex(random_bytes(4)),
            'cohortId' => $cohortId,
            'assignmentId' => $assignmentId,
            'title' => $title,
            'intro' => $intro,
            'passScore' => $passScore,
            'points' => $points,
            'questions' => $questions,
            'createdAt' => date('c'),
        );
        $list[] = $row;
        if (!write_json(school_quizzes_file($dir), $list)) fail('Не удалось сохранить тест.', 500);
        audit_log($dir, $me['email'], 'медиашкола', 'тест «' . $title . '» добавлен');
        respond(array('ok' => true, 'quiz' => school_quiz_public($row)));
    }

    if ($act === 'school-quiz-delete') {
        if (!can($me, 'school.manage')) fail('Тесты удаляет редакция школы.', 403);
        $id = text((string) (isset($in['id']) ? $in['id'] : ''), 40);
        $list = read_school_quizzes($dir);
        $left = array();
        $removed = '';
        foreach ($list as $q) {
            if ((string) $q['id'] === (string) $id) { $removed = isset($q['title']) ? $q['title'] : ''; continue; }
            $left[] = $q;
        }
        if ($removed === '') fail('Тест не найден.', 404);
        if (!write_json(school_quizzes_file($dir), $left)) fail('Не удалось удалить тест.', 500);
        audit_log($dir, $me['email'], 'медиашкола', 'тест удалён: ' . $removed);
        respond(array('ok' => true));
    }

    if ($act === 'school-quizzes') {
        if (!can($me, 'school.manage') && !can($me, 'school.teach') && !can($me, 'school.review')
            && !can($me, 'school.enroll')) {
            fail('Тесты доступны редакции и ученикам школы.', 403);
        }
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $out = array();
        foreach (read_school_quizzes($dir) as $q) {
            if ((string) (isset($q['cohortId']) ? $q['cohortId'] : '') !== (string) $cohortId) continue;
            $out[] = school_quiz_public($q);
        }
        respond(array('ok' => true, 'quizzes' => $out));
    }

    if ($act === 'school-quiz-submit') {
        $cohort = school_user_cohort($dir, $me['id']);
        if (!$cohort) fail('Вы не зачислены в набор школы.', 403);
        $quizId = text((string) (isset($in['quizId']) ? $in['quizId'] : ''), 40);
        $answersIn = isset($in['answers']) && is_array($in['answers']) ? $in['answers'] : array();
        $quiz = null;
        foreach (read_school_quizzes($dir) as $q) {
            if ((string) $q['id'] === (string) $quizId && (string) $q['cohortId'] === (string) $cohort['id']) { $quiz = $q; break; }
        }
        if (!$quiz) fail('Тест не найден в вашем наборе.', 404);
        $total = count($quiz['questions']);
        $correctCount = 0;
        $answers = array();
        foreach ($quiz['questions'] as $qs) {
            $chosen = '';
            foreach ($answersIn as $a) {
                if ((string) (isset($a['questionId']) ? $a['questionId'] : '') === (string) $qs['id']) {
                    $chosen = (string) (isset($a['optionIndex']) ? $a['optionIndex'] : '-1');
                }
            }
            $correctIndex = -1;
            foreach ($qs['options'] as $oi => $opt) {
                if (!empty($opt['correct'])) $correctIndex = $oi;
            }
            $isRight = ($chosen !== '' && (int) $chosen === $correctIndex);
            if ($isRight) $correctCount++;
            $answers[] = array(
                'questionId' => $qs['id'],
                'chosen' => $chosen === '' ? -1 : (int) $chosen,
                'correct' => $isRight,
            );
        }
        $score = $total > 0 ? (int) round($correctCount * 100 / $total) : 0;
        $passed = $score >= (int) $quiz['passScore'];
        /* история попыток; баллы — за первый зачёт (ref защищает от повторов) */
        $resultsFile = $dir . '/school-quiz-results.json';
        $results = read_json($resultsFile, array());
        if (!is_array($results)) $results = array();
        $attempt = 1;
        $passedBefore = false;
        foreach ($results as $r) {
            if ((string) $r['quizId'] !== (string) $quizId || (string) $r['userId'] !== (string) $me['id']) continue;
            $attempt++;
            if (!empty($r['passed'])) $passedBefore = true;
        }
        $row = array(
            'quizId' => $quizId,
            'userId' => $me['id'],
            'userName' => isset($me['name']) ? $me['name'] : '',
            'score' => $score,
            'passed' => $passed,
            'attempt' => $attempt,
            'answers' => $answers,
            'createdAt' => date('c'),
        );
        $results[] = $row;
        if (!write_json($resultsFile, $results)) fail('Не удалось сохранить попытку.', 500);
        $awarded = 0;
        if ($passed && !$passedBefore && $quiz['points'] > 0 && function_exists('points_add')) {
            $res = points_add($dir, $me['id'], (int) $quiz['points'], 'school.test',
                'Медиашкола', 'Тест «' . $quiz['title'] . '» — ' . $score . '%', 'quiz:' . $quizId . ':' . $me['id']);
            if (!empty($res['ok']) && empty($res['skipped'])) $awarded = (int) $quiz['points'];
        }
        $detail = array();
        foreach ($quiz['questions'] as $qi => $qs) {
            $correctIndex = -1;
            foreach ($qs['options'] as $oi => $opt) {
                if (!empty($opt['correct'])) $correctIndex = $oi;
            }
            $detail[] = array(
                'questionId' => $qs['id'],
                'correctIndex' => $correctIndex,
                'right' => $answers[$qi]['correct'],
                'explanation' => isset($qs['explanation']) ? $qs['explanation'] : '',
            );
        }
        audit_log($dir, $me['email'], 'медиашкола', 'тест «' . $quiz['title'] . '»: ' . $score . '%' .
            ($passed ? ' зачёт' : ' не зачёт'));
        respond(array('ok' => true, 'score' => $score, 'passed' => $passed,
            'passScore' => (int) $quiz['passScore'], 'attempt' => $attempt, 'awarded' => $awarded, 'detail' => $detail));
    }

    if ($act === 'school-quiz-results') {
        if (!can($me, 'school.manage') && !can($me, 'school.teach') && !can($me, 'school.review')) {
            fail('Результаты тестов видит редакция школы.', 403);
        }
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $results = read_json($dir . '/school-quiz-results.json', array());
        if (!is_array($results)) $results = array();
        $quizIds = array();
        foreach (read_school_quizzes($dir) as $q) {
            if ((string) (isset($q['cohortId']) ? $q['cohortId'] : '') === (string) $cohortId) $quizIds[] = (string) $q['id'];
        }
        $out = array();
        foreach ($results as $r) {
            if (!in_array((string) (isset($r['quizId']) ? $r['quizId'] : ''), $quizIds, true)) continue;
            $out[] = school_quiz_result_public($r);
        }
        usort($out, function ($a, $b) { return strcmp((string) $b['createdAt'], (string) $a['createdAt']); });
        respond(array('ok' => true, 'results' => array_slice($out, 0, 100)));
    }

    /* ---- напоминание ученику о задании (кнопка в очереди работ) ---- */
    if ($act === 'school-sub-remind') {
        if (!can($me, 'school.review')) fail('Напоминания отправляет редакция школы.', 403);
        $subId = text((string) (isset($in['subId']) ? $in['subId'] : ''), 40);
        $target = null;
        foreach (read_school_subs($dir) as $sub) {
            if ((string) $sub['id'] === (string) $subId) { $target = $sub; break; }
        }
        if (!$target) fail('Работа не найдена.', 404);
        $user = null;
        foreach (read_users($dir) as $u) {
            if ((string) $u['id'] === (string) $target['userId']) { $user = $u; break; }
        }
        if (!$user || empty($user['email'])) fail('У ученика нет подтверждённой почты.', 409);
        $assignment = null;
        foreach (read_school_assignments($dir) as $a) {
            if ((string) $a['id'] === (string) $target['assignmentId']) { $assignment = $a; break; }
        }
        $cohortName = '';
        foreach (read_school_cohorts($dir) as $c) {
            if ((string) $c['id'] === (string) (isset($target['cohortId']) ? $target['cohortId'] : '')) {
                $cohortName = isset($c['name']) ? $c['name'] : ''; break;
            }
        }
        $ok = mail_notify($dir, 'school_homework_reminder', (string) $user['email'], array(
            'name' => isset($user['name']) ? $user['name'] : '',
            'cohort' => $cohortName,
            'title' => $assignment ? $assignment['title'] : 'текущее задание',
            'due' => $assignment && !empty($assignment['dueAt']) ? (string) $assignment['dueAt'] : 'без жёсткого срока',
        ), array('kind' => 'school_homework_reminder', 'by' => isset($me['name']) ? $me['name'] : 'редакция'));
        audit_log($dir, $me['email'], 'медиашкола', 'напоминание отправлено: ' . (isset($user['name']) ? $user['name'] : ''));
        respond(array('ok' => true, 'sent' => (bool) $ok));
    }

    /* ---- дневник набора: последние события для редакции ---- */
    if ($act === 'school-diary') {
        if (!can($me, 'school.manage') && !can($me, 'school.teach') && !can($me, 'school.review')) {
            fail('Дневник набора видит редакция школы.', 403);
        }
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $events = array();
        foreach (read_school_subs($dir) as $sub) {
            if ((string) (isset($sub['cohortId']) ? $sub['cohortId'] : '') !== (string) $cohortId) continue;
            $events[] = array('at' => isset($sub['createdAt']) ? $sub['createdAt'] : '', 'kind' => 'submitted',
                'who' => isset($sub['userName']) ? $sub['userName'] : '', 'text' => 'сдал работу (попытка ' .
                (isset($sub['attempt']) ? (int) $sub['attempt'] : 1) . ')',
                'detail' => isset($sub['assignmentId']) ? (string) $sub['assignmentId'] : '');
            if (!empty($sub['reviewedAt'])) {
                $events[] = array('at' => $sub['reviewedAt'], 'kind' => isset($sub['status']) && $sub['status'] === 'accepted' ? 'accepted' : 'returned',
                    'who' => isset($sub['userName']) ? $sub['userName'] : '',
                    'text' => ($sub['status'] === 'accepted' ? 'работа принята, ' .
                        (isset($sub['points']) ? (int) $sub['points'] : 0) . ' б.' : 'работа возвращена с разбором'),
                    'detail' => '');
            }
        }
        foreach (read_json($dir . '/school-quiz-results.json', array()) as $r) {
            $qTitle = '';
            foreach (read_school_quizzes($dir) as $q) {
                if ((string) $q['id'] === (string) (isset($r['quizId']) ? $r['quizId'] : '')) { $qTitle = $q['title']; break; }
            }
            if ($qTitle === '') continue;
            $events[] = array('at' => isset($r['createdAt']) ? $r['createdAt'] : '', 'kind' => !empty($r['passed']) ? 'quiz_pass' : 'quiz_fail',
                'who' => isset($r['userName']) ? $r['userName'] : '',
                'text' => 'тест «' . $qTitle . '»: ' . (isset($r['score']) ? (int) $r['score'] : 0) . '%' .
                    (!empty($r['passed']) ? ' зачёт' : ' не зачёт'), 'detail' => '');
        }
        usort($events, function ($a, $b) { return strcmp((string) $b['at'], (string) $a['at']); });
        respond(array('ok' => true, 'events' => array_slice($events, 0, 20)));
    }

    /* ---- успеваемость набора: CSV для редакции ---- */
    if ($act === 'school-cohort-csv') {
        if (!can($me, 'school.manage')) fail('Выгрузку делает редакция школы.', 403);
        $cohortId = text((string) (isset($in['cohortId']) ? $in['cohortId'] : ''), 40);
        $cohort = null;
        foreach (read_school_cohorts($dir) as $c) {
            if ((string) $c['id'] === (string) $cohortId) { $cohort = $c; break; }
        }
        if (!$cohort) fail('Набор не найден.', 404);
        $assignments = array_values(array_filter(read_school_assignments($dir), function ($a) use ($cohortId) {
            return (string) (isset($a['cohortId']) ? $a['cohortId'] : '') === (string) $cohortId;
        }));
        usort($assignments, function ($a, $b) { return (int) $a['order'] - (int) $b['order']; });
        $subs = read_school_subs($dir);
        $csv = "\xEF\xBB\xBF";
        $csv .= "Ученик;Почта";
        foreach ($assignments as $a) $csv .= ";" . str_replace(array(";", "\r", "\n"), array(",", " ", " "), (string) $a['title']);
        $csv .= ";Баллы всего\n";
        foreach (school_cohort_students($dir, $cohortId) as $st) {
            $line = str_replace(array(";", "\r", "\n"), array(",", " ", " "), (string) (isset($st['name']) ? $st['name'] : ''))
                . ";" . str_replace(array(";", "\r", "\n"), array(",", " ", " "), (string) (isset($st['email']) ? $st['email'] : ''));
            $total = function_exists('points_balance') ? (int) points_balance($dir, $st['userId']) : 0;
            foreach ($assignments as $a) {
                $cell = "-";
                foreach ($subs as $sub) {
                    if ((string) $sub['assignmentId'] !== (string) $a['id']) continue;
                    if ((string) $sub['userId'] !== (string) $st['userId']) continue;
                    if ($sub['status'] === 'accepted') $cell = "принято, " . (isset($sub['points']) ? (int) $sub['points'] : 0) . " б.";
                    else if ($sub['status'] === 'pending') $cell = "на проверке";
                    else if ($sub['status'] === 'returned') $cell = "возвращено";
                }
                $line .= ";" . $cell;
            }
            $line .= ";" . $total . "\n";
            $csv .= $line;
        }
        if (trim($csv) === "\xEF\xBB\BF") $csv .= "Ученик;Почта;Баллы всего\n";
        respond(array(
            'ok' => true,
            'filename' => 'uspevaemost-' . date('Y-m-d') . '.csv',
            'mime' => 'text/csv; charset=UTF-8',
            'data' => base64_encode($csv),
        ));
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
        $mods = array();
        foreach (read_school_modules($dir) as $m) {
            if ((string) (isset($m['cohortId']) ? $m['cohortId'] : '') !== (string) $cohort['id']) continue;
            $mods[] = school_module_public($m);
        }
        usort($mods, function ($a, $b) { return (int) $a['order'] - (int) $b['order']; });
        $quizzes = array();
        foreach (read_school_quizzes($dir) as $q) {
            if ((string) (isset($q['cohortId']) ? $q['cohortId'] : '') !== (string) $cohort['id']) continue;
            $quizzes[] = school_quiz_public($q);
        }
        $myQuiz = array();
        foreach (read_json($dir . '/school-quiz-results.json', array()) as $r) {
            if ((string) (isset($r['userId']) ? $r['userId'] : '') !== (string) $me['id']) continue;
            $myQuiz[(string) $r['quizId']] = school_quiz_result_public($r);
        }
        respond(array('ok' => true, 'cohort' => array('id' => $cohort['id'], 'name' => $cohort['name']),
            'assignments' => $assignments, 'subs' => $mine, 'modules' => $mods, 'quizzes' => $quizzes,
            'myQuiz' => $myQuiz,
            'points' => function_exists('points_balance') ? points_balance($dir, $me['id']) : 0));
    }

    return true;
}
