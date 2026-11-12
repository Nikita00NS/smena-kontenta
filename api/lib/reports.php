<?php
/* ============================================================================
   ОТЧЁТЫ РЕДАКЦИЙ

   Раз в месяц руководитель региональной редакции сдаёт короткий отчёт: что
   сделано, что мешает, что в планах. Цифры (материалы, люди, карты) сайт
   считает сам — их не нужно вписывать и нельзя приукрасить.

   Отчёт за месяц сдаётся с первого числа следующего месяца, срок — до пятого.
   Читает и принимает отчёты центральная редакция (право reports.review).

   Состояния: draft (черновик) → sent (отправлен) → accepted (принят)
                                             ↘ returned (возвращён с замечанием) → sent

   Файл: smena-data/reports.json
   ========================================================================== */

/* до какого числа следующего месяца сдаётся отчёт */
const REPORT_DAY = 5;

function reports_file($dir) { return $dir . '/reports.json'; }

function read_reports($dir) {
    $list = read_json(reports_file($dir), array());
    return is_array($list) ? array_values($list) : array();
}

function report_period_ok($period) {
    return is_string($period) && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $period);
}

function report_period_title($period) {
    $names = array('январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль',
        'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь');
    if (!report_period_ok($period)) return '';
    return $names[(int) substr($period, 5, 2) - 1] . ' ' . substr($period, 0, 4);
}

function report_next_period($period) {
    $y = (int) substr($period, 0, 4);
    $m = (int) substr($period, 5, 2) + 1;
    if ($m > 12) { $m = 1; $y++; }
    return sprintf('%04d-%02d', $y, $m);
}

/* срок сдачи отчёта за период: пятое число следующего месяца, конец дня */
function report_due($period) {
    return report_next_period($period) . '-' . sprintf('%02d', REPORT_DAY);
}

/* Периоды редакции: с месяца открытия до прошлого месяца включительно.
   Текущий месяц ещё идёт — за него отчёт не сдаётся. */
function report_periods($editorial, $today = null) {
    $today = $today ?: date('Y-m-d');
    $start = substr((string) (isset($editorial['createdAt']) ? $editorial['createdAt'] : ''), 0, 7);
    if (!report_period_ok($start)) return array();
    $current = substr($today, 0, 7);
    $out = array();
    for ($p = $start, $guard = 0; strcmp($p, $current) < 0 && $guard < 240; $p = report_next_period($p), $guard++) {
        $out[] = $p;
    }
    return $out;
}

function report_in_period($iso, $period) {
    return is_string($iso) && $iso !== '' && substr($iso, 0, 7) === $period;
}

