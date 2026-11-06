<?php
/* ============================================================================
   СМЕНА КОНТЕНТА — отправка писем через SMTP

   Зачем свой клиент: на хостинге нет Composer и сторонних библиотек, а письма
   нужны для кодов подтверждения и восстановления доступа. Здесь один файл,
   который умеет то, что нужно: SSL или STARTTLS, AUTH LOGIN и AUTH PLAIN,
   текст и HTML, русские темы.

   Настройки лежат в api/data/mail.json — эта папка закрыта от веба через
   .htaccess. Пароль никогда не возвращается в браузер: наружу отдаются
   только хост, порт, логин и адрес отправителя.

   Подходит любой провайдер: SendPulse (smtp-pulse.com), Brevo, Яндекс,
   Mail.ru, Gmail — меняются только четыре значения в настройках.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

function smtp_config_file($dir) {
    return $dir . '/mail.json';
}

function smtp_config($dir) {
    $cfg = read_json(smtp_config_file($dir), array());
    if (!is_array($cfg)) $cfg = array();
    return array(
        'host' => isset($cfg['host']) ? (string) $cfg['host'] : '',
        'port' => isset($cfg['port']) ? (int) $cfg['port'] : 465,
        'secure' => in_array(isset($cfg['secure']) ? $cfg['secure'] : 'ssl', array('ssl', 'tls', 'none'), true)
            ? $cfg['secure'] : 'ssl',
        'user' => isset($cfg['user']) ? (string) $cfg['user'] : '',
        'pass' => isset($cfg['pass']) ? (string) $cfg['pass'] : '',
        'from' => isset($cfg['from']) ? (string) $cfg['from'] : '',
        'fromName' => isset($cfg['fromName']) ? (string) $cfg['fromName'] : 'Смена контента',
        'notify' => isset($cfg['notify']) ? (string) $cfg['notify'] : '',
        'updatedAt' => isset($cfg['updatedAt']) ? (string) $cfg['updatedAt'] : '',
        'lastTest' => isset($cfg['lastTest']) && is_array($cfg['lastTest']) ? $cfg['lastTest'] : null,
        'setupDone' => !empty($cfg['setupDone']),
    );
}

function smtp_configured($dir) {
    $cfg = smtp_config($dir);
    return $cfg['host'] !== '' && $cfg['from'] !== '' && $cfg['user'] !== '';
}

function smtp_public_config($dir) {
    $cfg = smtp_config($dir);
    return array(
        'configured' => smtp_configured($dir),
        'host' => $cfg['host'],
        'port' => $cfg['port'],
        'secure' => $cfg['secure'],
        'user' => $cfg['user'],
        'from' => $cfg['from'],
        'fromName' => $cfg['fromName'],
        'notify' => $cfg['notify'],
        'hasPassword' => $cfg['pass'] !== '',
        'updatedAt' => $cfg['updatedAt'],
        'lastTest' => $cfg['lastTest'],
    );
}

/* одна попытка разговора с сервером: возвращает ответ или ошибку */
function smtp_read($fp, &$error) {
    $data = '';
    while (($line = fgets($fp, 2048)) !== false) {
        $data .= $line;
        if (strlen($line) < 4 || $line[3] !== '-') break;
    }
    if ($data === '') {
        $error = 'Сервер закрыл соединение.';
        return '';
    }
    return $data;
}

function smtp_cmd($fp, $command, &$error, $expect = '') {
    if ($command !== '') fwrite($fp, $command . "\r\n");
    $answer = smtp_read($fp, $error);
    $code = substr($answer, 0, 3);
    if ($expect !== '' && $code !== $expect) {
        if ($error === '') $error = 'Сервер ответил ' . $code . ': ' . trim(substr($answer, 4, 200));
        return false;
    }
    return $answer;
}

