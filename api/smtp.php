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

/* Отправка через настройки сайта: используется везде в index.php */
function mail_send($to, $subject, $text, $html = '') {
    $cfg = smtp_config($GLOBALS['DATA_DIR']);
    if (!smtp_configured($GLOBALS['DATA_DIR'])) {
        return false;
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
