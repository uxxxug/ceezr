# دليل إصلاح توصيل DEC-42/43 + نشر البيئة — 2026-10-02

> كل حكم مُسنود بدليل: commit، deploy id، نتيجة HTTP.

## الـ commits

| العنصر | القيمة |
|---|---|
| commit الإصلاح | `b3705b4a` (PR #378 · squash merge) |
| commit توثيق السجل | `4659bda3` |
| commit قبل النشر | `72bff7c9` (main قبل PR #378) |

## Render deploys

| الخدمة | deploy id | commit | status | finishedAt |
|---|---|---|---|---|
| waslah-gateway | `dep-davpqv3ncjis73fafudg` | `b3705b4` | live | 2026-10-02T12:03:57Z |
| waslah-miniapp | `dep-davpqv49v7es738o301g` | `b3705b4` | live | 2026-10-02T12:03:25Z |

## CI على main

| Workflow | Run ID | Status |
|---|---|---|
| CI | `37004393835` | success (6m28s) |
| Roadmap freshness | `37004393847` | success (20s) |
| CI (docs commit `4659bda3`) | `37005352357` | success (5m56s) |
| Roadmap freshness (docs commit) | `37005352079` | success (17s) |

## CI على الفرع (PR #378)

| Check | Status |
|---|---|
| verify | pass (1m34s) |
| تكامل على PostgreSQL حقيقي | pass (6m32s) |
| تكامل على Redis حقيقي | pass (1m47s) |
| فوضى متعدد المثيلات (F5-06) | pass (53s) |
| متصفّح حقيقي — أول رسم (F1-09 · D-25) | pass (43s) |
| متصفّح حقيقي — سطح الراكب على Slow 4G | pass (2m1s) |
| مولّد حمل موزَّع (F9-03) | pass (1m6s) |
| roadmap | pass (13s) |

## الهجرات المطبّقة (11 هجرة)

| الهجرة | البند |
|---|---|
| `20260929000000` | DEC-20 (bootstrap admin) |
| `20260930010000` | F12-21 (approval guard) |
| `20260930020000` | F12-20 (ceiling detector) |
| `20261001030000` | DEC-27 (document expiry warning) |
| `20261001200000` | DEC-37 (deduction trace) |
| `20261001210000` | DEC-39 (delete saved place) |
| `20261001220000` | DEC-40 (update saved place) |
| `20261001230000` | DEC-41 (emergency contact) |
| `20261001300000` | DEC-42 (notification prefs) |
| `20261001310000` | DEC-43 (ticket threads) |
| `20261001311000` | DEC-43 (ticket threads index — CONCURRENTLY) |

## نتائج المسارات بعد النشر (`b3705b4`)

| المسار | الطريقة | قبل | بعد |
|---|---|---|---|
| `/v1/driver/deductions` | GET | 404 | 401 |
| `/v1/me/emergency-contact` | GET | 404 | 401 |
| `/v1/me/emergency-contact` | PUT | 404 | 401 |
| `/v1/me/notification-preferences` | GET | 404 | 401 |
| `/v1/me/notification-preferences` | PUT | 404 | 401 |
| `/v1/support/tickets/:id/messages` | GET | 503 | 401 |
| `/v1/support/tickets/:id/messages` | POST | 503 | 401 |
| `/v1/driver/support/tickets/:id/messages` | GET | 503 | 401 |
| `/v1/driver/support/tickets/:id/messages` | POST | 503 | 401 |

## البوتات

| البوت | Webhook URL | pending | last_error |
|---|---|---|---|
| ODD_D_BOT (driver) | `https://waslah-gateway.onrender.com/webhook/telegram/driver` | 0 | (none) |
| ODD_R_BOT (rider) | `https://waslah-gateway.onrender.com/webhook/telegram/rider` | 0 | (none) |

## المدن

جميع المدن الخمس مفعّلة: الرياض · الطائف · المدينة المنورة · جدة · مكة.
