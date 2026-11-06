<?php
/* Временная диагностика выкладки: отвечает, жив ли PHP и какие файлы дошли.
   Паролей и данных не отдаёт. После починки файл удаляется. */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$out = array('ok' => true, 'php' => PHP_VERSION, 'sapi' => PHP_SAPI, 'files' => array());
foreach (array('index.php', 'smtp.php', 'lib/permissions.php', 'lib/mailer.php',
    'lib/imap.php', 'lib/mailbox.php', 'lib/hiring.php', 'lib/points.php') as $f) {
    $path = __DIR__ . '/' . $f;
    $out['files'][$f] = array(
        'exists' => file_exists($path),
        'size' => file_exists($path) ? filesize($path) : 0,
        'mtime' => file_exists($path) ? date('c', filemtime($path)) : '',
    );
}

$lib = isset($_GET['lib']) ? preg_replace('/[^a-z]/', '', (string) $_GET['lib']) : '';
if ($lib !== '') {
    define('SMENA_API', true);
    $path = __DIR__ . '/lib/' . $lib . '.php';
    $out['lib'] = $lib;
    $out['loaded'] = false;
    if (file_exists($path)) {
        require $path;
        $out['loaded'] = true;
    }
}

/* ?index=1 — пробуем выполнить index.php и показать причину падения */
if (isset($_GET['index'])) {
    $_GET['action'] = 'points-rules';
    register_shutdown_function(function () {
        $e = error_get_last();
        $fatal = $e && in_array($e['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true);
        while (ob_get_level()) { @ob_end_clean(); }
        if (!headers_sent()) header('Content-Type: text/plain; charset=utf-8');
        echo $fatal
            ? "FATAL: " . $e['message'] . " in " . basename($e['file']) . ":" . $e['line']
            : "NO-FATAL";
    });
    ob_start();
    require __DIR__ . '/index.php';
    exit;
}

/* почему index.php мог упасть: последняя ошибка и подсказка */
$err = error_get_last();
if ($err) $out['last_error'] = array('msg' => $err['message'], 'file' => basename($err['file']), 'line' => $err['line']);
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
