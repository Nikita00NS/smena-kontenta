<?php
/* ============================================================================
   ПИСЬМА ПРОЕКТА: единый шаблон, шаблоны писем, журнал доставки.

   Зачем отдельный слой: раньше каждое письмо собиралось вручную в том месте,
   откуда отправлялось, и выглядело по-разному. Теперь есть один фирменный
   макет (чёрно-белый, без «дешёвых» рамок), список шаблонов и журнал:
   что, кому, когда, чем закончилось.

   Внешних картинок и трекеров нет — только логотип проекта с нашего домена.
   Письма собираются как таблица с inline-стилями: так они не разваливаются
   в Почте Mail.ru, Яндекс Почте, Gmail и Outlook.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

const MAIL_SITE = 'https://smenakontenta.ru';

function mail_log_file($dir) { return $dir . '/mail-log.json'; }
function mail_templates_file($dir) { return $dir . '/mail-templates.json'; }

/* Шаблоны по умолчанию. Администратор может переопределить тему и текст
   в админке — тогда правка ложится в mail-templates.json, код не меняется. */
function mail_templates() {
    return array(
        'welcome' => array(
            'name' => 'Приветствие после регистрации',
            'subject' => 'Добро пожаловать в «Смену контента»',
            'title' => 'Вы в проекте',
            'body' => 'Здравствуйте, {{name}}! Аккаунт создан. Остался один шаг — подтвердить почту, чтобы публиковать материалы и подавать заявки.',
            'button' => 'Подтвердить почту',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Вы зарегистрировались на сайте smenakontenta.ru.',
        ),
        'confirm_code' => array(
            'name' => 'Код подтверждения почты',
            'subject' => 'Код подтверждения — Смена контента',
            'title' => 'Код подтверждения',
            'body' => 'Здравствуйте, {{name}}! Введите этот код на сайте, чтобы подтвердить почту. Код действует {{minutes}} минут.',
            'code' => true,
            'why' => 'Код запрошен при регистрации или в личном кабинете.',
        ),
        'recovery_code' => array(
            'name' => 'Восстановление доступа',
            'subject' => 'Код восстановления — Смена контента',
            'title' => 'Восстановление доступа',
            'body' => 'Здравствуйте, {{name}}! Кто-то запросил восстановление доступа к аккаунту. Если это были вы — введите код на странице входа вместе с новым паролем. Код действует {{minutes}} минут.',
            'code' => true,
            'why' => 'Запрос на восстановление доступа к аккаунту.',
        ),
        'password_changed' => array(
            'name' => 'Пароль изменён',
            'subject' => 'Пароль изменён — Смена контента',
            'title' => 'Пароль изменён',
            'body' => 'Здравствуйте, {{name}}! Пароль от аккаунта только что изменён, остальные сессии закрыты. Если это были не вы — сразу напишите в поддержку.',
            'button' => 'Написать в поддержку',
            'url' => MAIL_SITE . '/support',
            'why' => 'Уведомление безопасности по вашему аккаунту.',
        ),
        'post_published' => array(
            'name' => 'Материал опубликован',
            'subject' => 'Материал опубликован — Смена контента',
            'title' => 'Материал вышел',
            'body' => 'Здравствуйте, {{name}}! Ваш материал «{{title}}» прошёл проверку редакции и опубликован на сайте.',
            'button' => 'Открыть материал',
            'url' => '{{url}}',
            'why' => 'Вы автор этого материала.',
        ),
        'post_rejected' => array(
            'name' => 'Материал вернули на правки',
            'subject' => 'Материал нужно доработать — Смена контента',
            'title' => 'Нужны правки',
            'body' => 'Здравствуйте, {{name}}! Материал «{{title}}» пока не опубликован. Замечание редакции: {{note}}',
            'button' => 'Открыть кабинет',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Вы автор этого материала.',
        ),
        'new_message' => array(
            'name' => 'Сообщение от редакции',
            'subject' => 'Сообщение от редакции — Смена контента',
            'title' => 'Сообщение от редакции',
            'body' => 'Здравствуйте, {{name}}! {{text}}',
            'button' => 'Ответить в кабинете',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Редакция отправила вам сообщение.',
        ),
        'editorial_assigned' => array(
            'name' => 'Назначение в редакцию',
            'subject' => 'Вы в редакции «{{editorial}}» — Смена контента',
            'title' => 'Вы в редакции',
            'body' => 'Здравствуйте, {{name}}! Вас приняли в редакцию «{{editorial}}», регион — {{region}}. Должность: {{position}}.',
            'button' => 'Открыть кабинет',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Решение редакции по вашей заявке.',
        ),
        'points_awarded' => array(
            'name' => 'Начислены баллы',
            'subject' => 'Начислены баллы — Смена контента',
            'title' => 'Баллы начислены',
            'body' => 'Здравствуйте, {{name}}! Начислено {{delta}} баллов. Основание: {{reason}}. Баланс: {{balance}}.',
            'button' => 'Открыть кабинет',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Изменение баллов в вашем аккаунте.',
        ),
        'account_status' => array(
            'name' => 'Статус аккаунта изменён',
            'subject' => 'Статус аккаунта — Смена контента',
            'title' => 'Статус аккаунта',
            'body' => 'Здравствуйте, {{name}}! Статус вашего аккаунта изменён: {{status}}. Причина: {{reason}}.',
            'button' => 'Написать в поддержку',
            'url' => MAIL_SITE . '/support',
            'why' => 'Уведомление безопасности по вашему аккаунту.',
        ),
        'consent_required' => array(
            'name' => 'Нужно согласие на публикацию',
            'subject' => 'Для публикации нужно согласие — Смена контента',
            'title' => 'Нужно согласие',
            'body' => 'Здравствуйте, {{name}}! Материал «{{title}}» содержит персональные данные или изображение человека. Пока нет действующего согласия на распространение — публикация невозможна. Причина: {{reason}}.',
            'button' => 'Открыть кабинет',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Требование закона о персональных данных (152-ФЗ).',
        ),
        'support_reply' => array(
            'name' => 'Ответ поддержки',
            'subject' => 'Ответ поддержки — Смена контента',
            'title' => 'Ответ поддержки',
            'body' => 'Здравствуйте, {{name}}! {{text}}',
            'button' => 'Открыть сайт',
            'url' => MAIL_SITE,
            'why' => 'Вы обратились в поддержку проекта.',
        ),
        'staff_invite' => array(
            'name' => 'Приглашение на собеседование',
            'subject' => 'Приглашение в команду — Смена контента',
            'title' => 'Приглашение в команду',
            'body' => 'Здравствуйте, {{name}}! Ваша заявка на позицию «{{position}}» принята к рассмотрению. Следующий шаг — тест и чек-лист в кабинете.',
            'button' => 'Открыть кабинет',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Вы подали заявку на работу в проект.',
        ),
        'access_granted' => array(
            'name' => 'Выдан доступ в админку',
            'subject' => 'Доступ в панель проекта — Смена контента',
            'title' => 'Вам выдан доступ',
            'body' => 'Здравствуйте, {{name}}! Администрация проекта открыла вам доступ в панель: {{access}}. Войдите на сайте по своей почте. Временный пароль: {{temp_pass}} — сразу смените его в личном кабинете.',
            'button' => 'Войти в проект',
            'url' => MAIL_SITE . '/join#login',
            'why' => 'Доступ выдан администрацией проекта «Смена контента».',
        ),
        'login_code' => array(
            'name' => 'Код входа (двухфакторная проверка)',
            'subject' => 'Код входа — Смена контента',
            'title' => 'Код входа',
            'body' => 'Здравствуйте, {{name}}! Кто-то входит в ваш аккаунт с паролем. Введите код ниже — он действует {{minutes}} минут. Если это были не вы, смените пароль.',
            'code' => true,
            'why' => 'У вас включена двухфакторная проверка входа.',
        ),
        'staff_hired' => array(
            'name' => 'Принят в команду',
            'subject' => 'Вы в команде — Смена контента',
            'title' => 'Вы в команде',
            'body' => 'Здравствуйте, {{name}}! Все этапы пройдены, вы приняты на позицию «{{position}}». Доступ к задачам — в личном кабинете.',
            'button' => 'Открыть кабинет',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Решение по вашей заявке на работу.',
        ),
        'school_new' => array(
            'name' => 'Новая заявка в медиашколу',
            'subject' => 'Заявка в медиашколу: {{direction}} — Смена контента',
            'title' => 'Новая заявка в медиашколу',
            'body' => 'Здравствуйте, {{name}}! Подана заявка в медиашколу, направление «{{direction}}». Решение — в панели проекта, раздел «Медиашкола».',
            'button' => 'Открыть панель',
            'url' => MAIL_SITE . '/admin',
            'why' => 'Уведомление редакции о новой заявке.',
        ),
        'school_accepted' => array(
            'name' => 'Вы приняты в медиашколу',
            'subject' => 'Вы в медиашколе — Смена контента',
            'title' => 'Вы приняты в медиашколу',
            'body' => 'Здравствуйте, {{name}}! Вас приняли в медиашколу, направление «{{direction}}». Следующий шаг — первое задание: оно ждёт в личном кабинете.',
            'button' => 'Открыть кабинет',
            'url' => MAIL_SITE . '/profile',
            'why' => 'Решение редакции по вашей заявке в медиашколу.',
        ),
        'school_invite' => array(
            'name' => 'Приглашение в медиашколу',
            'subject' => 'Набор «{{cohort}}» открыт: подайте заявку — Смена контента',
            'title' => 'Открыт набор медиашколы «{{cohort}}»',
            'body' => 'Здравствуйте, {{name}}! Редакция открыла новый набор медиашколы. Шесть направлений: тексты, интервью, фото, видео, соцсети, факт-чекинг. Заявка — направление и пара абзацев о себе; обучение бесплатное, разбор каждого материала от редактора.',
            'button' => 'Подать заявку',
            'url' => MAIL_SITE . '/school#apply',
            'why' => 'Вы зарегистрированы на сайте проекта.',
        ),
        'school_homework_reminder' => array(
            'name' => 'Напоминание о задании',
            'subject' => 'Напоминание: задание «{{title}}» ждёт работы — Смена контента',
            'title' => 'Редакция ждёт вашу работу',
            'body' => 'Здравствуйте, {{name}}! Напоминаем про задание «{{title}}» из набора {{cohort}}. Срок: {{due}}. Сдайте работу в «Моём курсе» — разбор появится там же.',
            'button' => 'Сдать работу',
            'url' => MAIL_SITE . '/school#course',
            'why' => 'Вы учитесь в наборе медиашколы.',
        ),
        'school_assignment_new' => array(
            'name' => 'Новое задание в медиашколе',
            'subject' => 'Новое задание: {{title}} — Смена контента',
            'title' => 'Новое задание в наборе {{cohort}}',
            'body' => 'Здравствуйте, {{name}}! В вашем наборе появилось задание «{{title}}». Срок: {{due}}. Прочитайте материал и сдайте работу в «Моём курсе» — разбор редакции появится там же.',
            'button' => 'Открыть мой курс',
            'url' => MAIL_SITE . '/school#course',
            'why' => 'Вы учитесь в наборе медиашколы.',
        ),
        'school_rejected' => array(
            'name' => 'Решение по заявке в медиашколу',
            'subject' => 'Заявка в медиашколу — Смена контента',
            'title' => 'Решение по заявке',
            'body' => 'Здравствуйте, {{name}}! По направлению «{{direction}}» пока не получилось. Причина: {{reason}}. Можно попробовать снова — расскажите подробнее о себе и своём опыте.',
            'button' => 'Страница медиашколы',
            'url' => MAIL_SITE . '/media-school',
            'why' => 'Решение редакции по вашей заявке в медиашколу.',
        ),
    );
}