function smtp_encode_header($value) {
    $value = str_replace(array("\r", "\n"), '', (string) $value);
    if (preg_match('/[\x80-\xFF]/', $value)) {
        return '=?UTF-8?B?' . base64_encode($value) . '?=';
    }
    return $value;
}

/* Основная функция отправки.
   $to — адрес, $subject — тема, $text — обычный текст, $html — необязательно. */
function smtp_send_mail($cfg, $to, $subject, $text, $html = '') {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return array('ok' => false, 'error' => 'Некорректный адрес получателя.');
    }
    if (empty($cfg['host']) || empty($cfg['from'])) {
        return array('ok' => false, 'error' => 'SMTP не настроен: нет сервера или отправителя.');
    }

    $host = $cfg['host'];
    $port = (int) ($cfg['port'] ? $cfg['port'] : 465);
    $secure = in_array($cfg['secure'], array('ssl', 'tls', 'none'), true) ? $cfg['secure'] : 'ssl';
    $transport = $secure === 'ssl' ? 'ssl://' : 'tcp://';
    $timeout = 20;

    $context = stream_context_create(array(
        'ssl' => array('verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true),
    ));
    $fp = @stream_socket_client($transport . $host . ':' . $port, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $context);
    if (!$fp) {
        return array('ok' => false, 'error' => 'Не удалось подключиться к ' . $host . ':' . $port . ' (' . $errstr . ').');
    }
    stream_set_timeout($fp, $timeout);
    $error = '';

    if (smtp_cmd($fp, '', $error, '220') === false) {
        fclose($fp);
        return array('ok' => false, 'error' => 'Сервер не поздоровался: ' . $error);
    }

    $ehlo = 'EHLO smenakontenta.ru';
    $answer = smtp_cmd($fp, $ehlo, $error, '250');
    if ($answer === false) {
        $answer = smtp_cmd($fp, 'HELO smenakontenta.ru', $error, '250');
        if ($answer === false) {
            fclose($fp);
            return array('ok' => false, 'error' => 'EHLO отклонён: ' . $error);
        }
    }

    if ($secure === 'tls') {
        if (smtp_cmd($fp, 'STARTTLS', $error, '220') === false) {
            fclose($fp);
            return array('ok' => false, 'error' => 'STARTTLS не принят: ' . $error);
        }
        if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            fclose($fp);
            return array('ok' => false, 'error' => 'Шифрование TLS не включилось.');
        }
        if (smtp_cmd($fp, 'EHLO smenakontenta.ru', $error, '250') === false) {
            fclose($fp);
            return array('ok' => false, 'error' => 'EHLO после TLS отклонён: ' . $error);
        }
    }

    if ($cfg['user'] !== '') {
        $auth = smtp_cmd($fp, 'AUTH LOGIN', $error, '334');
        if ($auth === false) {
            /* часть серверов просит сразу AUTH PLAIN */
            $plain = base64_encode("\0" . $cfg['user'] . "\0" . $cfg['pass']);
            if (smtp_cmd($fp, 'AUTH PLAIN ' . $plain, $error, '235') === false) {
                fclose($fp);
                return array('ok' => false, 'error' => 'Логин или пароль почты не приняты: ' . $error);
            }
        } else {
            if (smtp_cmd($fp, base64_encode($cfg['user']), $error, '334') === false) {
                fclose($fp);
                return array('ok' => false, 'error' => 'Сервер не принял логин: ' . $error);
            }
            if (smtp_cmd($fp, base64_encode($cfg['pass']), $error, '235') === false) {
                fclose($fp);
                return array('ok' => false, 'error' => 'Пароль почты не подошёл: ' . $error);
            }
        }
    }

    $from = $cfg['from'];
    if (smtp_cmd($fp, 'MAIL FROM:<' . $from . '>', $error, '250') === false) {
        fclose($fp);
        return array('ok' => false, 'error' => 'Отправитель отклонён: ' . $error);
    }
    if (smtp_cmd($fp, 'RCPT TO:<' . $to . '>', $error, '250') === false) {
        fclose($fp);
        return array('ok' => false, 'error' => 'Получатель отклонён: ' . $error);
    }
    if (smtp_cmd($fp, 'DATA', $error, '354') === false) {
        fclose($fp);
        return array('ok' => false, 'error' => 'Сервер не принял DATA: ' . $error);
    }

    $boundary = 'smena-' . bin2hex(random_bytes(8));
    $headers = array();
    $headers[] = 'Date: ' . date('r');
    $headers[] = 'From: ' . smtp_encode_header($cfg['fromName']) . ' <' . $from . '>';
    /* Ящиков на домене нет: без Reply-To ответ на письмо ушёл бы в никуда.
       Ответы идут на адрес, указанный в настройках почты (поле «Куда приходят
       обращения»), — это личная почта владельца проекта. */
    if (!empty($cfg['notify']) && filter_var($cfg['notify'], FILTER_VALIDATE_EMAIL)) {
        $headers[] = 'Reply-To: <' . $cfg['notify'] . '>';
    }
    $headers[] = 'To: <' . $to . '>';
    $headers[] = 'Subject: ' . smtp_encode_header($subject);
    $headers[] = 'Message-ID: <' . bin2hex(random_bytes(8)) . '@' . $host . '>';
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = 'X-Mailer: Smena Kontenta';

    if ($html !== '') {
        $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';
        $body = '--' . $boundary . "\r\n" .
            "Content-Type: text/plain; charset=UTF-8\r\n" .
            "Content-Transfer-Encoding: base64\r\n\r\n" .
            chunk_split(base64_encode($text), 76, "\r\n") . "\r\n" .
            '--' . $boundary . "\r\n" .
            "Content-Type: text/html; charset=UTF-8\r\n" .
            "Content-Transfer-Encoding: base64\r\n\r\n" .
            chunk_split(base64_encode($html), 76, "\r\n") . "\r\n" .
            '--' . $boundary . "--\r\n";
    } else {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $headers[] = 'Content-Transfer-Encoding: base64';
        $body = chunk_split(base64_encode($text), 76, "\r\n");
    }

    $payload = implode("\r\n", $headers) . "\r\n\r\n" . $body;
    /* точка в начале строки экранируется по правилам SMTP */
    $payload = preg_replace('/^\./m', '..', $payload);
    fwrite($fp, $payload . "\r\n.\r\n");

    $final = smtp_read($fp, $error);
    smtp_cmd($fp, 'QUIT', $error);
    fclose($fp);

    if (substr($final, 0, 3) !== '250') {
        return array('ok' => false, 'error' => 'Письмо не принято: ' . trim(substr($final, 0, 200)));
    }
    return array('ok' => true, 'error' => '');
}

