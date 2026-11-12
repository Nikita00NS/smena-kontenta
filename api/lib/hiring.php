<?php
/* ============================================================================
   ПРИЁМ В КОМАНДУ: заявка → тест знаний → чек-лист → согласование → сотрудник.

   Логика простая и проверяемая:
   1. человек подаёт заявку из кабинета (позиция, регион, мотивация);
   2. проходит тест: вопросы с одним ответом, проверяются на сервере,
      правильные ответы в браузер не отдаются;
   3. редакция отмечает чек-лист (документы, портфолио, собеседование);
   4. старший по роли нажимает «Принять» — только тогда роль меняется
      на «Сотрудник», а в журнал пишется запись.

   Обойти этапы нельзя: решение отклоняется, если тест не сдан или чек-лист
   не закрыт. Роль меняет сервер, а не кнопка в интерфейсе.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

const HIRING_PASS_PERCENT = 70;

function hiring_file($dir) { return $dir . '/hiring.json'; }

function hiring_positions() {
    return array('Автор текстов', 'Фотограф', 'Видеограф', 'Дизайнер', 'SMM-редактор', 'Модератор', 'Преподаватель', 'Корректор');
}

/* Тест знаний. Вопросы с одним правильным ответом: так проверка честная
   и не требует ручной работы. Открытые вопросы — в чек-листе. */
function hiring_test_questions() {
    return array(
        array('id' => 'q1', 'text' => 'Что обязательно проверить перед публикацией факта?',
            'options' => array('Первоисточник и дату', 'Количество лайков', 'Мнение друга', 'Красивую картинку'), 'right' => 0),
        array('id' => 'q2', 'text' => 'Что такое фактчекинг?',
            'options' => array('Проверка сведений по источникам', 'Работа с фоторедактором', 'Продвижение поста', 'Перевод текста'), 'right' => 0),
        array('id' => 'q3', 'text' => 'Можно ли публиковать фото человека без его согласия?',
            'options' => array('Нет, если он не публичное лицо и нет законного основания', 'Да, всегда', 'Да, если фото красивое', 'Да, если фото из интернета'), 'right' => 0),
        array('id' => 'q4', 'text' => 'Какой заголовок лучше?',
            'options' => array('«В городе открыли бесплатную мастерскую для школьников»', '«ШОК!!! ВЫ НЕ ПОВЕРИТЕ»', '«Новость»', '«Важно! Читать всем»'), 'right' => 0),
        array('id' => 'q5', 'text' => 'Что делать, если герой просит убрать его имя из текста?',
            'options' => array('Убрать имя или согласовать формулировку', 'Оставить как есть', 'Опубликовать и не отвечать', 'Передать материал третьим лицам'), 'right' => 0),
        array('id' => 'q6', 'text' => 'Кому принадлежат права на текст автора после публикации?',
            'options' => array('Автору, а проект использует его по согласию', 'Только редакции', 'Никому', 'Тому, кто первый прочитал'), 'right' => 0),
        array('id' => 'q7', 'text' => 'Что указывают в подписи к фотографии?',
            'options' => array('Что и где снято, кто автор', 'Своё мнение', 'Рекламу', 'Ничего'), 'right' => 0),
        array('id' => 'q8', 'text' => 'Что делать при обнаружении ошибки в опубликованном материале?',
            'options' => array('Исправить и указать, что исправлено', 'Удалить и молчать', 'Обвинить читателей', 'Ничего'), 'right' => 0),
        array('id' => 'q9', 'text' => 'Можно ли использовать чужой текст без указания источника?',
            'options' => array('Нет, это нарушение авторских прав', 'Да, если коротко', 'Да, если никто не заметит', 'Да, если поставить эмодзи'), 'right' => 0),
        array('id' => 'q10', 'text' => 'Что важнее всего в работе с несовершеннолетними героями?',
            'options' => array('Согласие законного представителя', 'Красивый кадр', 'Скорость публикации', 'Количество просмотров'), 'right' => 0),
    );
}

function hiring_checklist_items() {
    return array(
        'consent_pd' => 'Согласие на обработку персональных данных подписано и загружено',
        'consent_share' => 'Согласие на распространение данных подписано (если публикуется имя/фото)',
        'portfolio' => 'Портфолио просмотрено, качество устраивает',
        'test_done' => 'Тест знаний пройден',
        'rules' => 'Человек прочитал правила проекта и работы с ПД',
        'interview' => 'Собеседование проведено',
        'mentor' => 'Назначен наставник или руководитель отдела',
    );
}

function read_hiring($dir) {
    $list = read_json(hiring_file($dir), array());
    return is_array($list) ? $list : array();
}

