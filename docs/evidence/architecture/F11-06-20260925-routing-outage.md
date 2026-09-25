# F11-06 (الشقُّ المملوكُ للمستودَعِ) — عطلُ مزوّدِ الخرائطِ محقوناً على السِلكِ

**التاريخ**: 2026-09-25 · **الفرعُ**: `feat/f11-06-routing-outage-honest-eta` من `main`@`7d7d580` · **القرارُ**: `ADR 0192`

## المقيسُ قبلَ التغييرِ

- `packages/application/tracking/estimate-arrival.ts`: كلُّ عطلٍ عدا `no_route` ⇒ `PROVIDER_DOWN`، مُختبَرٌ بمزوّدٍ مُزيَّفٍ فقط.
- لا اختبارَ يُطفِئُ خادمَ توجيهٍ حقيقيّاً تحتَ رحلةٍ نشطةٍ ويقرأُ `GET /v1/rides/:id`.

## اكتشافٌ في أوّلِ تشغيلٍ

الأطوارُ متتابعةً في تركيبٍ واحدٍ: `stopped` 0 طلباتٍ · `hanging` 1 · `server_error` 2 · **`malformed` 0** — القاطعُ
(`failureThreshold` 5) فُتِحَ فلم يُحقَنِ الطورُ الأخيرُ؛ وقراءةُ التعافي فورَ عودةِ المزوّدِ `UNAVAILABLE` بصفرِ طلباتٍ. السلوكُ
صادقٌ (المدّةُ مُخفاةٌ بالسببِ الصحيحِ) لكنَّ القياسَ كانَ أعمى — فصارَ كلُّ طورٍ في تركيبٍ جديدٍ، والقاعدةُ `outage.injected`،
والتعافي يُقاسُ عبرَ مهلةِ القاطعِ.

## القياسُ المحلّيُّ (PostgreSQL 18 + PostGIS)

| الطورُ | HTTP | المدّةُ | الزمنُ | طلباتُ السِلكِ | الاقتباسُ | النبضةُ |
|---|---|---|---|---|---|---|
| `stopped` | 200 | `UNAVAILABLE/PROVIDER_DOWN` | 153ms | 0 (رفضُ اتصالٍ) | 200 · `PROVIDER_DOWN` | 200 |
| `hanging` | 200 | `UNAVAILABLE/PROVIDER_DOWN` | 3002ms (سقفٌ 4500) | 1 | 200 · `PROVIDER_DOWN` | 200 |
| `server_error` | 200 | `UNAVAILABLE/PROVIDER_DOWN` | 152ms | 2 (إعادةُ محاولةٍ) | 200 · `PROVIDER_DOWN` | 200 |
| `malformed` | 200 | `UNAVAILABLE/PROVIDER_DOWN` | 1ms | 1 (لا يُعادُ) | 200 · `PROVIDER_DOWN` | 200 |
| `quota_exhausted` | 200 | `UNAVAILABLE/PROVIDER_DOWN` | — | 0 | — | — |
| قاطعٌ مفتوحٌ | 200 | `UNAVAILABLE/PROVIDER_DOWN` | — | 0 | — | — |
| بعدَ 10254ms | 200 | `ROUTED` | — | 1 (مِسبارٌ) | — | — |

الرحلةُ (المعرِّفُ · الحالةُ · الطورُ · السائقُ · إظهارُ الموقعِ) مطابقةٌ لخطِّ الأساسِ في كلِّ طورٍ، وصفُّ `orders` بقيَ `in_progress`.

- `bun test tests/integration/routing-provider-outage.test.ts`: 6 pass · 0 fail.
- `bun test tests/unit/routing-outage-judge.test.ts`: 15 pass · 0 fail.
- حكمُ CI يُسجَّلُ في `ROADMAP.md` بعدَ الدفعِ (الأخضرُ المحلّيُّ ليسَ بديلاً).

## ما لا يُدَّعى

`F11-06` يبقى `[ ]`: البندُ في القسمِ الحادي عشرَ يُقصَدُ به أثناءَ الحملِ وعلى بيئةٍ شبيهةٍ بالإنتاجِ ومزوّدٍ حقيقيٍّ (`REQ-09` `[!]`).