function mail_template_saved($dir) {
    $saved = read_json(mail_templates_file($dir), array());
    return is_array($saved) ? $saved : array();
}

function mail_template($dir, $key) {
    $all = mail_templates();
    if (!isset($all[$key])) return null;
    $tpl = $all[$key];
    $saved = mail_template_saved($dir);
    if (isset($saved[$key]) && is_array($saved[$key])) {
        foreach (array('subject', 'title', 'body') as $field) {
            if (isset($saved[$key][$field]) && $saved[$key][$field] !== '') {
                $tpl[$field] = (string) $saved[$key][$field];
            }
        }
    }
    $tpl['key'] = $key;
    return $tpl;
}

function mail_vars_fill($text, $vars) {
    $out = (string) $text;
    foreach ($vars as $key => $value) {
        $out = str_replace('{{' . $key . '}}', (string) $value, $out);
    }
    /* незаполненные переменные не должны попадать в письмо как {{...}} */
    return preg_replace('/\{\{[a-z_]+\}\}/', '', $out);
}

function mail_escape($text) {
    return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
}

/* Фирменный макет: чёрное на белом, узкая колонка, одна кнопка. */
function mail_layout($tpl, $vars) {
    $title = mail_escape(mail_vars_fill($tpl['title'], $vars));
    $body = mail_escape(mail_vars_fill($tpl['body'], $vars));
    $why = mail_escape(mail_vars_fill($tpl['why'], $vars));
    $site = MAIL_SITE;
    /* логотип в письме: тёмный вариант на белом фоне письма
       (файла logo-light.png в проекте нет — из-за этого письма приходили без логотипа) */
    $logo = $site . '/assets/img/logo-dark.png';

    $code = '';
    if (!empty($tpl['code']) && !empty($vars['code'])) {
        $code = '<div style="margin:24px 0;padding:18px 20px;border:1px solid #111;border-radius:10px;'
            . 'font:700 30px/1.1 \'Courier New\',monospace;letter-spacing:8px;text-align:center;color:#111">'
            . mail_escape($vars['code']) . '</div>';
    }

    $button = '';
    if (!empty($tpl['button']) && !empty($tpl['url'])) {
        $url = mail_escape(mail_vars_fill($tpl['url'], $vars));
        $button = '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px"><tr>'
            . '<td style="background:#ff5c1a;border-radius:8px">'
            . '<a href="' . $url . '" style="display:inline-block;padding:13px 22px;'
            . 'font:600 15px/1 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">'
            . mail_escape(mail_vars_fill($tpl['button'], $vars)) . '</a></td></tr></table>';
    }

    return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . $title . '</title></head>'
        . '<body style="margin:0;padding:0;background:#f4f4f4;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 12px">'
        . '<tr><td align="center">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        . 'style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;'
        . 'border:1px solid #e6e6e6">'
        . '<tr><td style="padding:26px 28px 0">'
        . '<img src="' . $logo . '" alt="Смена контента" width="170" height="31" '
        . 'style="display:block;border:0;height:auto;max-width:170px;width:170px">'
        . '<div style="font:600 12px/1 Arial,Helvetica,sans-serif;letter-spacing:2px;color:#8a8a8a;'
        . 'margin:14px 0 0;text-transform:uppercase">Смена контента</div>'
        . '</td></tr>'
        . '<tr><td style="padding:16px 28px 0">'
        . '<h1 style="margin:0;font:700 24px/1.25 Arial,Helvetica,sans-serif;color:#111">' . $title . '</h1>'
        . '</td></tr>'
        . '<tr><td style="padding:12px 28px 0">'
        . '<p style="margin:0;font:400 16px/1.55 Arial,Helvetica,sans-serif;color:#333">' . $body . '</p>'
        . $code . $button
        . '</td></tr>'
        . '<tr><td style="padding:22px 28px 0">'
        . '<div style="height:1px;background:#ececec"></div></td></tr>'
        . '<tr><td style="padding:16px 28px 26px">'
        . '<p style="margin:0 0 8px;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:#8a8a8a">'
        . $why . '</p>'
        . '<p style="margin:0 0 8px;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:#8a8a8a">'
        . 'Сайт: <a href="' . $site . '" style="color:#8a8a8a">smenakontenta.ru</a> · '
        . 'Почта: <a href="mailto:info@smenakontenta.ru" style="color:#8a8a8a">info@smenakontenta.ru</a> · '
        . 'Поддержка: <a href="mailto:support@smenakontenta.ru" style="color:#8a8a8a">support@smenakontenta.ru</a></p>'
        . '<p style="margin:0;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:#b0b0b0">'
        . 'Это письмо отправлено автоматически, отвечать на него не нужно.</p>'
        . '</td></tr></table></td></tr></table></body></html>';
}

