<?php
/* временная диагностика: показывает FATAL при загрузке index.php */
header('Content-Type: text/plain; charset=utf-8');
if (isset($_GET['index'])) {
    $_GET['action'] = 'points-rules';
    register_shutdown_function(function () {
        $e = error_get_last();
        $fatal = $e && in_array($e['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true);
        while (ob_get_level()) { @ob_end_clean(); }
        echo $fatal ? "FATAL: " . $e['message'] . " in " . basename($e['file']) . ":" . $e['line'] : "NO-FATAL";
    });
    ob_start();
    require __DIR__ . '/index.php';
    exit;
}
define('SMENA_API', true);
$lib = isset($_GET['lib']) ? preg_replace('/[^a-z]/', '', (string) $_GET['lib']) : '';
echo "php " . PHP_VERSION . "\n";
if ($lib !== '') {
    require __DIR__ . '/lib/' . $lib . '.php';
    echo "loaded " . $lib . "\n";
}
