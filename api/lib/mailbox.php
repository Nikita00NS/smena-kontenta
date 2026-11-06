<?php
/* ============================================================================
   ПОЧТА ПРОЕКТА — ящики домена, чтение по IMAP, отправка по SMTP,
   черновики, шаблоны писем и журнал доставки.

   Правила, из которых всё следует:
   • пароли ящиков лежат только в smena-data/mailboxes.json (вне public_html),
     в браузер не отдаются никогда — даже администратору: интерфейс знает
     лишь «пароль задан / не задан»;
   • каждая операция проверяет полномочие на сервере;
   • письма не кэшируем в файлах: читаем у сервера, чтобы ящик не расходился
     с тем, что видит человек в другом клиенте;
   • отправка одного и того же письма дважды подряд блокируется (двойной
     клик по кнопке не должен рождать два письма).
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

const MAILBOX_MAX_ATTACH = 6;             // сколько вложений в одном письме
const MAILBOX_MAX_ATTACH_BYTES = 8000000; // общий вес вложений, ~8 МБ
const MAILBOX_FOLDERS = array('INBOX', 'Sent', 'Drafts', 'Archive', 'Trash', 'Junk');

function mailboxes_file($dir) { return $dir . '/mailboxes.json'; }
function mail_drafts_file($dir) { return $dir . '/mail-drafts.json'; }

/* Четыре ящика по ТЗ. Пока пароль не задан, ящик существует в списке, но
   не подключается — так админка сразу показывает, чего не хватает. */
function mailboxes_defaults() {
    $host = 'mail.smenakontenta.ru';
    $smtp = 'smtp.smenakontenta.ru';
    return array(
        'editorial' => array(
            'label' => 'Редакция', 'address' => 'editorial@smenakontenta.ru',
            'note' => 'Переписка с авторами, героями, партнёрами',
            'host' => $host, 'port' => 993, 'smtpHost' => $smtp, 'smtpPort' => 465,
            'secure' => 'ssl', 'user' => 'editorial@smenakontenta.ru', 'pass' => '',
        ),
        'info' => array(
            'label' => 'Общие вопросы', 'address' => 'info@smenakontenta.ru',
            'note' => 'Входящие обращения по проекту',
            'host' => $host, 'port' => 993, 'smtpHost' => $smtp, 'smtpPort' => 465,
            'secure' => 'ssl', 'user' => 'info@smenakontenta.ru', 'pass' => '',
        ),
        'noreply' => array(
            'label' => 'Системные письма', 'address' => 'noreply@smenakontenta.ru',
            'note' => 'Коды, подтверждения, уведомления сайта',
            'host' => $host, 'port' => 993, 'smtpHost' => $smtp, 'smtpPort' => 465,
            'secure' => 'ssl', 'user' => 'noreply@smenakontenta.ru', 'pass' => '',
        ),
        'support' => array(
            'label' => 'Поддержка', 'address' => 'support@smenakontenta.ru',
            'note' => 'Обращения участников и авторов',
            'host' => $host, 'port' => 993, 'smtpHost' => $smtp, 'smtpPort' => 465,
            'secure' => 'ssl', 'user' => 'support@smenakontenta.ru', 'pass' => '',
        ),
    );
}

function mailboxes_load($dir) {
    $saved = read_json(mailboxes_file($dir), array());
    if (!is_array($saved)) $saved = array();
    $out = mailboxes_defaults();
    foreach ($out as $key => $box) {
        if (isset($saved[$key]) && is_array($saved[$key])) {
            foreach (array('label', 'address', 'note', 'host', 'port', 'smtpHost', 'smtpPort', 'secure', 'user', 'pass') as $field) {
                if (isset($saved[$key][$field]) && $saved[$key][$field] !== '') {
                    $out[$key][$field] = $saved[$key][$field];
                }
            }
            if (isset($saved[$key]['lastTest'])) $out[$key]['lastTest'] = $saved[$key]['lastTest'];
        }
    }
    return $out;
}

