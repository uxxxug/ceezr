# PD-082 — مبرر الحل ظاهر من لوحة العمل

**التاريخ:** 2026-09-21
**الحالة:** منفّذ `[x]` — ثلاث جولات خضراء متتاليات على `main` (`ح-4`)
**البند:** PD-082 — «قصةُ حالةٍ» كاملةٌ للمشغِّلِ في مراجعةِ النزاعِ (مبرِّرُ الحلِّ ظاهرٌ من لوحةِ العملِ بلا رجوعٍ إلى قروب)
**الأولويّة:** السادسة — الاستراتيجيّة (`STR-02`..`STR-05`)

## المُدَّعى

`listDisputes` في لوحةِ الإدارةِ تَعرضُ التذكرةَ وحالتَها ونصَّها ومستلِمَها — لكن لا تَعرضُ مَن حلَّها ولا متى ولا مبرِّرَ الحلِّ. الأعمدةُ `resolved_by_user_id` و`resolved_at` و`resolution` موجودةٌ في القاعدةِ منذُ المرحلةِ 2.4 لكنَّها لا تُقرَأُ في اللوحةِ. المشغِّلُ يُضطَّرُ للرجوعِ إلى قروبِ الدعمِ لمعرفةِ لماذا حُسِمَتِ التذكرةُ هكذا.

## العلاج

- `DisputeRow` يُضافُ إليه `resolvedByName` و`resolvedAt` و`resolutionNote`
- استعلامُ `listDisputes` يُضافُ إليه `left join users ru2 on ru2.id = t.resolved_by_user_id` وقراءةُ `t.resolution`
- عمودُ «الحلّ» في جدولِ النزاعاتِ يَعرضُ الاسمَ والوقتَ والمبرِّرَ

## الإنفاذ

- typecheck ✓
- lint ✓ (32 warnings, 0 errors)
- `admin-dashboard.test.ts` ✓ (29 pass)
- قراءةٌ فقط — لا مسارَ حسمٍ جديدٌ

## جولات CI الخضراء على main

1. `bca41be` — ROADMAP.md fix (2026-09-21)
2. `b4eff54` — PD-081 merge (2026-09-21)
3. `1c9e2f6` — PD-062 merge (2026-09-21)

## الملفّات

- `apps/admin-dashboard/src/pages/disputes.ts`
- `apps/gateway/src/admin/queries.ts`
- `tests/unit/admin-dashboard.test.ts`
- `docs/ROADMAP-PRODUCT-DEBT.md`
- `ROADMAP.md`
