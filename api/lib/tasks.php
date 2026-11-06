<?php
/* ============================================================================
   РАБОТА КОМАНДЫ: задачи для сотрудников, редакции и основателей.

   Задача — это то, что нужно сделать: заголовок, описание, срок, приоритет.
   Назначается либо конкретному человеку, либо группе:
     founders  — основатели и руководство (уровень роли 60 и выше),
     editorial — редакции и отделы (уровень 25–59),
     staff     — сотрудники и авторы (уровень ниже 25).

   Правила:
   • каждый видит свои задачи и задачи своей группы;
   • руководитель (people.edit) видит все, создаёт и назначает;
   • исполнитель может менять только статус и писать комментарии;
   • каждое изменение пишется в историю задачи, удаление — только отмена.
   ========================================================================== */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

const TASK_STATUSES = array(
    'new' => 'Новая',
    'in_work' => 'В работе',
    'review' => 'На проверке',
    'done' => 'Готово',
    'cancelled' => 'Отменена',
);
const TASK_PRIORITIES = array('low' => 'Обычная', 'high' => 'Важная', 'urgent' => 'Срочная');
const TASK_GROUPS = array('founders' => 'Основатели', 'editorial' => 'Редакция', 'staff' => 'Сотрудники');

function tasks_file($dir) { return $dir . '/tasks.json'; }

function read_tasks($dir) {
    $list = read_json(tasks_file($dir), array());
    return is_array($list) ? $list : array();
}

function task_group_of($user) {
    $level = function_exists('role_level') ? role_level(isset($user['access']) ? $user['access'] : '') : 10;
    if ($level >= 60) return 'founders';
    if ($level >= 25) return 'editorial';
    return 'staff';
}

function public_task($task, $dir) {
    $assignee = null;
    if (!empty($task['assignee'])) {
        foreach (read_users($dir) as $u) {
            if ($u['id'] !== $task['assignee']) continue;
            $assignee = array('id' => $u['id'], 'name' => $u['name']);
            break;
        }
    }
    return array(
        'id' => isset($task['id']) ? $task['id'] : '',
        'title' => isset($task['title']) ? $task['title'] : '',
        'description' => isset($task['description']) ? $task['description'] : '',
        'assignee' => $assignee,
        'group' => isset($task['group']) ? $task['group'] : '',
        'groupLabel' => isset(TASK_GROUPS[$task['group']]) ? TASK_GROUPS[$task['group']] : '',
        'status' => isset($task['status']) ? $task['status'] : 'new',
        'statusLabel' => isset(TASK_STATUSES[$task['status']]) ? TASK_STATUSES[$task['status']] : '',
        'priority' => isset($task['priority']) ? $task['priority'] : 'low',
        'priorityLabel' => isset(TASK_PRIORITIES[$task['priority']]) ? TASK_PRIORITIES[$task['priority']] : '',
        'due' => isset($task['due']) ? $task['due'] : '',
        'createdAt' => isset($task['createdAt']) ? $task['createdAt'] : '',
        'createdBy' => isset($task['createdBy']) ? $task['createdBy'] : '',
        'closedAt' => isset($task['closedAt']) ? $task['closedAt'] : '',
        'comments' => isset($task['comments']) && is_array($task['comments']) ? $task['comments'] : array(),
        'history' => isset($task['history']) && is_array($task['history']) ? $task['history'] : array(),
    );
}

function task_visible($task, $user) {
    if (!empty($task['assignee'])) {
        return $task['assignee'] === $user['id'] || can($user, 'people.edit');
    }
    if (!empty($task['group'])) {
        return $task['group'] === task_group_of($user) || can($user, 'people.edit');
    }
    return can($user, 'people.edit');
}

