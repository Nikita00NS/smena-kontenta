<?php
/* ============================================================================
   IMAP-КЛИЕНТ БЕЗ БИБЛИОТЕК.

   На хостинге нет Composer и расширения imap, поэтому говорим с почтовым
   сервером напрямую по протоколу через SSL-сокет. Умеет ровно то, что нужно
   разделу «Почта»: папки, список писем, само письмо, вложения, флаги,
   перемещение и удаление.

   Пароли ящиков лежат в smena-data/mailboxes.json — папка вне public_html.
   В браузер пароль не отдаётся никогда.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

const IMAP_TIMEOUT = 20;

function imapc_quote($value) {
    return '"' . str_replace(array('\\', '"'), array('\\\\', '\\"'), (string) $value) . '"';
}

/* Один шаг протокола: отправить команду и собрать ответ до строки с тегом. */
function imapc_step($fp, $tag, $command, &$error) {
    if (fwrite($fp, $tag . ' ' . $command . "\r\n") === false) {
        $error = 'Соединение прервалось.';
        return null;
    }
    $out = '';
    $deadline = time() + IMAP_TIMEOUT;
    while (time() < $deadline) {
        $line = fgets($fp, 8192);
        if ($line === false) break;
        $out .= $line;
        /* литерал: сервер говорит {123} и ждёт ровно 123 байта */
        if (preg_match('/\{(\d+)\}\r\n$/', $line, $m)) {
            $need = (int) $m[1];
            $got = '';
            while (strlen($got) < $need) {
                $chunk = fread($fp, $need - strlen($got));
                if ($chunk === false || $chunk === '') break;
                $got .= $chunk;
            }
            $out .= $got;
            $rest = fgets($fp, 8192);
            if ($rest !== false) $out .= $rest;
            continue;
        }
        if (strpos($line, $tag . ' ') === 0) break;
    }
    if (!preg_match('/' . preg_quote($tag, '/') . ' (OK|NO|BAD)/i', $out, $m)) {
        $error = 'Сервер почты не ответил на команду.';
        return null;
    }
    if (strtoupper($m[1]) !== 'OK') {
        $error = 'Сервер почты ответил: ' . $m[1] . '.';
        return null;
    }
    return $out;
}

function imapc_open_box($box, &$error) {
    $error = '';
    $host = isset($box['host']) ? (string) $box['host'] : '';
    $port = isset($box['port']) ? (int) $box['port'] : 993;
    $user = isset($box['user']) ? (string) $box['user'] : '';
    $pass = isset($box['pass']) ? (string) $box['pass'] : '';
    if ($host === '' || $user === '' || $pass === '') {
        $error = 'Ящик не настроен: нужны сервер, логин и пароль.';
        return null;
    }
    $target = ($port === 143 ? 'tcp' : 'ssl') . '://' . $host . ':' . $port;
    $ctx = stream_context_create(array('ssl' => array(
        'verify_peer' => true, 'verify_peer_name' => true,
        'SNI_enabled' => true, 'peer_name' => $host,
    )));
    $fp = @stream_socket_client($target, $errno, $errstr, IMAP_TIMEOUT, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        $error = 'Не удалось подключиться к ' . $host . ':' . $port . ($errstr ? ' — ' . $errstr : '');
        return null;
    }
    stream_set_timeout($fp, IMAP_TIMEOUT);
    $greeting = fgets($fp, 4096);
    if ($greeting === false || stripos($greeting, 'OK') === false) {
        @fclose($fp);
        $error = 'Сервер почты не поприветствовал клиента.';
        return null;
    }
    if ($port === 143) {
        if (imapc_step($fp, 'a0', 'STARTTLS', $error) === null) { @fclose($fp); return null; }
        if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            @fclose($fp);
            $error = 'Не удалось включить шифрование на порту 143.';
            return null;
        }
    }
    if (imapc_step($fp, 'a1', 'LOGIN ' . imapc_quote($user) . ' ' . imapc_quote($pass), $error) === null) {
        @fclose($fp);
        return null;
    }
    return $fp;
}

function imapc_close_box($fp) {
    if (!$fp) return;
    @imapc_step($fp, 'zz', 'LOGOUT', $e);
    @fclose($fp);
}