function mailboxes_save($dir, $boxes) {
    return write_json(mailboxes_file($dir), $boxes);
}

/* Наружу — без пароля. Только факт «задан / не задан». */
function mailbox_public($key, $box) {
    return array(
        'key' => $key,
        'label' => isset($box['label']) ? $box['label'] : $key,
        'address' => isset($box['address']) ? $box['address'] : '',
        'note' => isset($box['note']) ? $box['note'] : '',
        'host' => isset($box['host']) ? $box['host'] : '',
        'port' => isset($box['port']) ? (int) $box['port'] : 993,
        'smtpHost' => isset($box['smtpHost']) ? $box['smtpHost'] : '',
        'smtpPort' => isset($box['smtpPort']) ? (int) $box['smtpPort'] : 465,
        'secure' => isset($box['secure']) ? $box['secure'] : 'ssl',
        'user' => isset($box['user']) ? $box['user'] : '',
        'hasPass' => !empty($box['pass']),
        'ready' => !empty($box['pass']) && !empty($box['host']) && !empty($box['user']),
        'lastTest' => isset($box['lastTest']) ? $box['lastTest'] : null,
    );
}

function mailbox_imap($box) {
    return array(
        'host' => $box['host'], 'port' => (int) $box['port'],
        'user' => $box['user'], 'pass' => $box['pass'],
    );
}

function mailbox_smtp($box) {
    return array(
        'host' => $box['smtpHost'] !== '' ? $box['smtpHost'] : $box['host'],
        'port' => (int) ($box['smtpPort'] ? $box['smtpPort'] : 465),
        'secure' => $box['secure'],
        'user' => $box['user'],
        'pass' => $box['pass'],
        'from' => $box['address'],
        'fromName' => 'Смена контента',
        'notify' => $box['address'],
    );
}

function mailbox_or_fail($dir, $key) {
    $boxes = mailboxes_load($dir);
    if (!isset($boxes[$key])) fail('Такого ящика нет.', 404);
    $box = $boxes[$key];
    if (empty($box['pass'])) fail('Ящик ' . $box['address'] . ' ещё не подключён: впишите пароль в настройках почты.', 409);
    return $box;
}

/* Собираем письмо целиком: заголовки, текст + HTML, вложения. */
function mail_build_mime($from, $fromName, $to, $cc, $bcc, $subject, $text, $html, $files, $inReplyTo = '') {
    $boundary = 'smena-' . bin2hex(random_bytes(8));
    $alt = 'alt-' . bin2hex(random_bytes(6));
    $head = array();
    $head[] = 'Date: ' . date('r');
    $head[] = 'From: ' . smtp_encode_header($fromName) . ' <' . $from . '>';
    $head[] = 'To: ' . $to;
    if ($cc !== '') $head[] = 'Cc: ' . $cc;
    $head[] = 'Subject: ' . smtp_encode_header($subject);
    $head[] = 'Message-ID: <' . bin2hex(random_bytes(10)) . '@smenakontenta.ru>';
    if ($inReplyTo !== '' && preg_match('/^<[^>]+>$/', $inReplyTo)) {
        $head[] = 'In-Reply-To: ' . $inReplyTo;
        $head[] = 'References: ' . $inReplyTo;
    }
    $head[] = 'MIME-Version: 1.0';
    $head[] = 'X-Mailer: Smena Kontenta';
    $head[] = 'Content-Type: multipart/' . ($files ? 'mixed' : 'alternative') . '; boundary="' . $boundary . '"';

    $body = '';
    $body .= '--' . $boundary . "\r\n";
    $body .= 'Content-Type: multipart/alternative; boundary="' . $alt . '"' . "\r\n\r\n";
    $body .= '--' . $alt . "\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
    $body .= chunk_split(base64_encode($text), 76, "\r\n") . "\r\n";
    $body .= '--' . $alt . "\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
    $body .= chunk_split(base64_encode($html), 76, "\r\n") . "\r\n";
    $body .= '--' . $alt . "--\r\n\r\n";

    foreach ((array) $files as $file) {
        $body .= '--' . $boundary . "\r\n";
        $body .= 'Content-Type: ' . $file['type'] . '; name="' . smtp_encode_header($file['name']) . '"' . "\r\n";
        $body .= "Content-Transfer-Encoding: base64\r\n";
        $body .= 'Content-Disposition: attachment; filename="' . smtp_encode_header($file['name']) . '"' . "\r\n\r\n";
        $body .= chunk_split(base64_encode($file['bin']), 76, "\r\n") . "\r\n";
    }
    $body .= '--' . $boundary . "--\r\n";
    return implode("\r\n", $head) . "\r\n\r\n" . $body;
}

