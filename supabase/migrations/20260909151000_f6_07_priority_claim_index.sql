-- الغرض: F6-07 — فهرسُ المُطالِبِ بترتيبِه الجديدِ. بعدَ أن صارَ الترتيبُ
--   `(notification_kind_priority(kind), created_at)` صارَ فهرسُ `F7-02`
--   (`notification_outbox_ride_cycle_due_idx` على `created_at` وحدَه) يُخدِمُ
--   المسحَ لا الفَرزَ: يُقرأُ مُرتَّباً بالأقدميّةِ ثمَّ يُفرَزُ كلُّ المُعلَّقِ
--   بالرتبةِ، وذلكَ فَرزٌ على دفعةِ بثٍّ من آلافِ الصفوفِ في كلِّ شوطٍ. فهذا
--   الفهرسُ يُعيدُ إلى المُطالِبِ خاصّيّتَه الأولى: **يتوقّفُ عندَ أوّلِ صفٍّ**.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: claim_notification_delivery
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`)،
--   ولا تُسقِطُ فهرسَ `F7-02` — إسقاطُه قرارٌ يحتاجُ قياسَ خُطَطٍ على حجمِ إنتاجٍ
--   وهوَ دَينٌ مُعلَنٌ في `docs/adr/0071-traffic-priority-classes.md` §٧، لا
--   إسقاطاً بالظنِّ في هجرةٍ.
-- migration-phase: index

-- ## العودة (rollback)
--
-- `drop index concurrently if exists notification_outbox_priority_due_idx;`
-- ولا تفقدُ بيانةً؛ ويعودُ المُطالِبُ يفرزُ لا يمسحُ فيبطؤُ ولا يُخطئُ. ويجبُ أن
-- يقعَ **قبلَ** إسقاطِ `notification_kind_priority(text)` لأنَّ الفهرسَ يعتمدُها.
--
-- ## الشرطُ الجزئيُّ عينُ نطاقِ المُطالِبِ
--
-- الأنواعُ الثمانيةُ في الشرطِ هيَ `v_ride_kinds` نفسُها، و`status = 'pending'`
-- شرطُه نفسُه. ولا يُدخَلُ `next_attempt_at` عموداً مفهرَساً لأنَّ المُطالِبَ
-- يُرشِّحُ بِه ولا يُرتِّبُ، والترشيحُ على صفوفٍ قليلةٍ بعدَ التوقّفِ عندَ أوّلِ
-- مُستحقٍّ أرخصُ من عمودِ فهرسٍ ثالثٍ يُكتَبُ في كلِّ إيداعٍ ومحاولةٍ.

create index concurrently if not exists notification_outbox_priority_due_idx
  on notification_outbox (notification_kind_priority(kind), created_at)
  where status = 'pending'
    and kind in ('offer', 'dispute_resolution', 'negotiation_turn_opened',
                 'negotiation_turn_closed', 'negotiation_agreed', 'wider_circle_opened',
                 'no_driver_found', 'order_cancelled');
