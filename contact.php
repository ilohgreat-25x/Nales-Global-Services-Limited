<?php
header('Content-Type: application/json');

$raw = file_get_contents('php://stdin');
$data = json_decode($raw, true);
if (!is_array($data)) {
    $data = [];
}

$payload = isset($data['payload']) && is_array($data['payload']) ? $data['payload'] : [];
$meta = isset($data['meta']) && is_array($data['meta']) ? $data['meta'] : [];

function isSuspiciousBot($userAgent) {
    $ua = strtolower((string) $userAgent);
    $patterns = ['curl', 'python', 'wget', 'bot', 'spider', 'headless', 'scrapy'];
    foreach ($patterns as $pattern) {
        if (strpos($ua, $pattern) !== false) {
            return true;
        }
    }
    return false;
}

function containsSqlInjection($value) {
    $candidate = strtolower((string) $value);
    $patterns = [
        "select ", "union ", "insert ", "delete ", "drop ", "or 1=1",
        "--", "' or", '" or', "sleep(", "benchmark(", "information_schema"
    ];

    foreach ($patterns as $pattern) {
        if (strpos($candidate, $pattern) !== false) {
            return true;
        }
    }

    return false;
}

function sanitizeValue($value) {
    $text = trim((string) $value);
    $text = strip_tags($text);
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$reasons = [];
$blocked = false;
$sanitized = [];

$userAgent = isset($meta['ua']) ? trim((string) $meta['ua']) : '';
$referer = isset($meta['referer']) ? trim((string) $meta['referer']) : '';

if ($userAgent === '') {
    $reasons[] = 'Missing user-agent';
    $blocked = true;
}

if (isSuspiciousBot($userAgent)) {
    $reasons[] = 'Suspicious bot user-agent detected';
    $blocked = true;
}

if ($referer === '') {
    $reasons[] = 'Missing referrer header';
    $blocked = true;
}

$requiredFields = ['name', 'phone', 'service', 'message'];
foreach ($requiredFields as $field) {
    if (!isset($payload[$field]) || trim((string) $payload[$field]) === '') {
        $reasons[] = "Missing required field: {$field}";
        $blocked = true;
    }
}

foreach (['name', 'phone', 'email', 'service', 'message'] as $field) {
    $value = isset($payload[$field]) ? $payload[$field] : '';
    $sanitized[$field] = sanitizeValue($value);
    if (containsSqlInjection($sanitized[$field])) {
        $reasons[] = "SQL injection pattern detected in {$field}";
        $blocked = true;
    }
}

if ($blocked) {
    echo json_encode([
        'ok' => false,
        'blocked' => true,
        'message' => 'Request blocked by PHP security middleware.',
        'reasons' => array_unique($reasons)
    ]);
    exit;
}

echo json_encode([
    'ok' => true,
    'blocked' => false,
    'message' => 'Request accepted safely.',
    'sanitized' => $sanitized,
    'mode' => 'php-security'
]);