/* Доставка готового письма: почтовый раздел админки собирает письмо
   целиком (копии, вложения, тема в UTF-8), а здесь только разговор с сервером.
   Возвращает array('ok'=>bool,'error'=>string). */
function smtp_deliver($cfg, $rcpts, $payload) {
    $rcpts = array_values(array_filter((array) $rcpts, function ($to) {
        return filter_var($to, FILTER_VALIDATE_EMAIL);
    }));
    if (!$rcpts) return array('ok' => false, 'error' => 'Нет корректных адресов получателей.');
    if (empty($cfg['host']) || empty($cfg['from'])) {
        return array('ok' => false, 'error' => 'SMTP не настроен: нет сервера или отправителя.');
    }
    $port = (int) (isset($cfg['port']) && $cfg['port'] ? $cfg['port'] : 465);
    $secure = in_array((string) $cfg['secure'], array('ssl', 'tls', 'none'), true) ? $cfg['secure'] : 'ssl';
    $target = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $cfg['host'] . ':' . $port;
    $ctx = stream_context_create(array('ssl' => array(
        'verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true,
    )));
    $fp = @stream_socket_client($target, $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        return array('ok' => false, 'error' => 'Не удалось подключиться к ' . $cfg['host'] . ':' . $port . ($errstr ? ' — ' . $errstr : ''));
    }
    stream_set_timeout($fp, 20);
    $error = '';
    if (smtp_cmd($fp, '', $error, '220') === false) {
        @fclose($fp);
        return array('ok' => false, 'error' => 'Сервер не поздоровался: ' . $error);
    }
    if (smtp_cmd($fp, 'EHLO smenakontenta.ru', $error, '250') === false) {
        if (smtp_cmd($fp, 'HELO smenakontenta.ru', $error, '250') === false) {
            @fclose($fp);
            return array('ok' => false, 'error' => 'EHLO отклонён: ' . $error);
        }
    }
    if ($secure === 'tls') {
        if (smtp_cmd($fp, 'STARTTLS', $error, '220') === false) {
            @fclose($fp);
            return array('ok' => false, 'error' => 'STARTTLS не принят: ' . $error);
        }
        if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            @fclose($fp);
            return array('ok' => false, 'error' => 'Шифрование TLS не включилось.');
        }
        smtp_cmd($fp, 'EHLO smenakontenta.ru', $error, '250');
    }
    if (!empty($cfg['user'])) {
        if (smtp_cmd($fp, 'AUTH LOGIN', $error, '334') === false) {
            $plain = base64_encode("\0" . $cfg['user'] . "\0" . $cfg['pass']);
            if (smtp_cmd($fp, 'AUTH PLAIN ' . $plain, $error, '235') === false) {
                @fclose($fp);
                return array('ok' => false, 'error' => 'Логин или пароль ящика не приняты: ' . $error);
            }
        } else {
            if (smtp_cmd($fp, base64_encode($cfg['user']), $error, '334') === false
                || smtp_cmd($fp, base64_encode($cfg['pass']), $error, '235') === false) {
                @fclose($fp);
                return array('ok' => false, 'error' => 'Пароль ящика не подошёл: ' . $error);
            }
        }
    }
    if (smtp_cmd($fp, 'MAIL FROM:<' . $cfg['from'] . '>', $error, '250') === false) {
        @fclose($fp);
        return array('ok' => false, 'error' => 'Отправитель отклонён: ' . $error);
    }
    foreach ($rcpts as $to) {
        if (smtp_cmd($fp, 'RCPT TO:<' . $to . '>', $error, '250') === false) {
            @fclose($fp);
            return array('ok' => false, 'error' => 'Получатель ' . $to . ' отклонён: ' . $error);
        }
    }
    if (smtp_cmd($fp, 'DATA', $error, '354') === false) {
        @fclose($fp);
        return array('ok' => false, 'error' => 'Сервер не принял DATA: ' . $error);
    }
    $payload = preg_replace('/^\./m', '..', $payload);
    fwrite($fp, $payload . "\r\n.\r\n");
    $final = smtp_read($fp, $error);
    smtp_cmd($fp, 'QUIT', $error);
    @fclose($fp);
    if (substr($final, 0, 3) !== '250') {
        return array('ok' => false, 'error' => 'Письмо не принято: ' . trim(substr($final, 0, 200)));
    }
    return array('ok' => true, 'error' => '');
}

