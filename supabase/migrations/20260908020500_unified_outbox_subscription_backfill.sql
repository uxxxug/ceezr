-- =============================================================================
-- F6-03 / ADR-0061: ترحيلُ صفوفِ إشعاراتِ الاشتراكِ القديمةِ من subscription_notices
--   إلى notification_outbox الموحَّد.
-- الحالة: منفّذ (مرحلةُ التوسيعِ — شطرٌ مكمِّلٌ للمرحلةِ الثانية).
-- يبني على: 20260908020000 (توحيدُ subscription_notice)، 20260908021000 (تحديدُ المطالبة).
-- ينتمي إلى: supabase/migrations.
--
-- ## ما تُغيّره هذه الهجرة
--
-- بعدَ أن صارَ `notification_outbox` مصدرَ حالةِ تسليمِ إشعاراتِ الاشتراكِ، تصيرُ
-- أيُّ صفوفٍ بقيت في `subscription_notices` (pending/sending/sent/failed) يتيمةً —
-- فالدوالُّ الجديدةُ لا تقرؤها. تُرحَّلُ إلى `notification_outbox` بتركيبِها نفسِه:
--   - id يُحفَظُ كما هو (لا تُولَّدُ قيمٌ جديدةٌ) حتى لا تتكسرَ مراجعُ سجلّاتِ التدقيق.
--   - status: pending→pending، sending→sending (مع claim_token/claimed_at)،
--     sent→delivered (مع delivered_message_id=message_id)، failed→failed (مع error_code).
--   - chat_id وlanguage_code وerror_code من الأعمدةِ القديمةِ.
--   - payload يُبنى من الحمولةِ القديمةِ + notice_kind + subscription_id + group_link.
--   - dedup_key = 'subscription:'||subscription_id||':'||kind.
--
-- الترحيلُ idempotent: يُفلتُ من التعارضِ على (kind, dedup_key) فلا يُضاعفُ إن أُعيد.
--
-- ## ما لا تُغيّره
--
-- جدولُ `subscription_notices` لا يُسقَطُ هنا (يُسقَطُ في هجرةِ التقليصِ). والصفوفُ
-- القديمةُ تُتركُ في مكانِها كنسخةٍ احتياطيةٍ حتى يستقرَّ التسليمُ من المصدرِ الموحَّد.
--
-- ## العودة
--
-- ترحيلُ بياناتٍ بـINSERT ... ON CONFLICT DO NOTHING: العودةُ حذفُ ما رُحِّلَ من
-- notification_outbox حيثُ kind='subscription_notice' (وهو ما تفعله هجرةُ التقليصِ
-- لاحقاً بإسقاطِ الجدولِ القديمِ، أو تُحذفُ يدوياً). والأمانُ: لا يُغيّرُ الترحيلُ
-- أيَّ صفٍّ موجودٍ في notification_outbox، بل يُضيفُ فقط.
-- =============================================================================

insert into notification_outbox
  (id, city_id, kind, dedup_key, chat_id, language_code, error_code,
   delivered_message_id, delivered_at, payload, status, attempts, claim_token, claimed_at,
   next_attempt_at, created_at, updated_at)
select
  n.id,
  n.city_id,
  'subscription_notice',
  'subscription:' || n.subscription_id::text || ':' || n.kind::text,
  n.chat_id,
  n.language_code,
  n.error_code,
  case when n.message_id is not null then n.message_id::text end,
  case when n.status::text = 'sent' then n.sent_at end,
  coalesce(n.payload, '{}'::jsonb)
    || jsonb_build_object(
         'notice_kind', n.kind::text,
         'subscription_id', n.subscription_id,
         'group_link', coalesce(
           get_setting(n.city_id, 'unsubscribed_drivers_group_link') #>> '{}', ''))
    ,
  case n.status::text
    when 'sent' then 'delivered'
    when 'failed' then 'failed'
    else n.status::text
  end,
  n.attempts,
  n.claim_token,
  case when n.status::text = 'sending' then n.claimed_at end,
  n.next_attempt_at,
  n.created_at,
  coalesce(n.sent_at, n.created_at)
from subscription_notices n
on conflict (kind, dedup_key) do nothing;