/* Вложения приходят как data-URL из браузера. Тип файла сверяем по списку:
   исполняемые и скрипты не прикладываем даже случайно. */
function mail_attachment_parse($items, &$error) {
    $allowed = array(
        'pdf' => 'application/pdf',
        'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls' => 'application/vnd.ms-excel',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'txt' => 'text/plain', 'csv' => 'text/csv',
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp',
        'zip' => 'application/zip',
    );
    $out = array();
    $total = 0;
    if (!is_array($items)) return $out;
    if (count($items) > MAILBOX_MAX_ATTACH) { $error = 'Не больше ' . MAILBOX_MAX_ATTACH . ' вложений в письме.'; return null; }
    foreach ($items as $item) {
        $name = isset($item['name']) ? basename((string) $item['name']) : '';
        $data = isset($item['data']) ? (string) $item['data'] : '';
        $name = preg_replace('/[^\w.\- а-яА-ЯёЁ()]/u', '', $name);
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if ($name === '' || !isset($allowed[$ext])) {
            $error = 'Файл «' . $name . '» нельзя приложить: разрешены pdf, docx, xlsx, txt, csv, картинки и zip.';
            return null;
        }
        if (!preg_match('#^data:[a-z0-9.+/\-]+;base64,#i', $data)) {
            $error = 'Вложение «' . $name . '» повреждено.';
            return null;
        }
        $bin = base64_decode(preg_replace('#^data:[^,]+,#', '', $data), true);
        if ($bin === false) { $error = 'Вложение «' . $name . '» не читается.'; return null; }
        $total += strlen($bin);
        if ($total > MAILBOX_MAX_ATTACH_BYTES) { $error = 'Вложения весят больше 8 МБ — уменьшите или пришлите ссылкой.'; return null; }
        $out[] = array('name' => $name, 'type' => $allowed[$ext], 'bin' => $bin);
    }
    return $out;
}

function mail_drafts_load($dir) {
    $list = read_json(mail_drafts_file($dir), array());
    return is_array($list) ? $list : array();
}

function mail_public_draft($d) {
    return array(
        'id' => isset($d['id']) ? $d['id'] : '',
        'box' => isset($d['box']) ? $d['box'] : 'editorial',
        'to' => isset($d['to']) ? $d['to'] : '',
        'cc' => isset($d['cc']) ? $d['cc'] : '',
        'bcc' => isset($d['bcc']) ? $d['bcc'] : '',
        'subject' => isset($d['subject']) ? $d['subject'] : '',
        'text' => isset($d['text']) ? $d['text'] : '',
        'updatedAt' => isset($d['updatedAt']) ? $d['updatedAt'] : '',
        'author' => isset($d['author']) ? $d['author'] : '',
    );
}

/* Текст письма в фирменную обёртку: так даже простое письмо выглядит
   как письмо проекта, а не как голая строка. */
function mail_compose_html($subject, $text, $why = '') {
    $tpl = array(
        'subject' => $subject,
        'title' => $subject,
        'body' => $text,
        'why' => $why !== '' ? $why : 'Письмо отправлено редакцией проекта «Смена контента».',
        'button' => '',
        'url' => '',
    );
    return mail_layout($tpl, array());
}

