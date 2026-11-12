<?php
/* ============================================================================
   БАЛЛЫ: журнал начислений вместо подсчёта в браузере.

   Раньше баллы считались на клиенте по таблице из data.js: их нельзя было
   ни проверить, ни оспорить, ни исправить. Теперь каждая операция — запись
   в журнале: кто, когда, за что, сколько и по какому основанию.

   Правила:
   • баланс — сумма операций, отдельного «поля баланса» нет;
   • одна операция — не больше 500 баллов;
   • списание требует основания (текст);
   • повторное начисление за тот же объект (ref) не делается;
   • каждая операция пишется в журнал действий редакции.
   ========================================================================== */

const POINTS_MAX_OP = 500;

function points_file($dir) { return $dir . '/points.json'; }
function points_rules_file($dir) { return $dir . '/points-rules.json'; }

/* Правила по умолчанию. Администратор может их менять — тогда в файле
   появляются свои значения, а этот список остаётся образцом. */
function points_default_rules() {
    return array(
        array('key' => 'post.Новость', 'label' => 'Опубликована новость', 'value' => 10, 'once' => true),
        array('key' => 'post.Статья', 'label' => 'Опубликована статья', 'value' => 10, 'once' => true),
        array('key' => 'post.Интервью', 'label' => 'Опубликовано интервью', 'value' => 15, 'once' => true),
        array('key' => 'post.Репортаж', 'label' => 'Опубликован репортаж', 'value' => 15, 'once' => true),
        array('key' => 'post.Фотоистория', 'label' => 'Опубликована фотоистория', 'value' => 15, 'once' => true),
        array('key' => 'post.Видео', 'label' => 'Опубликовано видео', 'value' => 20, 'once' => true),
        array('key' => 'post.Подкаст', 'label' => 'Опубликован подкаст', 'value' => 20, 'once' => true),
        array('key' => 'school.lesson', 'label' => 'Пройден урок', 'value' => 2, 'once' => true),
        array('key' => 'school.test', 'label' => 'Пройден тест', 'value' => 5, 'once' => true),
        array('key' => 'school.homework', 'label' => 'Принято домашнее задание', 'value' => 10, 'once' => false),
        array('key' => 'school.course', 'label' => 'Завершён курс', 'value' => 25, 'once' => true),
        array('key' => 'card.issued', 'label' => 'Выдана пресс-карта', 'value' => 15, 'once' => true),
        array('key' => 'manual', 'label' => 'Решение редакции', 'value' => 0, 'once' => false),
    );
}

function points_rules($dir) {
    $saved = read_json(points_rules_file($dir), array());
    $rules = points_default_rules();
    if (!is_array($saved) || !isset($saved['rules']) || !is_array($saved['rules'])) {
        return array('rules' => $rules, 'custom' => false);
    }
    $out = array();
    foreach ($rules as $def) {
        $out[$def['key']] = $def;
    }
    foreach ($saved['rules'] as $row) {
        if (!isset($row['key'])) continue;
        $out[$row['key']] = array(
            'key' => (string) $row['key'],
            'label' => isset($row['label']) ? (string) $row['label'] : $row['key'],
            'value' => isset($row['value']) ? (int) $row['value'] : 0,
            'once' => !empty($row['once']),
        );
    }
    return array('rules' => array_values($out), 'custom' => true, 'updatedAt' => isset($saved['updatedAt']) ? $saved['updatedAt'] : '');
}

function points_rule_value($dir, $key) {
    $box = points_rules($dir);
    foreach ($box['rules'] as $row) {
        if ($row['key'] === $key) return (int) $row['value'];
    }
    return 0;
}

function read_points($dir) {
    $list = read_json(points_file($dir), array());
    return is_array($list) ? $list : array();
}

function points_balance($dir, $userId) {
    $sum = 0;
    foreach (read_points($dir) as $row) {
        if ((string) $row['userId'] !== (string) $userId) continue;
        $sum += (int) $row['delta'];
    }
    return $sum;
}

function points_balance_all($dir) {
    $out = array();
    foreach (read_points($dir) as $row) {
        $id = (string) $row['userId'];
        if (!isset($out[$id])) $out[$id] = 0;
        $out[$id] += (int) $row['delta'];
    }
    return $out;
}

function points_history($dir, $userId, $limit = 200) {
    $out = array();
    foreach (read_points($dir) as $row) {
        if ($userId !== '' && (string) $row['userId'] !== (string) $userId) continue;
        $out[] = $row;
    }
    usort($out, function ($a, $b) { return strcmp((string) $b['at'], (string) $a['at']); });
    return array_slice($out, 0, $limit);
}

function points_has_ref($dir, $userId, $ref) {
    if ($ref === '') return false;
    foreach (read_points($dir) as $row) {
        if ((string) $row['userId'] === (string) $userId && (string) $row['ref'] === (string) $ref) return true;
    }
    return false;
}

/* Начисление и списание. Возвращает запись журнала или текст ошибки. */
function points_add($dir, $userId, $delta, $reason, $by, $note = '', $ref = '') {
    $delta = (int) $delta;
    if ($delta === 0) return array('ok' => false, 'error' => 'Изменение равно нулю.');
    if (abs($delta) > POINTS_MAX_OP) {
        return array('ok' => false, 'error' => 'За одну операцию — не больше ' . POINTS_MAX_OP . ' баллов.');
    }
    if ($delta < 0 && slen($note) < 5) {
        return array('ok' => false, 'error' => 'Для списания нужно основание: минимум пять символов.');
    }
    if ($ref !== '' && points_has_ref($dir, $userId, $ref)) {
        return array('ok' => true, 'skipped' => true, 'reason' => 'За эту операцию баллы уже начислены.');
    }

    $list = read_points($dir);
    $row = array(
        'id' => 'pt_' . bin2hex(random_bytes(5)),
        'userId' => (string) $userId,
        'delta' => $delta,
        'reason' => text($reason, 60),
        'note' => text($note, 300),
        'by' => text($by, 120),
        'ref' => text($ref, 80),
        'at' => date('c'),
        'balanceAfter' => points_balance($dir, $userId) + $delta,
    );
    $list[] = $row;
    if (!write_json(points_file($dir), $list)) {
        return array('ok' => false, 'error' => 'Не удалось сохранить операцию.');
    }
    audit_log($dir, $by, 'points', ($delta > 0 ? '+' : '') . $delta . ' — ' . $reason .
        ($note !== '' ? ' (' . $note . ')' : ''));
    return array('ok' => true, 'entry' => $row);
}

/* Начисление по правилу: значение берётся из настройки, а не из формы. */
function points_award_rule($dir, $userId, $ruleKey, $by, $note = '', $ref = '') {
    $value = points_rule_value($dir, $ruleKey);
    if ($value === 0) return array('ok' => true, 'skipped' => true, 'reason' => 'Правило с нулём баллов.');
    return points_add($dir, $userId, $value, $ruleKey, $by, $note, $ref);
}

function points_leaderboard($dir, $limit = 20) {
    $balances = points_balance_all($dir);
    arsort($balances);
    $out = array();
    foreach (array_slice($balances, 0, $limit, true) as $userId => $sum) {
        if ($sum <= 0) continue;
        $out[] = array('userId' => $userId, 'points' => $sum);
    }
    return $out;
}
