-- =============================================================================
-- migration-phase: contract
-- الغرض: `PD-021` — طورُ `contract`: توسيعُ قيدِ الأنواعِ وبذرُ السياسةِ.
--   القيدُ الجديدُ مجموعةٌ فائقةٌ تحوي القديمَ كلَّهُ زائدَ نوعَينِ،
--   فلا صفَّ يُرفَضُ ولا بياناتَ تُفقَدُ. والتوثيقُ في طورِ `validate` تالٍ.
--
--   ١) توسيعُ قيدِ `notification_outbox_kind_check` بنوعَيِ المآلِ العامِّ.
--   ٢) رتبةُ المرورِ للنوعَينِ الجديدَينِ — متوسّطةٌ (٣): إشعارُ مآلٍ للمُبلِّغِ
--      ذو قيمةٍ زمنيّةٍ لا استغاثةٌ ولا حالةَ رحلةٍ.
--   ٣) بذرُ سياسةِ الأنواعِ الجديدةِ — قناةٌ حرجةٌ عبرَ تلغرام.
-- =============================================================================
-- الحالة: منفّذ فعلياً — البند `PD-021`.
-- ينتمي إلى: supabase/migrations
-- يحرسه: tests/integration/safety-sos.test.ts · scripts/check-notification-classification.ts
--   · scripts/check-traffic-priority.ts · scripts/check-migration-safety.ts
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) توسيعُ قيدِ `notification_outbox_kind_check` بنوعَيِ المآلِ العامِّ.
--    القيدُ الجديدُ مجموعةٌ فائقةٌ تحوي القديمَ كلَّهُ زائدَ نوعَينِ،
--    فلا صفَّ يُرفَضُ ولا بياناتَ تُفقَدُ. والتوثيقُ في طورِ `validate` تالٍ.
-- ---------------------------------------------------------------------------
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'safety_incident', 'subscription_notice', 'broadcast_recipient',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked'
  )) not valid;

-- ---------------------------------------------------------------------------
-- ٢) رتبةُ المرورِ للنوعَينِ الجديدَينِ — `medium` (٣): إشعارُ مآلٍ للمُبلِّغِ
--    ذو قيمةٍ زمنيّةٍ (رُوجِعَ بلاغُكَ) لا استغاثةٌ ولا حالةَ رحلةٍ ولا مطالبةَ
--    إسنادٍ. والدالّةُ تُعادُ بزيادةِ فرعَينِ للنوعَينِ الجديدَينِ وحدَهما.
-- ---------------------------------------------------------------------------
create or replace function notification_kind_priority(p_kind text)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case p_kind
    -- ١ = حرجٌ: استغاثةٌ، وحالةُ رحلةٍ نشطةٍ، ومطالبةُ إسنادٍ لها مؤقّتٌ يجري.
    when 'safety_incident' then 1
    when 'order_cancelled' then 1
    when 'negotiation_turn_opened' then 1
    when 'negotiation_turn_closed' then 1
    when 'negotiation_agreed' then 1
    -- ٢ = مرتفعٌ: تسليمُ العروضِ وتوسيعُ الدائرةِ — خطواتُ الإسنادِ نفسِه.
    when 'offer' then 2
    when 'wider_circle_opened' then 2
    -- ٣ = متوسّطٌ: أخبارُ نتيجةٍ وتحديثاتُ دعمٍ وإشعاراتٌ عاديّةٌ. وإشعارُ مآلِ
    --    السلامةِ تحديثٌ ذو قيمةٍ زمنيّةٍ، لكنَّهُ ليسَ في تتابعٍ سببيٍّ مع دورةِ
    --    الرحلةِ ولا مؤقّتَ يستهلكُه التأخيرُ — فهو متوسّطٌ لا مرتفعٌ.
    when 'no_driver_found' then 3
    when 'dispute_resolution' then 3
    when 'subscription_notice' then 3
    when 'lost_item_report' then 3
    when 'safety_resolution_closed' then 3
    when 'safety_resolution_blocked' then 3
    -- ٤ = منخفضٌ: البثُّ الجماعيُّ.
    when 'broadcast_recipient' then 4
    -- المجهولُ **حرجٌ** لا منخفضٌ: نوعٌ جديدٌ نُسيَ تصنيفُه يُقدَّمُ لا يُؤخَّرُ،
    -- وسهوُه يُكشَفُ في CI بحاجزِ `scripts/check-traffic-priority.ts` لا في حادثةٍ.
    else 1
  end::smallint;
$$;

revoke all on function notification_kind_priority(text) from public, anon, authenticated;
grant execute on function notification_kind_priority(text) to service_role;

-- ---------------------------------------------------------------------------
-- ٣) بذرُ سياسةِ الأنواعِ الجديدةِ — بنمطِ `cross join (values ...)` نفسِهِ الذي
--    تقرؤُه هجرةُ F6-05، ليُقابِلَهُ حاجزُ check-notification-classification.
--    والقناةُ `critical`: إشعارُ مآلٍ موجَّهٌ إلى فردٍ يُرسَلُ عبرَ تلغرام. ولا
--    `in_app`: لا صندوقَ واردٍ شخصيَّ له.
-- ---------------------------------------------------------------------------
insert into notification_kind_policy (city_id, kind, channel, description_ar)
select c.id, k.kind, 'critical', k.description_ar
  from cities c
  cross join (values
    ('safety_resolution_closed', 'إشعار مآلٍ عامٌّ للمُبلِّغِ: بلاغُهُ خُتِمَ'),
    ('safety_resolution_blocked', 'إشعار مآلٍ عامٌّ للمُبلِّغِ: اتُّخِذَ إجراءٌ')
  ) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;