function mail_text_version($tpl, $vars) {
    $lines = array(
        'СМЕНА КОНТЕНТА',
        '',
        mail_vars_fill($tpl['title'], $vars),
        '',
        mail_vars_fill($tpl['body'], $vars),
    );
    if (!empty($tpl['code']) && !empty($vars['code'])) {
        $lines[] = '';
        $lines[] = 'Код: ' . $vars['code'];
    }
    if (!empty($tpl['button']) && !empty($tpl['url'])) {
        $lines[] = '';
        $lines[] = mail_vars_fill($tpl['button'], $vars) . ': ' . mail_vars_fill($tpl['url'], $vars);
    }
    $lines[] = '';
    $lines[] = mail_vars_fill($tpl['why'], $vars);
    $lines[] = 'smenakontenta.ru · info@smenakontenta.ru · support@smenakontenta.ru';
    return implode("\n", $lines);
}

function mail_log_add($dir, $row) {
    $list = read_json(mail_log_file($dir), array());
    if (!is_array($list)) $list = array();
    $list[] = $row;
    if (count($list) > 3000) $list = array_slice($list, -3000);
    write_json(mail_log_file($dir), $list);
}

function mail_log_list($dir, $limit = 200) {
    $list = read_json(mail_log_file($dir), array());
    if (!is_array($list)) return array();
    return array_slice(array_reverse($list), 0, $limit);
}

