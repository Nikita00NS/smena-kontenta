<?php
/* Минимальный PDF-движок для пресс-карты: без Composer и внешних сервисов.

   Текст остаётся текстом (не картинкой), кириллица обеспечивается встроенным
   TrueType-шрифтом Golos Text. Шрифт и его метрики собираются заранее:
   python3 tools/build-card-fonts.py. Лицензия — api/lib/fonts/OFL.txt.

   Движок умеет ровно то, что нужно карте: страницы, прямоугольники, линии,
   текст с переносом по словам и встроенный шрифт с ToUnicode, чтобы текст
   можно было выделить и найти в PDF. */

if (!defined('SMENA_API')) {
    http_response_code(403);
    exit;
}

function pdf_mm($mm) { return $mm * 72.0 / 25.4; }

function pdf_rgb($hex) {
    $hex = ltrim((string) $hex, '#');
    if (strlen($hex) !== 6) return array(0.0, 0.0, 0.0);
    return array(
        hexdec(substr($hex, 0, 2)) / 255.0,
        hexdec(substr($hex, 2, 2)) / 255.0,
        hexdec(substr($hex, 4, 2)) / 255.0,
    );
}

/* UTF-8 → кодовые точки без обязательного mbstring. */
function pdf_codepoints($text) {
    $out = array();
    $len = strlen((string) $text);
    for ($i = 0; $i < $len; $i++) {
        $c = ord($text[$i]);
        if ($c < 0x80) { $out[] = $c; continue; }
        if (($c & 0xE0) === 0xC0 && $i + 1 < $len) {
            $c2 = ord($text[$i + 1]);
            if (($c2 & 0xC0) === 0x80) {
                $cp = (($c & 0x1F) << 6) | ($c2 & 0x3F);
                if ($cp >= 0x80) { $out[] = $cp; $i += 1; continue; }
            }
        } elseif (($c & 0xF0) === 0xE0 && $i + 2 < $len) {
            $c2 = ord($text[$i + 1]); $c3 = ord($text[$i + 2]);
            if (($c2 & 0xC0) === 0x80 && ($c3 & 0xC0) === 0x80) {
                $cp = (($c & 0x0F) << 12) | (($c2 & 0x3F) << 6) | ($c3 & 0x3F);
                if ($cp >= 0x800) { $out[] = $cp; $i += 2; continue; }
            }
        } elseif (($c & 0xF8) === 0xF0 && $i + 3 < $len) {
            $c2 = ord($text[$i + 1]); $c3 = ord($text[$i + 2]); $c4 = ord($text[$i + 3]);
            if (($c2 & 0xC0) === 0x80 && ($c3 & 0xC0) === 0x80 && ($c4 & 0xC0) === 0x80) {
                $cp = (($c & 0x07) << 18) | (($c2 & 0x3F) << 12) | (($c3 & 0x3F) << 6) | ($c4 & 0x3F);
                if ($cp >= 0x10000 && $cp <= 0x10FFFF) { $out[] = $cp; $i += 3; continue; }
            }
        }
        $out[] = 0xFFFD;
    }
    return $out;
}

function pdf_font_load($name) {
    static $cache = array();
    if (isset($cache[$name])) return $cache[$name];
    $base = __DIR__ . '/fonts/golos-text-' . $name;
    $metricsRaw = @file_get_contents($base . '.json');
    $ttf = @file_get_contents($base . '.ttf');
    if ($metricsRaw === false || $ttf === false) {
        throw new RuntimeException('Шрифт для PDF не собран. Запустите tools/build-card-fonts.py.');
    }
    $metrics = json_decode($metricsRaw, true);
    if (!is_array($metrics) || empty($metrics['cmap']) || empty($metrics['widths'])) {
        throw new RuntimeException('Метрики шрифта PDF повреждены.');
    }
    $cache[$name] = array('metrics' => $metrics, 'ttf' => $ttf, 'used' => array());
    return $cache[$name];
}

function pdf_font_gid($font, $cp) {
    $cmap = $font['metrics']['cmap'];
    if (isset($cmap[(string) $cp])) return (int) $cmap[(string) $cp];
    if (isset($cmap['63'])) return (int) $cmap['63']; /* '?' */
    return 0;
}

function pdf_font_width($font, $gid) {
    $widths = $font['metrics']['widths'];
    return isset($widths[(string) $gid]) ? (int) $widths[(string) $gid] : 500;
}

