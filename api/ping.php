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

/* почему index.php мог упасть: последняя ошибка и подсказка */
$err = error_get_last();
if ($err) $out['last_error'] = array('msg' => $err['message'], 'file' => basename($err['file']), 'line' => $err['line']);
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