/* Единая отправка по шаблону. Возвращает true, если сервер почты принял письмо.
   dedupe — строка: повторный вызов с тем же ключом за сутки не отправит письмо
   второй раз (защита от двойного нажатия и повторных уведомлений). */
function mail_notify($dir, $key, $to, $vars = array(), $opts = array()) {
    $tpl = mail_template($dir, $key);
    if (!$tpl) return false;
    $to = trim((string) $to);
    if ($to === '') return false;

    $dedupe = isset($opts['dedupe']) ? (string) $opts['dedupe'] : '';
    if ($dedupe !== '') {
        foreach (mail_log_list($dir, 500) as $row) {
            if (isset($row['dedupe']) && $row['dedupe'] === $dedupe
                && isset($row['at']) && (time() - strtotime($row['at'])) < 86400
                && !empty($row['ok'])) {
                return true;
            }
        }
    }

    $vars['project'] = 'Смена контента';
    $vars['site'] = MAIL_SITE;
    $html = mail_layout($tpl, $vars);
    $text = mail_text_version($tpl, $vars);
    $subject = mail_vars_fill($tpl['subject'], $vars);
    $kind = isset($opts['kind']) ? (string) $opts['kind'] : $key;

    $ok = mail_send($to, $subject, $text, $html, $kind);

    mail_log_add($dir, array(
        'at' => date('c'),
        'template' => $key,
        'to' => $to,
        'subject' => $subject,
        'kind' => $kind,
        'ok' => (bool) $ok,
        'dedupe' => $dedupe,
        'by' => isset($opts['by']) ? (string) $opts['by'] : 'система',
    ));
    return (bool) $ok;
}