class SmenaPdf {
    private $pages = array();
    private $current = -1;
    private $fonts = array('regular' => 'F1', 'bold' => 'F2');
    private $loaded = array();
    private $used = array('regular' => array(), 'bold' => array());

    private function font($name) {
        if (!isset($this->fonts[$name])) throw new RuntimeException('Неизвестный шрифт PDF: ' . $name);
        if (!isset($this->loaded[$name])) $this->loaded[$name] = pdf_font_load($name);
        return $this->loaded[$name];
    }

    public function addPage($widthMm, $heightMm) {
        $this->pages[] = array('w' => pdf_mm($widthMm), 'h' => pdf_mm($heightMm), 'ops' => '');
        $this->current = count($this->pages) - 1;
        return $this->current;
    }

    private function op($s) {
        if ($this->current < 0) throw new RuntimeException('Страница PDF не создана.');
        $this->pages[$this->current]['ops'] .= $s . "\n";
    }

    public function rect($xMm, $yMm, $wMm, $hMm, $fillHex = null, $strokeHex = null, $lineWidthMm = 0.25) {
        $x = pdf_mm($xMm); $y = pdf_mm($yMm); $w = pdf_mm($wMm); $h = pdf_mm($hMm);
        $parts = array();
        if ($fillHex !== null) {
            $c = pdf_rgb($fillHex);
            $parts[] = sprintf('%.3F %.3F %.3F rg', $c[0], $c[1], $c[2]);
        }
        if ($strokeHex !== null) {
            $c = pdf_rgb($strokeHex);
            $parts[] = sprintf('%.3F %.3F %.3F RG', $c[0], $c[1], $c[2]);
            $parts[] = sprintf('%.3F w', pdf_mm($lineWidthMm));
        }
        $parts[] = sprintf('%.3F %.3F %.3F %.3F re', $x, $y, $w, $h);
        if ($fillHex !== null && $strokeHex !== null) $parts[] = 'B';
        elseif ($fillHex !== null) $parts[] = 'f';
        else $parts[] = 'S';
        $this->op(implode("\n", $parts));
    }

    public function line($x1Mm, $y1Mm, $x2Mm, $y2Mm, $hex = '111111', $lineWidthMm = 0.2) {
        $c = pdf_rgb($hex);
        $this->op(sprintf("%.3F %.3F %.3F RG\n%.3F w\n%.3F %.3F m\n%.3F %.3F l\nS",
            $c[0], $c[1], $c[2], pdf_mm($lineWidthMm),
            pdf_mm($x1Mm), pdf_mm($y1Mm), pdf_mm($x2Mm), pdf_mm($y2Mm)));
    }

    public function textWidth($text, $sizePt, $fontName = 'regular') {
        $font = $this->font($fontName);
        $width = 0.0;
        foreach (pdf_codepoints($text) as $cp) {
            $gid = pdf_font_gid($font, $cp);
            $width += pdf_font_width($font, $gid) * $sizePt / 1000.0;
        }
        return $width;
    }

    /* Перенос по словам; слишком длинное слово режется по символам. */
    public function wrap($text, $sizePt, $maxWidthPt, $fontName = 'regular') {
        $lines = array();
        foreach (preg_split('/\R/u', (string) $text) as $paragraph) {
            $words = preg_split('/\s+/u', trim($paragraph), -1, PREG_SPLIT_NO_EMPTY);
            if (!$words) { $lines[] = ''; continue; }
            $line = '';
            foreach ($words as $word) {
                $candidate = $line === '' ? $word : $line . ' ' . $word;
                if ($this->textWidth($candidate, $sizePt, $fontName) <= $maxWidthPt) {
                    $line = $candidate;
                    continue;
                }
                if ($line !== '') { $lines[] = $line; $line = ''; }
                if ($this->textWidth($word, $sizePt, $fontName) <= $maxWidthPt) {
                    $line = $word;
                    continue;
                }
                $chunk = '';
                foreach (pdf_codepoints($word) as $cp) {
                    $ch = $this->codepointUtf8($cp);
                    if ($chunk !== '' && $this->textWidth($chunk . $ch, $sizePt, $fontName) > $maxWidthPt) {
                        $lines[] = $chunk;
                        $chunk = $ch;
                    } else {
                        $chunk .= $ch;
                    }
                }
                $line = $chunk;
            }
            if ($line !== '') $lines[] = $line;
        }
        return $lines;
    }