function mailbox_require_use($user) {
    if (!can($user, 'mail.use')) fail('Почта доступна только администрации и редакции.', 403);
}

/* ============================ маршруты =================================== */

function mailbox_routes($act, $dir) {
    $handled = array(
        'mailboxes', 'mailboxes-save', 'mailboxes-test', 'mail-folders', 'mail-list',
        'mail-get', 'mail-attachment', 'mail-flag', 'mail-move', 'mail-send',
        'mail-drafts', 'mail-draft-save', 'mail-draft-delete',
        'mail-templates', 'mail-template-save', 'mail-template-preview', 'mail-template-test',
        'mail-log',
    );
    if (!in_array($act, $handled, true)) return false;

    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    mailbox_require_use($me);

    /* ---- список ящиков ---- */
    if ($act === 'mailboxes') {
        $boxes = mailboxes_load($dir);
        $list = array();
        foreach ($boxes as $key => $box) $list[] = mailbox_public($key, $box);
        respond(array('ok' => true, 'mailboxes' => $list, 'canManage' => can($me, 'mail.manage')));
    }

    if ($act === 'mailboxes-save') {
        if (!can($me, 'mail.manage')) fail('Менять настройки ящиков может только администрация.', 403);
        $box = isset($in['box']) && is_array($in['box']) ? $in['box'] : array();
        $key = isset($box['key']) ? (string) $box['key'] : '';
        $boxes = mailboxes_load($dir);
        if (!isset($boxes[$key])) fail('Такого ящика нет.', 404);

        foreach (array('label', 'address', 'note', 'host', 'smtpHost', 'user') as $field) {
            if (isset($box[$field])) $boxes[$key][$field] = text((string) $box[$field], 120);
        }
        if (!empty($box['address']) && !filter_var($box['address'], FILTER_VALIDATE_EMAIL)) {
            fail('Адрес ящика указан с ошибкой.');
        }
        foreach (array('port' => 1, 'smtpPort' => 25) as $field => $default) {
            if (isset($box[$field])) $boxes[$key][$field] = max(0, min(65535, (int) $box[$field])) ?: $default;
        }
        if (isset($box['secure']) && in_array($box['secure'], array('ssl', 'tls', 'none'), true)) {
            $boxes[$key]['secure'] = $box['secure'];
        }
        /* Пустой пароль означает «оставить прежний»: админка никогда не
           показывает сохранённый пароль, значит и прислать его заново не может. */
        if (isset($box['pass']) && (string) $box['pass'] !== '') {
            $boxes[$key]['pass'] = (string) $box['pass'];
            $boxes[$key]['passAt'] = date('c');
        }
        if (!mailboxes_save($dir, $boxes)) fail('Не удалось сохранить настройки ящика.', 500);
        audit_log($dir, $me['email'], 'настройки почты', 'ящик ' . $key . ' обновлён');
        respond(array('ok' => true, 'mailbox' => mailbox_public($key, $boxes[$key])));
    }

    if ($act === 'mailboxes-test') {
        if (!can($me, 'mail.manage')) fail('Проверять ящики может только администрация.', 403);
        $key = isset($in['key']) ? (string) $in['key'] : '';
        $boxes = mailboxes_load($dir);
        if (!isset($boxes[$key])) fail('Такого ящика нет.', 404);
        $box = $boxes[$key];
        if (empty($box['pass'])) fail('Сначала впишите пароль ящика.', 409);

        $error = '';
        $folders = imapc_folders(mailbox_imap($box), $error);
        $ok = is_array($folders) && $folders;
        $boxes[$key]['lastTest'] = array('ok' => $ok, 'error' => $ok ? '' : $error, 'at' => date('c'));
        mailboxes_save($dir, $boxes);
        if (!$ok) fail('IMAP не пустил: ' . ($error !== '' ? $error : 'сервер не вернул папки') . '. Проверьте сервер, порт и пароль в панели хостинга.', 502);
        respond(array('ok' => true, 'folders' => $folders, 'lastTest' => $boxes[$key]['lastTest']));
    }

    if ($act === 'mail-folders') {
        $box = mailbox_or_fail($dir, isset($in['key']) ? (string) $in['key'] : 'editorial');
        $error = '';
        $folders = imapc_folders(mailbox_imap($box), $error);
        if (!is_array($folders)) fail('Не удалось получить папки ящика: ' . $error, 502);
        respond(array('ok' => true, 'folders' => $folders));
    }

    if ($act === 'mail-list') {
        $key = isset($in['key']) ? (string) $in['key'] : 'editorial';
        $box = mailbox_or_fail($dir, $key);
        $folder = isset($in['folder']) ? (string) $in['folder'] : 'INBOX';
        $limit = max(1, min(50, (int) (isset($in['limit']) ? $in['limit'] : 25)));
        $offset = max(0, (int) (isset($in['offset']) ? $in['offset'] : 0));
        $search = isset($in['q']) ? trim((string) $in['q']) : '';
        $error = '';
        $res = imapc_list(mailbox_imap($box), $folder, $limit, $offset, $search, $error);
        if ($res === null) fail('Не удалось прочитать ящик: ' . $error, 502);
        $res['ok'] = true;
        $res['box'] = $key;
        $res['address'] = $box['address'];
        $res['folder'] = $folder;
        respond($res);
    }

    if ($act === 'mail-get') {
        $box = mailbox_or_fail($dir, isset($in['key']) ? (string) $in['key'] : 'editorial');
        $error = '';
        $msg = imapc_message(mailbox_imap($box), (string) (isset($in['folder']) ? $in['folder'] : 'INBOX'), (int) (isset($in['uid']) ? $in['uid'] : 0), $error);
        if ($msg === null) fail('Не удалось открыть письмо: ' . $error, 502);
        $msg['ok'] = true;
        $msg['address'] = $box['address'];
        respond($msg);
    }

    if ($act === 'mail-attachment') {
        $box = mailbox_or_fail($dir, isset($in['key']) ? (string) $in['key'] : 'editorial');
        $error = '';
        $file = imapc_attachment(mailbox_imap($box), (string) (isset($in['folder']) ? $in['folder'] : 'INBOX'), (int) (isset($in['uid']) ? $in['uid'] : 0), (int) (isset($in['index']) ? $in['index'] : -1), $error);
        if ($file === null) fail('Вложение не получено: ' . $error, 502);
        respond(array(
            'ok' => true,
            'name' => $file['name'],
            'type' => $file['type'],
            'size' => strlen($file['body']),
            'data' => 'data:' . $file['type'] . ';base64,' . base64_encode($file['body']),
        ));
    }

    if ($act === 'mail-flag') {
        $box = mailbox_or_fail($dir, isset($in['key']) ? (string) $in['key'] : 'editorial');
        $flag = isset($in['flag']) ? (string) $in['flag'] : '\\Seen';
        $folder = (string) (isset($in['folder']) ? $in['folder'] : 'INBOX');
        $uid = (int) (isset($in['uid']) ? $in['uid'] : 0);
        $error = '';
        $ok = imapc_flag(mailbox_imap($box), $folder, $uid, $flag, !empty($in['value']), $error);
        if (!$ok) fail('Не удалось изменить метку: ' . $error, 502);
        respond(array('ok' => true, 'uid' => $uid, 'flag' => $flag, 'value' => !empty($in['value'])));
    }

    if ($act === 'mail-move') {
        $box = mailbox_or_fail($dir, isset($in['key']) ? (string) $in['key'] : 'editorial');
        $error = '';
        $ok = imapc_move(mailbox_imap($box), (string) (isset($in['folder']) ? $in['folder'] : 'INBOX'), (int) (isset($in['uid']) ? $in['uid'] : 0), (string) (isset($in['to']) ? $in['to'] : 'Trash'), $error);
        if (!$ok) fail('Не удалось переместить письмо: ' . $error, 502);
        respond(array('ok' => true));
    }

    if ($act === 'mail-drafts') {
        $out = array();
        foreach (mail_drafts_load($dir) as $d) {
            if (isset($d['author']) && (string) $d['author'] !== (string) $me['id'] && !can($me, 'mail.manage')) continue;
            $out[] = mail_public_draft($d);
        }
        respond(array('ok' => true, 'drafts' => array_reverse($out)));
    }

    if ($act === 'mail-draft-save') {
        $list = mail_drafts_load($dir);
        $id = isset($in['id']) ? (string) $in['id'] : '';
        $row = array(
            'id' => $id !== '' ? $id : 'd_' . bin2hex(random_bytes(5)),
            'box' => text((string) (isset($in['box']) ? $in['box'] : 'editorial'), 20),
            'to' => text((string) (isset($in['to']) ? $in['to'] : ''), 300),
            'cc' => text((string) (isset($in['cc']) ? $in['cc'] : ''), 300),
            'bcc' => text((string) (isset($in['bcc']) ? $in['bcc'] : ''), 300),
            'subject' => text((string) (isset($in['subject']) ? $in['subject'] : ''), 200),
            'text' => text((string) (isset($in['text']) ? $in['text'] : ''), 40000),
            'author' => (string) $me['id'],
            'updatedAt' => date('c'),
        );
        $found = false;
        foreach ($list as $i => $d) {
            if ($d['id'] !== $row['id']) continue;
            if ((string) $d['author'] !== (string) $me['id'] && !can($me, 'mail.manage')) fail('Это черновик другого сотрудника.', 403);
            $list[$i] = $row;
            $found = true;
            break;
        }
        if (!$found) {
            if (count($list) >= 200) $list = array_slice($list, -199);
            $list[] = $row;
        }
        if (!write_json(mail_drafts_file($dir), $list)) fail('Черновик не сохранился.', 500);
        respond(array('ok' => true, 'draft' => mail_public_draft($row)));
    }

    if ($act === 'mail-draft-delete') {
        $list = mail_drafts_load($dir);
        $id = (string) (isset($in['id']) ? $in['id'] : '');
        $left = array();
        foreach ($list as $d) {
            if ($d['id'] !== $id) { $left[] = $d; continue; }
            if ((string) $d['author'] !== (string) $me['id'] && !can($me, 'mail.manage')) fail('Это черновик другого сотрудника.', 403);
        }
        write_json(mail_drafts_file($dir), $left);
        respond(array('ok' => true));
    }

    /* ---- отправка ---- */
    if ($act === 'mail-send') {
        if (empty($in['confirm'])) fail('Отправка без подтверждения запрещена: нажмите «Отправить» ещё раз.', 428);
        $check = isset($in['check']) ? (string) $in['check'] : '';
        $stampFile = $dir . '/mail-sent-stamps.json';
        $stamps = read_json($stampFile, array());
        if (!is_array($stamps)) $stamps = array();
        $now = time();
        foreach ($stamps as $k => $t) {
            if ($now - (int) $t > 300) unset($stamps[$k]);
        }
        /* защита от двойной отправки: одинаковое письмо в течение 5 минут */
        if ($check !== '' && isset($stamps[$check])) {
            fail('Это письмо уже отправлено минуту назад. Проверьте «Отправленные», чтобы не дублировать.', 409);
        }

        $key = isset($in['key']) ? (string) $in['key'] : 'editorial';
        $box = mailbox_or_fail($dir, $key);
        $to = trim((string) (isset($in['to']) ? $in['to'] : ''));
        $cc = trim((string) (isset($in['cc']) ? $in['cc'] : ''));
        $bcc = trim((string) (isset($in['bcc']) ? $in['bcc'] : ''));
        $subject = text((string) (isset($in['subject']) ? $in['subject'] : ''), 200);
        $plain = text((string) (isset($in['text']) ? $in['text'] : ''), 40000);

        $noSubject = ($subject === '');
        if ($noSubject) $subject = '(без темы)';

        $split = function ($raw) {
            $out = array();
            foreach (preg_split('/[,;\s]+/', $raw) as $one) {
                if ($one !== '' && filter_var($one, FILTER_VALIDATE_EMAIL)) $out[] = $one;
            }
            return $out;
        };
        $toList = $split($to);
        $ccList = $split($cc);
        $bccList = $split($bcc);
        if (!$toList) fail('Укажите почту получателя — без неё письмо не уйдёт.');

        /* Текст: если пришёл HTML из редактора, берём его, иначе собираем
           абзацы из обычного текста. Текстовая версия есть всегда. */
        $htmlRaw = isset($in['html']) ? (string) $in['html'] : '';
        $why = (string) (isset($in['why']) ? $in['why'] : '');
        if ($htmlRaw !== '') {
            $safe = strip_tags($htmlRaw, '<p><br><b><strong><i><em><u><ul><ol><li><a><h2><h3><blockquote><img>');
            $safe = preg_replace('/\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $safe);
            $safe = preg_replace('/javascript:/i', '', $safe);
            $bodyHtml = mail_compose_html($subject, $safe, $why);
            $plain = $plain !== '' ? $plain : trim(html_entity_decode(strip_tags(str_replace(array('<br>', '</p>', '</li>'), "\n", $safe)), ENT_QUOTES, 'UTF-8'));
        } else {
            $bodyHtml = mail_compose_html($subject, $plain, $why);
        }

        $error = '';
        $files = mail_attachment_parse(isset($in['attachments']) ? $in['attachments'] : array(), $error);
        if ($files === null) fail($error, 413);

        $mime = mail_build_mime($box['address'], 'Смена контента', $to, $cc, $bcc, $subject, $plain, $bodyHtml, $files, (string) (isset($in['inReplyTo']) ? $in['inReplyTo'] : ''));
        $all = array_merge($toList, $ccList, $bccList);
        $res = smtp_deliver(mailbox_smtp($box), $all, $mime);
        if (empty($res['ok'])) {
            mail_log_add($dir, array(
                'at' => date('c'), 'template' => 'compose', 'to' => $to, 'subject' => $subject,
                'kind' => $key, 'ok' => false, 'error' => $res['error'], 'by' => $me['email'],
            ));
            fail('Письмо не ушло: ' . $res['error'] . '. Проверьте настройки ящика и попробуйте ещё раз.', 502);
        }

        $savedToSent = false;
        if (!empty($box['pass'])) {
            $savedToSent = imapc_append(mailbox_imap($box), 'Sent', $mime, $e);
            if (!$savedToSent) $savedToSent = imapc_append(mailbox_imap($box), 'Отправленные', $mime, $e);
        }

        if ($check !== '') {
            $stamps[$check] = $now;
            write_json($stampFile, $stamps);
        }
        mail_log_add($dir, array(
            'at' => date('c'), 'template' => 'compose', 'to' => implode(', ', $all), 'subject' => $subject,
            'kind' => $key, 'ok' => true, 'by' => $me['email'], 'attachments' => count($files),
        ));
        audit_log($dir, $me['email'], 'письмо отправлено', $key . ' → ' . implode(', ', $toList));

        if (!empty($in['draftId'])) {
            $list = mail_drafts_load($dir);
            $left = array();
            foreach ($list as $d) { if ($d['id'] !== (string) $in['draftId']) $left[] = $d; }
            write_json(mail_drafts_file($dir), $left);
        }
        respond(array('ok' => true, 'to' => $toList, 'cc' => $ccList, 'bcc' => count($bccList), 'from' => $box['address'], 'savedToSent' => $savedToSent, 'noSubject' => $noSubject));
    }

    /* ---- шаблоны писем ---- */
    if ($act === 'mail-templates') {
        $saved = mail_template_saved($dir);
        $out = array();
        foreach (mail_templates() as $key => $tpl) {
            $out[] = array(
                'key' => $key,
                'name' => $tpl['name'],
                'subject' => isset($saved[$key]['subject']) ? $saved[$key]['subject'] : $tpl['subject'],
                'title' => isset($saved[$key]['title']) ? $saved[$key]['title'] : $tpl['title'],
                'body' => isset($saved[$key]['body']) ? $saved[$key]['body'] : $tpl['body'],
                'defaults' => array('subject' => $tpl['subject'], 'title' => $tpl['title'], 'body' => $tpl['body']),
                'edited' => isset($saved[$key]),
                'code' => !empty($tpl['code']),
            );
        }
        respond(array('ok' => true, 'templates' => $out, 'canManage' => can($me, 'mail.manage')));
    }

    if ($act === 'mail-template-save') {
        if (!can($me, 'mail.manage')) fail('Менять шаблоны писем может только администрация.', 403);
        $key = (string) (isset($in['key']) ? $in['key'] : '');
        if (!isset(mail_templates()[$key])) fail('Такого шаблона нет.', 404);
        $saved = mail_template_saved($dir);
        $row = array();
        foreach (array('subject', 'title', 'body') as $field) {
            $row[$field] = text((string) (isset($in[$field]) ? $in[$field] : ''), $field === 'body' ? 2000 : 200);
        }
        $saved[$key] = $row;
        if (!write_json(mail_templates_file($dir), $saved)) fail('Не удалось сохранить шаблон.', 500);
        audit_log($dir, $me['email'], 'шаблон письма', $key . ' изменён');
        respond(array('ok' => true, 'template' => $row));
    }

    if ($act === 'mail-template-preview') {
        $key = (string) (isset($in['key']) ? $in['key'] : '');
        $tpl = mail_template($dir, $key);
        if (!$tpl) fail('Такого шаблона нет.', 404);
        $vars = array(
            'name' => 'Анна', 'code' => '482913', 'minutes' => '30',
            'link' => MAIL_SITE . '/cabinet/', 'post' => 'Как прошёл фестиваль уличной фотографии',
            'points' => '10', 'reason' => 'Нужно уточнить источник цитаты.',
            'position' => 'Автор текстов', 'message' => 'Здравствуйте! Подскажите, как подать материал?',
            'amount' => '10', 'status' => 'активен', 'sender' => 'Редакция',
        );
        if (!is_array($in)) $in = array();
        respond(array(
            'ok' => true,
            'subject' => mail_vars_fill($tpl['subject'], $vars),
            'html' => mail_layout($tpl, $vars),
            'text' => mail_text_version($tpl, $vars),
        ));
    }

    if ($act === 'mail-template-test') {
        if (!can($me, 'mail.manage')) fail('Тестовую отправку делает только администрация.', 403);
        $key = (string) (isset($in['key']) ? $in['key'] : '');
        if (!isset(mail_templates()[$key])) fail('Такого шаблона нет.', 404);
        $to = trim((string) (isset($in['to']) ? $in['to'] : $me['email']));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) fail('Укажите корректный адрес для теста.');
        $ok = mail_notify($dir, $key, $to, array(
            'name' => $me['name'], 'code' => '482913', 'minutes' => '30',
            'link' => MAIL_SITE . '/cabinet/', 'post' => 'Тестовый материал',
            'points' => '10', 'position' => 'Автор текстов', 'amount' => '10',
            'status' => 'активен', 'sender' => 'Редакция',
        ), array('dedupe' => '', 'by' => $me['email']));
        if (!$ok) fail('Письмо не ушло. Проверьте настройки SMTP в разделе «Почта».', 502);
        audit_log($dir, $me['email'], 'тест письма', $key . ' → ' . $to);
        respond(array('ok' => true, 'to' => $to));
    }

    if ($act === 'mail-log') {
        if (!can($me, 'mail.manage') && !can($me, 'audit.view')) fail('Журнал доставки видит администрация.', 403);
        $rows = array_reverse(mail_log_list($dir, 300));
        respond(array('ok' => true, 'entries' => $rows));
    }

    return true;
}
