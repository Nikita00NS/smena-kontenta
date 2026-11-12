<?php
/* ============================================================================
   МЕДИАШКОЛА

   Курс — это уроки по порядку. У урока есть текст, по желанию видео (ссылка
   на VK Видео или Rutube) и один из трёх способов проверки:
     none — прочитал и отметил «изучено»;
     task — письменное задание, его проверяет преподаватель;
     test — тест с вариантами ответа, проверяет сайт.
   Следующий урок открывается, когда пройден предыдущий (задание достаточно
   отправить: ждать проверки, чтобы идти дальше, не нужно).

   Кто что может:
     записаться      — любой вошедший с подтверждённой почтой и принятым
                       согласием на обработку данных;
     school.teach    — создавать и править свои курсы (преподаватель);
     school.review   — проверять задания: преподаватель — своих курсов,
                       руководство школы — всех;
     school.manage   — любые курсы, назначение преподавателя и публикация:
                       в каталог курс попадает только решением руководства.

   Файлы: smena-data/school-courses.json, smena-data/school-enrolls.json
   ========================================================================== */

const SCHOOL_MAX_LESSONS = 40;
const SCHOOL_MAX_QUESTIONS = 20;
const SCHOOL_PASS = 70;           // процент верных ответов, с которого тест сдан

function school_courses_file($dir) { return $dir . '/school-courses.json'; }
function school_enrolls_file($dir) { return $dir . '/school-enrolls.json'; }

function read_courses($dir) {
    $list = read_json(school_courses_file($dir), array());
    return is_array($list) ? array_values($list) : array();
}

function read_enrolls($dir) {
    $list = read_json(school_enrolls_file($dir), array());
    return is_array($list) ? array_values($list) : array();
}

/* Видео — только ссылкой на российские площадки: файлы на сайт не грузятся. */
function school_video_url($raw) {
    $url = text($raw, 300);
    if ($url === '') return '';
    if (!preg_match('~^https://([a-z0-9.-]+)/~i', $url, $m)) return null;
    $host = strtolower($m[1]);
    $host = preg_replace('/^(www|m)\./', '', $host);
    return in_array($host, array('vk.com', 'vk.ru', 'vkvideo.ru', 'rutube.ru'), true) ? $url : null;
}

/* Урок из формы преподавателя: всё лишнее отбрасывается, ошибки — в $bad. */
function school_lesson_clean($raw, $n, &$bad, $old = null) {
    $raw = is_array($raw) ? $raw : array();
    $label = 'Урок ' . $n;
    $id = isset($raw['id']) && preg_match('/^les_[a-f0-9]{8,16}$/', (string) $raw['id']) ? (string) $raw['id'] : new_id('les_');
    $title = text(isset($raw['title']) ? $raw['title'] : '', 140);
    $body = text(isset($raw['body']) ? $raw['body'] : '', 20000);
    $check = isset($raw['check']) && in_array($raw['check'], array('none', 'task', 'test'), true) ? $raw['check'] : 'none';
    if (slen($title) < 3) $bad[] = $label . ': напишите название.';
    if (slen($body) < 20 && $check !== 'test') $bad[] = $label . ': добавьте текст урока — хотя бы пару предложений.';
    $video = school_video_url(isset($raw['video']) ? $raw['video'] : '');
    if ($video === null) {
        $bad[] = $label . ': видео — только ссылкой на VK Видео или Rutube (https://vk.com/…, https://vkvideo.ru/…, https://rutube.ru/…).';
        $video = '';
    }
    $out = array('id' => $id, 'title' => $title, 'body' => $body, 'video' => $video, 'check' => $check);

    if ($check === 'task') {
        $prompt = text(isset($raw['task']) ? $raw['task'] : '', 3000);
        if (slen($prompt) < 10) $bad[] = $label . ': опишите задание — что сделать и что прислать.';
        $out['task'] = $prompt;
    }
    if ($check === 'test') {
        $questions = array();
        $list = isset($raw['questions']) && is_array($raw['questions']) ? array_slice($raw['questions'], 0, SCHOOL_MAX_QUESTIONS) : array();
        foreach ($list as $qi => $q) {
            $q = is_array($q) ? $q : array();
            $text = text(isset($q['q']) ? $q['q'] : '', 400);
            $options = array();
            foreach (isset($q['options']) && is_array($q['options']) ? array_slice($q['options'], 0, 6) : array() as $opt) {
                $opt = text($opt, 200);
                if ($opt !== '') $options[] = $opt;
            }
            $answer = isset($q['answer']) ? (int) $q['answer'] : -1;
            if ($text === '' && !$options) continue;      // пустая строка формы
            $where = $label . ', вопрос ' . ($qi + 1);
            if (slen($text) < 5) $bad[] = $where . ': напишите вопрос.';
            if (count($options) < 2) $bad[] = $where . ': нужно хотя бы два варианта ответа.';
            if ($answer < 0 || $answer >= count($options)) $bad[] = $where . ': отметьте верный вариант.';
            $questions[] = array('q' => $text, 'options' => $options, 'answer' => $answer);
        }
        if (!$questions) $bad[] = $label . ': в тесте нет вопросов.';
        $out['questions'] = $questions;
        $pass = isset($raw['pass']) ? (int) $raw['pass'] : SCHOOL_PASS;
        $out['pass'] = max(50, min(100, $pass));
    }
    return $out;
}