    private function codepointUtf8($cp) {
        if ($cp < 0x80) return chr($cp);
        if ($cp < 0x800) return chr(0xC0 | ($cp >> 6)) . chr(0x80 | ($cp & 0x3F));
        if ($cp < 0x10000) return chr(0xE0 | ($cp >> 12)) . chr(0x80 | (($cp >> 6) & 0x3F)) . chr(0x80 | ($cp & 0x3F));
        return chr(0xF0 | ($cp >> 18)) . chr(0x80 | (($cp >> 12) & 0x3F)) . chr(0x80 | (($cp >> 6) & 0x3F)) . chr(0x80 | ($cp & 0x3F));
    }

    /* $yMm — базовая линия текста, отсчёт снизу страницы. */
    public function text($xMm, $yMm, $sizePt, $text, $fontName = 'regular', $hex = '111111') {
        $font = $this->font($fontName);
        $tag = $this->fonts[$fontName];
        $hexStr = '';
        foreach (pdf_codepoints($text) as $cp) {
            $gid = pdf_font_gid($font, $cp);
            $this->used[$fontName][$gid] = $cp;
            $hexStr .= sprintf('%04X', $gid);
        }
        $c = pdf_rgb($hex);
        $this->op(sprintf("BT\n%.3F %.3F %.3F rg\n/%s %.3F Tf\n1 0 0 1 %.3F %.3F Tm\n<%s> Tj\nET",
            $c[0], $c[1], $c[2], $tag, $sizePt, pdf_mm($xMm), pdf_mm($yMm), $hexStr));
    }

    public function textBlock($xMm, $topYFromBottomMm, $sizePt, $text, $maxWidthMm, $lineHeightMm, $fontName = 'regular', $hex = '111111', $maxLines = 0) {
        $lines = $this->wrap($text, $sizePt, pdf_mm($maxWidthMm), $fontName);
        if ($maxLines > 0 && count($lines) > $maxLines) {
            $lines = array_slice($lines, 0, $maxLines);
            $last = $lines[$maxLines - 1];
            while ($last !== '' && $this->textWidth($last . '…', $sizePt, $fontName) > pdf_mm($maxWidthMm)) {
                $last = substr($last, 0, -1);
            }
            $lines[$maxLines - 1] = rtrim($last) . '…';
        }
        $y = $topYFromBottomMm;
        foreach ($lines as $line) {
            $this->text($xMm, $y, $sizePt, $line, $fontName, $hex);
            $y -= $lineHeightMm;
        }
        return $y;
    }

    private function stream($data, $extra = '') {
        $raw = $data;
        $filter = '';
        if (function_exists('gzcompress')) {
            $compressed = gzcompress($data, 6);
            if ($compressed !== false && strlen($compressed) < strlen($data)) {
                $raw = $compressed;
                $filter = ' /Filter /FlateDecode';
            }
        }
        return '<< /Length ' . strlen($raw) . $filter . $extra . " >>\nstream\n" . $raw . "\nendstream";
    }

    private function toUnicode($fontName) {
        $pairs = $this->used[$fontName];
        ksort($pairs);
        $out = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n" .
            "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" .
            "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n" .
            "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
        $chunks = array_chunk($pairs, 100, true);
        foreach ($chunks as $chunk) {
            $out .= count($chunk) . " beginbfchar\n";
            foreach ($chunk as $gid => $cp) {
                if ($cp <= 0xFFFF) $unicode = sprintf('%04X', $cp);
                else {
                    $cp -= 0x10000;
                    $unicode = sprintf('%04X%04X', 0xD800 + ($cp >> 10), 0xDC00 + ($cp & 0x3FF));
                }
                $out .= sprintf("<%04X> <%s>\n", $gid, $unicode);
            }
            $out .= "endbfchar\n";
        }
        $out .= "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
        return $out;
    }

