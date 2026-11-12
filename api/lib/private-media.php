<?php
/* Личные документы не являются публикациями. Наружу выдаётся случайный
   идентификатор, а файл лежит без исполняемого расширения в private/.
   Доступ проверяется при каждом запросе: владелец или ответственная роль.
   Токен входа не помещаем в URL картинок: для них используется отдельный
   HttpOnly-cookie, связанный с текущей серверной сессией. */

function private_media_dir($dir) { return $dir . '/private'; }
function private_media_index($dir) { return $dir . '/private-media.json'; }
function private_sessions_file($dir) { return $dir . '/media-sessions.json'; }

function private_media_read($dir) {
    $rows = read_json(private_media_index($dir), array());
    return is_array($rows) ? $rows : array();
}

function private_media_url($id) {
    return '/api/index.php?action=private-media&id=' . rawurlencode($id);
}

function private_media_record($dir, $id) {
    if (!preg_match('/^[a-f0-9]{40}$/', (string) $id)) return null;
    $rows = private_media_read($dir);
    return isset($rows[$id]) && is_array($rows[$id]) ? $rows[$id] : null;
}

function private_media_capability($kind) {
    $map = array('consent' => 'consents.review', 'portfolio' => 'portfolio.review',
        'editorial' => 'editorials.review');
    return isset($map[$kind]) ? $map[$kind] : '';
}

function private_media_can_view($dir, $user, $record) {
    if (!$user || !$record || !empty($record['deletedAt'])) return false;
    if ((string) $user['id'] === (string) $record['ownerId']) return true;
    $cap = private_media_capability(isset($record['kind']) ? $record['kind'] : '');
    if ($cap === '' || !can($user, $cap)) return false;
    if ($record['kind'] === 'editorial' && !can($user, 'editorials.appoint') && !empty($record['editorialId'])) {
        foreach (read_editorials($dir) as $editorial) {
            if ($editorial['id'] === $record['editorialId'] && $editorial['founderId'] === $user['id']) return true;
        }
        return false;
    }
    return true;
}

/* В ответах показываем только ссылки, которые получатель вправе открыть. */
function private_media_visible($dir, $user, $url) {
    if (!is_string($url) || strpos($url, 'action=private-media&id=') === false) return '';
    $parts = array(); parse_str((string) parse_url($url, PHP_URL_QUERY), $parts);
    $record = private_media_record($dir, isset($parts['id']) ? $parts['id'] : '');
    return private_media_can_view($dir, $user, $record) ? $url : '';
}

function private_media_store($dir, $ownerId, $kind, $file, $editorialId = '') {
    if (!ensure_dir(private_media_dir($dir))) return null;
    $id = bin2hex(random_bytes(20));
    $path = private_media_dir($dir) . '/' . $id . '.bin';
    if (@file_put_contents($path, $file['bin'], LOCK_EX) === false) return null;
    @chmod($path, 0600);
    $record = array('id' => $id, 'ownerId' => (string) $ownerId, 'kind' => $kind,
        'editorialId' => (string) $editorialId, 'ext' => $file['ext'], 'mime' => $file['mime'],
        'size' => strlen($file['bin']), 'sha256' => hash('sha256', $file['bin']), 'createdAt' => date('c'));
    $rows = private_media_read($dir);
    $rows[$id] = $record;
    if (!write_json(private_media_index($dir), $rows)) { @unlink($path); return null; }
    return array('id' => $id, 'url' => private_media_url($id), 'record' => $record);
}

function private_https() {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    $remote = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
    $trusted = preg_match('/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/', $remote);
    return $trusted && isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https';
}

function private_media_cookie($dir, $user, $token) {
    $raw = bin2hex(random_bytes(32));
    $rows = read_json(private_sessions_file($dir), array());
    if (!is_array($rows)) $rows = array();
    $mine = array();
    foreach ($rows as $key => $row) {
        if (empty($row['exp']) || (int) $row['exp'] < time()) { unset($rows[$key]); continue; }
        if ((string) $row['userId'] === (string) $user['id']) $mine[$key] = (int) $row['exp'];
    }
    if (count($mine) >= 12) {
        asort($mine);
        $drop = count($mine) - 12 + 1;
        foreach ($mine as $key => $exp) {
            if ($drop <= 0) break;
            unset($rows[$key]); $drop--;
        }
    }
    $exp = time() + 7 * 86400;
    $rows[hash('sha256', $raw)] = array('userId' => (string) $user['id'],
        'tokenHash' => hash('sha256', $token), 'exp' => $exp);
    if (!write_json(private_sessions_file($dir), $rows)) return false;
    setcookie('smena_docs', $raw, array('expires' => $exp, 'path' => '/api/', 'secure' => private_https(),
        'httponly' => true, 'samesite' => 'Lax'));
    return true;
}

function private_media_clear_cookie($dir) {
    $raw = isset($_COOKIE['smena_docs']) ? (string) $_COOKIE['smena_docs'] : '';
    if (preg_match('/^[a-f0-9]{64}$/', $raw)) {
        $rows = read_json(private_sessions_file($dir), array());
        if (is_array($rows)) { unset($rows[hash('sha256', $raw)]); write_json(private_sessions_file($dir), $rows); }
    }
    setcookie('smena_docs', '', array('expires' => time() - 3600, 'path' => '/api/',
        'secure' => private_https(), 'httponly' => true, 'samesite' => 'Lax'));
}