function school_counts($course) {
    $tasks = 0; $tests = 0;
    foreach ($course['lessons'] as $l) {
        if ($l['check'] === 'task') $tasks++;
        if ($l['check'] === 'test') $tests++;
    }
    return array('lessons' => count($course['lessons']), 'tasks' => $tasks, 'tests' => $tests);
}

/* Состояние урока у ученика: done — пройден, sent — задание ждёт проверки,
   returned — возвращено, failed — тест не сдан, open — можно проходить,
   locked — ещё закрыт. */
function school_lesson_states($course, $enroll) {
    $states = array();
    $open = true;                 // первый урок открыт всегда
    $marks = $enroll && isset($enroll['lessons']) && is_array($enroll['lessons']) ? $enroll['lessons'] : array();
    foreach ($course['lessons'] as $l) {
        $mark = isset($marks[$l['id']]['status']) ? $marks[$l['id']]['status'] : '';
        if ($mark === 'done') $state = 'done';
        elseif (!$open) $state = 'locked';
        elseif (in_array($mark, array('sent', 'returned', 'failed'), true)) $state = $mark;
        else $state = 'open';
        $states[$l['id']] = $state;
        /* дальше пускаем, если урок пройден или задание отправлено на проверку */
        $open = $open && ($state === 'done' || $state === 'sent');
    }
    return $states;
}

function school_progress($course, $enroll) {
    $done = 0;
    foreach (school_lesson_states($course, $enroll) as $state) {
        if ($state === 'done') $done++;
    }
    $total = count($course['lessons']);
    return array('done' => $done, 'total' => $total, 'percent' => $total ? (int) floor($done * 100 / $total) : 0);
}

function school_find($list, $id) {
    foreach ($list as $i => $row) {
        if ((string) $row['id'] === (string) $id) return $i;
    }
    return -1;
}

function school_enroll_index($enrolls, $courseId, $userId) {
    foreach ($enrolls as $i => $e) {
        if ((string) $e['courseId'] === (string) $courseId && (string) $e['userId'] === (string) $userId) return $i;
    }
    return -1;
}

/* может ли сотрудник править курс и проверять его задания */
function school_can_edit($me, $course) {
    if (can($me, 'school.manage')) return true;
    return can($me, 'school.teach') && isset($course['teacherId']) && (string) $course['teacherId'] === (string) $me['id'];
}

function school_can_review($me, $course) {
    if (can($me, 'school.manage')) return true;
    return can($me, 'school.review') && isset($course['teacherId']) && (string) $course['teacherId'] === (string) $me['id'];
}

function school_card($course) {
    return array(
        'id' => $course['id'],
        'title' => $course['title'],
        'summary' => isset($course['summary']) ? $course['summary'] : '',
        'level' => isset($course['level']) ? $course['level'] : '',
        'status' => $course['status'],
        'teacherName' => isset($course['teacherName']) ? $course['teacherName'] : '',
        'counts' => school_counts($course),
        'publishedAt' => isset($course['publishedAt']) ? $course['publishedAt'] : '',
    );
}

/* урок для ученика: без верных ответов теста; закрытый урок — только название */
function school_lesson_public($lesson, $state, $mark) {
    $out = array('id' => $lesson['id'], 'title' => $lesson['title'], 'check' => $lesson['check'], 'state' => $state,
        'hasVideo' => $lesson['video'] !== '');
    if ($state === 'locked') return $out;
    $out['body'] = $lesson['body'];
    $out['video'] = $lesson['video'];
    if ($lesson['check'] === 'task') {
        $out['task'] = isset($lesson['task']) ? $lesson['task'] : '';
        $out['answer'] = isset($mark['answer']) ? $mark['answer'] : null;
        $out['sentAt'] = isset($mark['sentAt']) ? $mark['sentAt'] : '';
        $out['review'] = isset($mark['review']) ? $mark['review'] : null;
    }
    if ($lesson['check'] === 'test') {
        $questions = array();
        foreach ($lesson['questions'] as $q) $questions[] = array('q' => $q['q'], 'options' => $q['options']);
        $out['questions'] = $questions;
        $out['pass'] = isset($lesson['pass']) ? (int) $lesson['pass'] : SCHOOL_PASS;
        $out['test'] = isset($mark['test']) ? $mark['test'] : null;
    }
    $out['doneAt'] = isset($mark['doneAt']) ? $mark['doneAt'] : '';
    return $out;
}