/* Отправка через настройки сайта: используется везде в index.php */
/* Домен проекта: на нём работают адреса-алиасы (kod@, support@, redakcia@).
   Отдельных ящиков не заводится: письма уходят от имени домена. */
const SMENA_MAIL_DOMAIN = 'smenakontenta.ru';

/* Кому пишем — от того и отправляем: коды от kod@, поддержка от support@,
   редакция от redakcia@. Если домен ещё не подтверждён у почтового сервиса,
   mail_send() отправит письмо с основного адреса, чтобы оно не потерялось. */
function mail_from_kind($kind) {
    $aliases = array('kod', 'support', 'redakcia', 'hello', 'press');
    if (!in_array($kind, $aliases, true)) return '';
    $cfg = smtp_config($GLOBALS['DATA_DIR']);
    $at = strrpos($cfg['from'], '@');
    if ($at === false) return '';
    $domain = substr($cfg['from'], $at + 1);
    if (strcasecmp($domain, SMENA_MAIL_DOMAIN) !== 0) return '';
    return $kind . '@' . SMENA_MAIL_DOMAIN;
}


/* ---------------------------------------------------------------------------
   Подбор SMTP для ящика. Хостинг принимает и smtp.<домен>:465, и
   mail.<домен>:465, и 587/25 с STARTTLS. Перебираем сами и запоминаем
   рабочий вариант: человеку не нужно знать, какой порт у него открыт.
   --------------------------------------------------------------------------- */
