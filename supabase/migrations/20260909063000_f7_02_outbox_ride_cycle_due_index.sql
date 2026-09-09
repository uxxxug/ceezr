-- الغرض: F7-02 / CAP-005 — فهرسٌ جزئيٌّ لمُطالِبِ دورةِ الرحلةِ. بعدَ توحيدِ
--   الصندوقِ صارَ البثُّ الجماهيريُّ يسكنُ الجدولَ نفسَه، ودفعةٌ واحدةٌ تُدخِلُ
--   آلافَ صفوفٍ مُعلَّقةٍ؛ فالمُطالِبُ كانَ يمرُّ عليها كلَّها في الفهرسِ العامِّ
--   ثمَّ يُرتِّبُ. والأنواعُ الثمانيةُ في الشرطِ هيَ عينُ نطاقِ المُطالِبِ، و`created_at`
--   وحدَه عمودُ الفهرسِ لأنَّ المُطالِبَ يُرتِّبُ بهِ ويكتفي بصفٍّ واحدٍ، فالمسحُ
--   يتوقّفُ عندَ أوّلِ مُستحقٍّ ولا يفرِزُ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: claim_due_notifications
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`).
-- migration-phase: index

create index concurrently if not exists notification_outbox_ride_cycle_due_idx
  on notification_outbox (created_at)
  where status = 'pending'
    and kind in ('offer', 'dispute_resolution', 'negotiation_turn_opened',
                 'negotiation_turn_closed', 'negotiation_agreed', 'wider_circle_opened',
                 'no_driver_found', 'order_cancelled');
