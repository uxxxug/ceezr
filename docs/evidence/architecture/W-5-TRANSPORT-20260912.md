# دليلُ ناقلِ أحداثِ CORE في الاتّجاهَينِ — `W-5` (2026-09-12)

- **البندُ**: `W-5` «Consume `core.fulfillment.created`; produce `move.job.completed` through a transactional outbox with the canonical event envelope».
- **الدرجةُ المُدَّعاةُ**: `مُختبَرٌ` للناقلِ والبابِ وشوطِ التصريفِ. **وليسَ** `مُتحقَّقٌ منه`، ولا `[x]` للبندِ: تثبيتُ المخطّطِ ما زالَ محجوباً بـ`DEP-CORE-006`/`O-1`، ولم يُقَسْ تسليمٌ إلى بيئةِ CORE حقيقيّةٍ (`DEP-CORE-007`).
- **القرارُ الحاكمُ**: [ADR-0082](../../adr/0082-core-event-transport-both-directions.md) · يبني على [ADR-0081](../../adr/0081-operational-job-and-core-event-boundary.md).
- **الفرعُ**: `feat/w4-w5-operational-job-and-core-lifecycle`.
- **ما فتحَ هذا العملَ**: إغلاقُ `DEP-CORE-001` في CORE — بابٌ شبكيٌّ يقبلُ `move.job.*` (`d2c38e3`، وقُرِئَ عندَ `1231817757446560a0ecd061bd9c4f3a2a1c9fe4`، 2026-09-11 22:06:48 +0000).

## ما نُفِّذَ

| الطبقةُ | الملفُّ | ما فيه |
|---|---|---|
| عقودٌ منقولةٌ | `docs/contracts/core/transport/core-v1.yaml` (`4c6cfc16…`) · `transport/outbound-delivery.md` (`eec712a9…`) | عقدُ النقلِ من CORE@`1231817` حرفاً، ببصمتَيهما في `PROVENANCE.md` |
| إعدادٌ | `packages/shared/config/core-event-transport.ts` | المسارُ والترويسُ وصيغةُ التوقيعِ والمهلةُ وحدُّ البايتاتِ وحدُّ طولِ السرِّ، و`classifyCoreSubmitStatus` مصدراً وحيداً لقراءةِ رمزِ الردِّ |
| بنيةٌ (صاعدٌ) | `packages/infrastructure/wasla/core-event-shipper.ts` | `POST {baseUrl}/v1/events` بحاملٍ ومهلةٍ بـ`AbortController`؛ يُصنِّفُ الشبكةَ والمهلةَ عابراً، و`accepted:false` عابراً، و`event_id` مخالفاً **دائماً** |
| بوّابةٌ (هابطٌ) | `apps/gateway/src/routes/core-event-intake.ts` | `/webhook/core-events`: حدُّ بايتاتٍ، ثمَّ `HMAC` على البايتاتِ عينِها بـ`timingSafeEqual` **قبلَ** التحليلِ، ثمَّ رموزُ ردٍّ تُقرأُ حكمَ إعادةٍ عندَ CORE |
| توصيلٌ | `apps/gateway/src/index.ts` | المسارُ لا يُركَّبُ ألبتّةَ بلا سرٍّ — غيابٌ يُقرأُ `404` لا قَبولاً كاذباً |
| تطبيقٌ | `packages/application/wasla/ship-due-move-events.ts` | شوطٌ بسقفٍ، يتوقّفُ عندَ عطلِ بابٍ ولا يتوقّفُ عندَ إخفاقِ تسليمٍ |
| عاملٌ | `apps/workers/src/container.ts` | مهمّةُ `ship-move-events` كلَّ 15 ثانيةً، لا تُسجَّلُ بلا عنوانٍ ورمزٍ ويُكتَبُ الغيابُ سطراً في السجلِّ |
| هجرةٌ | `supabase/migrations/20260912000000_w5_permanent_delivery_failure.sql` | `abandon_move_event_delivery` خمسيَّةً بـ`p_permanent` — موتٌ من المحاولةِ الأولى للرفضِ الدائمِ · طورُ `switch` · مُعلَنةٌ في سجلِّ مساراتِ العودةِ |
| حاجزٌ | `scripts/check-core-contract-parity.ts` (وُسِّعَ) | يُقابِلُ المسارَ ورمزَ القبولِ وحقولَ الإيصالِ والترويسَينِ وصيغةَ التوقيعِ وحدَّ الطولِ، **ويقرأُ جدولَ الإعادةِ من الملفِّ المنقولِ** فيُقابِلُ كلَّ سطرٍ بحكمِ التصنيفِ |
| حاجزٌ جديدٌ | `scripts/check-vendored-contract-integrity.ts` | يُعيدُ حسابَ كلِّ بصمةٍ ويُخفِقُ على أوّلِ بايتٍ يختلفُ، أو ملفٍّ بلا بصمةٍ، أو بصمةٍ بلا ملفٍّ — في `bun run ci` وفي `.github/workflows/ci.yml` |
| بيئةٌ | `.env.example` · `render.yaml` | `CORE_EVENTS_BASE_URL` · `CORE_EVENTS_BEARER_TOKEN` (العاملُ) · `CORE_INBOUND_SIGNING_SECRET` (البوّابةُ) — و`check-env-drift` أخضرُ |

