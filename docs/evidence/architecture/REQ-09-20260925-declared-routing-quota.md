# REQ-09 (الشقُّ المملوكُ للمستودَعِ) — حدُّ معدّلِ التوجيهِ المُعلَنُ مفروضٌ قبلَ الطلبِ

**التاريخ**: 2026-09-25 · **الفرعُ**: `feat/req-09-declared-routing-quota` من `main`@`f7484d5` · **القرارُ**: `ADR 0190`

## المقيسُ قبلَ التغييرِ

- `packages/maps/providers/osrm/osrm-provider.ts`: لا موضعَ لحدٍّ؛ الحدُّ يُعرَفُ بـ`429` بعدَ الطلبِ.
- `packages/shared/config/index.ts`: لا مفتاحَ لحدِّ الحسابِ؛ `render.yaml`/`.env.example` لا يُعلِنانِه.

## التغييرُ

| الموضعُ | ما تغيّرَ |
|---|---|
| `packages/shared/config/index.ts` | `ROUTING_RATE_LIMIT` → `routingRateLimit` · `parseRoutingRateLimit` · رفضُ الإنتاجِ بلا حدٍّ معَ مزوّدٍ |
| `packages/maps/core/routing-provider.ts` | الصنفُ `quota_exhausted` · منفذُ `RoutingQuota` · `ROUTING_QUOTA_KEY` |
| `packages/maps/providers/osrm/osrm-provider.ts` | `quota` يُستشارُ قبلَ كلِّ طلبِ HTTP |
| `apps/gateway/src/container.ts` | `routingQuota()`: `Redis` متى وُجِدَ وإلّا الذاكرةُ؛ تحتَ `CachedRoutingProvider` |
| `render.yaml` (3 خدماتٍ) · `.env.example` | إعلانُ `ROUTING_RATE_LIMIT` (`sync: false`) |

## القياسُ المحلّيُّ

- `bun test tests/unit/routing-declared-quota.test.ts`: 12 pass · 0 fail.
- `bun test tests/unit`: 5,611 pass · 0 fail (347 ملفّاً).
- `bun run typecheck` نظيفٌ · `bun scripts/check-env-drift.ts`: لا انحرافَ.
- حكمُ CI يُسجَّلُ في `ROADMAP.md` بعدَ الدفعِ (الأخضرُ المحلّيُّ ليسَ بديلاً).

## ما لا يُدَّعى

`REQ-09` يبقى `[!]`: الحسابُ والحدُّ الحقيقيُّ والسعرُ والفاتورةُ قرارُ المالكِ. المتبقّي له: فتحُ الحسابِ، ونقلُ حدِّه إلى
`ROUTING_RATE_LIMIT` في بيئةِ النشرِ، وسعرُه إلى مُدخَلاتِ `ECO-004`/`ECO-008` (`ADR 0154`).
