# دليلُ F12-21 — منعُ ناقصِ الوثائقِ من الاعتمادِ (2026-09-30)

## المرجعُ
- البندُ: `F12-21` في `ROADMAP-MASTER.md` §F12
- القرارُ: `DEC-23` · `ADR 0215`
- الهجرةُ: `supabase/migrations/20260930010000_f12_21_approval_guard.sql`
- الاختبارُ: `tests/integration/driver-documents-approval-guard.test.ts`

## ما نُفِّذ

حارسٌ في `admin_set_driver_verification`: حينَ يطلبُ المسؤولُ `verified` تُستدعَى
`driver_document_block_reasons` فإن أعادَت أسباباً يُرفَضُ الطلبُ برمزٍ
`INCOMPLETE_DOCUMENTS` والقائمةُ في الحمولةِ.

## القياسُ

٦ حالاتِ تكاملٍ على PostgreSQL حقيقيّةٍ:

1. رفضُ `verified` بلا وثائقَ → `INCOMPLETE_DOCUMENTS` + قائمةُ الأسباب
2. قبولُ `suspended` بلا وثائقَ (التعليقُ لا يشترطُ وثائقَ)
3. قبولُ `rejected` بلا وثائقَ (الرفضُ لا يشترطُ وثائقَ)
4. رفضُ `verified` بوثائقَ ناقصةٍ (واحدةٌ مفقودةٌ)
5. قبولُ `verified` حينَ كلُّ الوثائقِ مقبولةٌ وغيرُ منتهيةٍ
6. رفضُ `verified` حينَ تنتهي صلاحيّةُ وثيقةٍ

## ما لا يُدَّعى

- لا قياسٌ إنتاجيٌّ (`ح-5`): لا نشرَ staging ولا مستخدمَ حقيقيّاً.
- لا مساسٌ بمسارِ العرضِ: `driver_document_block_reasons` في `open_offer_round` كما هو.