    public function output() {
        foreach (array_keys($this->fonts) as $name) $this->font($name);

        $objects = array(1 => '', 2 => '');
        $next = 3;
        $fontIds = array();
        foreach ($this->fonts as $name => $tag) {
            $fontIds[$name] = array(
                'type0' => $next++, 'cid' => $next++, 'desc' => $next++,
                'file' => $next++, 'unicode' => $next++,
            );
            for ($i = 0; $i < 5; $i++) $objects[$next - 1 - $i] = '';
        }

        $kids = array();
        $fontResources = array();
        foreach ($this->fonts as $name => $tag) {
            $fontResources[] = '/' . $tag . ' ' . $fontIds[$name]['type0'] . ' 0 R';
        }
        $resources = '<< /Font << ' . implode(' ', $fontResources) . ' >> >>';
        foreach ($this->pages as $page) {
            $contentId = $next++;
            $pageId = $next++;
            $objects[$contentId] = $this->stream($page['ops']);
            $objects[$pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' .
                sprintf('%.3F %.3F', $page['w'], $page['h']) . '] /Resources ' . $resources .
                ' /Contents ' . $contentId . ' 0 R >>';
            $kids[] = $pageId . ' 0 R';
        }

        foreach ($this->fonts as $name => $tag) {
            $ids = $fontIds[$name];
            $font = $this->loaded[$name];
            $m = $font['metrics'];
            $baseName = 'GolosText-' . ucfirst($name);
            $objects[$ids['type0']] = '<< /Type /Font /Subtype /Type0 /BaseFont /' . $baseName .
                ' /Encoding /Identity-H /DescendantFonts [' . $ids['cid'] . ' 0 R] /ToUnicode ' . $ids['unicode'] . ' 0 R >>';

            $w = array();
            $used = $this->used[$name];
            if (!$used) $used = array(0 => 32);
            ksort($used);
            foreach (array_keys($used) as $gid) {
                $w[] = $gid . ' [' . pdf_font_width($font, $gid) . ']';
            }
            $objects[$ids['cid']] = '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' . $baseName .
                ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' . $ids['desc'] .
                ' 0 R /DW 1000 /W [' . implode(' ', $w) . '] /CIDToGIDMap /Identity >>';

            $bbox = implode(' ', array_map('intval', $m['bbox']));
            $objects[$ids['desc']] = '<< /Type /FontDescriptor /FontName /' . $baseName .
                ' /Flags 4 /FontBBox [' . $bbox . '] /ItalicAngle ' . (float) $m['italicAngle'] .
                ' /Ascent ' . (int) $m['ascent'] . ' /Descent ' . (int) $m['descent'] .
                ' /CapHeight ' . (int) $m['capHeight'] . ' /StemV 80 /FontFile2 ' . $ids['file'] . ' 0 R >>';
            $objects[$ids['file']] = $this->stream($font['ttf'], ' /Length1 ' . strlen($font['ttf']));
            $objects[$ids['unicode']] = $this->stream($this->toUnicode($name));
        }

        $objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $objects[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($this->pages) . ' >>';
        ksort($objects);

        $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = array(0 => 0);
        foreach ($objects as $id => $body) {
            $offsets[$id] = strlen($pdf);
            $pdf .= $id . " 0 obj\n" . $body . "\nendobj\n";
        }
        $xrefPos = strlen($pdf);
        $size = count($objects) + 1;
        $pdf .= "xref\n0 " . $size . "\n0000000000 65535 f \n";
        for ($id = 1; $id < $size; $id++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$id]);
        }
        $pdf .= "trailer\n<< /Size " . $size . " /Root 1 0 R >>\nstartxref\n" . $xrefPos . "\n%%EOF";
        return $pdf;
    }
}

/* Название региона берём из той же карты, что и сайт: assets/js/map-data.js. */
function card_region_name($slug) {
    static $names = null;
    if ($names === null) {
        $names = array();
        $path = __DIR__ . '/../../assets/js/map-data.js';
        $raw = @file_get_contents($path);
        if ($raw !== false && preg_match_all('/name:"([^"]+)",short:"[^"]*",slug:"([^"]+)"/u', $raw, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $row) $names[$row[2]] = $row[1];
        }
    }
    $slug = (string) $slug;
    return isset($names[$slug]) ? $names[$slug] : $slug;
}

function card_pdf_date($iso) {
    $ts = strtotime((string) $iso);
    if ($ts === false) return '—';
    return date('d.m.Y', $ts);
}

