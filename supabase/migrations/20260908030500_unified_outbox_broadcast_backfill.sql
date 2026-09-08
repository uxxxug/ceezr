-- =============================================================================
-- F6-03 المرحلة 3 — ترحيل بيانات مستقبِلي البثّ القائمين من
-- `broadcast_recipients` إلى `notification_outbox`. Idempotent: تُشغَّل على
-- قاعدةٍ فيها حملاتٌ قائمة فتنقلها، وتُشغَّل على قاعدةٍ نظيفة فلا تصنع شيئًا.
--
-- ترجمة الحالات:
--   sent      → delivered (delivered_message_id = message_id، delivered_at = sent_at)
--   failed    → failed (error_code)
--   canceled  → canceled
--   pending   → pending (مع next_attempt_at)
--   sending   → sending (مع claim_token + claimed_at) — إن وُجدت صفوف عالقة
-- =============================================================================
-- الحالة: موسِّعة — أُضيف 2026-09-08 ضمن F6-03 المرحلة 3.
-- =============================================================================

insert into notification_outbox (
  id, city_id, kind, status, attempts, claim_token, claimed_at, next_attempt_at,
  delivered_message_id, delivered_at, created_at, payload,
  broadcast_campaign_id, recipient_user_id, chat_id, language_code, error_code,
  dedup_key
)
select
  r.id,
  r.city_id,
  'broadcast_recipient',
  case r.status
    when 'sent' then 'delivered'
    when 'failed' then 'failed'
    when 'canceled' then 'canceled'
    else r.status  -- pending, sending
  end,
  r.attempts,
  r.claim_token,
  r.claimed_at,
  r.next_attempt_at,
  case when r.status = 'sent' then r.message_id::text else null end,
  case when r.status = 'sent' then r.sent_at else null end,
  r.created_at,
  jsonb_build_object('audience', k.audience),
  r.campaign_id,
  r.user_id,
  r.chat_id,
  r.language_code,
  r.error_code,
  'broadcast:' || r.campaign_id::text || ':' || r.user_id::text
  from broadcast_recipients r
  join broadcast_campaigns k on k.id = r.campaign_id
 where not exists (
   select 1 from notification_outbox n
    where n.kind = 'broadcast_recipient' and n.broadcast_campaign_id = r.campaign_id
      and n.recipient_user_id = r.user_id
 );

-- فهرسُ الترحيل: القيد الجزئي `notification_outbox_broadcast_recipient_uidx`
-- يكفي للتفريد، لكن نتأكّد هنا أنّ الترحيل لم يكرّر صفًّا.