/* Цифры редакции за месяц — считает сервер по тем же данным, что видит панель. */
function report_stats($dir, $editorial, $period) {
    $id = (string) $editorial['id'];
    $users = read_users($dir);
    $byId = array();
    $members = 0;
    foreach ($users as $u) {
        $byId[$u['id']] = $u;
        if (isset($u['status']) && $u['status'] === 'deleted') continue;
        if (isset($u['editorialId']) && (string) $u['editorialId'] === $id) $members++;
    }

    $submitted = 0; $published = 0; $rejected = 0; $pending = 0;
    $formats = array();
    $authors = array();
    $top = array();
    foreach (read_json($dir . '/posts.json', array()) as $post) {
        /* материал относится к редакции, в которой автор состоял при отправке;
           у старых записей этой отметки нет — берём нынешнюю редакцию автора */
        $postEd = isset($post['editorialId']) ? (string) $post['editorialId']
            : (isset($post['authorId'], $byId[$post['authorId']]['editorialId']) ? (string) $byId[$post['authorId']]['editorialId'] : '');
        if ($postEd !== $id) continue;
        $status = isset($post['status']) ? (string) $post['status'] : '';
        if ($status === 'pending') $pending++;
        $sentAt = isset($post['firstSubmittedAt']) ? $post['firstSubmittedAt'] : (isset($post['submittedAt']) ? $post['submittedAt'] : '');
        if (report_in_period($sentAt, $period)) {
            $submitted++;
            if (!empty($post['authorId'])) $authors[$post['authorId']] = true;
        }
        $decidedAt = isset($post['reviewedAt']) ? (string) $post['reviewedAt'] : '';
        if ($status === 'published' && report_in_period($decidedAt, $period)) {
            $published++;
            $format = isset($post['format']) && $post['format'] !== '' ? (string) $post['format'] : 'Материал';
            $formats[$format] = (isset($formats[$format]) ? $formats[$format] : 0) + 1;
            $name = isset($post['authorName']) ? (string) $post['authorName'] : '';
            if ($name !== '') $top[$name] = (isset($top[$name]) ? $top[$name] : 0) + 1;
        }
        if ($status === 'rejected' && report_in_period($decidedAt, $period)) $rejected++;
    }
    arsort($top);
    arsort($formats);

    $joined = 0; $left = 0;
    foreach (read_editorial_apps($dir) as $a) {
        if ((string) $a['editorialId'] !== $id) continue;
        if (report_in_period(isset($a['decidedAt']) ? $a['decidedAt'] : '', $period)
            && in_array($a['status'], array('approved', 'left', 'excluded'), true)) $joined++;
        if (report_in_period(isset($a['leftAt']) ? $a['leftAt'] : '', $period)) $left++;
    }

    $cards = 0;
    if (function_exists('read_cards')) {
        foreach (read_cards($dir) as $card) {
            $uid = isset($card['userId']) ? (string) $card['userId'] : '';
            if ($uid === '' || !isset($byId[$uid]['editorialId']) || (string) $byId[$uid]['editorialId'] !== $id) continue;
            if (card_state($card) === 'issued') $cards++;
        }
    }

    $topRows = array();
    foreach (array_slice($top, 0, 3, true) as $name => $count) $topRows[] = array('name' => $name, 'published' => $count);
    $formatRows = array();
    foreach ($formats as $name => $count) $formatRows[] = array('name' => $name, 'count' => $count);

    return array(
        'period' => $period,
        'submitted' => $submitted,     // отправлено на проверку за месяц
        'published' => $published,     // опубликовано за месяц
        'rejected' => $rejected,       // возвращено на доработку за месяц
        'pending' => $pending,         // ждёт проверки сейчас
        'authors' => count($authors),  // сколько человек отправляли материалы
        'members' => $members,         // в штате сейчас
        'joined' => $joined,
        'left' => $left,
        'cards' => $cards,             // действующих пресс-карт
        'formats' => $formatRows,
        'top' => $topRows,
        'countedAt' => date('c'),
    );
}

function report_form_clean($raw) {
    $raw = is_array($raw) ? $raw : array();
    $out = array();
    foreach (array('done' => 3000, 'plans' => 2000, 'problems' => 2000, 'events' => 2000) as $key => $max) {
        $out[$key] = text(isset($raw[$key]) ? $raw[$key] : '', $max);
    }
    return $out;
}

function public_report($r) {
    $period = isset($r['period']) ? (string) $r['period'] : '';
    return array(
        'id' => $r['id'],
        'editorialId' => $r['editorialId'],
        'editorialName' => isset($r['editorialName']) ? $r['editorialName'] : '',
        'region' => isset($r['region']) ? $r['region'] : '',
        'period' => $period,
        'title' => report_period_title($period),
        'due' => report_due($period),
        'status' => isset($r['status']) ? $r['status'] : 'draft',
        'form' => isset($r['form']) && is_array($r['form']) ? $r['form'] : report_form_clean(array()),
        'stats' => isset($r['stats']) && is_array($r['stats']) ? $r['stats'] : null,
        'note' => isset($r['note']) ? $r['note'] : '',
        'late' => !empty($r['late']),
        'sentAt' => isset($r['sentAt']) ? $r['sentAt'] : '',
        'sentBy' => isset($r['sentBy']) ? $r['sentBy'] : '',
        'decidedAt' => isset($r['decidedAt']) ? $r['decidedAt'] : '',
        'decidedBy' => isset($r['decidedBy']) ? $r['decidedBy'] : '',
        'updatedAt' => isset($r['updatedAt']) ? $r['updatedAt'] : '',
    );
}

/* сколько отчётов ждёт решения — счётчик в панели */
function reports_waiting($dir) {
    $n = 0;
    foreach (read_reports($dir) as $r) {
        if (isset($r['status']) && $r['status'] === 'sent') $n++;
    }
    return $n;
}

/* редакция, которой руководит человек */
function report_own_editorial($dir, $me) {
    foreach (read_editorials($dir) as $e) {
        if ($e['founderId'] === $me['id']) return $e;
    }
    return null;
}