/* сколько заданий ждёт проверки (и курсов — публикации) у этого сотрудника */
function school_waiting($dir, $me) {
    $courses = array();
    $n = 0;
    foreach (read_courses($dir) as $c) {
        $courses[$c['id']] = $c;
        if (can($me, 'school.manage') && !empty($c['ready']) && $c['status'] === 'draft') $n++;
    }
    foreach (read_enrolls($dir) as $e) {
        if (!isset($courses[$e['courseId']]) || !school_can_review($me, $courses[$e['courseId']])) continue;
        foreach (isset($e['lessons']) && is_array($e['lessons']) ? $e['lessons'] : array() as $mark) {
            if (isset($mark['status']) && $mark['status'] === 'sent') $n++;
        }
    }
    return $n;
}

/* курс пройден: все уроки done — отметка, баллы, уведомление */
function school_check_completed($dir, &$enroll, $course) {
    $p = school_progress($course, $enroll);
    if ($p['total'] === 0 || $p['done'] < $p['total'] || $enroll['status'] === 'completed') return false;
    $enroll['status'] = 'completed';
    $enroll['completedAt'] = date('c');
    points_award_rule($dir, $enroll['userId'], 'school.course', 'медиашкола',
        'Курс «' . $course['title'] . '»', 'course:' . $course['id']);
    notify_user($dir, $enroll['userId'], 'Курс «' . $course['title'] . '» пройден. Поздравляем! Результат сохранён в кабинете, вкладка «Медиашкола».',
        array('kind' => 'school', 'ref' => 'course-done:' . $enroll['id']));
    return true;
}

/* удаление аккаунта: записи на курсы и ответы человека стираются */
function school_forget_user($dir, $userId) {
    $enrolls = read_enrolls($dir);
    $kept = array();
    foreach ($enrolls as $e) {
        if ((string) $e['userId'] !== (string) $userId) $kept[] = $e;
    }
    if (count($kept) !== count($enrolls)) write_json(school_enrolls_file($dir), $kept);
}