function private_media_user($dir) {
    $raw = isset($_COOKIE['smena_docs']) ? (string) $_COOKIE['smena_docs'] : '';
    if (!preg_match('/^[a-f0-9]{64}$/', $raw)) return null;
    $rows = read_json(private_sessions_file($dir), array());
    $key = hash('sha256', $raw);
    if (!is_array($rows) || !isset($rows[$key]) || (int) $rows[$key]['exp'] < time()) return null;
    $session = $rows[$key];
    $tokens = read_json(tokens_file($dir), array());
    if (!is_array($tokens)) return null;
    foreach ($tokens as $token => $info) {
        if (!is_array($info) || (int) $info['exp'] < time() || $info['id'] !== $session['userId']) continue;
        if (!hash_equals($session['tokenHash'], hash('sha256', (string) $token))) continue;
        $user = user_by_token($dir, (string) $token);
        return $user && empty($user['deletedAt']) ? $user : null;
    }
    return null;
}

function private_media_revoke_user($dir, $userId) {
    $rows = read_json(private_sessions_file($dir), array());
    if (!is_array($rows)) return;
    foreach ($rows as $key => $row) if ((string) $row['userId'] === (string) $userId) unset($rows[$key]);
    write_json(private_sessions_file($dir), $rows);
}

function private_media_serve($dir, $record) {
    $path = private_media_dir($dir) . '/' . $record['id'] . '.bin';
    if (!is_file($path)) { http_response_code(404); exit; }
    $types = array('jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp',
        'pdf' => 'application/pdf', 'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4',
        'ogg' => 'audio/ogg', 'wav' => 'audio/wav', 'mp4' => 'video/mp4', 'webm' => 'video/webm');
    $ext = $record['ext'];
    if (!isset($types[$ext])) { http_response_code(404); exit; }
    header('Content-Type: ' . $types[$ext]);
    header('Content-Disposition: inline; filename="document.' . $ext . '"');
    header('Cache-Control: private, no-store');
    header('Content-Length: ' . filesize($path));
    header("Content-Security-Policy: default-src 'none'; sandbox");
    readfile($path);
    exit;
}

/* Перенос старых pd_/pf_/ed_ файлов. Сначала сохраняем закрытую копию,
   затем ссылку в записи. Оригинал не удаляем, но маршрут media больше не
   отдаёт личные документы без проверки. Повторный запуск безопасен. */
function private_media_migrate($dir) {
    $marker = $dir . '/private-media-migrated-v1.json';
    if (is_file($marker)) return array('ok' => true, 'skipped' => true);
    $errors = array(); $moved = 0;
    $sources = array(
        array(consents_file($dir), 'consent', 'scan', array('pd_')),
        array(portfolio_file($dir), 'portfolio', 'files', array('pf_')),
        array(editorial_apps_file($dir), 'editorial', 'portfolio', array('ed_')),
    );
    foreach ($sources as $source) {
        list($file, $kind, $field, $prefixes) = $source;
        $rows = read_json($file, array()); $changed = false;
        foreach ($rows as $i => $row) {
            $urls = $field === 'scan' ? array(isset($row[$field]) ? $row[$field] : '') :
                (isset($row[$field]) && is_array($row[$field]) ? $row[$field] : array());
            $out = array();
            foreach ($urls as $url) {
                $parts = array(); parse_str((string) parse_url((string) $url, PHP_URL_QUERY), $parts);
                $name = isset($parts['id']) ? basename((string) $parts['id']) : '';
                $legacy = false; foreach ($prefixes as $prefix) if (strpos($name, $prefix) === 0) $legacy = true;
                if (!$legacy) { $out[] = $url; continue; }
                $old = media_dir($dir) . '/' . $name;
                $existing = null;
                foreach (private_media_read($dir) as $saved) {
                    if (isset($saved['legacyName']) && $saved['legacyName'] === $name) { $existing = $saved; break; }
                }
                if (!$existing && is_file($old)) {
                    $bin = @file_get_contents($old); $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                    $mimes = array('jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
                        'webp' => 'image/webp', 'pdf' => 'application/pdf', 'mp3' => 'audio/mpeg',
                        'm4a' => 'audio/mp4', 'ogg' => 'audio/ogg', 'wav' => 'audio/wav', 'mp4' => 'video/mp4', 'webm' => 'video/webm');
                    if ($bin !== false && isset($mimes[$ext])) {
                        $saved = private_media_store($dir, isset($row['userId']) ? $row['userId'] : '', $kind,
                            array('bin' => $bin, 'ext' => $ext === 'jpeg' ? 'jpg' : $ext, 'mime' => $mimes[$ext]),
                            isset($row['editorialId']) ? $row['editorialId'] : '');
                        if ($saved) {
                            $all = private_media_read($dir); $all[$saved['id']]['legacyName'] = $name;
                            if (!write_json(private_media_index($dir), $all)) $saved = null;
                            else $existing = $all[$saved['id']];
                        }
                    }
                }
                if ($existing) { $out[] = private_media_url($existing['id']); $changed = true; $moved++; }
                else { $out[] = $url; $errors[] = $kind . ':' . $i; }
            }
            if ($changed) $rows[$i][$field] = $field === 'scan' ? $out[0] : $out;
        }
        if ($changed && !write_json($file, $rows)) $errors[] = basename($file);
    }
    $result = array('ok' => !$errors, 'moved' => $moved, 'errors' => $errors,
        'originalsRetained' => true);
    if (!$errors) write_json($marker, array('at' => date('c'), 'result' => $result));
    return $result;
}