/* Две стороны карты на одном листе A4 в реальном размере 85,6 × 54 мм. */
function card_pdf_bytes($card, $verifyCode) {
    $pdf = new SmenaPdf();
    $pdf->addPage(210, 297);

    $cardW = 85.6; $cardH = 54.0;
    $left = 15.0; $gap = 8.0;
    $top = 297.0 - 22.0;             /* верхняя граница карт от низа листа */
    $y = $top - $cardH;
    $backX = $left + $cardW + $gap;

    $number = isset($card['number']) ? (string) $card['number'] : '';
    $name = isset($card['authorName']) ? (string) $card['authorName'] : '';
    $region = card_region_name(isset($card['authorRegion']) ? $card['authorRegion'] : '');
    $role = isset($card['authorRole']) ? (string) $card['authorRole'] : '';
    $meta = trim($region . ($role !== '' ? ' · ' . $role : ''));
    $issued = card_pdf_date(isset($card['issuedAt']) ? $card['issuedAt'] : '');
    $until = card_pdf_date(isset($card['validUntil']) ? $card['validUntil'] : '');

    /* Подписи сторон и метки реза. */
    $pdf->text($left, $top + 3.0, 7.0, 'Лицевая сторона', 'regular', '555555');
    $pdf->text($backX, $top + 3.0, 7.0, 'Оборотная сторона', 'regular', '555555');
    foreach (array($left, $backX) as $cx) {
        foreach (array($y, $y + $cardH) as $cy) {
            $pdf->line($cx - 3.0, $cy, $cx - 0.8, $cy, '999999', 0.15);
            $pdf->line($cx + $cardW + 0.8, $cy, $cx + $cardW + 3.0, $cy, '999999', 0.15);
        }
        foreach (array($cx, $cx + $cardW) as $cx2) {
            $pdf->line($cx2, $y - 3.0, $cx2, $y - 0.8, '999999', 0.15);
            $pdf->line($cx2, $y + $cardH + 0.8, $cx2, $y + $cardH + 3.0, '999999', 0.15);
        }
    }

    /* Лицевая сторона. */
    $pdf->rect($left, $y, $cardW, $cardH, '121110', null);
    $pdf->rect($left, $y + $cardH - 1.2, $cardW, 1.2, 'F26B21', null);
    $pdf->text($left + 5.0, $y + $cardH - 8.0, 7.0, 'СМЕНА КОНТЕНТА', 'bold', 'F4F2ED');
    $pdf->text($left + 5.0, $y + $cardH - 13.5, 6.5, 'Пресс-карта автора', 'regular', 'C9C5BD');
    $pdf->textBlock($left + 5.0, $y + 27.0, 12.0, $name, $cardW - 10.0, 5.0, 'bold', 'F4F2ED', 2);
    $pdf->textBlock($left + 5.0, $y + 15.0, 6.5, $meta, $cardW - 10.0, 3.2, 'regular', 'C9C5BD', 1);
    $pdf->text($left + 5.0, $y + 6.0, 6.5, '№ ' . $number, 'bold', 'F4F2ED');
    $untilText = 'до ' . $until;
    $untilWidth = $pdf->textWidth($untilText, 6.5, 'bold') * 25.4 / 72.0;
    $pdf->text($left + $cardW - 5.0 - $untilWidth, $y + 6.0, 6.5, $untilText, 'bold', 'F4F2ED');

    /* Оборотная сторона. */
    $pdf->rect($backX, $y, $cardW, $cardH, 'FFFFFF', '111111', 0.25);
    $ty = $y + $cardH - 6.0;
    $ty = $pdf->textBlock($backX + 5.0, $ty, 6.2,
        'Карта подтверждает сотрудничество с проектом «Смена контента». Не является удостоверением журналиста зарегистрированного СМИ и не даёт права на доступ на закрытые мероприятия.',
        $cardW - 10.0, 3.1, 'regular', '111111', 4);
    $ty -= 1.0;
    $pdf->text($backX + 5.0, $ty, 6.2, 'Проверка: smenakontenta.ru/verify', 'bold', '111111'); $ty -= 3.4;
    $pdf->text($backX + 5.0, $ty, 6.2, 'Номер: ' . $number, 'regular', '111111'); $ty -= 3.4;
    $pdf->text($backX + 5.0, $ty, 6.2, 'Код: ' . $verifyCode, 'bold', '111111'); $ty -= 4.2;
    $pdf->text($backX + 5.0, $ty, 6.2, 'Выдана: ' . $issued . ' · Действует до: ' . $until, 'regular', '111111');

    /* Инструкция под картами — короткая, без колонтитулов. */
    $pdf->textBlock($left, $y - 12.0, 8.0,
        'Печатайте в масштабе 100 % на плотной бумаге. Размер карты — 85,6 × 54 мм. Вырежьте обе стороны по рамке.',
        180.0, 4.2, 'regular', '333333', 2);

    return $pdf->output();
}