function hiring_by_user($dir, $userId) {
    $best = null;
    foreach (read_hiring($dir) as $app) {
        if ((string) $app['userId'] !== (string) $userId) continue;
        if ($best === null || strcmp((string) $app['createdAt'], (string) $best['createdAt']) > 0) $best = $app;
    }
    return $best;
}

function hiring_public($app) {
    if (!$app) return null;
    $out = array(
        'id' => $app['id'],
        'userId' => $app['userId'],
        'name' => isset($app['name']) ? $app['name'] : '',
        'position' => isset($app['position']) ? $app['position'] : '',
        'region' => isset($app['region']) ? $app['region'] : '',
        'motivation' => isset($app['motivation']) ? $app['motivation'] : '',
        'stage' => isset($app['stage']) ? $app['stage'] : 'test',
        'createdAt' => isset($app['createdAt']) ? $app['createdAt'] : '',
        'decidedAt' => isset($app['decidedAt']) ? $app['decidedAt'] : '',
        'decidedBy' => isset($app['decidedBy']) ? $app['decidedBy'] : '',
        'note' => isset($app['note']) ? $app['note'] : '',
        'testScore' => isset($app['testScore']) ? (int) $app['testScore'] : 0,
        'testPercent' => isset($app['testPercent']) ? (int) $app['testPercent'] : 0,
        'testPassedAt' => isset($app['testPassedAt']) ? $app['testPassedAt'] : '',
        'checklist' => array(),
        'history' => isset($app['history']) && is_array($app['history']) ? $app['history'] : array(),
    );
    $labels = hiring_checklist_items();
    foreach ($labels as $key => $label) {
        $row = isset($app['checklist'][$key]) ? $app['checklist'][$key] : array();
        $out['checklist'][] = array(
            'key' => $key,
            'label' => $label,
            'ok' => !empty($row['ok']),
            'by' => isset($row['by']) ? $row['by'] : '',
            'at' => isset($row['at']) ? $row['at'] : '',
            'note' => isset($row['note']) ? $row['note'] : '',
        );
    }
    return $out;
}

function hiring_can_approve($app) {
    if (!$app) return array('ok' => false, 'reason' => 'Заявки нет.');
    if (!isset($app['testPercent']) || (int) $app['testPercent'] < HIRING_PASS_PERCENT) {
        return array('ok' => false, 'reason' => 'Тест не пройден: нужно не меньше ' . HIRING_PASS_PERCENT . '%.');
    }
    $labels = hiring_checklist_items();
    foreach ($labels as $key => $label) {
        if (empty($app['checklist'][$key]['ok'])) {
            return array('ok' => false, 'reason' => 'Чек-лист не закрыт: ' . $label);
        }
    }
    return array('ok' => true, 'reason' => '');
}

/* ============================== маршруты ================================= */

function hiring_public_list($dir, $filter) {
    $out = array();
    foreach (array_reverse(read_hiring($dir)) as $app) {
        if ($filter !== '' && (isset($app['stage']) ? $app['stage'] : '') !== $filter) continue;
        $out[] = hiring_public($app);
    }
    return $out;
}

