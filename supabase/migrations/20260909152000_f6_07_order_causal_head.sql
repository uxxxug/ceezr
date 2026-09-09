-- الغرض: F6-07 — فهرسُ شرطِ **رأسِ الطلبِ** في المُطالِبِ. بعدَ أن صارَ الصفُّ
--   مؤهَّلاً بشرطِ «لا مُعلَّقَ مُستحقَّ أقدمَ لطلبِه» صارَ لكلِّ صفٍّ مُرشَّحٍ
--   استعلامٌ مرتبطٌ على `order_id`؛ وبلا فهرسٍ يصيرُ مسحاً متتالياً على الصادرِ
--   كلِّه في كلِّ شوطٍ. وهذا الفهرسُ يجعلُه بحثاً نقطيّاً في شجرةٍ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: claim_notification_delivery (شرطُ `not exists`)
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`)،
--   ولا تُغني عن `notification_outbox_priority_due_idx` — ذاكَ للفَرزِ وهذا
--   للحجبِ، ويعملانِ معاً في استعلامٍ واحدٍ.
-- migration-phase: index

-- ## العودة (rollback)
--
-- `drop index concurrently if exists notification_outbox_order_pending_idx;`
-- ولا تفقدُ بيانةً؛ ويبقى المُطالِبُ صحيحاً ويبطؤُ وحدَه.
--
-- ## لِمَ `(order_id, created_at, id)` بهذا الترتيبِ
--
-- الشرطُ يسألُ: «هل لهذا الطلبِ مُعلَّقٌ مُستحقٌّ سابقٌ في `(created_at, id)`؟»
-- فالبادئةُ `order_id` تقصُرُ البحثَ على الطلبِ، والعمودانِ بعدَها يجعلانِ
-- المقارنةَ نطاقاً في الشجرةِ لا ترشيحاً بعدَ القراءةِ. و`id` ثانيَ الفرزِ لأنَّ
-- `created_at` قد يتساوى في إيداعٍ واحدٍ، والتتابعُ يجبُ أن يكونَ كُلّيّاً وإلّا
-- حجبَ صفّانِ متساويانِ أحدُهما الآخرَ فتوقّفَ الطلبُ (`deadlock` منطقيٌّ).

create index concurrently if not exists notification_outbox_order_pending_idx
  on notification_outbox (order_id, created_at, id)
  where status = 'pending' and order_id is not null;
