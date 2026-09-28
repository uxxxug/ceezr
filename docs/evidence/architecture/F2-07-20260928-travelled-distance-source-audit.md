# F2-07 — تدقيقُ اكتمالِ مصدرِ المسافةِ المقطوعةِ قبلَ `ADR 0208` (2026-09-28)

- **النوعُ**: قراءةُ شيفرةٍ على `main`@`3dc74f19` — لا تغييرَ شيفرةٍ ولا مخطّطٍ.
- **النتيجةُ**: الكاتبانِ الإنتاجيّانِ يُلحِقانِ في `driver_location_history`؛ لكنَّ المسارَ المؤجَّلَ
  يُسقِطُ المقبولَ المُزاحَ داخلَ دورةِ الإفراغِ ⇒ `D-38`.

## ١) المساراتُ

| الموضعُ | ما يفعلُ |
|---|---|
| `packages/application/geo/update-driver-location.ts` | `persistence = "direct"` افتراضاً؛ يصيرُ `"deferred"` إذا وُصِلَت الحالةُ الساخنةُ وردَّت `queued` والسائقُ `hasLocation` |
| `packages/infrastructure/identity/directories.ts` → `updateLocation` | CTE `written` ثمَّ `appended` يُدرِجُ `source = 'direct'` |
| `supabase/migrations/20260910200000_f4_05_last_location_at_is_acceptance_time.sql` (آخرُ تعريفٍ لـ`persist_driver_location_batch`) | `appended` من `written` · `source = 'batch'` |
| `packages/infrastructure/geo/redis-driver-location-hot-state.ts:96` | `HSET pending member payload` — حقلٌ واحدٌ لكلِّ سائقٍ يُكتَبُ فوقَه |
| `apps/gateway/src/container.ts:815` · `render.yaml` (`UPSTASH_REDIS_REST_*`) | الحالةُ الساخنةُ موصولةٌ في الإنتاجِ ⇒ المسارُ السويُّ مؤجَّلٌ |
| `20260909140000_f4_02_driver_location_hot_state.sql` | `driver_location_flush_interval_seconds` = 10 · `driver_location_hot_ttl_seconds` = 120 |

والإثباتُ على قاعدةٍ حقيقيّةٍ قائمٌ للإلحاقِ في المسارَينِ (`tests/integration/location-history-partitions.test.ts`
١–٣)، ولتنقيةِ الدفعةِ إلى الأحدثِ (`tests/integration/driver-location-batch-persist.test.ts`).

## ٢) ما يُستنتَجُ

- ظنُّ أنَّ المسارَ المباشرَ لا يُلحِقُ **غيرُ صحيحٍ** على `main`: يُلحِقُ ومُختبَرٌ.
- الناقصُ في المسارِ المؤجَّلِ: نبضاتٌ مقبولةٌ تُزاحُ في `pending` قبلَ الإفراغِ فلا تبلغُ الأثرَ. فالأثرُ
  نقطةٌ لكلِّ ~10s لكلِّ سائقٍ في المسارِ السويِّ، وكلُّ نبضةٍ عندَ تدهوُّرِ Redis.
- لذلكَ `ADR 0208` §٨ يجعلُ `D-38` شرطاً سابقاً للتنفيذِ.