function school_routes($act, $dir) {
    $handled = array('school-catalog', 'school-course', 'school-enroll', 'school-leave', 'school-lesson-done',
        'school-task-send', 'school-test-send', 'school-admin', 'school-course-get', 'school-course-save',
        'school-course-status', 'school-queue', 'school-review', 'school-students');
    if (!in_array($act, $handled, true)) return false;
    $in = body();
    $me = user_by_token($dir, isset($in['token']) ? (string) $in['token'] : '');
    $now = date('c');

    /* ----------------------------------------------------------- каталог */
    if ($act === 'school-catalog') {
        $enrolls = $me ? read_enrolls($dir) : array();
        $out = array();
        foreach (read_courses($dir) as $c) {
            $mine = $me ? school_enroll_index($enrolls, $c['id'], $me['id']) : -1;
            $enroll = $mine >= 0 ? $enrolls[$mine] : null;
            $active = $enroll && $enroll['status'] !== 'left';
            /* в каталоге — опубликованные; снятый с публикации курс видит тот, кто на нём учится */
            if ($c['status'] !== 'published' && !$active) continue;
            $row = school_card($c);
            $row['enrolled'] = (bool) $active;
            $row['enrollStatus'] = $enroll ? $enroll['status'] : '';
            $row['progress'] = $active ? school_progress($c, $enroll) : null;
            $out[] = $row;
        }
        $why = '';
        if (!$me) $why = 'login';
        elseif (empty($me['emailVerified'])) $why = 'email';
        elseif (!consent_ok($dir, $me)) $why = 'consent';
        respond(array('ok' => true, 'courses' => $out, 'canEnroll' => $why === '', 'why' => $why,
            'staff' => $me ? can_any($me, array('school.manage', 'school.teach', 'school.review')) : false));
    }

    if (!$me) fail('Нужно войти в аккаунт.', 401);

    /* ----------------------------------------------------------- ученик */
    if ($act === 'school-course') {
        $courses = read_courses($dir);
        $ci = school_find($courses, text(isset($in['id']) ? $in['id'] : '', 40));
        if ($ci < 0) fail('Курс не найден.', 404);
        $course = $courses[$ci];
        $enrolls = read_enrolls($dir);
        $ei = school_enroll_index($enrolls, $course['id'], $me['id']);
        $enroll = $ei >= 0 && $enrolls[$ei]['status'] !== 'left' ? $enrolls[$ei] : null;
        $staff = school_can_edit($me, $course);
        if ($course['status'] !== 'published' && !$enroll && !$staff) fail('Курс не найден.', 404);

        $states = school_lesson_states($course, $enroll);
        $marks = $enroll && isset($enroll['lessons']) ? $enroll['lessons'] : array();
        $lessons = array();
        foreach ($course['lessons'] as $l) {
            /* без записи видно только оглавление; преподавателю — всё, как ученику с открытыми уроками */
            $state = $enroll ? $states[$l['id']] : ($staff ? 'open' : 'locked');
            $lessons[] = school_lesson_public($l, $state, isset($marks[$l['id']]) ? $marks[$l['id']] : array());
        }
        $card = school_card($course);
        respond(array(
            'ok' => true,
            'course' => $card,
            'lessons' => $lessons,
            'enrolled' => (bool) $enroll,
            'enrollStatus' => $enroll ? $enroll['status'] : '',
            'preview' => !$enroll && $staff,
            'progress' => $enroll ? school_progress($course, $enroll) : null,
            'completedAt' => $enroll && isset($enroll['completedAt']) ? $enroll['completedAt'] : '',
        ));
    }

    if ($act === 'school-enroll') {
        if (empty($me['emailVerified'])) fail('Сначала подтвердите почту: кабинет, вкладка «Профиль».', 403);
        require_consent($dir, $me);
        $courses = read_courses($dir);
        $ci = school_find($courses, text(isset($in['id']) ? $in['id'] : '', 40));
        if ($ci < 0 || $courses[$ci]['status'] !== 'published') fail('На этот курс запись закрыта.', 404);
        $course = $courses[$ci];
        $enrolls = read_enrolls($dir);
        $ei = school_enroll_index($enrolls, $course['id'], $me['id']);
        if ($ei >= 0 && $enrolls[$ei]['status'] !== 'left') fail('Вы уже записаны на этот курс.', 409);
        if ($ei >= 0) {
            /* возвращение на курс: пройденное сохраняется */
            $enrolls[$ei]['status'] = 'active';
            $enrolls[$ei]['returnedAt'] = $now;
        } else {
            $enrolls[] = array(
                'id' => new_id('enr_'),
                'courseId' => $course['id'],
                'userId' => $me['id'],
                'status' => 'active',
                'startedAt' => $now,
                'lessons' => array(),
            );
            $ei = count($enrolls) - 1;
        }
        if (!write_json(school_enrolls_file($dir), $enrolls)) fail('Не удалось записать на курс.', 500);
        respond(array('ok' => true, 'enrollId' => $enrolls[$ei]['id'], 'progress' => school_progress($course, $enrolls[$ei])));
    }

    if ($act === 'school-leave') {
        $enrolls = read_enrolls($dir);
        $ei = school_enroll_index($enrolls, text(isset($in['id']) ? $in['id'] : '', 40), $me['id']);
        if ($ei < 0 || $enrolls[$ei]['status'] === 'left') fail('Вы не записаны на этот курс.', 409);
        if ($enrolls[$ei]['status'] === 'completed') fail('Курс уже пройден: результат остаётся в кабинете.', 409);
        $enrolls[$ei]['status'] = 'left';
        $enrolls[$ei]['leftAt'] = $now;
        if (!write_json(school_enrolls_file($dir), $enrolls)) fail('Не удалось сохранить.', 500);
        respond(array('ok' => true));
    }

    if (in_array($act, array('school-lesson-done', 'school-task-send', 'school-test-send'), true)) {
        $courses = read_courses($dir);
        $ci = school_find($courses, text(isset($in['courseId']) ? $in['courseId'] : '', 40));
        if ($ci < 0) fail('Курс не найден.', 404);
        $course = $courses[$ci];
        $lessonId = text(isset($in['lessonId']) ? $in['lessonId'] : '', 40);
        $lesson = null;
        foreach ($course['lessons'] as $l) {
            if ($l['id'] === $lessonId) $lesson = $l;
        }
        if (!$lesson) fail('Урок не найден.', 404);
        $enrolls = read_enrolls($dir);
        $ei = school_enroll_index($enrolls, $course['id'], $me['id']);
        if ($ei < 0 || $enrolls[$ei]['status'] === 'left') fail('Сначала запишитесь на курс.', 403);
        /* согласие могли отозвать уже после записи — учёба тогда останавливается */
        require_consent($dir, $me);
        $states = school_lesson_states($course, $enrolls[$ei]);
        $state = $states[$lessonId];
        if ($state === 'locked') fail('Этот урок откроется после предыдущего.', 409);
        $mark = isset($enrolls[$ei]['lessons'][$lessonId]) ? $enrolls[$ei]['lessons'][$lessonId] : array();
        $extra = array();

        if ($act === 'school-lesson-done') {
            if ($lesson['check'] !== 'none') fail('У этого урока есть задание или тест: урок засчитается после них.', 409);
            if ($state !== 'done') {
                $mark['status'] = 'done';
                $mark['doneAt'] = $now;
                points_award_rule($dir, $me['id'], 'school.lesson', 'медиашкола',
                    'Урок «' . $lesson['title'] . '»', 'lesson:' . $course['id'] . ':' . $lessonId);
            }
        }

        if ($act === 'school-task-send') {
            if ($lesson['check'] !== 'task') fail('В этом уроке нет задания.', 409);
            if ($state === 'done') fail('Задание уже принято.', 409);
            $answer = text(isset($in['text']) ? $in['text'] : '', 8000);
            $link = text(isset($in['link']) ? $in['link'] : '', 300);
            if (slen($answer) < 20) fail('Ответ слишком короткий: напишите хотя бы пару предложений.');
            if ($link !== '' && !preg_match('~^https?://[^\s<>"\']+$~i', $link)) fail('Ссылка должна начинаться с https://');
            $mark['status'] = 'sent';
            $mark['answer'] = array('text' => $answer, 'link' => $link);
            $mark['sentAt'] = $now;
            $mark['tries'] = (isset($mark['tries']) ? (int) $mark['tries'] : 0) + 1;
            unset($mark['review']);
        }

        if ($act === 'school-test-send') {
            if ($lesson['check'] !== 'test') fail('В этом уроке нет теста.', 409);
            $answers = isset($in['answers']) && is_array($in['answers']) ? array_values($in['answers']) : array();
            $questions = $lesson['questions'];
            if (count($answers) !== count($questions)) fail('Ответьте на все вопросы теста.');
            $right = 0;
            $marks = array();
            foreach ($questions as $qi => $q) {
                $ok = is_numeric($answers[$qi]) && (int) $answers[$qi] === (int) $q['answer'];
                if ($ok) $right++;
                $marks[] = $ok;
            }
            $score = (int) floor($right * 100 / count($questions));
            $pass = isset($lesson['pass']) ? (int) $lesson['pass'] : SCHOOL_PASS;
            $passed = $score >= $pass;
            $test = isset($mark['test']) && is_array($mark['test']) ? $mark['test'] : array('attempts' => 0, 'best' => 0);
            $test['attempts'] = (int) $test['attempts'] + 1;
            $test['best'] = max((int) $test['best'], $score);
            $test['lastScore'] = $score;
            $test['lastAt'] = $now;
            $mark['test'] = $test;
            if ($state !== 'done') {
                if ($passed) {
                    $mark['status'] = 'done';
                    $mark['doneAt'] = $now;
                    points_award_rule($dir, $me['id'], 'school.test', 'медиашкола',
                        'Тест «' . $lesson['title'] . '»', 'test:' . $course['id'] . ':' . $lessonId);
                } else {
                    $mark['status'] = 'failed';
                }
            }
            /* после попытки показываем, какие ответы верны, но не сами верные варианты */
            $extra = array('score' => $score, 'passed' => $passed, 'right' => $right, 'total' => count($questions),
                'pass' => $pass, 'marks' => $marks);
        }

        $enrolls[$ei]['lessons'][$lessonId] = $mark;
        $completed = school_check_completed($dir, $enrolls[$ei], $course);
        if (!write_json(school_enrolls_file($dir), $enrolls)) fail('Не удалось сохранить результат.', 500);
        $states = school_lesson_states($course, $enrolls[$ei]);
        respond(array_merge(array('ok' => true, 'state' => $states[$lessonId],
            'progress' => school_progress($course, $enrolls[$ei]), 'completed' => $completed), $extra));
    }

    /* ------------------------------------------- преподаватель и руководство */
    if (!can_any($me, array('school.manage', 'school.teach', 'school.review'))) {
        fail('Раздел медиашколы открыт преподавателям и руководству проекта.', 403);
    }
    $manage = can($me, 'school.manage');

    if ($act === 'school-admin') {
        $enrolls = read_enrolls($dir);
        $out = array();
        foreach (read_courses($dir) as $c) {
            if (!school_can_edit($me, $c) && !school_can_review($me, $c)) continue;
            $students = 0; $completed = 0; $waiting = 0;
            foreach ($enrolls as $e) {
                if ((string) $e['courseId'] !== (string) $c['id'] || $e['status'] === 'left') continue;
                $students++;
                if ($e['status'] === 'completed') $completed++;
                foreach (isset($e['lessons']) && is_array($e['lessons']) ? $e['lessons'] : array() as $mark) {
                    if (isset($mark['status']) && $mark['status'] === 'sent') $waiting++;
                }
            }
            $row = school_card($c);
            $row['teacherId'] = isset($c['teacherId']) ? $c['teacherId'] : '';
            $row['ready'] = !empty($c['ready']);
            $row['students'] = $students;
            $row['completed'] = $completed;
            $row['waiting'] = $waiting;
            $row['updatedAt'] = isset($c['updatedAt']) ? $c['updatedAt'] : '';
            $row['canEdit'] = school_can_edit($me, $c);
            $out[] = $row;
        }
        $teachers = array();
        if ($manage) {
            foreach (read_users($dir) as $u) {
                if (isset($u['status']) && $u['status'] === 'deleted') continue;
                if (!can($u, 'school.teach')) continue;
                $teachers[] = array('id' => $u['id'], 'name' => $u['name'], 'access' => isset($u['access']) ? $u['access'] : '');
            }
        }
        respond(array('ok' => true, 'courses' => $out, 'teachers' => $teachers, 'canManage' => $manage,
            'canCreate' => can_any($me, array('school.manage', 'school.teach')), 'pass' => SCHOOL_PASS));
    }

    if ($act === 'school-course-get') {
        $courses = read_courses($dir);
        $ci = school_find($courses, text(isset($in['id']) ? $in['id'] : '', 40));
        if ($ci < 0) fail('Курс не найден.', 404);
        if (!school_can_edit($me, $courses[$ci])) fail('Этот курс ведёт другой преподаватель.', 403);
        respond(array('ok' => true, 'course' => $courses[$ci]));
    }

    if ($act === 'school-course-save') {
        if (!can_any($me, array('school.manage', 'school.teach'))) fail('Курсы создают преподаватели и руководство школы.', 403);
        $raw = isset($in['course']) && is_array($in['course']) ? $in['course'] : array();
        $courses = read_courses($dir);
        $id = text(isset($raw['id']) ? $raw['id'] : '', 40);
        $ci = $id !== '' ? school_find($courses, $id) : -1;
        if ($id !== '' && $ci < 0) fail('Курс не найден.', 404);
        $old = $ci >= 0 ? $courses[$ci] : null;
        if ($old && !school_can_edit($me, $old)) fail('Этот курс ведёт другой преподаватель.', 403);

        $bad = array();
        $title = text(isset($raw['title']) ? $raw['title'] : '', 140);
        $summary = text(isset($raw['summary']) ? $raw['summary'] : '', 600);
        $level = text(isset($raw['level']) ? $raw['level'] : '', 60);
        if (slen($title) < 5) $bad[] = 'Название курса — хотя бы пять символов.';
        if (slen($summary) < 20) $bad[] = 'Опишите курс: для кого он и чему научит (не меньше 20 символов).';
        $lessonsRaw = isset($raw['lessons']) && is_array($raw['lessons']) ? array_values($raw['lessons']) : array();
        if (count($lessonsRaw) > SCHOOL_MAX_LESSONS) $bad[] = 'В курсе не больше ' . SCHOOL_MAX_LESSONS . ' уроков.';
        $lessons = array();
        $seen = array();
        foreach (array_slice($lessonsRaw, 0, SCHOOL_MAX_LESSONS) as $n => $l) {
            $clean = school_lesson_clean($l, $n + 1, $bad);
            if (isset($seen[$clean['id']])) $clean['id'] = new_id('les_');   // одинаковые номера уроков недопустимы
            $seen[$clean['id']] = true;
            $lessons[] = $clean;
        }
        /* преподаватель: руководство назначает любого, сам преподаватель — только себя */
        $teacherId = $old ? (isset($old['teacherId']) ? $old['teacherId'] : '') : $me['id'];
        $teacherName = $old ? (isset($old['teacherName']) ? $old['teacherName'] : '') : $me['name'];
        if ($manage && isset($raw['teacherId']) && (string) $raw['teacherId'] !== (string) $teacherId) {
            $found = null;
            foreach (read_users($dir) as $u) {
                if ((string) $u['id'] === (string) $raw['teacherId'] && can($u, 'school.teach')
                    && !(isset($u['status']) && $u['status'] === 'deleted')) $found = $u;
            }
            if (!$found) $bad[] = 'Преподавателем можно назначить человека с ролью преподавателя или руководства школы.';
            else { $teacherId = $found['id']; $teacherName = $found['name']; }
        }
        if ($bad) respond(array('ok' => false, 'error' => $bad[0], 'problems' => $bad, 'code' => 400), 400);

        $course = array(
            'id' => $old ? $old['id'] : new_id('crs_'),
            'title' => $title,
            'summary' => $summary,
            'level' => $level,
            'status' => $old ? $old['status'] : 'draft',
            'teacherId' => $teacherId,
            'teacherName' => $teacherName,
            'lessons' => $lessons,
            'ready' => !empty($raw['ready']),
            'createdAt' => $old ? $old['createdAt'] : $now,
            'updatedAt' => $now,
            'updatedBy' => $me['name'],
            'publishedAt' => $old && isset($old['publishedAt']) ? $old['publishedAt'] : '',
        );
        if ($course['status'] === 'published' && !$lessons) {
            fail('В опубликованном курсе должен остаться хотя бы один урок. Чтобы убрать курс, снимите его с публикации.', 409);
        }
        if ($old) $courses[$ci] = $course; else $courses[] = $course;
        if (!write_json(school_courses_file($dir), $courses)) fail('Не удалось сохранить курс.', 500);
        audit_log($dir, (string) $me['email'], 'school-course-save', ($old ? 'изменён' : 'создан') . ' курс «' . $title . '»');
        respond(array('ok' => true, 'course' => $course));
    }

    if ($act === 'school-course-status') {
        if (!$manage) fail('Публикует и снимает курсы руководство школы.', 403);
        $status = isset($in['status']) ? (string) $in['status'] : '';
        if (!in_array($status, array('published', 'draft', 'archived'), true)) fail('Состояние курса: опубликован, черновик или архив.');
        $courses = read_courses($dir);
        $ci = school_find($courses, text(isset($in['id']) ? $in['id'] : '', 40));
        if ($ci < 0) fail('Курс не найден.', 404);
        if ($status === 'published' && !$courses[$ci]['lessons']) fail('В курсе нет уроков — публиковать нечего.', 409);
        $was = $courses[$ci]['status'];
        $courses[$ci]['status'] = $status;
        $courses[$ci]['ready'] = false;
        if ($status === 'published' && empty($courses[$ci]['publishedAt'])) $courses[$ci]['publishedAt'] = $now;
        $courses[$ci]['updatedAt'] = $now;
        if (!write_json(school_courses_file($dir), $courses)) fail('Не удалось сохранить.', 500);
        audit_log($dir, (string) $me['email'], 'school-course-status', 'курс «' . $courses[$ci]['title'] . '»: ' . $was . ' → ' . $status);
        if ($status === 'published' && $was !== 'published' && !empty($courses[$ci]['teacherId'])
            && (string) $courses[$ci]['teacherId'] !== (string) $me['id']) {
            notify_user($dir, $courses[$ci]['teacherId'], 'Курс «' . $courses[$ci]['title'] . '» опубликован в медиашколе.',
                array('kind' => 'school', 'ref' => 'course-pub:' . $courses[$ci]['id'] . ':' . time()));
        }
        respond(array('ok' => true, 'course' => school_card($courses[$ci])));
    }

    /* ниже — проверка заданий и ученики */
    $courses = array();
    foreach (read_courses($dir) as $c) $courses[$c['id']] = $c;
    $names = array();
    foreach (read_users($dir) as $u) $names[$u['id']] = $u;

    if ($act === 'school-queue') {
        $items = array();
        foreach (read_enrolls($dir) as $e) {
            if (!isset($courses[$e['courseId']]) || !school_can_review($me, $courses[$e['courseId']])) continue;
            $course = $courses[$e['courseId']];
            $titles = array(); $tasks = array();
            foreach ($course['lessons'] as $l) { $titles[$l['id']] = $l['title']; $tasks[$l['id']] = isset($l['task']) ? $l['task'] : ''; }
            foreach (isset($e['lessons']) && is_array($e['lessons']) ? $e['lessons'] : array() as $lessonId => $mark) {
                if (!isset($mark['status']) || $mark['status'] !== 'sent' || !isset($titles[$lessonId])) continue;
                $user = isset($names[$e['userId']]) ? $names[$e['userId']] : null;
                if ($user && isset($user['status']) && $user['status'] === 'deleted') continue;
                $items[] = array(
                    'enrollId' => $e['id'],
                    'lessonId' => $lessonId,
                    'courseId' => $course['id'],
                    'courseTitle' => $course['title'],
                    'lessonTitle' => $titles[$lessonId],
                    'task' => $tasks[$lessonId],
                    'userName' => $user ? $user['name'] : 'Участник',
                    'userNumber' => $user && isset($user['number']) ? (int) $user['number'] : 0,
                    'text' => isset($mark['answer']['text']) ? $mark['answer']['text'] : '',
                    'link' => isset($mark['answer']['link']) ? $mark['answer']['link'] : '',
                    'sentAt' => isset($mark['sentAt']) ? $mark['sentAt'] : '',
                    'tries' => isset($mark['tries']) ? (int) $mark['tries'] : 1,
                );
            }
        }
        usort($items, function ($a, $b) { return strcmp((string) $a['sentAt'], (string) $b['sentAt']); });
        respond(array('ok' => true, 'items' => $items));
    }

    if ($act === 'school-review') {
        $decision = isset($in['decision']) ? (string) $in['decision'] : '';
        $note = text(isset($in['note']) ? $in['note'] : '', 1500);
        if (!in_array($decision, array('accepted', 'returned'), true)) fail('Решение: принять или вернуть.');
        if ($decision === 'returned' && slen($note) < 5) fail('Напишите, что исправить: ученик увидит это в уроке.');
        $enrolls = read_enrolls($dir);
        $ei = school_find($enrolls, text(isset($in['enrollId']) ? $in['enrollId'] : '', 40));
        if ($ei < 0 || !isset($courses[$enrolls[$ei]['courseId']])) fail('Работа не найдена.', 404);
        $course = $courses[$enrolls[$ei]['courseId']];
        if (!school_can_review($me, $course)) fail('Задания этого курса проверяет его преподаватель.', 403);
        $lessonId = text(isset($in['lessonId']) ? $in['lessonId'] : '', 40);
        if (!isset($enrolls[$ei]['lessons'][$lessonId]) || $enrolls[$ei]['lessons'][$lessonId]['status'] !== 'sent') {
            fail('По этой работе решение уже принято.', 409);
        }
        if ((string) $enrolls[$ei]['userId'] === (string) $me['id']) fail('Свою работу проверяет другой преподаватель.', 403);
        $lessonTitle = '';
        foreach ($course['lessons'] as $l) { if ($l['id'] === $lessonId) $lessonTitle = $l['title']; }

        $enrolls[$ei]['lessons'][$lessonId]['status'] = $decision === 'accepted' ? 'done' : 'returned';
        $enrolls[$ei]['lessons'][$lessonId]['review'] = array('by' => $me['name'], 'at' => $now, 'note' => $note, 'decision' => $decision);
        if ($decision === 'accepted') {
            $enrolls[$ei]['lessons'][$lessonId]['doneAt'] = $now;
            points_award_rule($dir, $enrolls[$ei]['userId'], 'school.homework', $me['name'],
                'Задание «' . $lessonTitle . '»', 'task:' . $course['id'] . ':' . $lessonId . ':' . $enrolls[$ei]['userId']);
        }
        $completed = school_check_completed($dir, $enrolls[$ei], $course);
        if (!write_json(school_enrolls_file($dir), $enrolls)) fail('Не удалось сохранить решение.', 500);
        notify_user($dir, $enrolls[$ei]['userId'],
            $decision === 'accepted'
                ? 'Задание «' . $lessonTitle . '» в курсе «' . $course['title'] . '» принято.' . ($note !== '' ? ' Комментарий преподавателя: ' . $note : '')
                : 'Задание «' . $lessonTitle . '» в курсе «' . $course['title'] . '» нужно доработать: ' . $note,
            array('kind' => 'school', 'ref' => 'task:' . $enrolls[$ei]['id'] . ':' . $lessonId . ':' . $decision . ':' . time()));
        respond(array('ok' => true, 'completed' => $completed));
    }

    if ($act === 'school-students') {
        $id = text(isset($in['id']) ? $in['id'] : '', 40);
        if (!isset($courses[$id])) fail('Курс не найден.', 404);
        $course = $courses[$id];
        if (!school_can_review($me, $course) && !school_can_edit($me, $course)) fail('Учеников курса видит его преподаватель.', 403);
        $rows = array();
        foreach (read_enrolls($dir) as $e) {
            if ((string) $e['courseId'] !== $id) continue;
            $user = isset($names[$e['userId']]) ? $names[$e['userId']] : null;
            if (!$user || (isset($user['status']) && $user['status'] === 'deleted')) continue;
            $rows[] = array(
                'userName' => $user['name'],
                'userNumber' => isset($user['number']) ? (int) $user['number'] : 0,
                'region' => isset($user['region']) ? $user['region'] : '',
                'status' => $e['status'],
                'startedAt' => isset($e['startedAt']) ? $e['startedAt'] : '',
                'completedAt' => isset($e['completedAt']) ? $e['completedAt'] : '',
                'progress' => school_progress($course, $e),
            );
        }
        usort($rows, function ($a, $b) { return $b['progress']['done'] - $a['progress']['done']; });
        respond(array('ok' => true, 'course' => school_card($course), 'students' => $rows));
    }

    return false;
}