## العطلُ الذي وُجِدَ في دليلٍ سابقٍ وأُصلِحَ في أصلِه

دعوى `PROVENANCE.md` أنَّ المخطَّطاتِ منقولةٌ **حرفاً**، وقد أعادَ `biome` تنسيقَ ملفَّينِ منها (`core.fulfillment.created.v1`, `move.job.completed.v1`) فبطلَت بصمتاهما وبقيَت الدعوى مكتوبةً: **دليلٌ كاذبٌ**. ولم يُمحَ الدليلُ السابقُ بل صُحِّحَ بالإضافةِ: أُعيدَت البايتاتُ من CORE@`511624b`، واستُثنيَ `docs/contracts` من المُنسِّقِ، وأُضيفَ الحاجزُ أعلاهُ، وكُتِبَ في `PROVENANCE.md` قسمٌ يشرحُ الخرقَ وحرسَه.

## القياسُ المحلّيُّ

بيئةُ القياسِ: PostgreSQL 18.6 + PostGIS 3.6.2 محلّيّةٌ على المنفذِ 5433، الهجراتُ مطبَّقةٌ بـ`scripts/migrate.ts`، bun 1.4.2.

```
bun test tests/unit/core-event-shipper.test.ts            → 23 pass · 0 fail
bun test tests/unit/gateway-core-event-intake.test.ts     → 16 pass · 0 fail
bun test tests/unit/ship-due-move-events.test.ts          →  5 pass · 0 fail
bun test tests/unit/check-vendored-contract-integrity.test.ts →  6 pass · 0 fail
bun test tests/unit                                       → 2614 pass · 0 fail (174 ملفّاً)

TEST_DATABASE_URL=… bun test tests/integration/wasla-core-transport.test.ts
  → 7 pass · 0 fail · 44 توقُّعاً
TEST_DATABASE_URL=… bun test tests/integration/wasla-fulfillment-lifecycle.test.ts
  → 35 pass · 0 fail · 204 توقُّعاً
TEST_DATABASE_URL=… bun test tests/integration/scheduled-jobs.test.ts (لتسجيلِ المهمّةِ الجديدةِ)
  → داخلَ جريَةٍ من ثلاثةِ ملفّاتٍ: 50 pass · 0 fail

bunx tsc --noEmit            → لا خطأَ
bunx biome check .           → لا مخالفةَ
scripts/check-vendored-contract-integrity.ts → 8 ملفّاً، كلُّ بصمةٍ مُطابِقةٌ
scripts/check-core-contract-parity.ts        → أخضرُ
scripts/check-migration-safety.ts            → 101 هجرةً، 23 مُحاكَمةً بالقواعدِ الستِّ
scripts/check-env-drift.ts                   → أخضرُ
scripts/check-rollback-safety.ts             → أخضرُ
scripts/check-migrations.ts                  → **يُخفِقُ** بثلاثِ مخالفاتٍ للقاعدةِ 0.4 (`DEP-CORE-006`) — لم يُضعَّف ولم يُستثنَ
```

**والأخضرُ المحلّيُّ ليسَ حكماً** (`ح-8` · §0.6): حكمُ CI الفعليُّ مكتوبٌ في جدولِ أحكامِ CI في `ROADMAP.md`.

## ما يُقاسُ وما لا يُقاسُ — بصراحةٍ

- **يُقاسُ**: مطابقتُنا لعقدِ CORE **المكتوبِ**؛ وأثرُ الطريقَينِ في قاعدةٍ حقيقيّةٍ؛ وأنَّ بايتاً مُبدَّلاً في الطريقِ يُردُّ `401` ولا يُقيَّدُ ولا يُنشئُ مهمّةً؛ وأنَّ إعادةَ التسليمِ لا تُنشئُ مهمّةً ثانيةً؛ وأنَّ إعادةَ الإيداعِ بعدَ انقطاعٍ تُقرأُ `first_delivery=false` نجاحاً فيُغلَقُ الصفُّ مرّةً واحدةً.
- **لا يُقاسُ**: أنَّ CORE الحقيقيَّ قَبِلَ. نظيرُ CORE في الاختبارِ `fetch` مزدوجٌ يُطبِّقُ عقدَه المنقولَ. وهذا مسجَّلٌ `DEP-CORE-007` ولا يُقرأُ إنجازاً.

## ما يبقى محجوباً

| # | الحجبُ | مالكُه |
|---|---|---|
| `DEP-CORE-006` · `O-1` | لا مدينةَ ولا جغرافيا في `core.fulfillment.created` | مالكُ CORE أو ملحقٌ حاكمٌ |
| `DEP-CORE-007` | لا بيئةَ CORE مشتركةً ولا رمزَ خدمةٍ لـMOVE | مالكُ CORE |
| `O-3` | إصدارُ رمزِ حاملٍ لخدمةِ MOVE وزرعُه في العاملِ | المُشغِّلُ |
| `O-4` | إنشاءُ `event_subscription` في CORE على `https://<gateway>/webhook/core-events` بسرٍّ ≥ 32 محرفاً | المُشغِّلُ |
| `O-2` | سرّا Upstash لوظيفةِ Redis الحقيقيّةِ | المُشغِّلُ |
