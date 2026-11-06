<?php
/* временная диагностика */
header('Content-Type: text/plain; charset=utf-8');
define('SMENA_API', true);

if (isset($_GET['lib'])) {
    $lib = preg_replace('/[^a-z]/', '', (string) $_GET['lib']);
    require __DIR__ . '/lib/' . $lib . '.php';
    echo "loaded " . $lib . "\n";
    echo "imap_list exists: " . (function_exists('imap_list') ? 'yes' : 'no') . "\n";
    $rf = new ReflectionFunction('imap_list');
    echo "imap_list defined in: " . $rf->getFileName() . ":" . $rf->getStartLine() . "\n";
    exit;
}

if (isset($_GET['index'])) {
    $_GET['action'] = 'points-rules';
    register_shutdown_function(function () {
        $e = error_get_last();
        $fatal = $e && in_array($e['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true);
        while (ob_get_level()) { @ob_end_clean(); }
        echo $fatal ? "FATAL: " . $e['message'] . " in " . $e['file'] . ":" . $e['line'] : "NO-FATAL";
    });
    ob_start();
    require __DIR__ . '/index.php';
    exit;
}

foreach (array('lib/imap.php', 'lib/mailbox.php', 'index.php') as $f) {
    $p = __DIR__ . '/' . $f;
    echo $f . " size=" . filesize($p) . " md5=" . md5_file($p) . " mtime=" . date('c', filemtime($p)) . "\n";
}
echo "imap_list exists: " . (function_exists('imap_list') ? 'yes' : 'no') . "\n";
echo "imapc_list exists: " . (function_exists('imapc_list') ? 'yes' : 'no') . "\n";