function smtp_candidates($box) {
    $domain = '';
    $address = isset($box['address']) ? (string) $box['address'] : '';
    if (strpos($address, '@') !== false) $domain = substr($address, strpos($address, '@') + 1);
    $hosts = array();
    foreach (array($box['smtpHost'], $box['host'], 'smtp.' . $domain, 'mail.' . $domain) as $h) {
        $h = trim((string) $h);
        if ($h !== '' && !in_array($h, $hosts, true)) $hosts[] = $h;
    }
    $out = array();
    foreach ($hosts as $h) {
        foreach (array(array(465, 'ssl'), array(587, 'tls'), array(25, 'tls')) as $pair) {
            $out[] = array($h, $pair[0], $pair[1]);
        }
    }
    return array_slice($out, 0, 6);
}

/* Отправка с ящика с перебором вариантов SMTP: тем же способом, что и
   проверка. Возвращает рабочий вариант в $used. */
function smtp_send_from_box($box, $to, $subject, $text, $html = '', &$used = null) {
    $used = null;
    $tried = array();
    foreach (smtp_candidates($box) as $cand) {
        $cfg = array(
            'host' => $cand[0], 'port' => $cand[1], 'secure' => $cand[2],
            'user' => isset($box['user']) ? $box['user'] : '',
            'pass' => isset($box['pass']) ? $box['pass'] : '',
            'from' => isset($box['address']) ? $box['address'] : '',
            'fromName' => 'Смена контента',
            'notify' => isset($box['address']) ? $box['address'] : '',
        );
        if ($cfg['from'] === '' || $cfg['pass'] === '') {
            return array('ok' => false, 'error' => 'Пароль ящика не задан.');
        }
        $res = smtp_send_mail($cfg, $to, $subject, $text, $html);
        if (!empty($res['ok'])) {
            $used = $cand;
            return array('ok' => true, 'error' => '', 'host' => $cand[0] . ':' . $cand[1]);
        }
        $tried[] = $cand[0] . ':' . $cand[1] . ' — ' . (isset($res['error']) ? $res['error'] : 'отказ');
    }
    return array('ok' => false, 'error' => implode('; ', array_slice($tried, 0, 3)));
}

/* Пробная отправка письма себе. Возвращает рабочий вариант в $used. */
function smtp_test_send($box, $to, &$used) {
    $used = null;
    $tried = array();
    foreach (smtp_candidates($box) as $cand) {
        $cfg = array(
            'host' => $cand[0], 'port' => $cand[1], 'secure' => $cand[2],
            'user' => isset($box['user']) ? $box['user'] : '',
            'pass' => isset($box['pass']) ? $box['pass'] : '',
            'from' => isset($box['address']) ? $box['address'] : '',
            'fromName' => 'Смена контента',
            'notify' => isset($box['address']) ? $box['address'] : '',
        );
        if ($cfg['from'] === '' || $cfg['pass'] === '') {
            return array('ok' => false, 'error' => 'Впишите пароль ящика.', 'tried' => $tried);
        }
        $res = smtp_send_mail($cfg, $to,
            'Проверка отправки — Смена контента',
            "Это проверочное письмо. Значит, ящик " . $cfg['from'] . " умеет отправлять письма.

"
            . "Отправлено со страницы «Почта» — «Ящики домена».");
        if (!empty($res['ok'])) {
            $used = $cand;
            return array('ok' => true, 'error' => '', 'tried' => $tried);
        }
        $tried[] = $cand[0] . ':' . $cand[1] . ' — ' . (isset($res['error']) ? $res['error'] : 'отказ');
    }
    return array('ok' => false, 'error' => 'Ни один вариант SMTP не пустил: ' . implode('; ', array_slice($tried, 0, 3)), 'tried' => $tried);
}