function reports_routes($act, $dir) {
    $handled = array('report-mine', 'report-save', 'report-queue', 'report-review');
    if (!in_array($act, $handled, true)) return false;
    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);
    $today = date('Y-m-d');

    /* ------------------------------------------------- кабинет руководителя */
    if ($act === 'report-mine') {
        $ed = report_own_editorial($dir, $me);
        if (!$ed) {
            respond(array('ok' => true, 'editorial' => null, 'periods' => array(), 'current' => null));
        }
        $mine = array();
        foreach (read_reports($dir) as $r) {
            if ((string) $r['editorialId'] === (string) $ed['id']) $mine[$r['period']] = $r;
        }
        $periods = array();
        foreach (array_reverse(report_periods($ed, $today)) as $p) {
            $report = isset($mine[$p]) ? public_report($mine[$p]) : null;
            $status = $report ? $report['status'] : 'none';
            $periods[] = array(
                'period' => $p,
                'title' => report_period_title($p),
                'due' => report_due($p),
                'overdue' => !in_array($status, array('sent', 'accepted'), true) && strcmp($today, report_due($p)) > 0,
                'status' => $status,
                'report' => $report,
                /* у несданного отчёта цифры живые; у сданного — те, что были на момент отправки */
                'stats' => $report && $report['stats'] && in_array($status, array('sent', 'accepted'), true)
                    ? $report['stats'] : report_stats($dir, $ed, $p),
            );
        }
        $now = substr($today, 0, 7);
        respond(array(
            'ok' => true,
            'editorial' => array('id' => $ed['id'], 'name' => $ed['name'], 'region' => $ed['region'], 'createdAt' => $ed['createdAt']),
            'periods' => $periods,
            'current' => array('period' => $now, 'title' => report_period_title($now), 'due' => report_due($now),
                'stats' => report_stats($dir, $ed, $now)),
            'reportDay' => REPORT_DAY,
        ));
    }

    if ($act === 'report-save') {
        $ed = report_own_editorial($dir, $me);
        if (!$ed) fail('Отчёт сдаёт руководитель редакции.', 403);
        $period = isset($in['period']) ? (string) $in['period'] : '';
        if (!report_period_ok($period) || !in_array($period, report_periods($ed, $today), true)) {
            fail('Отчёт сдаётся за завершившийся месяц работы редакции.', 400);
        }
        $form = report_form_clean(isset($in['form']) ? $in['form'] : array());
        $send = !empty($in['send']);
        if ($send && slen($form['done']) < 30) {
            fail('Расскажите, что редакция сделала за месяц: хотя бы 30 символов.');
        }

        $list = read_reports($dir);
        $index = -1;
        foreach ($list as $i => $r) {
            if ((string) $r['editorialId'] === (string) $ed['id'] && $r['period'] === $period) $index = $i;
        }
        $now = date('c');
        if ($index >= 0) {
            $status = isset($list[$index]['status']) ? $list[$index]['status'] : 'draft';
            if ($status === 'accepted') fail('Отчёт за этот месяц уже принят.', 409);
            if ($status === 'sent') fail('Отчёт уже отправлен и ждёт решения. Править его можно, если редакция вернёт отчёт.', 409);
        } else {
            $list[] = array(
                'id' => 'rp_' . bin2hex(random_bytes(5)),
                'editorialId' => $ed['id'],
                'period' => $period,
                'status' => 'draft',
                'createdAt' => $now,
                'history' => array(),
            );
            $index = count($list) - 1;
        }
        $list[$index]['editorialName'] = $ed['name'];
        $list[$index]['region'] = $ed['region'];
        $list[$index]['form'] = $form;
        $list[$index]['updatedAt'] = $now;
        if ($send) {
            $list[$index]['status'] = 'sent';
            $list[$index]['sentAt'] = $now;
            $list[$index]['sentBy'] = $me['name'];
            $list[$index]['headId'] = $me['id'];
            $list[$index]['late'] = strcmp($today, report_due($period)) > 0;
            /* цифры фиксируются в момент отправки: позже они уже не «подрастут» */
            $list[$index]['stats'] = report_stats($dir, $ed, $period);
            $list[$index]['history'][] = array('at' => $now, 'action' => 'sent', 'by' => $me['name']);
        }
        if (!write_json(reports_file($dir), $list)) fail('Не удалось сохранить отчёт.', 500);
        if ($send) {
            audit_log($dir, (string) $me['email'], 'report-send',
                'отчёт редакции «' . $ed['name'] . '» за ' . report_period_title($period));
        }
        respond(array('ok' => true, 'report' => public_report($list[$index])));
    }

    /* ------------------------------------------------------------ редакция */
    if (!can($me, 'reports.review')) fail('Отчёты редакций читает центральная редакция.', 403);

    if ($act === 'report-queue') {
        $list = read_reports($dir);
        $out = array();
        $have = array();
        foreach ($list as $r) {
            $have[$r['editorialId'] . ':' . $r['period']] = isset($r['status']) ? $r['status'] : 'draft';
            if (isset($r['status']) && $r['status'] === 'draft') continue;   // черновик видит только руководитель
            $out[] = public_report($r);
        }
        usort($out, function ($a, $b) {
            $wa = $a['status'] === 'sent' ? 0 : 1;
            $wb = $b['status'] === 'sent' ? 0 : 1;
            if ($wa !== $wb) return $wa - $wb;
            return strcmp((string) $b['sentAt'], (string) $a['sentAt']);
        });
        /* кто не сдал: срок прошёл, а отчёта нет (или он возвращён и не исправлен) */
        $missing = array();
        foreach (read_editorials($dir) as $e) {
            foreach (report_periods($e, $today) as $p) {
                $status = isset($have[$e['id'] . ':' . $p]) ? $have[$e['id'] . ':' . $p] : 'none';
                if (in_array($status, array('sent', 'accepted'), true)) continue;
                if (strcmp($today, report_due($p)) <= 0) continue;
                $missing[] = array(
                    'editorialId' => $e['id'],
                    'editorialName' => $e['name'],
                    'region' => $e['region'],
                    'headId' => $e['founderId'],
                    'headName' => $e['founderName'],
                    'period' => $p,
                    'title' => report_period_title($p),
                    'due' => report_due($p),
                    'status' => $status,
                );
            }
        }
        respond(array('ok' => true, 'reports' => array_slice($out, 0, 300), 'missing' => $missing,
            'waiting' => reports_waiting($dir), 'reportDay' => REPORT_DAY));
    }

    if ($act === 'report-review') {
        $id = text(isset($in['id']) ? $in['id'] : '', 40);
        $decision = isset($in['decision']) ? (string) $in['decision'] : '';
        $note = text(isset($in['note']) ? $in['note'] : '', 600);
        if (!in_array($decision, array('accepted', 'returned'), true)) fail('Решение: принять или вернуть.');
        if ($decision === 'returned' && slen($note) < 5) fail('Напишите, что нужно дополнить: руководитель увидит это в кабинете.');
        $list = read_reports($dir);
        $index = -1;
        foreach ($list as $i => $r) {
            if ($r['id'] === $id) $index = $i;
        }
        if ($index < 0) fail('Отчёт не найден.', 404);
        if ((isset($list[$index]['status']) ? $list[$index]['status'] : '') !== 'sent') {
            fail('По этому отчёту решение уже принято.', 409);
        }
        $now = date('c');
        $list[$index]['status'] = $decision;
        $list[$index]['note'] = $note;
        $list[$index]['decidedAt'] = $now;
        $list[$index]['decidedBy'] = $me['name'];
        $list[$index]['history'][] = array('at' => $now, 'action' => $decision, 'by' => $me['name'], 'note' => $note);
        if (!write_json(reports_file($dir), $list)) fail('Не удалось сохранить решение.', 500);

        $title = report_period_title($list[$index]['period']);
        audit_log($dir, (string) $me['email'], 'report-review',
            ($decision === 'accepted' ? 'принят' : 'возвращён') . ' отчёт «' . $list[$index]['editorialName'] . '» за ' . $title);
        $headId = isset($list[$index]['headId']) ? $list[$index]['headId'] : '';
        if ($headId !== '') {
            notify_user($dir, $headId,
                $decision === 'accepted'
                    ? 'Отчёт редакции за ' . $title . ' принят.' . ($note !== '' ? ' Комментарий: ' . $note : '')
                    : 'Отчёт редакции за ' . $title . ' возвращён на доработку: ' . $note . ' Исправьте его в кабинете, вкладка «Редакция».',
                array('kind' => 'editorial', 'ref' => 'report:' . $id . ':' . $decision . ':' . count($list[$index]['history'])));
        }
        respond(array('ok' => true, 'report' => public_report($list[$index])));
    }

    return false;
}