/* Декодирование заголовков: =?UTF-8?B?...?= и =?UTF-8?Q?...?= */
function mail_decode_header($value) {
    $value = (string) $value;
    if ($value === '') return '';
    $decoded = @iconv_mime_decode($value, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
    if ($decoded !== false && $decoded !== '') return $decoded;
    $value = preg_replace_callback('/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/', function ($m) {
        $charset = $m[1];
        $data = $m[2] === 'B' || $m[2] === 'b' ? base64_decode($m[3]) : quoted_printable_decode(str_replace('_', ' ', $m[3]));
        $converted = @mb_convert_encoding($data, 'UTF-8', $charset);
        return $converted === false ? $data : $converted;
    }, $value);
    return $value;
}

function mail_to_utf8($text, $charset) {
    $charset = strtoupper(trim((string) $charset));
    if ($charset === '' || $charset === 'UTF-8') return (string) $text;
    $out = @mb_convert_encoding((string) $text, 'UTF-8', $charset);
    return $out === false ? (string) $text : $out;
}

/* Разбор заголовков блока: массив «ключ в нижнем регистре» → значение. */
function mail_parse_headers($raw) {
    $raw = str_replace("\r\n", "\n", (string) $raw);
    $lines = explode("\n", $raw);
    $out = array();
    $key = '';
    foreach ($lines as $line) {
        if ($line === '') continue;
        if (($line[0] === ' ' || $line[0] === "\t") && $key !== '') {
            $out[$key] .= ' ' . trim($line);
            continue;
        }
        $pos = strpos($line, ':');
        if ($pos === false) continue;
        $key = strtolower(substr($line, 0, $pos));
        $out[$key] = trim(substr($line, $pos + 1));
    }
    return $out;
}

function mail_header_param($value, $name) {
    if (preg_match('/' . preg_quote($name, '/') . '\*?=\s*"?([^";]+)"?/i', (string) $value, $m)) {
        return trim($m[1]);
    }
    return '';
}

/* Разбор MIME на части. Возвращает плоский список частей с декодированным телом. */
function mail_mime_parts($raw, $depth = 0) {
    $raw = (string) $raw;
    $sep = strpos(str_replace("\r\n", "\n", $raw), "\n\n");
    $normalized = str_replace("\r\n", "\n", $raw);
    if ($sep === false) {
        $headers = mail_parse_headers($normalized);
        $body = '';
    } else {
        $headers = mail_parse_headers(substr($normalized, 0, $sep));
        $body = substr($normalized, $sep + 2);
    }
    $type = isset($headers['content-type']) ? strtolower($headers['content-type']) : 'text/plain';
    $boundary = mail_header_param(isset($headers['content-type']) ? $headers['content-type'] : '', 'boundary');
    $encoding = isset($headers['content-transfer-encoding']) ? strtolower(trim($headers['content-transfer-encoding'])) : '';

    if ($boundary !== '' && strpos($type, 'multipart/') === 0 && $depth < 6) {
        $parts = array();
        $chunks = explode('--' . $boundary, $body);
        foreach ($chunks as $chunk) {
            $chunk = ltrim($chunk, "\n");
            if ($chunk === '' || strpos($chunk, '--') === 0) continue;
            foreach (mail_mime_parts($chunk, $depth + 1) as $sub) $parts[] = $sub;
        }
        return $parts;
    }

    if ($encoding === 'base64') {
        $body = base64_decode(preg_replace('/\s+/', '', $body));
    } elseif ($encoding === 'quoted-printable') {
        $body = quoted_printable_decode($body);
    }

    $charset = mail_header_param(isset($headers['content-type']) ? $headers['content-type'] : '', 'charset');
    $disposition = isset($headers['content-disposition']) ? $headers['content-disposition'] : '';
    $filename = mail_header_param($disposition, 'filename');
    if ($filename === '' && isset($headers['content-type'])) {
        $filename = mail_header_param($headers['content-type'], 'name');
    }

    return array(array(
        'type' => $type,
        'charset' => $charset,
        'filename' => $filename === '' ? '' : mail_decode_header($filename),
        'disposition' => strtolower(trim(explode(';', $disposition)[0])),
        'body' => $body,
        'size' => strlen($body),
        'is_text' => strpos($type, 'text/') === 0,
    ));
}

/* ---------------------------------------------------------------- операции */

function imapc_folders($box, &$error) {
    $fp = imapc_open_box($box, $error);
    if (!$fp) return null;
    $raw = imapc_step($fp, 'a2', 'LIST "" "*"', $error);
    imapc_close_box($fp);
    if ($raw === null) return null;
    $out = array();
    foreach (explode("\n", $raw) as $line) {
        if (strpos($line, '* LIST') !== 0 && strpos($line, '* LSUB') !== 0) continue;
        if (!preg_match('/"([^"]*)"\s*$/', trim($line), $m)) continue;
        $name = $m[1];
        if ($name === '') continue;
        $out[] = $name;
    }
    return $out;
}

function imapc_select($fp, $folder, &$error) {
    $raw = imapc_step($fp, 'a3', 'SELECT ' . imapc_quote($folder), $error);
    if ($raw === null) return 0;
    $count = 0;
    if (preg_match('/\* (\d+) EXISTS/', $raw, $m)) $count = (int) $m[1];
    return $count;
}

/* Список писем: последние $limit штук, без скачивания тела. */
function imapc_list($box, $folder, $limit, $offset, $search, &$error) {
    $fp = imapc_open_box($box, $error);
    if (!$fp) return null;
    $total = imapc_select($fp, $folder, $error);

    $criteria = 'ALL';
    if ($search !== '') {
        $safe = str_replace(array('"', '\\'), ' ', $search);
        $criteria = 'OR OR OR SUBJECT "' . $safe . '" FROM "' . $safe . '" TO "' . $safe . '" BODY "' . $safe . '"';
    }
    $raw = imapc_step($fp, 'a4', 'UID SEARCH ' . $criteria, $error);
    if ($raw === null) { imapc_close_box($fp); return null; }

    $uids = array();
    if (preg_match('/\* SEARCH([0-9 ]*)/', $raw, $m)) {
        foreach (preg_split('/\s+/', trim($m[1])) as $uid) {
            if ($uid !== '') $uids[] = (int) $uid;
        }
    }
    $uids = array_reverse($uids);
    $slice = array_slice($uids, max(0, (int) $offset), max(1, (int) $limit));
    if (!$slice) {
        imapc_close_box($fp);
        return array('total' => $total, 'messages' => array(), 'matched' => count($uids));
    }

    $set = implode(',', $slice);
    $fetch = 'UID FETCH ' . $set . ' (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])';
    $rawFetch = imapc_step($fp, 'a5', $fetch, $error);
    imapc_close_box($fp);
    if ($rawFetch === null) return null;

    $messages = array();
    $blocks = preg_split('/\* \d+ FETCH \(/', $rawFetch);
    foreach ($blocks as $block) {
        if (!preg_match('/UID (\d+)/', $block, $um)) continue;
        $uid = (int) $um[1];
        $flags = '';
        if (preg_match('/FLAGS \(([^)]*)\)/', $block, $fm)) $flags = $fm[1];
        $headers = '';
        if (preg_match('/\{(?:(\d+))\}/', $block, $lm)) {
            $start = strpos($block, '{' . $lm[1] . '}');
            if ($start !== false) {
                $headers = substr($block, $start + strlen('{' . $lm[1] . '}'));
                $headers = substr($headers, 0, (int) $lm[1]);
            }
        }
        $h = mail_parse_headers($headers);
        $messages[] = array(
            'uid' => $uid,
            'folder' => $folder,
            'from' => mail_decode_header(isset($h['from']) ? $h['from'] : ''),
            'to' => mail_decode_header(isset($h['to']) ? $h['to'] : ''),
            'subject' => mail_decode_header(isset($h['subject']) ? $h['subject'] : '(без темы)'),
            'date' => isset($h['date']) ? trim($h['date']) : '',
            'seen' => stripos($flags, '\\Seen') !== false,
            'flagged' => stripos($flags, '\\Flagged') !== false,
        );
    }
    usort($messages, function ($a, $b) {
        return strtotime((string) $b['date']) <=> strtotime((string) $a['date']);
    });
    return array('total' => $total, 'messages' => $messages, 'matched' => count($uids));
}

/* Полное письмо: заголовки, текст, HTML и вложения. */
function imapc_message($box, $folder, $uid, &$error) {
    $fp = imapc_open_box($box, $error);
    if (!$fp) return null;
    imapc_select($fp, $folder, $error);
    $raw = imapc_step($fp, 'a6', 'UID FETCH ' . (int) $uid . ' (UID FLAGS BODY.PEEK[])', $error);
    if ($raw === null) { imapc_close_box($fp); return null; }
    /* помечаем прочитанным */
    imapc_step($fp, 'a7', 'UID STORE ' . (int) $uid . ' +FLAGS (\\Seen)', $e);
    imapc_close_box($fp);

    $pos = strpos($raw, 'BODY[]');
    if ($pos === false) { $error = 'Письмо не найдено.'; return null; }
    $tail = substr($raw, $pos);
    if (!preg_match('/\{(\d+)\}/', $tail, $m)) { $error = 'Письмо повреждено.'; return null; }
    $start = strpos($tail, '{' . $m[1] . '}');
    $message = substr($tail, $start + strlen('{' . $m[1] . '}'), (int) $m[1]);

    $normalized = str_replace("\r\n", "\n", $message);
    $sep = strpos($normalized, "\n\n");
    $headRaw = $sep === false ? $normalized : substr($normalized, 0, $sep);
    $headers = mail_parse_headers($headRaw);
    $parts = mail_mime_parts($message);

    $textPlain = '';
    $textHtml = '';
    $attachments = array();
    foreach ($parts as $i => $part) {
        if ($part['filename'] !== '' || $part['disposition'] === 'attachment') {
            $attachments[] = array(
                'index' => $i,
                'name' => $part['filename'] !== '' ? $part['filename'] : ('файл-' . $i),
                'type' => $part['type'],
                'size' => $part['size'],
            );
            continue;
        }
        if ($part['type'] === 'text/html' && $textHtml === '') {
            $textHtml = mail_to_utf8($part['body'], $part['charset']);
        }
        if ($part['type'] === 'text/plain' && $textPlain === '') {
            $textPlain = mail_to_utf8($part['body'], $part['charset']);
        }
    }

    return array(
        'uid' => (int) $uid,
        'folder' => $folder,
        'from' => mail_decode_header(isset($headers['from']) ? $headers['from'] : ''),
        'to' => mail_decode_header(isset($headers['to']) ? $headers['to'] : ''),
        'cc' => mail_decode_header(isset($headers['cc']) ? $headers['cc'] : ''),
        'subject' => mail_decode_header(isset($headers['subject']) ? $headers['subject'] : '(без темы)'),
        'date' => isset($headers['date']) ? trim($headers['date']) : '',
        'messageId' => isset($headers['message-id']) ? trim($headers['message-id']) : '',
        'text' => $textPlain,
        'html' => $textHtml,
        'attachments' => $attachments,
    );
}

function imapc_attachment($box, $folder, $uid, $index, &$error) {
    $fp = imapc_open_box($box, $error);
    if (!$fp) return null;
    imapc_select($fp, $folder, $error);
    $raw = imapc_step($fp, 'a8', 'UID FETCH ' . (int) $uid . ' (BODY.PEEK[])', $error);
    imapc_close_box($fp);
    if ($raw === null) return null;
    if (!preg_match('/\{(\d+)\}/', $raw, $m)) { $error = 'Письмо повреждено.'; return null; }
    $start = strpos($raw, '{' . $m[1] . '}');
    $message = substr($raw, $start + strlen('{' . $m[1] . '}'), (int) $m[1]);
    $parts = mail_mime_parts($message);
    if (!isset($parts[(int) $index])) { $error = 'Вложение не найдено.'; return null; }
    $part = $parts[(int) $index];
    return array(
        'name' => $part['filename'] !== '' ? $part['filename'] : ('файл-' . $index),
        'type' => $part['type'] !== '' ? $part['type'] : 'application/octet-stream',
        'body' => $part['body'],
    );
}

function imapc_flag($box, $folder, $uid, $flag, $set, &$error) {
    $fp = imapc_open_box($box, $error);
    if (!$fp) return false;
    imapc_select($fp, $folder, $error);
    $allowed = array('\\Seen', '\\Flagged');
    if (!in_array($flag, $allowed, true)) { $error = 'Такой флаг не поддерживается.'; imapc_close_box($fp); return false; }
    $raw = imapc_step($fp, 'a9', 'UID STORE ' . (int) $uid . ' ' . ($set ? '+' : '-') . 'FLAGS (' . $flag . ')', $error);
    imapc_close_box($fp);
    return $raw !== null;
}

function imapc_move($box, $folder, $uid, $target, &$error) {
    $fp = imapc_open_box($box, $error);
    if (!$fp) return false;
    imapc_select($fp, $folder, $error);
    $ok = imapc_step($fp, 'b1', 'UID COPY ' . (int) $uid . ' ' . imapc_quote($target), $error) !== null;
    if ($ok) {
        imapc_step($fp, 'b2', 'UID STORE ' . (int) $uid . ' +FLAGS (\\Deleted)', $e);
        imapc_step($fp, 'b3', 'EXPUNGE', $e);
    }
    imapc_close_box($fp);
    return $ok;
}

/* Складываем отправленное письмо в папку «Отправленные» этого ящика. */
function imapc_append($box, $folder, $raw, &$error) {
    $fp = imapc_open_box($box, $error);
    if (!$fp) return false;
    $size = strlen($raw);
    $tag = 'c1';
    fwrite($fp, $tag . ' APPEND ' . imapc_quote($folder) . ' (\\Seen) {' . $size . "}\r\n");
    $reply = fgets($fp, 4096);
    if ($reply === false || strpos($reply, '+') !== 0) {
        $error = 'Сервер не принял письмо в папку «Отправленные».';
        imapc_close_box($fp);
        return false;
    }
    fwrite($fp, $raw . "\r\n");
    $deadline = time() + IMAP_TIMEOUT;
    $ok = false;
    while (time() < $deadline) {
        $line = fgets($fp, 4096);
        if ($line === false) break;
        if (strpos($line, $tag . ' OK') === 0) { $ok = true; break; }
        if (strpos($line, $tag . ' NO') === 0 || strpos($line, $tag . ' BAD') === 0) break;
    }
    imapc_close_box($fp);
    if (!$ok) $error = 'Папка «Отправленные» не приняла копию письма.';
    return $ok;
}