function tasks_routes($act, $dir) {
    if (!in_array($act, array('tasks-mine', 'tasks-list', 'tasks-create', 'tasks-update', 'tasks-comment'), true)) {
        return false;
    }
    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    if (!$me) fail('Нужно войти в аккаунт.', 401);

    if ($act === 'tasks-mine') {
        $out = array();
        foreach (read_tasks($dir) as $task) {
            if (task_visible($task, $me)) $out[] = public_task($task, $dir);
        }
        usort($out, function ($a, $b) {
            $order = array('new' => 0, 'in_work' => 1, 'review' => 2, 'done' => 3, 'cancelled' => 4);
            $oa = isset($order[$a['status']]) ? $order[$a['status']] : 5;
            $ob = isset($order[$b['status']]) ? $order[$b['status']] : 5;
            if ($oa !== $ob) return $oa <=> $ob;
            return strcmp((string) $a['due'], (string) $b['due']);
        });
        respond(array(
            'ok' => true,
            'tasks' => $out,
            'statuses' => TASK_STATUSES,
            'priorities' => TASK_PRIORITIES,
            'groups' => TASK_GROUPS,
            'myGroup' => task_group_of($me),
            'canManage' => can($me, 'people.edit'),
        ));
    }

    if ($act === 'tasks-list') {
        if (!can($me, 'people.edit')) fail('Список всех задач видит редакция и администрация.', 403);
        $out = array();
        foreach (read_tasks($dir) as $task) $out[] = public_task($task, $dir);
        respond(array('ok' => true, 'tasks' => array_reverse($out), 'statuses' => TASK_STATUSES,
            'priorities' => TASK_PRIORITIES, 'groups' => TASK_GROUPS, 'canManage' => true));
    }

    if ($act === 'tasks-create') {
        if (!can($me, 'people.edit')) fail('Ставить задачи может редакция и администрация.', 403);
        $title = text((string) (isset($in['title']) ? $in['title'] : ''), 160);
        if (slen($title) < 5) fail('Название задачи — хотя бы пять символов.');
        $assignee = text((string) (isset($in['assignee']) ? $in['assignee'] : ''), 40);
        $group = text((string) (isset($in['group']) ? $in['group'] : ''), 20);
        if ($assignee === '' && $group === '') fail('Выберите, кому задача: человеку или группе.');
        if ($assignee !== '') {
            $exists = false;
            foreach (read_users($dir) as $u) { if ($u['id'] === $assignee) { $exists = true; break; } }
            if (!$exists) fail('Такого человека нет.', 404);
            $group = '';
        } elseif (!isset(TASK_GROUPS[$group])) {
            fail('Неизвестная группа.');
        }
        $priority = (string) (isset($in['priority']) ? $in['priority'] : 'low');
        if (!isset(TASK_PRIORITIES[$priority])) $priority = 'low';
        $due = text((string) (isset($in['due']) ? $in['due'] : ''), 20);
        if ($due !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $due)) fail('Срок — в виде 2026-11-30.');

        $task = array(
            'id' => 't_' . bin2hex(random_bytes(5)),
            'title' => $title,
            'description' => text((string) (isset($in['description']) ? $in['description'] : ''), 4000),
            'assignee' => $assignee,
            'group' => $group,
            'status' => 'new',
            'priority' => $priority,
            'due' => $due,
            'createdBy' => $me['email'],
            'createdAt' => date('c'),
            'comments' => array(),
            'history' => array(array('at' => date('c'), 'by' => $me['email'], 'what' => 'Задача поставлена')),
        );
        $list = read_tasks($dir);
        $list[] = $task;
        if (!write_json(tasks_file($dir), $list)) fail('Задача не сохранилась.', 500);
        audit_log($dir, $me['email'], 'задача создана', $title);
        respond(array('ok' => true, 'task' => public_task($task, $dir)));
    }

    if ($act === 'tasks-update') {
        $id = (string) (isset($in['id']) ? $in['id'] : '');
        $list = read_tasks($dir);
        $index = -1;
        foreach ($list as $i => $task) {
            if ($task['id'] === $id) { $index = $i; break; }
        }
        if ($index < 0) fail('Задача не найдена.', 404);
        $task = $list[$index];
        $manager = can($me, 'people.edit');
        if (!$manager && $task['assignee'] !== $me['id']) {
            fail('Менять чужую задачу нельзя.', 403);
        }

        $status = (string) (isset($in['status']) ? $in['status'] : '');
        if ($status !== '') {
            if (!isset(TASK_STATUSES[$status])) fail('Неизвестный статус.');
            $list[$index]['status'] = $status;
            $list[$index]['closedAt'] = in_array($status, array('done', 'cancelled'), true) ? date('c') : '';
            $list[$index]['history'][] = array('at' => date('c'), 'by' => $me['email'],
                'what' => 'Статус: ' . TASK_STATUSES[$status]);
        }
        if ($manager) {
            foreach (array('title', 'description', 'due', 'priority', 'group', 'assignee') as $field) {
                if (!isset($in[$field])) continue;
                $value = text((string) $in[$field], $field === 'description' ? 4000 : 160);
                if ($field === 'priority' && !isset(TASK_PRIORITIES[$value])) continue;
                if ($field === 'group' && $value !== '' && !isset(TASK_GROUPS[$value])) continue;
                if ($field === 'due' && $value !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) continue;
                $list[$index][$field] = $value;
            }
            if (!empty($in['assignee'])) $list[$index]['group'] = '';
        }
        if (!write_json(tasks_file($dir), $list)) fail('Задача не сохранилась.', 500);
        if ($status !== '') audit_log($dir, $me['email'], 'задача: статус', $task['title'] . ' → ' . TASK_STATUSES[$status]);
        respond(array('ok' => true, 'task' => public_task($list[$index], $dir)));
    }

    if ($act === 'tasks-comment') {
        $id = (string) (isset($in['id']) ? $in['id'] : '');
        $textValue = text((string) (isset($in['text']) ? $in['text'] : ''), 1500);
        if (slen($textValue) < 2) fail('Комментарий пустой.');
        $list = read_tasks($dir);
        $index = -1;
        foreach ($list as $i => $task) { if ($task['id'] === $id) { $index = $i; break; } }
        if ($index < 0) fail('Задача не найдена.', 404);
        if (!task_visible($list[$index], $me)) fail('Эта задача не ваша.', 403);
        $list[$index]['comments'][] = array('at' => date('c'), 'by' => $me['name'], 'text' => $textValue);
        if (!write_json(tasks_file($dir), $list)) fail('Комментарий не сохранился.', 500);
        respond(array('ok' => true, 'task' => public_task($list[$index], $dir)));
    }

    return true;
}