function mail_send($to, $subject, $text, $html = '', $kind = '') {
    $dir = $GLOBALS['DATA_DIR'];

    /* Системные письма уходят с ящика noreply@, если он подключён в админке:
       один набор настроек вместо «старого сервиса» и новых ящиков. Если ящик
       ещё не настроен — работает прежний SMTP, чтобы письма не вставали. */
    if (function_exists('mailboxes_load')) {
        $boxes = mailboxes_load($dir);
        if (isset($boxes['noreply']) && !empty($boxes['noreply']['pass'])) {
            $used = null;
            $res = smtp_send_from_box($boxes['noreply'], $to, $subject, $text, $html, $used);
            if (!empty($res['ok'])) {
                /* запомним рабочий сервер, чтобы не перебирать каждый раз */
                if (is_array($used) && function_exists('mailboxes_save')) {
                    $fresh = mailboxes_load($dir);
                    if (isset($fresh['noreply'])) {
                        $fresh['noreply']['smtpHost'] = $used[0];
                        $fresh['noreply']['smtpPort'] = (int) $used[1];
                        $fresh['noreply']['secure'] = $used[2];
                        mailboxes_save($dir, $fresh);
                    }
                }
                return true;
            }
        }
    }

    if (!smtp_configured($dir)) {
        return false;
    }
    $cfg = smtp_config($dir);
    $from = $kind === '' ? '' : mail_from_kind($kind);
    if ($from !== '' && strcasecmp($from, $cfg['from']) !== 0) {
        $trial = $cfg;
        $trial['from'] = $from;
        $res = smtp_send_mail($trial, $to, $subject, $text, $html);
        if (!empty($res['ok'])) return true;
    }
    $res = smtp_send_mail($cfg, $to, $subject, $text, $html);
    return !empty($res['ok']);
}

/* письмо с кодом — один и тот же вид для подтверждения и восстановления */
function mail_code_text($code, $minutes, $what) {
    return "Здравствуйте!\n\n" .
        "Код для " . $what . ": " . $code . "\n\n" .
        "Код действует " . $minutes . " минут и срабатывает один раз. " .
        "Если вы ничего не запрашивали, просто удалите это письмо — доступ останется прежним.\n\n" .
        "—\nСмена контента\nМедиа, медиашкола и сообщество авторов\nhttps://smenakontenta.ru\n";
}

function mail_code_html($code, $minutes, $what) {
    $code_safe = htmlspecialchars($code, ENT_QUOTES, 'UTF-8');
    return '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;color:#141414">' .
        '<p>Здравствуйте!</p>' .
        '<p>Код для ' . htmlspecialchars($what, ENT_QUOTES, 'UTF-8') . ':</p>' .
        '<p style="font-size:30px;letter-spacing:6px;font-weight:600;margin:18px 0">' . $code_safe . '</p>' .
        '<p style="color:#555">Код действует ' . (int) $minutes . ' минут и срабатывает один раз. ' .
        'Если вы ничего не запрашивали, просто удалите письмо — доступ останется прежним.</p>' .
        '<p style="color:#777;margin-top:24px">—<br>Смена контента<br>' .
        'Медиа, медиашкола и сообщество авторов<br>' .
        '<a href="https://smenakontenta.ru" style="color:#ff3d14">smenakontenta.ru</a></p></div>';
}
