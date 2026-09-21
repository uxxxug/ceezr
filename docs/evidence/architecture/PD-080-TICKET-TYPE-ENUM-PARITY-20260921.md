# PD-080 — مواءمة قاموس أنواع التذاكر بين pg_enum و SUPPORT_TICKET_TYPES

**التاريخ:** 2026-09-21
**الحالة:** منفّذ `[x]` — ثلاث جولات خضراء متتاليات على `main` (`ح-4`)
**البند:** PD-080 — مواءمةُ قاموسِ أنواعِ التذاكرِ بينَ مرجعِ الدعمِ التشغيليِّ ومصفوفةِ `SUPPORT_TICKET_TYPES` المقيسةِ (فحصُ تكاملٍ يقارنُ `pg_enum` بالقائمة)
**الأولويّة:** السادسة — الاستراتيجيّة (`STR-02`..`STR-05`)

## المُدَّعى

`SUPPORT_TICKET_TYPES` في `ticket-types.ts` قائمةٌ مكتوبةٌ يدويّاً تُقابِلُ `pg_enum` في القاعدةِ. والفحوصُ القائمةُ تَتحقَّقُ من وجودِ أنواعٍ مُحدَّدةٍ لكنَّها لا تُقارنُ القائمتَينِ في كلا الاتجاهَين. فانفصالٌ صامتٌ بين القاعدةِ والشيفرةِ لا يكشفُه أحدٌ حتى يصطدمَ به راكبٌ في شاشةٍ.

## العلاج

فحصُ تكاملٍ يَقرأُ `pg_enum` ويُقارنُه بـ`SUPPORT_TICKET_TYPES` في كلا الاتجاهَين:
1. كلُّ قيمةٍ في `pg_enum` موجودةٌ في `SUPPORT_TICKET_TYPES`
2. كلُّ صنفٍ في `SUPPORT_TICKET_TYPES` موجودٌ في `pg_enum`
3. القائمتانِ متطابقتانِ في العددِ والترتيبِ

## الإنفاذ

- `tests/integration/ticket-type-enum-parity.test.ts` — ثلاث حالاتٍ على PostgreSQL حقيقي
- `scripts/lib/skip-registry.ts` — ١٣١ ملفّاً · ١٣١٠ حالةً
- `tests/unit/skip-audit.test.ts` — تحديثُ العدَدَين

## جولات CI الخضراء على main

1. `bca41be` — ROADMAP.md fix (2026-09-21)
2. `b4eff54` — PD-081 merge (2026-09-21)
3. `1c9e2f6` — PD-062 merge (2026-09-21)

## الملفّات

- `tests/integration/ticket-type-enum-parity.test.ts` (جديد)
- `scripts/lib/skip-registry.ts`
- `tests/unit/skip-audit.test.ts`
- `docs/ROADMAP-PRODUCT-DEBT.md`
- `ROADMAP.md`
