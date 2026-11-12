<?php
/* ============================================================================
   РЕЗЕРВНЫЕ КОПИИ.
   Данные лежат в JSON-файлах вне public_html. Копия делается один раз в сутки
   при первом запросе записи, хранится 14 дней. Личные документы (private/)
   входят в копию вместе с индексом: без них восстановление согласий и
   портфолио было бы неполным. Публичные загрузки (uploads/) не копируются:
   они слишком тяжёлые для лимита хостинга — об этом сказано в документации.

   Копия считается готовой только после проверки SHA-256 каждого файла.
   Пока проверка не прошла, маркер дня не обновляется и старые копии не
   удаляются.
   ========================================================================== */

function backup_dir($dir) { return $dir . '/backup'; }

function backup_sources($dir) {
    $files = array();
    foreach ((array) glob($dir . '/*.json') as $file) {
        $name = basename($file);
        if (substr($name, -4) === '.tmp') continue;
        $files[$name] = $file;
    }
    $private = $dir . '/private';
    if (is_dir($private)) {
        foreach ((array) glob($private . '/*.bin') as $file) {
            $files['private/' . basename($file)] = $file;
        }
    }
    return $files;
}

function backup_copy_verified($source, $target) {
    if (!@copy($source, $target)) return false;
    $want = @hash_file('sha256', $source);
    $got = @hash_file('sha256', $target);
    return $want !== false && $got !== false && hash_equals($want, $got);
}

function backup_verify($dir, $date) {
    $base = backup_dir($dir) . '/' . $date;
    $manifestFile = $base . '/manifest.json';
    $manifest = read_json($manifestFile, array());
    if (!isset($manifest['files']) || !is_array($manifest['files'])) {
        return array('ok' => false, 'error' => 'Нет манифеста копии', 'date' => $date);
    }
    $errors = array();
    foreach ($manifest['files'] as $name => $info) {
        $path = $base . '/' . $name;
        if (!is_file($path)) { $errors[] = $name . ': нет файла'; continue; }
        $hash = @hash_file('sha256', $path);
        if ($hash === false || !hash_equals((string) $info['sha256'], $hash)) {
            $errors[] = $name . ': контрольная сумма не совпала';
        }
    }
    return array('ok' => !$errors, 'date' => $date, 'files' => count($manifest['files']), 'errors' => $errors);
}

function backup_maybe_run($dir, $force = false) {
    $base = backup_dir($dir);
    $marker = $base . '/.last';
    $today = date('Y-m-d');

    if (!$force) {
        $last = @file_get_contents($marker);
        if (trim((string) $last) === $today) {
            return array('ok' => true, 'skipped' => true, 'date' => $today);
        }
    }

    if (!is_dir($base) && !@mkdir($base, 0755, true)) {
        return array('ok' => false, 'error' => 'Нет папки для копий');
    }
    if (!file_exists($base . '/.htaccess')) {
        @file_put_contents($base . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    $target = $base . '/' . $today;
    if (!is_dir($target) && !@mkdir($target, 0755, true)) {
        return array('ok' => false, 'error' => 'Не удалось создать папку копии');
    }
    $privateTarget = $target . '/private';
    if (!is_dir($privateTarget) && !@mkdir($privateTarget, 0755, true)) {
        return array('ok' => false, 'error' => 'Не удалось создать папку личных документов в копии');
    }

    $saved = 0;
    $bytes = 0;
    $manifest = array('at' => date('c'), 'files' => array());
    $errors = array();
    foreach (backup_sources($dir) as $name => $file) {
        $dest = $target . '/' . $name;
        if (!backup_copy_verified($file, $dest)) {
            $errors[] = $name;
            continue;
        }
        $size = (int) @filesize($file);
        $manifest['files'][$name] = array('sha256' => hash_file('sha256', $file), 'bytes' => $size);
        $saved++;
        $bytes += $size;
    }
    if ($errors) {
        return array('ok' => false, 'error' => 'Не все файлы скопированы и проверены', 'failed' => $errors, 'date' => $today);
    }
    $manifest['bytes'] = $bytes;
    if (!write_json($target . '/manifest.json', $manifest)) {
        return array('ok' => false, 'error' => 'Не удалось записать манифест копии', 'date' => $today);
    }
    $check = backup_verify($dir, $today);
    if (empty($check['ok'])) {
        return array('ok' => false, 'error' => 'Копия не прошла проверку', 'verify' => $check, 'date' => $today);
    }
    @file_put_contents($marker, $today);

    /* старые копии убираем только после успешной новой: 14 дней достаточно,
       чтобы вернуть случайную правку */
    $keep_from = date('Y-m-d', time() - 14 * 86400);
    foreach ((array) glob($base . '/*', GLOB_ONLYDIR) as $old) {
        $name = basename($old);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $name)) continue;
        if ($name >= $keep_from) continue;
        foreach ((array) glob($old . '/private/*.bin') as $f) @unlink($f);
        @rmdir($old . '/private');
        foreach ((array) glob($old . '/*') as $f) @unlink($f);
        @rmdir($old);
    }

    return array('ok' => true, 'saved' => $saved, 'bytes' => $bytes, 'date' => $today, 'verified' => true);
}

function backup_list($dir) {
    $out = array();
    foreach ((array) glob(backup_dir($dir) . '/*', GLOB_ONLYDIR) as $old) {
        $name = basename($old);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $name)) continue;
        $check = backup_verify($dir, $name);
        $files = (array) glob($old . '/*.json');
        $bytes = 0;
        foreach ($files as $f) $bytes += (int) @filesize($f);
        foreach ((array) glob($old . '/private/*.bin') as $f) $bytes += (int) @filesize($f);
        $out[] = array('date' => $name, 'files' => isset($check['files']) ? $check['files'] : count($files),
            'bytes' => $bytes, 'verified' => !empty($check['ok']),
            'errors' => isset($check['errors']) ? $check['errors'] : array());
    }
    usort($out, function ($a, $b) { return strcmp($b['date'], $a['date']); });
    return $out;
}
