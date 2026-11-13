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