function hiring_routes($act, $dir) {
    $handled = array('hiring-positions', 'hiring-apply', 'hiring-mine', 'hiring-test',
        'hiring-test-submit', 'hiring-list', 'hiring-checklist', 'hiring-decide');
    if (!in_array($act, $handled, true)) return false;

    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);

    if ($act === 'hiring-positions') {
        respond(array('ok' => true, 'positions' => hiring_positions()));
    }

    if ($act === 'hiring-mine') {
        $app = hiring_by_user($dir, $me['id']);
        respond(array(
            'ok' => true,
            'application' => hiring_public($app),
            'positions' => hiring_positions(),
            'access' => isset($me['access']) ? $me['access'] : 'Пользователь',
            'passPercent' => HIRING_PASS_PERCENT,
            'questionsCount' => count(hiring_test_questions()),
            'stages' => array(
                'test' => 'Тест знаний',
                'checklist' => 'Проверка документов и портфолио',
                'review' => 'Согласование редакции',
                'approved' => 'Принят в команду',
                'rejected' => 'Отказ',
            ),
        ));
    }

    if ($act === 'hiring-apply') {
        require_consent($dir, $me);
        $existing = hiring_by_user($dir, $me['id']);
        if ($existing && in_array($existing['stage'], array('test', 'checklist', 'review', 'approved'), true)) {
            fail('Заявка уже есть. Откройте кабинет — там видно, на каком она этапе.', 409);
        }
        $position = text((string) (isset($in['position']) ? $in['position'] : ''), 60);
        if (!in_array($position, hiring_positions(), true)) fail('Выберите направление из списка.');
        $region = text((string) (isset($in['region']) ? $in['region'] : ''), 60);
        $motivation = text((string) (isset($in['motivation']) ? $in['motivation'] : ''), 1500);
        if (slen($motivation) < 40) fail('Расскажите о себе хотя бы в 40 символах — это часть отбора.');

        $app = array(
            'id' => 'hr_' . bin2hex(random_bytes(5)),
            'userId' => $me['id'],
            'name' => $me['name'],
            'email' => $me['email'],
            'position' => $position,
            'region' => $region,
            'motivation' => $motivation,
            'stage' => 'test',
            'createdAt' => date('c'),
            'testScore' => 0,
            'testPercent' => 0,
            'checklist' => array(),
            'history' => array(array('at' => date('c'), 'by' => $me['email'], 'what' => 'Заявка подана')),
        );
        $list = read_hiring($dir);
        $list[] = $app;
        if (!write_json(hiring_file($dir), $list)) fail('Заявка не сохранилась.', 500);
        audit_log($dir, $me['email'], 'заявка в команду', $position);
        mail_notify($dir, 'staff_invite', $me['email'], array(
            'name' => $me['name'], 'position' => $position, 'link' => 'https://smenakontenta.ru/cabinet/',
        ), array('dedupe' => 'hiring:' . $app['id']));
        respond(array('ok' => true, 'application' => hiring_public($app)));
    }

    if ($act === 'hiring-test') {
        $app = hiring_by_user($dir, $me['id']);
        if (!$app) fail('Сначала подайте заявку.', 404);
        if ($app['stage'] !== 'test') fail('Тест уже пройден.', 409);
        $questions = array();
        foreach (hiring_test_questions() as $q) {
            /* правильные ответы на сервере: в браузер уходят только варианты */
            $questions[] = array('id' => $q['id'], 'text' => $q['text'], 'options' => $q['options']);
        }
        respond(array('ok' => true, 'questions' => $questions, 'passPercent' => HIRING_PASS_PERCENT));
    }

    if ($act === 'hiring-test-submit') {
        $app = hiring_by_user($dir, $me['id']);
        if (!$app) fail('Сначала подайте заявку.', 404);
        if ($app['stage'] !== 'test') fail('Тест уже пройден.', 409);
        $answers = isset($in['answers']) && is_array($in['answers']) ? $in['answers'] : array();
        $questions = hiring_test_questions();
        $right = 0;
        foreach ($questions as $q) {
            if (isset($answers[$q['id']]) && (int) $answers[$q['id']] === (int) $q['right']) $right++;
        }
        $percent = (int) round($right / max(1, count($questions)) * 100);
        $passed = $percent >= HIRING_PASS_PERCENT;

        $list = read_hiring($dir);
        foreach ($list as $i => $row) {
            if ($row['id'] !== $app['id']) continue;
            $list[$i]['testScore'] = $right;
            $list[$i]['testPercent'] = $percent;
            $list[$i]['testAnswers'] = array_map('intval', $answers);
            $list[$i]['testPassedAt'] = $passed ? date('c') : '';
            $list[$i]['stage'] = $passed ? 'checklist' : 'test';
            $list[$i]['history'][] = array('at' => date('c'), 'by' => $me['email'], 'what' => 'Тест: ' . $right . ' из ' . count($questions) . ' (' . $percent . '%)');
            if ($passed) {
                $list[$i]['checklist']['test_done'] = array('ok' => true, 'by' => 'автоматически', 'at' => date('c'), 'note' => $percent . '%');
            }
            break;
        }
        if (!write_json(hiring_file($dir), $list)) fail('Результат теста не сохранился.', 500);
        audit_log($dir, $me['email'], 'тест на сотрудника', $right . '/' . count($questions) . ' (' . $percent . '%)');

        /* кому-то из редакции стоит узнать о новой заявке — пишем на support@,
           но не чаще одного письма на заявку в сутки (dedupe внутри mail_notify) */
        if ($passed) {
            mail_notify($dir, 'editorial_assigned', 'support@smenakontenta.ru', array(
                'name' => 'редакция', 'position' => $app['position'], 'link' => 'https://smenakontenta.ru/admin/',
            ), array('dedupe' => 'hiring-ready:' . $app['id']));
        }
        respond(array('ok' => true, 'right' => $right, 'total' => count($questions), 'percent' => $percent, 'passed' => $passed, 'stage' => $passed ? 'checklist' : 'test'));
    }

    if ($act === 'hiring-list') {
        if (!can($me, 'hiring.view')) fail('Заявки видит только редакция и администрация.', 403);
        $filter = (string) (isset($in['stage']) ? $in['stage'] : '');
        respond(array('ok' => true, 'applications' => hiring_public_list($dir, $filter), 'canDecide' => can($me, 'hiring.decide')));
    }

    if ($act === 'hiring-checklist') {
        if (!can($me, 'hiring.decide')) fail('Чек-лист заполняет тот, кто принимает решение.', 403);
        $id = (string) (isset($in['id']) ? $in['id'] : '');
        $key = (string) (isset($in['key']) ? $in['key'] : '');
        $labels = hiring_checklist_items();
        if (!isset($labels[$key])) fail('Такого пункта чек-листа нет.', 404);
        $list = read_hiring($dir);
        $found = false;
        foreach ($list as $i => $app) {
            if ($app['id'] !== $id) continue;
            $ok = !empty($in['ok']);
            $list[$i]['checklist'][$key] = array(
                'ok' => $ok, 'by' => $me['email'], 'at' => date('c'),
                'note' => text((string) (isset($in['note']) ? $in['note'] : ''), 300),
            );
            $list[$i]['history'][] = array('at' => date('c'), 'by' => $me['email'],
                'what' => ($ok ? 'Отмечено: ' : 'Снято: ') . $labels[$key]);
            $found = true;
            break;
        }
        if (!$found) fail('Заявка не найдена.', 404);
        if (!write_json(hiring_file($dir), $list)) fail('Чек-лист не сохранился.', 500);
        respond(array('ok' => true));
    }

    if ($act === 'hiring-decide') {
        if (!can($me, 'hiring.decide')) fail('Решение принимает главный редактор или администрация.', 403);
        $id = (string) (isset($in['id']) ? $in['id'] : '');
        $decision = (string) (isset($in['decision']) ? $in['decision'] : '');
        $note = text((string) (isset($in['note']) ? $in['note'] : ''), 500);
        if (!in_array($decision, array('approve', 'reject'), true)) fail('Решение — «approve» или «reject».');

        $list = read_hiring($dir);
        $app = null;
        $index = -1;
        foreach ($list as $i => $row) {
            if ($row['id'] === $id) { $app = $row; $index = $i; break; }
        }
        if (!$app) fail('Заявка не найдена.', 404);
        if ($decision === 'approve') {
            $check = hiring_can_approve($app);
            if (!$check['ok']) fail($check['reason'], 409);
            $target = null;
            $users = read_users($dir);
            foreach ($users as $i => $u) {
                if ($u['id'] !== $app['userId']) continue;
                if (role_level(isset($u['access']) ? $u['access'] : '') < ROLE_LEVELS['Сотрудник']) {
                    $users[$i]['access'] = 'Сотрудник';
                }
                $users[$i]['role'] = $app['position'];
                $users[$i]['position'] = $app['position'];
                $users[$i]['hiredAt'] = date('c');
                if (!isset($users[$i]['status']) || $users[$i]['status'] === 'pending_email') {
                    /* на работу принимаем только с подтверждённой почтой */
                    fail('У человека не подтверждена почта — принять нельзя, пока он не введёт код из письма.', 409);
                }
                $target = $users[$i];
                break;
            }
            if (!$target) fail('Аккаунт заявителя не найден.', 404);
            require_consent($dir, $target);
            if (!write_json(users_file($dir), $users)) fail('Не удалось выдать роль.', 500);
            $list[$index]['stage'] = 'approved';
            $list[$index]['decidedAt'] = date('c');
            $list[$index]['decidedBy'] = $me['email'];
            $list[$index]['note'] = $note;
            $list[$index]['history'][] = array('at' => date('c'), 'by' => $me['email'], 'what' => 'Принят в команду: ' . $app['position']);
            mail_notify($dir, 'staff_hired', $target['email'], array(
                'name' => $target['name'], 'position' => $app['position'], 'link' => 'https://smenakontenta.ru/cabinet/',
            ), array('dedupe' => 'hired:' . $app['id']));
            audit_log($dir, $me['email'], 'приём в команду', $target['email'] . ' → ' . $app['position']);
        } else {
            if (slen($note) < 5) fail('Напишите причину отказа — человек должен понимать, что улучшить.');
            $list[$index]['stage'] = 'rejected';
            $list[$index]['decidedAt'] = date('c');
            $list[$index]['decidedBy'] = $me['email'];
            $list[$index]['note'] = $note;
            $list[$index]['history'][] = array('at' => date('c'), 'by' => $me['email'], 'what' => 'Отказ');
            $users = read_users($dir);
            foreach ($users as $u) {
                if ($u['id'] !== $app['userId']) continue;
                mail_notify($dir, 'staff_hired', $u['email'], array(
                    'name' => $u['name'], 'position' => $app['position'], 'reason' => $note,
                    'link' => 'https://smenakontenta.ru/cabinet/',
                ), array('dedupe' => 'hired-no:' . $app['id']));
                break;
            }
            audit_log($dir, $me['email'], 'отказ в приёме', $app['email'] . ': ' . $note);
        }
        if (!write_json(hiring_file($dir), $list)) fail('Решение не сохранилось.', 500);
        respond(array('ok' => true, 'application' => hiring_public($list[$index])));
    }

    return true;
}
