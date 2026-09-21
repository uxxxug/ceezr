# PD-081 — ربط سبب حجب المركبة بفعل إصلاحِه من موضع الحجب نفسِه

**التاريخ:** 2026-09-21
**الحالة:** منفّذ `[x]` — ثلاث جولات خضراء متتاليات على `main` (`ح-4`)
**البند:** PD-081 — ربطُ سببِ حجبِ المركبةِ بفعلِ إصلاحِهِ من موضعِ الحجبِ نفسِهِ
**الأولويّة:** السادسة — الاستراتيجيّة (`STR-02`..`STR-05`)

## المُدَّعى

عندما تُحجَبُ مركبةُ السائقِ لسببٍ معروفٍ (رخصةٌ منتهيةٌ، وثيقةٌ مرفوضةٌ)، يرى السائقُ سببَ الحجبِ في واجهةِ الطلبِ — لكن لا رابطَ منه إلى فعلِ الإصلاح. فيظهرُ قُطعٌ: «مرفوض» بلا «أصلِح».

## العلاج

`BlockLine` في `documents-view.ts` و`OfferBlockLine` في `offers-view.ts` يَحملانِ `docType` و`fixLabelKey` مُستخرَجَينِ من كودِ الحجبِ (`DriverBlockCode` + `doc_type`):
- MISSING / UNVERIFIED ← لا فعلَ إصلاحٍ مُتاحٌ (null)
- REJECTED ← رفعُ الوثيقةِ من جديدٍ (`dd__block-fix`)
- EXPIRED ← تجديدُ الوثيقةِ (`dof__block-fix`)

في شاشةِ الوثائقِ (`DocumentsScreen.tsx`): رابطُ «أصلِح» يُركِّزُ على بطاقةِ الوثيقةِ المطلوبةِ (`getElementById(docType)?.focus()`).

في شاشةِ العروضِ (`OffersScreen.tsx`): رابطُ «أصلِح» ينقلُ إلى صفحةِ الوثائقِ (`#/driver/documents#${docType}`).

## الإنفاذ

- typecheck ✓
- lint ✓
- CSS class guard ✓ (`dd__block-fix` و`dof__block-fix` في `global.css`)
- i18n: `driver.documents.block.fix` في العربية والإنجليزية والأوردو

## جولات CI الخضراء على main

1. `b4eff54` — PD-081 merge (2026-09-21)
2. `1c9e2f6` — PD-062 merge (2026-09-21)
3. `fdab41f` — [x] status update (2026-09-21)

## الملفّات

- `apps/miniapp/src/surfaces/driver/documents/documents-view.ts`
- `apps/miniapp/src/surfaces/driver/documents/DocumentsScreen.tsx`
- `apps/miniapp/src/surfaces/driver/offers/offers-view.ts`
- `apps/miniapp/src/surfaces/driver/offers/OffersScreen.tsx`
- `packages/shared/i18n/miniapp/ar.json`
- `packages/shared/i18n/miniapp/en.json`
- `packages/shared/i18n/miniapp/ur.json`
- `apps/miniapp/src/styles/global.css`
- `docs/ROADMAP-PRODUCT-DEBT.md`
- `ROADMAP.md`
