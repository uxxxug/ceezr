# ECO-004 — مواردُ الرحلةِ مقيسةٌ على السِلكِ (الزيادةُ الأولى)

**التاريخ:** 2026-09-20
**البند:** `ECO-004` (القسمُ 17 — اقتصادُ التشغيلِ)
**الفرعُ:** `feat/eco-004-resource-usage-budget`
**الحاكمُ:** `ADR 0153`

## ١. المقيسُ

خمسةُ أسطحِ مواردَ تُقاسُ في رحلةٍ واحدةٍ على السِلكِ من بوّابةٍ مُركَّبةٍ بـ
`buildContainer` على قاعدةِ `PostgreSQL` حقيقيّةٍ (صورةُ `postgis/postgis:17-3.5`)
وعميلِ `Redis` مُحقونٍ معدودٍ:

| السطحُ | المقيسُ | وحدّةُ القياسِ | السقفُ المُشتَقُّ |
|---|---|---|---|
| القاعدةُ | صفوفٌ ممسوحةٌ | `tup_returned + tup_fetched` من `pg_stat_database` | `(activeReadCount + lifecycleTransitionCount) × 2 + 8 = 34` |
| القاعدةُ | كُتَلٌ ملموسةٌ | `blks_read + blks_hit` من `pg_stat_database` | `ceil(34 × 1.2) = 41` |
| الطابورُ | رسائلُ مُنتَجةٌ | `notification_outbox` + `order_offers` | `lifecycleTransitionCount + 2 = 7` |
| Redis | أوامرُ منفَّذةٌ | عميلٌ مُحقونٌ يَعُدُّ | `(heartbeatCount + activeReadCount + lifecycleTransitionCount + 2) × 2 + 10 = 160` |
| النقلُ الشبكيُّ | بايتاتُ ردودِ `HTTP` | `TextEncoder().encode(body).byteLength` | `512 × 1024 = 524288` |
| التخزينُ | صفوفٌ مُدخَلةٌ | عدُّ الصفوفِ في `orders` | `lifecycleTransitionCount × 4 = 20` |

## ٢. الحَكَمُ النقيُّ

`scripts/lib/resource-usage-budget.ts` — تسعُ قواعدَ حكمٍ، كلُّ واحدةٍ لها سالبةٌ
مبذورةٌ (`ح-7`):

1. `facts.measured` — قياسٌ لم يجرِ لا يُقرأُ أخضرَ.
2. `counts.sane` — أعدادٌ غيرُ صحيحةٍ أو سالبةٌ تُبطِلُ كلَّ ما بعدَها.
3. `database.within-budget` — الصفوفُ والكُتَلُ ضمنَ السقفِ.
4. `queue.within-budget` — رسائلُ الطابورِ ضمنَ السقفِ.
5. `redis.within-budget` — أوامرُ `Redis` ضمنَ السقفِ.
6. `network.within-budget` — بايتاتُ النقلِ ضمنَ السقفِ.
7. `storage.within-budget` — الصفوفُ المُدخَلةُ ضمنَ السقفِ.
8. `budget.derived` — السقوفُ مُشتَقَّةٌ من الشكلِ لا مكتوبةٌ رقماً.
9. `window.declared` — نافذةُ القياسِ هيَ المُعلَنةُ.

## ٣. الحاجزُ الساكنُ

`scripts/check-resource-usage-budget.ts` — عشرُ قواعدَ حاجزٍ، كلُّ واحدةٍ لها
سالبٌ مبذورٌ (`ح-7`):

1. `guard.measurement-present` — ملفُّ القياسِ موجودٌ.
2. `guard.judge-imported` — الحَكَمُ يُستورَدُ من `scripts/lib/`.
3. `guard.database-measured` — `pg_stat_database` يُقرأُ.
4. `guard.queue-measured` — `notification_outbox` يُعَدُّ.
5. `guard.redis-instrumented` — `Redis` مُحقونٌ ومعدودٌ.
6. `guard.network-measured` — بايتاتُ الردودِ تُقاسُ.
7. `guard.storage-measured` — الصفوفُ المُدخَلةُ تُعَدُّ.
8. `guard.assertion-intact` — التأكيدُ لم يُفرَّغْ.
9. `guard.budget-sane` — السقوفُ والشكلُ عقلانيّانِ.
10. `guard.self-enforced` — الحاجزُ موصولٌ في سلسلةِ `ci`.

## ٤. الوصلُ في CI

- سلسلةُ `ci` في `package.json` — حلقةٌ جديدةٌ `check-resource-usage-budget`.
- خطواتٌ مُسمّاتٌ في وظيفةِ `verify` في `.github/workflows/ci.yml`.
- خطوةٌ في وظيفةِ «تكامل على PostgreSQL حقيقي» تشغِّلُ اختبارَ التكاملِ.

## ٥. ما لا يُدَّعى (`ح-5`)

- **لا تُقاسُ النسخُ (Replication)**: `WAL`/`LSN` غيرُ مستقرٍّ في CI.
- **لا تُحسَبُ تكلفةٌ بالمالِ**: السعرُ في فاتورةِ مزوّدِ سحابةٍ (`REQ-09`).
- **لا يُقاسُ سلوكُ مستخدمينَ حقيقيّينَ**: شكلُ النافذةِ مُعلَنٌ (`ADR 0099`).
- **لا يُقاسُ `CDN` ولا `WAF` ولا `TLS`**: خارجُ نطاقِ الشيفرةِ.
- **`ECO-004` يبقى `[ ]`**: العددُ مُنفَّذٌ محروسٌ والسعرُ عملُ المالكِ.
- **لا `[x]` قبلَ ثلاثِ جولاتٍ خضراءَ على `main` (`ح-4`)**.
