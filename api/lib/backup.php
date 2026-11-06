<?php
/* ============================================================================
   РЕЗЕРВНЫЕ КОПИИ.
   Данные лежат в JSON-файлах вне public_html. Копия делается один раз в сутки
   при первом заходе на сайт, хранится 14 дней. Файлы загрузок не копируются:
   они слишком тяжёлые для лимита хостинга — об этом сказано в документации.
   ========================================================================== */

function backup_dir($dir) { return $dir . '/backup'; }

function backup_maybe_run($dir, $force = false) {
    $base = backup_dir($dir);
    $marker = $base . '/.last';
    $today = date('Y-m-d');

    if (!$force) {
        $last = @file_get_contents($marker);
        if (trim((string) $last) === $today) return array('ok' => true, 'skipped' => true);
    }

    if (!is_dir($base)) @mkdir($base, 0755, true);
    if (!is_dir($base)) return array('ok' => false, 'error' => 'Нет папки для копий');
    if (!file_exists($base . '/.htaccess')) {
        @file_put_contents($base . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    $target = $base . '/' . $today;
    if (!is_dir($target)) @mkdir($target, 0755, true);

    $saved = 0;
    $bytes = 0;
    foreach ((array) glob($dir . '/*.json') as $file) {
        $name = basename($file);
        if (substr($name, -4) === '.tmp') continue;
        if (@copy($file, $target . '/' . $name)) {
            $saved++;
            $bytes += (int) @filesize($file);
        }
    }
    @file_put_contents($marker, $today);

    /* старые копии убираем: 14 дней достаточно, чтобы вернуть случайную правку */
    $keep_from = date('Y-m-d', time() - 14 * 86400);
    foreach ((array) glob($base . '/*', GLOB_ONLYDIR) as $old) {
        $name = basename($old);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $name)) continue;
        if ($name >= $keep_from) continue;
        foreach ((array) glob($old . '/*') as $f) @unlink($f);
        @rmdir($old);
    }

    return array('ok' => true, 'saved' => $saved, 'bytes' => $bytes, 'date' => $today);
}

function backup_list($dir) {
    $out = array();
    foreach ((array) glob(backup_dir($dir) . '/*', GLOB_ONLYDIR) as $old) {
        $name = basename($old);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $name)) continue;
        $files = (array) glob($old . '/*.json');
        $bytes = 0;
        foreach ($files as $f) $bytes += (int) @filesize($f);
        $out[] = array('date' => $name, 'files' => count($files), 'bytes' => $bytes);
    }
    usort($out, function ($a, $b) { return strcmp($b['date'], $a['date']); });
    return $out;
}
